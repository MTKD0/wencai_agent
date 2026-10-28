import { describe, expect, it } from 'vitest'
import { subscriptionTotals, sumYuan, withAnnualCost } from '#/server/tools/totals'
import { runBankTool } from '#/server/tools/runner'
import { resolveTool } from '#/server/tools/bank'
import { DEMO_USER_ID } from '#/server/db/constants'
import { checkedResponse } from '#/server/verify/response'

const ctx = { userId: DEMO_USER_ID, sessionId: `totals-${Date.now()}`, channel: 'web' as const }

describe('服务端合计', () => {
  it('按整数分累加，没有浮点误差', () => {
    expect(sumYuan([0.1, 0.2])).toBe(0.3)
    expect(sumYuan([23568.2, 80000])).toBe(103568.2)
  })
  it('订阅合计只计有效订阅，并给出按月、按年和全年费用', () => {
    expect(subscriptionTotals([
      { amount: 25, cycle: 'monthly', status: 'active' },
      { amount: 15, cycle: 'monthly', status: 'active' },
      { amount: 298, cycle: 'yearly', status: 'active' },
      { amount: 99, cycle: 'monthly', status: 'cancelled' },
    ])).toEqual({ activeCount: 3, monthlyTotal: 40, monthlyAnnualTotal: 480, yearlyTotal: 298, annualTotal: 778 })
    // 识别候选没有 status，视为有效
    expect(subscriptionTotals([{ amount: 25, cycle: 'monthly' }]).annualTotal).toBe(300)
  })
  it('get_accounts 经 runner 返回合计，且不改变 data 的数组结构', async () => {
    const outcome = await runBankTool(resolveTool('get_accounts')!, {}, ctx)
    if (outcome.status !== 'done') throw new Error(outcome.status)
    const rows = outcome.data as { balance: number }[]
    expect(Array.isArray(rows)).toBe(true)
    expect(outcome.totals).toEqual({ totalBalance: sumYuan(rows.map((r) => r.balance)), accountCount: rows.length })
  })
})

describe('减少模型心算', () => {
  it('每项订阅带一年费用：按月的 × 12，按年的原样', () => {
    expect(withAnnualCost([{ amount: 15, cycle: 'monthly' }, { amount: 298, cycle: 'yearly' }, { amount: 25.9, cycle: 'monthly' }]).map((s) => s.annualCost)).toEqual([180, 298, 310.8])
  })
  it('年度账单按月拆分并给出月均支出；月度账期不附加', async () => {
    const year = await runBankTool(resolveTool('get_spending_report')!, { period: '2026' }, ctx)
    if (year.status !== 'done') throw new Error(year.status)
    const data = year.data as { expense: number; byMonth: { expense: number }[]; monthsWithActivity: number; averageMonthlyExpense: number }
    expect(data.byMonth.length).toBe(data.monthsWithActivity)
    expect(Math.round(data.byMonth.reduce((s, m) => s + m.expense * 100, 0))).toBe(Math.round(data.expense * 100))
    expect(data.averageMonthlyExpense).toBeCloseTo(data.expense / data.monthsWithActivity, 1)
    const month = await runBankTool(resolveTool('get_spending_report')!, { period: '2026-09' }, ctx)
    if (month.status !== 'done') throw new Error(month.status)
    expect(month.data).not.toHaveProperty('byMonth')
  })
})

describe('数字核验接受服务端合计', () => {
  const data = [{ name: '工资卡', balance: 23568.2 }, { name: '储蓄账户', balance: 80000 }]
  it('合计出现在工具结果里时，复述总余额可以通过', () => {
    const evidence = [{ status: 'done', data, totals: { totalBalance: 103568.2 } }]
    expect(checkedResponse('两个账户合计 **¥103,568.20**。', evidence, false, false).blocked).toBe(false)
  })
  it('没有合计时，模型心算的总余额仍被拦下；编造的数字始终被拦', () => {
    expect(checkedResponse('两个账户合计 ¥103,568.20。', [{ status: 'done', data }], false, false).blocked).toBe(true)
    expect(checkedResponse('两个账户合计 ¥999,999.00。', [{ status: 'done', data, totals: { totalBalance: 103568.2 } }], false, false).blocked).toBe(true)
  })
})
