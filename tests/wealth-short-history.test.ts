import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, schema } from '#/server/db/client'
import { AdviceInput, expertTextViolations, getWealthAdvice, modelAdviceInput } from '#/server/funds/advice'
import { ensureFundData } from '#/server/funds/store'
import { requestedAmounts, requestedTransferMatches, transferClauseAmounts } from '#/lib/requested-amounts'
import { collectEvidence, verifyNumbers } from '#/server/verify/numbers'

describe('金额里的“万”', () => {
  it('用户请求中的“5 万”“1.5 万元”“2万块”按元计，不再被当成 5 元或忽略', () => {
    expect(requestedAmounts('手上 5 万闲钱，三年用不上')).toEqual([50000])
    expect(requestedAmounts('投 1.5 万元，再买 8000 块的')).toEqual([15000, 8000])
    expect(requestedAmounts('2万块')).toEqual([20000])
    expect(requestedAmounts('万一需要用钱，一万元也行')).toEqual([])
  })
  it('转账子句同样识别：给妈妈转 1 万是 10000 元，不是 1 元', () => {
    expect(transferClauseAmounts('给妈妈转 1 万')).toMatchObject([{ recipient: '妈妈', amount: 10000 }])
    expect(transferClauseAmounts('给王芳和张伟各转 0.5 万')).toMatchObject([{ recipient: '王芳', amount: 5000 }, { recipient: '张伟', amount: 5000 }])
    expect(requestedTransferMatches('给妈妈转 1 万', '妈妈', 10000)).toHaveLength(1)
    expect(requestedTransferMatches('给妈妈转 1 万', '妈妈', 1)).toEqual([])
  })
  it('回复核验按一万倍比对：编造的“9.9 万元”被拦，有出处的“5 万元”放行，“¥5.2万”不再当成 5.2 元', () => {
    const evidence = collectEvidence([{ amountCents: 5_000_000 }, 52000])
    expect(verifyNumbers('余额为 9.9 万元', evidence).map((v) => v.text)).toEqual(['9.9 万元'])
    expect(verifyNumbers('准备投入 5 万元', evidence)).toEqual([])
    expect(verifyNumbers('合计 ¥5.2万', evidence)).toEqual([])
  })
})

describe('收支记录不足三个月的理财建议', () => {
  const now = new Date('2026-10-22T04:00:00Z'), uid = 'short_history_customer', aid = 'short_history_account', cid = 'short_history_card'
  const ctx = (requestText: string) => ({ userId: uid, sessionId: 'short-history', channel: 'web' as const, requestText })
  const offline = async () => { throw new Error('offline') }
  beforeAll(async () => {
    await ensureFundData()
    await db.insert(schema.users).values({ id: uid, name: '新用户', riskRating: 'R3', riskAssessedAt: '2026-10-01T00:00:00Z' })
    await db.insert(schema.accounts).values({ id: aid, userId: uid, name: '新用户资金', balanceCents: 8_000_000 })
    await db.insert(schema.cards).values({ id: cid, userId: uid, accountId: aid, last4: '6611', kind: 'debit', status: 'active', dailyLimitCents: 5_000_000 })
    // 只有一个完整月份的支出
    await db.insert(schema.transactions).values({ id: 'short_history_tx', accountId: aid, amountCents: -300_000, category: '餐饮', counterparty: '餐厅', occurredAt: new Date('2026-09-15T04:00:00Z') })
  })
  afterAll(async () => {
    await db.delete(schema.transactions).where(eq(schema.transactions.accountId, aid))
    await db.delete(schema.bankCardNumbers).where(eq(schema.bankCardNumbers.cardId, cid))
    await db.delete(schema.bankCardProfiles).where(eq(schema.bankCardProfiles.cardId, cid))
    await db.delete(schema.cards).where(eq(schema.cards.id, cid))
    await db.delete(schema.accounts).where(eq(schema.accounts.id, aid))
    await db.delete(schema.users).where(eq(schema.users.id, uid))
  })

  it('没说金额：请用户给出金额，不硬算可投资额度', async () => {
    const result = await getWealthAdvice(ctx('帮我推荐点理财'), AdviceInput.parse({ horizon: '1_3y', liquidity: 'locked_ok', preference: 'preserve' }), now, offline)
    expect(result).toMatchObject({ status: 'insufficient_history', picks: [] })
    if ('message' in result) expect(result.message).toContain('请直接告诉我打算投入多少')
  })
  it('说了“5 万”：按这个金额照常推荐，并标明没有核对生活备用金', async () => {
    const result = await getWealthAdvice(ctx('我做过风险测评了，手上 5 万闲钱，三年用不上，想稳一点'), AdviceInput.parse({ amountYuan: 50000, horizon: '1_3y', liquidity: 'locked_ok', preference: 'preserve' }), now, offline)
    expect(result.status).toBe('advice')
    if (!('budget' in result) || !result.budget) throw new Error('no budget')
    expect(result.budget).toMatchObject({ amountCents: 5_000_000, reserveUnchecked: true })
    expect(result.conflicts).toContain('reserve_unchecked')
    expect(result.conflicts).not.toContain('amount_exceeds_investable')
    expect(result.picks.length).toBeGreaterThan(0)
  })
  it('备用金未核对时，交给说明模型的只有用户金额，说明里也不能出现不可靠的月均支出或可投资额度', () => {
    const budget = { monthlyExpenseCents: 300_000, reserveCents: 1_800_000, investableCents: 6_200_000, amountCents: 5_000_000, monthsObserved: 1, reserveUnchecked: true as const }
    const request = AdviceInput.parse({ amountYuan: 50000, horizon: '1_3y', liquidity: 'locked_ok', preference: 'preserve' })
    expect(modelAdviceInput([], budget, request, ['reserve_unchecked']).budget).toEqual({ amountYuan: 50000, reserveUnchecked: true })
    expect(expertTextViolations('可投资 62000 元', budget).length).toBeGreaterThan(0)
    expect(expertTextViolations('本次按 50000 元筛选', budget)).toEqual([])
  })
})
