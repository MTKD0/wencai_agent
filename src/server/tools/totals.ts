import { centsToYuan, yuanToCents } from '#/lib/money'

/**
 * 工具结果的服务端合计（见 BankToolDef.totals）。按整数分累加，避免浮点误差；
 * 模型复述总余额、订阅年费等汇总数时引用这些值，回复才能通过数字核验。
 */
/** 每项订阅一年的费用（按月扣费的 × 12）：“音乐会员一年多少”直接引用这个字段，不让模型自己乘 */
export const withAnnualCost = <T extends { amount: number; cycle: string }>(items: T[]) =>
  items.map((s) => ({ ...s, annualCost: centsToYuan(yuanToCents(s.amount) * (s.cycle === 'monthly' ? 12 : 1)) }))

export const sumYuan = (values: number[]) => centsToYuan(values.reduce((sum, v) => sum + yuanToCents(v), 0))

/** 订阅合计：只计有效订阅；没有 status 的识别候选视为有效 */
export function subscriptionTotals(items: { amount: number; cycle: string; status?: string }[]) {
  const active = items.filter((s) => (s.status ?? 'active') === 'active')
  const monthlyCents = yuanToCents(sumYuan(active.filter((s) => s.cycle === 'monthly').map((s) => s.amount)))
  const yearlyCents = yuanToCents(sumYuan(active.filter((s) => s.cycle === 'yearly').map((s) => s.amount)))
  return {
    activeCount: active.length,
    /** 按月扣费的订阅每月合计 */
    monthlyTotal: centsToYuan(monthlyCents),
    /** 按月扣费的订阅一年合计（每月合计 × 12） */
    monthlyAnnualTotal: centsToYuan(monthlyCents * 12),
    /** 按年扣费的订阅合计 */
    yearlyTotal: centsToYuan(yearlyCents),
    /** 全部有效订阅一年的费用 */
    annualTotal: centsToYuan(monthlyCents * 12 + yearlyCents),
  }
}
