import type { PolicyInput, RiskLevel } from './types'

export const LIMITS = {
  /** 日累计转出超过该值即为大额（分） */
  dailyLargeCents: 100_000,
  /** 夜间单笔超过该值升级（分） */
  nightSingleCents: 50_000,
  /** 10 分钟内转账笔数超过该值触发熔断 */
  burstTransfers: 5,
  /** 新收款人观察期（天） */
  newPayeeDays: 7,
} as const

export type RuleResult =
  | { kind: 'raise'; to: RiskLevel; reason: string }
  | { kind: 'deny'; reason: string }
  | null

export interface Rule {
  id: string
  applies: (input: PolicyInput) => boolean
  evaluate: (input: PolicyInput) => RuleResult
}

/** 工具参数金额统一以「元」表示（对模型更不易出错），规则内部换算为分 */
function amountCents(input: PolicyInput): number {
  const v = input.args.amount
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) : 0
}

const isTransfer = (i: PolicyInput) => i.tool === 'transfer'

export const RULES: Rule[] = [
  {
    id: 'account-locked',
    applies: () => true,
    evaluate: ({ facts, baseRisk }) =>
      facts.accountLocked && baseRisk !== 'green'
        ? { kind: 'deny', reason: '账户因安全原因已临时锁定，请联系人工客服' }
        : null,
  },
  {
    id: 'transfer-burst',
    applies: isTransfer,
    evaluate: ({ facts }) =>
      facts.recentTransferCount >= LIMITS.burstTransfers
        ? { kind: 'deny', reason: '短时间内转账过于频繁，已触发风控熔断' }
        : null,
  },
  {
    id: 'transfer-daily-large',
    applies: isTransfer,
    evaluate: (input) =>
      input.facts.dailyOutgoingCents + amountCents(input) > LIMITS.dailyLargeCents
        ? { kind: 'raise', to: 'red', reason: '今日累计转账超过 1000 元，需要强验证' }
        : null,
  },
  {
    id: 'transfer-new-payee',
    applies: isTransfer,
    evaluate: ({ facts }) =>
      facts.payeeAgeDays === undefined || facts.payeeAgeDays < LIMITS.newPayeeDays
        ? { kind: 'raise', to: 'red', reason: '首次或近期新增的收款人，需要强验证' }
        : null,
  },
  {
    id: 'transfer-night',
    applies: isTransfer,
    evaluate: (input) => {
      const hour = input.facts.now.getHours()
      return hour < 6 && amountCents(input) > LIMITS.nightSingleCents
        ? { kind: 'raise', to: 'red', reason: '夜间大额转账，需要强验证' }
        : null
    },
  },
]
