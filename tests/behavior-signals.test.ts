import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db, schema } from '#/server/db/client'
import { ensurePaymentsSchema } from '#/server/payments/migrate'
import { behaviorSignals, collectTransferBaseline, type TransferBaseline } from '#/server/policy/behavior'
import { decide } from '#/server/policy/engine'
import { runBankTool } from '#/server/tools/runner'
import { transfer } from '#/server/tools/bank'
import { UNUSUAL_REASON_PREFIX } from '#/lib/fraud'
import type { PolicyFacts } from '#/server/policy/types'

const base: TransferBaseline = { medianOutCents: 30_000, sampleCount: 10, monthlyIncomeCents: 800_000, liquidBalanceCents: 2_000_000, payeePaidBefore: true, payeeAddedHoursAgo: 2000, redeemedTodayCents: 0, newPayeesToday: 0, beijingHour: 14 }

describe('行为信号（纯函数）', () => {
  it('平时的金额、老收款人、白天转账不产生信号', () => {
    expect(behaviorSignals(50_000, base)).toEqual([])
  })
  it('金额远超平时、首次收款人、掏空余额、刚赎回理财、刚登录、深夜各自独立判定', () => {
    expect(behaviorSignals(300_000, base)).toContain('amount_spike')
    expect(behaviorSignals(100_000, { ...base, payeePaidBefore: false })).toContain('new_payee')
    expect(behaviorSignals(100_000, { ...base, payeePaidBefore: true, payeeAddedHoursAgo: 3 })).toContain('new_payee')
    expect(behaviorSignals(1_200_000, base)).toEqual(expect.arrayContaining(['amount_spike', 'drains_balance']))
    expect(behaviorSignals(200_000, { ...base, redeemedTodayCents: 200_000 })).toContain('liquidated_today')
    expect(behaviorSignals(200_000, { ...base, sessionAgeMinutes: 5 })).toContain('fresh_login')
    expect(behaviorSignals(200_000, { ...base, beijingHour: 2 })).toContain('late_night')
    expect(behaviorSignals(10_000, { ...base, newPayeesToday: 2 })).toEqual(['many_new_payees'])
  })
  it('小额不计首次收款人、深夜、刚登录：避免第一次给朋友转 50 元就被提醒', () => {
    expect(behaviorSignals(5_000, { ...base, payeePaidBefore: false, sessionAgeMinutes: 1, beijingHour: 1 })).toEqual([])
  })
  it('新用户没有历史样本时用默认大额线（5000 元）', () => {
    const fresh = { ...base, medianOutCents: null, sampleCount: 0, monthlyIncomeCents: 0 }
    expect(behaviorSignals(400_000, fresh)).not.toContain('amount_spike')
    expect(behaviorSignals(500_000, fresh)).toContain('amount_spike')
  })
  it('超过月均收入也算金额异常；收入未知时不算', () => {
    expect(behaviorSignals(250_000, { ...base, medianOutCents: 100_000, monthlyIncomeCents: 240_000 })).toContain('amount_spike')
    expect(behaviorSignals(250_000, { ...base, medianOutCents: 100_000, monthlyIncomeCents: 0 })).not.toContain('amount_spike')
  })
})

describe('策略：至少两项信号才升红', () => {
  const facts = (baseline: TransferBaseline): PolicyFacts => ({ now: new Date('2026-10-10T06:00:00Z'), channel: 'web', accountLocked: false, dailyOutgoingCents: 0, recentTransferCount: 0, transferBaseline: baseline })
  const input = (amount: number, baseline: TransferBaseline, tool = 'transfer') => ({ tool, baseRisk: 'yellow' as const, args: { amount }, facts: facts(baseline) })
  it('一项信号不升级，两项升红并写明原因', () => {
    expect(decide(input(800, { ...base, payeePaidBefore: false })).level).toBe('yellow')
    const d = decide(input(3000, { ...base, payeePaidBefore: false }))
    expect(d.level).toBe('red')
    expect(d.reasons.find((r) => r.startsWith(UNUSUAL_REASON_PREFIX))).toContain('首次向该收款人转账')
  })
  it('本人互转、AA 付款不适用', () => {
    expect(decide({ ...input(0, base, 'transfer_between_cards'), args: { amountCents: 1_500_000 } }).reasons.some((r) => r.startsWith(UNUSUAL_REASON_PREFIX))).toBe(false)
  })
})

describe('基线采集与完整链路', () => {
  const uid = 'behavior_user', other = 'behavior_other', acct = 'behavior_acct', credit = 'behavior_credit', target = 'behavior_target'
  const ctx = { userId: uid, sessionId: 'behavior-session', channel: 'web' as const }
  const known = 'behavior_known', fresh = 'behavior_fresh'
  const tx = (cents: number, category: string, counterparty: string, at: Date) => ({ id: `bh_${randomUUID()}`, accountId: acct, amountCents: cents, category, counterparty, occurredAt: at })
  beforeAll(async () => {
    await ensurePaymentsSchema()
    await db.insert(schema.users).values([{ id: uid, name: '画像用户' }, { id: other, name: '画像他人' }])
    await db.insert(schema.accounts).values([{ id: acct, userId: uid, name: '储蓄', balanceCents: 1_000_000 }, { id: credit, userId: uid, name: '信用', balanceCents: 5_000_000 }, { id: target, userId: other, name: '他人', balanceCents: 0 }])
    await db.insert(schema.cards).values({ id: 'behavior_credit_card', accountId: credit, userId: uid, kind: 'credit', last4: '5511', status: 'active', dailyLimitCents: 5_000_000 })
    // 有卡片档案的信用卡已绑定独立账户，不会被迁移；余额不计入可用活期
    await db.insert(schema.bankCardProfiles).values({ cardId: 'behavior_credit_card', remark: '信用卡', creditLimitCents: 5_000_000 })
    await db.insert(schema.payees).values([
      { id: known, userId: uid, name: '老朋友', bank: '工商银行', accountNo: '6222000011112222', createdAt: new Date(0) },
      { id: fresh, userId: uid, name: '陌生人', bank: '建设银行', accountNo: '6217000033334444', createdAt: new Date(Date.now() - 3600_000) },
    ])
  })
  beforeEach(async () => {
    await db.delete(schema.transactions).where(inArray(schema.transactions.accountId, [acct, credit]))
    await db.delete(schema.pendingActions).where(eq(schema.pendingActions.userId, uid))
    const now = Date.now(), day = 86_400_000
    await db.insert(schema.transactions).values([
      ...[20_000, 30_000, 40_000, 30_000].map((c, i) => tx(-c, '转账', '老朋友', new Date(now - (i + 2) * 10 * day))),
      ...[0, 1, 2].map((i) => tx(600_000, '工资', '公司', new Date(now - (i * 30 + 5) * day))),
      tx(-80_000, '餐饮', '饭店', new Date(now - 3 * day)),
    ])
  })
  afterAll(async () => {
    await db.delete(schema.transactions).where(inArray(schema.transactions.accountId, [acct, credit]))
    await db.delete(schema.pendingActions).where(eq(schema.pendingActions.userId, uid))
    await db.delete(schema.payees).where(eq(schema.payees.userId, uid))
    await db.delete(schema.bankCardProfiles).where(eq(schema.bankCardProfiles.cardId, 'behavior_credit_card'))
    await db.delete(schema.cards).where(eq(schema.cards.userId, uid))
    await db.delete(schema.accounts).where(inArray(schema.accounts.userId, [uid, other]))
    await db.delete(schema.users).where(inArray(schema.users.id, [uid, other]))
  })

  it('中位数只算转给他人的转账，余额不含信用卡，收款人是否付过款按历史判断', async () => {
    const b = await collectTransferBaseline({ userId: uid, now: new Date(), payeeId: fresh })
    expect(b).toMatchObject({ medianOutCents: 30_000, sampleCount: 4, monthlyIncomeCents: 600_000, liquidBalanceCents: 1_000_000, payeePaidBefore: false })
    expect(b.payeeAddedHoursAgo).toBeLessThan(2)
    expect((await collectTransferBaseline({ userId: uid, now: new Date(), payeeId: known })).payeePaidBefore).toBe(true)
  })
  it('给老朋友转平时的金额是黄色；给一小时前刚加的陌生人转 6000 元升红并带行为提醒', async () => {
    const normal = await runBankTool(transfer, { fromAccountId: acct, payeeId: known, amount: 300 }, ctx)
    expect(normal).toMatchObject({ status: 'needs_confirmation', level: 'yellow' })
    const odd = await runBankTool(transfer, { fromAccountId: acct, payeeId: fresh, amount: 6000 }, ctx)
    if (odd.status !== 'needs_confirmation') throw new Error(JSON.stringify(odd))
    expect(odd.level).toBe('red')
    expect(odd.reasons.find((r) => r.startsWith(UNUSUAL_REASON_PREFIX))).toMatch(/金额明显高于.*一次转出活期余额的一半以上.*首次向该收款人转账/)
  })
})
