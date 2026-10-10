import { describe, expect, it } from 'vitest'
import { advance, initPlanState, reject, resume } from '#/server/executor/executor'
import type { NodeRunner } from '#/server/executor/executor'
import { validatePlan } from '#/server/planner/dag'
import type { Plan, PlanNode } from '#/server/planner/dag'
import type { ToolOutcome } from '#/server/tools/define'

const TOOLS = new Set(['get_anniversary', 'suggest_budget', 'earmark_funds', 'set_reminder', 'transfer'])

function fakeRunner(behaviour: Record<string, (args: Record<string, unknown>) => ToolOutcome>) {
  const calls: string[] = []
  const compensated: string[] = []
  const runner: NodeRunner = {
    run: async (node: PlanNode, args) => {
      calls.push(node.id)
      return behaviour[node.tool!]?.(args) ?? { status: 'done', data: { ok: true } }
    },
    compensate: async (node) => {
      compensated.push(node.id)
      return true
    },
  }
  return { runner, calls, compensated }
}

const birthday: Plan = {
  goal: '为爱人生日做准备',
  nodes: [
    { id: 'n1', kind: 'tool', tool: 'get_anniversary', args: {}, dependsOn: [] },
    { id: 'n2', kind: 'tool', tool: 'suggest_budget', args: { date: { $ref: 'n1.date' } }, dependsOn: ['n1'] },
    { id: 'n3', kind: 'tool', tool: 'earmark_funds', args: { amount: { $ref: 'n2.amount' } }, dependsOn: ['n2'] },
    { id: 'n4', kind: 'tool', tool: 'set_reminder', args: {}, dependsOn: ['n3'] },
  ],
}

const pending = (id: string): ToolOutcome => ({
  status: 'needs_confirmation',
  actionId: id,
  level: 'yellow',
  reasons: [],
  summary: { title: 't', fields: [] },
  expiresAt: 0,
})

describe('DAG 校验', () => {
  it('合法计划通过并给出拓扑序', () => {
    const v = validatePlan(birthday, TOOLS)
    expect(v.ok && v.order).toEqual(['n1', 'n2', 'n3', 'n4'])
  })

  it('拒绝循环依赖', () => {
    const v = validatePlan(
      { goal: 'x', nodes: [{ id: 'a', tool: 'transfer', dependsOn: ['b'] }, { id: 'b', tool: 'transfer', dependsOn: ['a'] }] },
      TOOLS,
    )
    expect(v.ok).toBe(false)
  })

  it('拒绝白名单外的工具（如模型臆造的 admin_override）', () => {
    const v = validatePlan({ goal: 'x', nodes: [{ id: 'a', tool: 'admin_override' }] }, TOOLS)
    expect(v.ok).toBe(false)
  })

  it('$ref 只能引用直接依赖', () => {
    const v = validatePlan({ goal: 'x', nodes: [{ id: 'a', tool: 'transfer' }, { id: 'b', tool: 'transfer', args: { x: { $ref: 'a.y' } } }] }, TOOLS)
    expect(v.ok).toBe(false)
  })
})

describe('DAG 执行器', () => {
  it('遇到需确认节点挂起，确认后恢复并完成', async () => {
    const { runner, calls } = fakeRunner({
      get_anniversary: () => ({ status: 'done', data: { date: '10-20' } }),
      suggest_budget: (a) => ({ status: 'done', data: { amount: 1000, for: a.date } }),
      earmark_funds: () => pending('pa_1'),
    })
    let s = await advance(initPlanState('p1', birthday), runner)
    expect(s.status).toBe('suspended')
    expect(s.nodes.n3.status).toBe('suspended')
    expect(s.nodes.n4.status).toBe('pending')
    expect((s.nodes.n2.output as { for: string }).for).toBe('10-20') // $ref 解析

    s = await resume(s, 'n3', { earmarked: 1000 }, runner)
    expect(s.status).toBe('completed')
    expect(calls).toEqual(['n1', 'n2', 'n3', 'n4'])
  })

  it('节点失败时逆序补偿已完成的步骤', async () => {
    const { runner, compensated } = fakeRunner({ earmark_funds: () => ({ status: 'error', message: '余额不足' }) })
    const s = await advance(initPlanState('p2', birthday), runner)
    expect(s.status).toBe('compensated')
    expect(compensated).toEqual(['n2', 'n1'])
    expect(s.nodes.n4.status).toBe('skipped')
  })

  it('用户拒绝确认触发补偿', async () => {
    const { runner, compensated } = fakeRunner({ earmark_funds: () => pending('pa_2') })
    const s = await reject(await advance(initPlanState('p3', birthday), runner), 'n3', runner)
    expect(s.status).toBe('compensated')
    expect(s.nodes.n3.status).toBe('failed')
    expect(compensated).toEqual(['n2', 'n1'])
  })

  it('风控拒绝时终止计划', async () => {
    const { runner } = fakeRunner({ suggest_budget: () => ({ status: 'denied', reasons: ['熔断'] }) })
    const s = await advance(initPlanState('p4', birthday), runner)
    expect(s.nodes.n2).toMatchObject({ status: 'failed', error: '熔断' })
  })

  it('handoff 节点转人工', async () => {
    const { runner } = fakeRunner({})
    const plan: Plan = { goal: '投诉', nodes: [{ id: 'h', kind: 'handoff', args: {}, dependsOn: [] }] }
    expect((await advance(initPlanState('p5', plan), runner)).status).toBe('handoff')
  })
})
