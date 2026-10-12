import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db, schema } from '#/server/db/client'
import { cardLabel, createUserCard, creditSpend, ensureUserCardAccounts, findCards, ownProfile, repayCredit, resolveCard, saveCardRemark, userCards } from '#/server/cards/service'
import { paymentAccounts, settleTransfer } from '#/server/payments/service'
import { getDashboard } from '#/server/dashboard'
import { transferBetweenCards, repayCreditCard } from '#/server/tools/cards'
import { runBankTool } from '#/server/tools/runner'
import { resolveTool } from '#/server/tools/bank'
import { confirmPending } from '#/server/confirm/pending'
import { getSpendingReport } from '#/server/tools/bank-extended'

const userId = 'u_cards_v2', otherId = 'u_cards_v2_other'
const ctx = { userId, sessionId: 'cards-v2', channel: 'web' as const }
const mainId = 'cards_v2_main', savingId = 'cards_v2_save'
const first = 'cards_v2_first', second = 'cards_v2_second', credit = 'cards_v2_credit'
const historyId = 'cards_v2_history'
let secondAccount = '', creditAccount = ''
const balance = async (id: string) => (await db.select().from(schema.accounts).where(eq(schema.accounts.id, id)))[0].balanceCents
const confirm = (actionId: string) => confirmPending({ ctx, actionId, resolveTool, stepUp: { method: 'password', password: '123456' } })

beforeAll(async () => {
  await db.insert(schema.users).values([{ id: userId, name: '卡片测试' }, { id: otherId, name: '其他用户' }])
  await db.insert(schema.accounts).values([
    { id: mainId, userId, name: '工资卡', balanceCents: 100_000 },
    { id: savingId, userId, name: '储蓄账户', balanceCents: 80_000 },
  ])
  // 信用卡故意先插入，迁移仍须选第一张储蓄卡保留原余额和历史。
  await db.insert(schema.cards).values([
    { id: credit, userId, accountId: mainId, last4: '1047', kind: 'credit', status: 'active', dailyLimitCents: 500_000 },
    { id: first, userId, accountId: mainId, last4: '8823', kind: 'debit', status: 'active', dailyLimitCents: 500_000 },
    { id: second, userId, accountId: mainId, last4: '8476', kind: 'debit', status: 'active', dailyLimitCents: 500_000 },
  ])
  await db.insert(schema.transactions).values({ id: historyId, accountId: mainId, amountCents: -1200, category: '餐饮', counterparty: '历史消费', occurredAt: new Date() })
})

afterAll(async () => {
  const accounts = await db.select().from(schema.accounts).where(inArray(schema.accounts.userId, [userId, otherId]))
  const cards = await db.select().from(schema.cards).where(inArray(schema.cards.userId, [userId, otherId]))
  if (accounts.length) await db.delete(schema.transactions).where(inArray(schema.transactions.accountId, accounts.map((a) => a.id)))
  if (cards.length) await db.delete(schema.bankCardProfiles).where(inArray(schema.bankCardProfiles.cardId, cards.map((c) => c.id)))
  await db.delete(schema.pendingActions).where(inArray(schema.pendingActions.userId, [userId, otherId]))
  await db.delete(schema.cards).where(inArray(schema.cards.userId, [userId, otherId]))
  await db.delete(schema.accounts).where(inArray(schema.accounts.userId, [userId, otherId]))
  await db.delete(schema.users).where(inArray(schema.users.id, [userId, otherId]))
})

describe('银行卡独立账户升级与备注识别', () => {
  it('保留第一张储蓄卡余额、历史与独立储蓄账户资产，并补齐第四张实际卡片', async () => {
    await Promise.all([ensureUserCardAccounts(userId), ensureUserCardAccounts(userId)])
    const cards = await userCards(userId)
    expect(cards).toHaveLength(4)
    expect(new Set(cards.map((c) => c.accountId)).size).toBe(4)
    expect(cards.find((c) => c.id === first)).toMatchObject({ accountId: mainId, balanceCents: 100_000, remark: '工资卡' })
    const secondCard = cards.find((c) => c.id === second)!
    const creditCard = cards.find((c) => c.id === credit)!
    secondAccount = secondCard.accountId; creditAccount = creditCard.accountId
    expect(secondCard.balanceCents).toBe(0)
    expect(creditCard).toMatchObject({ balanceCents: 0, outstandingCents: 0 })
    expect(cards.find((c) => c.accountId === savingId)?.balanceCents).toBe(80_000)
    expect((await db.select().from(schema.transactions).where(eq(schema.transactions.id, historyId)))[0].accountId).toBe(mainId)
    expect((await getDashboard(userId)).availableBalance).toBe(1800)
    expect(await userCards(userId)).toEqual(cards)
  })
  it('每张卡账单独立；切到拆分出的卡片不再显示工资账户流水', async () => {
    const dashboard = await getDashboard(userId)
    expect(dashboard.cards).toHaveLength(4)
    expect(dashboard.accountActivity[mainId].transactions.map((t) => t.id)).toContain(historyId)
    expect(dashboard.accountActivity[secondAccount].transactions).toEqual([])
    expect(dashboard.accountActivity[creditAccount].transactions).toEqual([])
  })
  it('重名不选第一张，要求尾号；类型、备注和尾号组合筛选且隔离用户', async () => {
    expect(await findCards(userId, '工资卡')).toHaveLength(2)
    await expect(resolveCard(userId, '工资卡', 'debit')).rejects.toThrow(/8823.*8476/)
    expect((await resolveCard(userId, '工资卡 尾号8476', 'debit')).id).toBe(second)
    await saveCardRemark(userId, second, '储蓄卡A')
    expect((await resolveCard(userId, '储蓄卡A', 'debit')).id).toBe(second)
    expect(await findCards(otherId, '8823')).toEqual([])
    await expect(saveCardRemark(otherId, first, '盗改')).rejects.toThrow('不属于你')
    await expect(resolveCard(userId, '不存在的卡')).rejects.toThrow('没有找到')
    expect(await findCards(userId, '信用卡尾号1047', 'debit')).toEqual([])
  })
  it('新卡独立零余额且新增备注不会改变卡类型', async () => {
    const result = await createUserCard(otherId, 'debit')
    const card = await ownProfile(otherId, result.cardId)
    expect(card.balanceCents).toBe(0)
    await saveCardRemark(otherId, card.id, '工资卡')
    expect(await ownProfile(otherId, card.id)).toMatchObject({ kind: 'debit', remark: '工资卡' })
  })
  it('只有信用卡的旧账户若有资产，原资金与流水也不会被清空', async () => {
    const id = 'cards_v2_credit_only'
    await db.insert(schema.accounts).values({ id, userId: otherId, name: '历史资金', balanceCents: 12345 })
    await db.insert(schema.cards).values({ id: `${id}_card`, accountId: id, userId: otherId, kind: 'credit', last4: '7643', status: 'active', dailyLimitCents: 500_000 })
    await ensureUserCardAccounts(otherId)
    expect(await balance(id)).toBe(12345)
    expect((await ownProfile(otherId, `${id}_card`)).accountId).not.toBe(id)
  })
})

describe('备注转账确认与执行', () => {
  it('歧义时无确认单、无扣款，且不能用伪造派生卡片 ID 绕过', async () => {
    await saveCardRemark(userId, second, '工资卡')
    const before = await db.select().from(schema.pendingActions).where(eq(schema.pendingActions.userId, userId))
    const out = await runBankTool(transferBetweenCards, { fromCardQuery: '工资卡', toCardQuery: '储蓄账户', amountCents: 100, fromCardId: first }, ctx)
    expect(out).toMatchObject({ status: 'error', message: expect.stringMatching(/8823.*8476/) })
    expect(await db.select().from(schema.pendingActions).where(eq(schema.pendingActions.userId, userId))).toHaveLength(before.length)
    expect(await balance(mainId)).toBe(100_000)
    await saveCardRemark(userId, second, '储蓄卡A')
  })
  it('确认摘要含两边尾号；备注改名后仍执行已签名的卡片身份，并发确认只扣一次', async () => {
    const out = await runBankTool(transferBetweenCards, { fromCardQuery: '工资卡', toCardQuery: '储蓄卡A', amountCents: 100, fromCardId: second }, ctx)
    expect(out.status).toBe('needs_confirmation')
    if (out.status !== 'needs_confirmation') throw new Error(JSON.stringify(out))
    expect(JSON.stringify(out.summary)).toContain('8823')
    expect(JSON.stringify(out.summary)).toContain('8476')
    const row = (await db.select().from(schema.pendingActions).where(eq(schema.pendingActions.id, out.actionId)))[0]
    expect(JSON.parse(row.argsJson).fromCardId).toBe(first)
    await saveCardRemark(userId, second, '改名后的卡')
    const results = await Promise.all([confirm(out.actionId), confirm(out.actionId)])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(await balance(mainId)).toBe(99_900)
    expect(await balance(secondAccount)).toBe(100)
    const dashboard = await getDashboard(userId)
    expect(dashboard.accountActivity[secondAccount].transactions).toHaveLength(1)
  })
  it('付款卡/收款卡冻结或挂失、信用卡普通转账均拒绝且不扣钱', async () => {
    const input = { fromAccountId: mainId, toAccountId: secondAccount, amountCents: 100 }
    await db.update(schema.cards).set({ status: 'locked' }).where(eq(schema.cards.id, second))
    await expect(settleTransfer(input, ctx)).rejects.toThrow('冻结')
    await db.update(schema.cards).set({ status: 'active' }).where(eq(schema.cards.id, second))
    await db.update(schema.cards).set({ status: 'lost' }).where(eq(schema.cards.id, first))
    await expect(settleTransfer(input, ctx)).rejects.toThrow('挂失')
    await db.update(schema.cards).set({ status: 'active' }).where(eq(schema.cards.id, first))
    await expect(settleTransfer({ ...input, toAccountId: creditAccount }, ctx)).rejects.toThrow('信用卡')
    await expect(settleTransfer({ ...input, fromAccountId: creditAccount }, ctx)).rejects.toThrow('信用卡')
    expect(await balance(mainId)).toBe(99_900)
  })
  it('卡片每日限额在结算时强制检查', async () => {
    await db.update(schema.cards).set({ dailyLimitCents: 100 }).where(eq(schema.cards.id, first))
    await expect(settleTransfer({ fromAccountId: mainId, toAccountId: secondAccount, amountCents: 1 }, ctx)).rejects.toThrow('每日')
    await db.update(schema.cards).set({ dailyLimitCents: 500_000 }).where(eq(schema.cards.id, first))
  })
})

describe('信用卡消费、额度及还款', () => {
  it('信用额度不会进入存款或可转账账户，消费仅增加该卡待还金额', async () => {
    const before = (await getDashboard(userId)).availableBalance
    expect((await paymentAccounts(userId)).some((a) => a.id === creditAccount)).toBe(false)
    await creditSpend(userId, credit, 10_000, '测试商户')
    expect(await ownProfile(userId, credit)).toMatchObject({ outstandingCents: 10_000, creditLimitCents: 2_000_000 })
    expect((await getDashboard(userId)).availableBalance).toBe(before)
    expect((await getDashboard(userId)).accountActivity[creditAccount].transactions).toHaveLength(1)
    await expect(creditSpend(userId, credit, 2_000_000, '超额消费')).rejects.toThrow('额度不足')
    await expect(creditSpend(otherId, credit, 1, '越权')).rejects.toThrow('不属于你')
  })
  it('信用卡还款支持部分还款，额度恢复、双方流水独立，消费汇总不重复计入还款', async () => {
    const before = await balance(mainId)
    const reportBefore = await getSpendingReport.execute({ period: new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 7) }, ctx)
    const pending = await runBankTool(repayCreditCard, { creditCardQuery: '尾号1047', sourceCardQuery: '尾号8823', amountCents: 2000 }, ctx)
    if (pending.status !== 'needs_confirmation') throw new Error(JSON.stringify(pending))
    expect((await confirm(pending.actionId)).ok).toBe(true)
    expect(await balance(mainId)).toBe(before - 2000)
    expect((await ownProfile(userId, credit)).outstandingCents).toBe(8000)
    expect(await balance(creditAccount)).toBe(0)
    expect((await getDashboard(userId)).cards.find((c) => c.id === credit)?.availableCredit).toBe(19_920)
    const reportAfter = await getSpendingReport.execute({ period: reportBefore.period }, ctx)
    expect(reportAfter.expense).toBe(reportBefore.expense)
  })
  it('超额还款、余额不足和并发重复还款都不能超扣或多恢复额度', async () => {
    const input = { creditCardId: credit, sourceCardId: first, amountCents: 9000 }
    await expect(repayCredit(input, ctx)).rejects.toThrow('超过待还')
    await expect(repayCredit({ ...input, sourceCardId: second, amountCents: 200 }, ctx)).rejects.toThrow('余额不足')
    expect((await ownProfile(userId, credit)).outstandingCents).toBe(8000)
    const before = await balance(mainId)
    const results = await Promise.allSettled([repayCredit({ ...input, amountCents: 8000 }, ctx), repayCredit({ ...input, amountCents: 8000 }, ctx)])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await balance(mainId)).toBe(before - 8000)
    expect((await ownProfile(userId, credit)).outstandingCents).toBe(0)
  })
  it('卡片标识会包含备注与尾号，便于所有确认界面统一核对', () => {
    expect(cardLabel({ kind: 'debit', remark: '工资卡', last4: '8823' })).toBe('工资卡 · 储蓄卡尾号8823')
  })
})
