import { and, eq, gte, inArray, lt } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { auth, db, schema } from '#/server/db/client'

/**
 * 行为画像信号（诱导转账识别第二层）：不看用户说了什么，只看“这笔转账和本人平时是否一样”。
 *
 * 基线由代码从本人流水算出（`collectTransferBaseline`），信号由纯函数按本笔金额判定（`behaviorSignals`）。
 * 与话术识别一样只产生事实，是否升级由 rules.ts 决定，命中只会升级、不会拒绝或放行。
 * 这里刻意不复用后台用户画像（profile/）：画像要读六个月全部流水和基金持仓，太重，且按设计不进入策略引擎。
 */
export type BehaviorSignal = 'amount_spike' | 'drains_balance' | 'new_payee' | 'liquidated_today' | 'fresh_login' | 'many_new_payees' | 'late_night'

export const BEHAVIOR_SIGNAL_TEXT: Record<BehaviorSignal, string> = {
  amount_spike: '金额明显高于您平时的转账',
  drains_balance: '一次转出活期余额的一半以上',
  new_payee: '首次向该收款人转账',
  liquidated_today: '今天刚赎回理财又大额转出',
  fresh_login: '刚登录不久就大额转账',
  many_new_payees: '今天已向多个新收款人转账',
  late_night: '深夜大额转账',
}

export interface TransferBaseline {
  /** 近 180 天转给他人的单笔金额中位数（分）；样本少于 3 笔时为 null，按新用户默认阈值处理 */
  medianOutCents: number | null
  sampleCount: number
  /** 近 90 天月均外部入账（分）：排除本人互转、理财、冲正、开户 */
  monthlyIncomeCents: number
  /** 储蓄类账户可用余额合计（分），不含信用卡 */
  liquidBalanceCents: number
  /** 收款人以前是否收到过本人转账；不是已保存收款人时为 undefined */
  payeePaidBefore?: boolean
  payeeAddedHoursAgo?: number
  /** 今天（北京时间）理财赎回到账合计（分） */
  redeemedTodayCents: number
  /** 今天已首次转账的新收款人个数（不含本笔） */
  newPayeesToday: number
  /** 当前登录会话已存在的分钟数；不是网页会话时为 undefined */
  sessionAgeMinutes?: number
  /** 北京时间的小时 */
  beijingHour: number
}

/** 阈值集中在这里，评测与文档引用同一份 */
export const BEHAVIOR_THRESHOLDS = {
  /** 本笔 ≥ 平时中位数的倍数，且不低于 minSpikeCents */
  spikeMultiple: 5,
  minSpikeCents: 200_000,
  /** 历史样本不足时（新用户）的大额线 */
  coldStartSpikeCents: 500_000,
  /** 以下信号只在本笔不低于这个金额时才计 */
  notableCents: 100_000,
  newPayeeCents: 50_000,
  drainShare: 0.5,
  freshLoginMinutes: 30,
  /** 至少命中几个信号才升级 */
  minSignals: 2,
} as const

const DAY = 86_400_000
const beijingDayStart = (now: Date) => Math.floor((now.getTime() + 8 * 3600_000) / DAY) * DAY - 8 * 3600_000

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

/** 纯函数：同样的金额与基线永远得到同样的信号 */
export function behaviorSignals(amountCents: number, b: TransferBaseline): BehaviorSignal[] {
  const t = BEHAVIOR_THRESHOLDS
  const signals: BehaviorSignal[] = []
  const spike = b.medianOutCents !== null
    ? amountCents >= Math.max(b.medianOutCents * t.spikeMultiple, t.minSpikeCents)
    : amountCents >= t.coldStartSpikeCents
  const aboveIncome = b.monthlyIncomeCents > 0 && amountCents >= b.monthlyIncomeCents && amountCents >= t.minSpikeCents
  if (spike || aboveIncome) signals.push('amount_spike')
  if (amountCents >= t.notableCents && b.liquidBalanceCents > 0 && amountCents >= b.liquidBalanceCents * t.drainShare) signals.push('drains_balance')
  if (amountCents >= t.newPayeeCents && (b.payeePaidBefore === false || (b.payeeAddedHoursAgo !== undefined && b.payeeAddedHoursAgo < 24))) signals.push('new_payee')
  if (amountCents >= t.notableCents && b.redeemedTodayCents >= amountCents * 0.5) signals.push('liquidated_today')
  if (amountCents >= t.notableCents && b.sessionAgeMinutes !== undefined && b.sessionAgeMinutes < t.freshLoginMinutes) signals.push('fresh_login')
  if (b.newPayeesToday >= 2) signals.push('many_new_payees')
  if (amountCents >= t.notableCents && b.beijingHour < 6) signals.push('late_night')
  return signals
}

const target = alias(schema.accounts, 'baseline_target')

/** 只读采集本人的转账基线。只在转给已保存收款人时调用。 */
export async function collectTransferBaseline(params: { userId: string; now: Date; payeeId?: string; sessionId?: string }): Promise<TransferBaseline> {
  const { userId, now } = params
  const todayStart = beijingDayStart(now)
  const [accounts, creditCards] = await Promise.all([
    db.select().from(schema.accounts).where(eq(schema.accounts.userId, userId)),
    db.select({ accountId: schema.cards.accountId }).from(schema.cards).where(and(eq(schema.cards.userId, userId), eq(schema.cards.kind, 'credit'))),
  ])
  const ids = accounts.map((a) => a.id)
  const creditIds = new Set(creditCards.map((c) => c.accountId))
  const liquidBalanceCents = accounts.filter((a) => !creditIds.has(a.id)).reduce((n, a) => n + Math.max(0, a.balanceCents), 0)
  if (!ids.length) return { medianOutCents: null, sampleCount: 0, monthlyIncomeCents: 0, liquidBalanceCents, redeemedTodayCents: 0, newPayeesToday: 0, beijingHour: new Date(now.getTime() + 8 * 3600_000).getUTCHours() }

  const rows = await db.select({
    id: schema.transactions.id, cents: schema.transactions.amountCents, category: schema.transactions.category,
    counterparty: schema.transactions.counterparty, at: schema.transactions.occurredAt, targetUserId: target.userId,
  }).from(schema.transactions)
    .leftJoin(schema.bankTransferLinks, eq(schema.bankTransferLinks.debitTransactionId, schema.transactions.id))
    .leftJoin(target, eq(target.id, schema.bankTransferLinks.targetAccountId))
    .where(and(inArray(schema.transactions.accountId, ids), gte(schema.transactions.occurredAt, new Date(now.getTime() - 180 * DAY)), lt(schema.transactions.occurredAt, new Date(now.getTime() + 1))))

  // 入账一侧的本人互转：贷方流水的对应借方属于本人账户
  const internalCredits = new Set((await db.select({ creditId: schema.bankTransferLinks.creditTransactionId, debitId: schema.bankTransferLinks.debitTransactionId })
    .from(schema.bankTransferLinks).innerJoin(schema.transactions, eq(schema.transactions.id, schema.bankTransferLinks.debitTransactionId))
    .where(inArray(schema.transactions.accountId, ids))).map((l) => l.creditId).filter((id): id is string => !!id))

  const outToOthers = rows.filter((r) => r.cents < 0 && r.category === '转账' && r.targetUserId !== userId)
  const amounts = outToOthers.map((r) => -r.cents)
  const firstPaid = new Map<string, number>()
  for (const r of outToOthers) firstPaid.set(r.counterparty, Math.min(firstPaid.get(r.counterparty) ?? Infinity, r.at.getTime()))
  const newPayeesToday = [...firstPaid.values()].filter((at) => at >= todayStart).length

  const income = rows.filter((r) => r.cents > 0 && r.at.getTime() >= now.getTime() - 90 * DAY && !internalCredits.has(r.id) && !['理财', '冲正', 'opening'].includes(r.category))
  const redeemedTodayCents = rows.filter((r) => r.cents > 0 && r.category === '理财' && r.at.getTime() >= todayStart).reduce((n, r) => n + r.cents, 0)

  let payeePaidBefore: boolean | undefined, payeeAddedHoursAgo: number | undefined
  if (params.payeeId) {
    const [payee] = await db.select().from(schema.payees).where(and(eq(schema.payees.id, params.payeeId), eq(schema.payees.userId, userId)))
    if (payee) {
      payeePaidBefore = firstPaid.has(payee.name)
      payeeAddedHoursAgo = (now.getTime() - payee.createdAt.getTime()) / 3600_000
    }
  }
  let sessionAgeMinutes: number | undefined
  if (params.sessionId) {
    const [session] = await db.select({ createdAt: auth.baSession.createdAt }).from(auth.baSession).where(and(eq(auth.baSession.id, params.sessionId), eq(auth.baSession.userId, userId))).catch(() => [])
    if (session) sessionAgeMinutes = Math.max(0, (Date.now() - session.createdAt.getTime()) / 60_000)
  }

  return {
    medianOutCents: amounts.length >= 3 ? median(amounts) : null,
    sampleCount: amounts.length,
    monthlyIncomeCents: Math.round(income.reduce((n, r) => n + r.cents, 0) / 3),
    liquidBalanceCents,
    ...(payeePaidBefore !== undefined ? { payeePaidBefore } : {}),
    ...(payeeAddedHoursAgo !== undefined ? { payeeAddedHoursAgo } : {}),
    redeemedTodayCents,
    newPayeesToday,
    ...(sessionAgeMinutes !== undefined ? { sessionAgeMinutes } : {}),
    beijingHour: new Date(now.getTime() + 8 * 3600_000).getUTCHours(),
  }
}
