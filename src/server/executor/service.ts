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
  const state = await resume(await load(ctx, planId), nodeId, output, bankRunner(ctx, planId))
  await persist(ctx, state)
  return state
}

export async function rejectPlanNode(ctx: AgentContext, planId: string, nodeId: string) {
  const state = await reject(await load(ctx, planId), nodeId, bankRunner(ctx, planId))
  await persist(ctx, state)
  return state
}
