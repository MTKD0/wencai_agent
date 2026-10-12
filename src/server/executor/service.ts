import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db, schema } from '#/server/db/client'
import { audit } from '#/server/audit/log'
import { cancelPending } from '#/server/confirm/pending'
import { validatePlan } from '#/server/planner/dag'
import { resolveTool } from '#/server/tools/bank'
import { runBankTool } from '#/server/tools/runner'
import type { AgentContext } from '#/server/agent/context'
import { advance, initPlanState, reject, resume } from './executor'
import type { NodeRunner, PlanState } from './executor'
import { withUserExecutionLock } from '#/server/confirm/lock'
import { getConfirmationResult } from '#/server/confirm/result'

function bankRunner(ctx: AgentContext, planId: string): NodeRunner {
  return {
    run: (node, args) => runBankTool(resolveTool(node.tool!)!, args, ctx, { planId, nodeId: node.id }),
    compensate: async (node, args, output) => {
      const def = resolveTool(node.tool!)
      if (!def || def.kind === 'read') return true // 只读操作无需补偿
      if (!def.compensate) return false
      await def.compensate(args, output, ctx)
      await audit(ctx, 'action_compensated', { planId, nodeId: node.id, tool: node.tool })
      return true
    },
  }
}

async function persist(ctx: AgentContext, state: PlanState) {
  await db
    .insert(schema.plans)
    .values({ id: state.id, userId: ctx.userId, sessionId: ctx.sessionId, stateJson: JSON.stringify(state), status: state.status, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.plans.id,
      set: { stateJson: JSON.stringify(state), status: state.status, updatedAt: new Date() },
    })
  // 计划终止时，作废仍挂起的待确认动作，避免孤儿确认单
  if (state.status === 'failed' || state.status === 'compensated' || state.status === 'handoff') {
    for (const n of Object.values(state.nodes)) if (n.status === 'suspended' && n.actionId) await cancelPending(ctx, n.actionId)
  }
  if (state.status === 'handoff') await audit(ctx, 'handoff', { planId: state.id, goal: state.plan.goal })
}

async function load(ctx: AgentContext, planId: string): Promise<PlanState> {
  const [row] = await db
    .select()
    .from(schema.plans)
    .where(and(eq(schema.plans.id, planId), eq(schema.plans.userId, ctx.userId)))
  if (!row) throw new Error('计划不存在')
  return JSON.parse(row.stateJson) as PlanState
}

export async function startPlan(ctx: AgentContext, input: unknown, allowedTools: Set<string>) {
  const v = validatePlan(input, allowedTools)
  if (!v.ok) return { ok: false as const, errors: v.errors }
  const id = `plan_${randomUUID()}`
  await audit(ctx, 'plan_created', { planId: id, plan: v.plan })
  const state = await advance(initPlanState(id, v.plan), bankRunner(ctx, id))
  await persist(ctx, state)
  return { ok: true as const, state }
}

export async function resumePlan(ctx: AgentContext, planId: string, nodeId: string, output: unknown) {
  return withUserExecutionLock(`plan:${planId}`, async () => {
    const current = await load(ctx, planId)
    if (current.nodes[nodeId]?.status === 'done') return current
    if (current.status === 'paused') throw new Error('任务已暂停')
    const state = await resume(current, nodeId, output, bankRunner(ctx, planId))
    await persist(ctx, state)
    return state
  })
}

export async function cancelActionAndPlan(ctx: AgentContext, actionId: string) {
  return withUserExecutionLock(ctx.userId, async () => {
    const [row] = await db.select().from(schema.pendingActions).where(and(eq(schema.pendingActions.id, actionId), eq(schema.pendingActions.userId, ctx.userId)))
    if (!row || row.status !== 'pending') throw new Error('该操作不存在或已处理')
    await cancelPending(ctx, actionId)
    return row.planId && row.nodeId ? rejectPlanNode(ctx, row.planId, row.nodeId) : undefined
  })
}

export async function controlPlan(ctx: AgentContext, planId: string, command: 'pause' | 'resume' | 'cancel' | 'complete_handoff' | 'acknowledge_failure', note = '') {
  return withUserExecutionLock(ctx.userId, () => withUserExecutionLock(`plan:${planId}`, async () => {
    let state = await load(ctx, planId)
    if (['completed', 'compensated'].includes(state.status)) throw new Error('计划已结束')
    if (state.status === 'failed' || command === 'acknowledge_failure') {
      if (state.status !== 'failed' || command !== 'acknowledge_failure' || !note.trim()) throw new Error('失败计划不能继续执行，请填写人工核对结果')
      state.manualReview = { note: note.trim(), at: new Date().toISOString() }
      await persist(ctx, state)
      await audit(ctx, 'handoff', { planId, resolved: true, ...state.manualReview })
      return state
    }
    if (command === 'pause') state.status = 'paused'
    else if (command === 'cancel') {
      const node = state.plan.nodes.find((n) => ['pending', 'suspended', 'handoff'].includes(state.nodes[n.id].status))
      if (!node) throw new Error('没有可取消的待执行节点')
      state = await reject(state, node.id, bankRunner(ctx, planId))
    } else {
      if (command === 'complete_handoff') {
        const node = state.plan.nodes.find((n) => state.nodes[n.id].status === 'handoff')
        if (!node || !note.trim()) throw new Error('请填写人工处理说明')
        state.nodes[node.id] = { status: 'done', output: { operatorNote: note, confirmedBy: 'account_owner' } }
        state.completed.push(node.id)
        await audit(ctx, 'handoff', { planId, nodeId: node.id, resolved: true, operatorNote: note })
      } else if (state.status !== 'paused' && state.status !== 'suspended') throw new Error('请先完成对应人工处理或核对')
      for (const [nodeId, node] of Object.entries(state.nodes)) if (node.status === 'suspended' && node.actionId) {
        const receipt = await getConfirmationResult(ctx.userId, node.actionId)
        if (receipt.status === 'completed') { state.nodes[nodeId] = { status: 'done', output: receipt.output }; if (!state.completed.includes(nodeId)) state.completed.push(nodeId) }
        else if (['expired', 'cancelled', 'not_found'].includes(receipt.status)) state.nodes[nodeId] = { status: 'pending' }
      }
      state.status = 'running'
      if (Object.values(state.nodes).some((node) => node.status === 'handoff')) state.status = 'handoff'
      else state = await advance(state, bankRunner(ctx, planId))
    }
    await persist(ctx, state)
    await audit(ctx, 'plan_control', { planId, command, status: state.status })
    return state
  }))
}

export async function rejectPlanNode(ctx: AgentContext, planId: string, nodeId: string) {
  const state = await reject(await load(ctx, planId), nodeId, bankRunner(ctx, planId))
  await persist(ctx, state)
  return state
}
