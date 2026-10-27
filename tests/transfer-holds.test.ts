import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db, schema } from '#/server/db/client'
import { beginDemoBiometric } from '#/server/auth/demo-biometric'
import { ensurePaymentsSchema } from '#/server/payments/migrate'
import { cancelHold, ensureHoldSchema, holdForAction, listCallbackTickets, releaseDueHolds, resolveCallbackTicket } from '#/server/payments/holds'
import { getConfirmationResult } from '#/server/confirm/result'
import { runBankTool } from '#/server/tools/runner'
import { resolveTool, transfer } from '#/server/tools/bank'
import { FRAUD_REASON_PREFIX, UNUSUAL_REASON_PREFIX } from '#/lib/fraud'
import { confirmPending } from './helpers/card-confirmation'

const uid = 'hold_user', source = 'hold_source', payeeId = 'hold_payee'
const scamText = '对方说我的账户涉嫌洗钱，让我把钱转到安全账户核查'
const ctx = (riskText?: string) => ({ userId: uid, sessionId: 'hold-session', channel: 'web' as const, ...(riskText ? { requestText: riskText, riskText } : {}) })
const balance = async () => (await db.select().from(schema.accounts).where(eq(schema.accounts.id, source)))[0].balanceCents
const face = async (scope: string) => ({ method: 'face' as const, ...await beginDemoBiometric(uid, scope, 'face') })
/** 生成一张带诈骗劝阻的确认单，并由用户本人完成强验证确认 */
async function confirmScamTransfer(amount = 500) {
  const outcome = await runBankTool(transfer, { fromAccountId: source, payeeId, amount }, ctx(scamText))
  if (outcome.status !== 'needs_confirmation') throw new Error(JSON.stringify(outcome))
  expect(outcome.reasons.some((r) => r.startsWith(FRAUD_REASON_PREFIX))).toBe(true)
  const result = await confirmPending({ ctx: ctx(), actionId: outcome.actionId, resolveTool, stepUp: await face(`action:${outcome.actionId}`) })
  if (!result.ok) throw new Error(JSON.stringify(result))
  return { actionId: outcome.actionId, output: result.output as { status: string; holdId: string; releaseAt: string } }
}

beforeAll(async () => {
  await ensurePaymentsSchema(); await ensureHoldSchema()
  await db.insert(schema.users).values({ id: uid, name: '冷静期用户' })
  await db.insert(schema.accounts).values({ id: source, userId: uid, name: '付款账户', balanceCents: 1_000_000 })
  await db.insert(schema.payees).values({ id: payeeId, userId: uid, name: '陌生收款人', bank: '工商银行', accountNo: '6222000077778888', createdAt: new Date(0) })

})
beforeEach(async () => {
  await db.delete(schema.transactions).where(eq(schema.transactions.accountId, source))
  await db.delete(schema.bankTransferHolds).where(eq(schema.bankTransferHolds.userId, uid))
  await db.delete(schema.bankCallbackTickets).where(eq(schema.bankCallbackTickets.userId, uid))
  await db.update(schema.accounts).set({ balanceCents: 1_000_000 }).where(eq(schema.accounts.id, source))
  await db.update(schema.users).set({ failedAuthCount: 0, lockedUntil: null }).where(eq(schema.users.id, uid))
})
afterAll(async () => {
  await db.delete(schema.transactions).where(eq(schema.transactions.accountId, source))
  await db.delete(schema.bankTransferHolds).where(eq(schema.bankTransferHolds.userId, uid))
  await db.delete(schema.bankCallbackTickets).where(eq(schema.bankCallbackTickets.userId, uid))
  await db.delete(schema.bankNotifications).where(eq(schema.bankNotifications.userId, uid))
  await db.delete(schema.pendingActions).where(eq(schema.pendingActions.userId, uid))
  await db.delete(schema.payees).where(eq(schema.payees.userId, uid))
  await db.delete(schema.accounts).where(eq(schema.accounts.userId, uid))
  await db.delete(schema.users).where(inArray(schema.users.id, [uid]))
})

describe('劝阻后的冷静期', () => {
  it('话术命中且用户坚持确认：不扣款，回执为冷静期，并生成回访工单', async () => {
    const { actionId, output } = await confirmScamTransfer()
    expect(output.status).toBe('held')
    expect(await balance()).toBe(1_000_000)
    expect(await getConfirmationResult(uid, actionId)).toMatchObject({ status: 'held' })
    const ticket = (await listCallbackTickets()).find((t) => t.actionId === actionId)
    expect(ticket).toMatchObject({ status: 'open', userName: '冷静期用户', payeeName: '陌生收款人', amountCents: 50_000, hold: { status: 'held' } })
  })
  it('到期前不执行；到期后按原授权执行，回执变为已完成，工单自动结束', async () => {
    const { actionId, output } = await confirmScamTransfer()
    const releaseAt = new Date(output.releaseAt)
    expect(await releaseDueHolds(uid, new Date(releaseAt.getTime() - 1000))).toEqual([])
    expect(await releaseDueHolds(uid, new Date(releaseAt.getTime() + 1000))).toMatchObject([{ status: 'released' }])
    expect(await balance()).toBe(950_000)
    expect(await getConfirmationResult(uid, actionId)).toMatchObject({ status: 'completed' })
    expect((await listCallbackTickets()).find((t) => t.actionId === actionId)).toMatchObject({ status: 'closed' })
    // 已执行的不能再撤销，也不会重复执行
    const hold = await holdForAction(uid, actionId)
    await expect(cancelHold({ holdId: hold!.holdId, by: 'user', userId: uid })).rejects.toThrow('已执行')
    expect(await releaseDueHolds(uid, new Date(releaseAt.getTime() + 2000))).toEqual([])
  })
  it('用户本人可随时撤销，资金从未转出；别人撤销不了', async () => {
    const { actionId, output } = await confirmScamTransfer()
    await expect(cancelHold({ holdId: output.holdId, by: 'user', userId: 'someone_else' })).rejects.toThrow()
    await cancelHold({ holdId: output.holdId, by: 'user', userId: uid })
    expect(await getConfirmationResult(uid, actionId)).toMatchObject({ status: 'cancelled' })
    expect(await releaseDueHolds(uid, new Date(Date.parse(output.releaseAt) + 1000))).toEqual([])
    expect(await balance()).toBe(1_000_000)
  })
  it('回访确认诈骗即撤销；确认安全则提前放行；联系不上只记录', async () => {
    const scam = await confirmScamTransfer()
    const scamTicket = (await listCallbackTickets()).find((t) => t.actionId === scam.actionId)!
    await resolveCallbackTicket({ ticketId: scamTicket.ticketId, outcome: 'confirmed_scam', note: '用户承认对方自称警察' })
    expect(await holdForAction(uid, scam.actionId)).toMatchObject({ status: 'cancelled', resolvedBy: 'admin' })

    const safe = await confirmScamTransfer(300)
    const unreachable = (await listCallbackTickets()).find((t) => t.actionId === safe.actionId)!
    await resolveCallbackTicket({ ticketId: unreachable.ticketId, outcome: 'unreachable' })
    expect(await holdForAction(uid, safe.actionId)).toMatchObject({ status: 'held' })
    await resolveCallbackTicket({ ticketId: unreachable.ticketId, outcome: 'confirmed_safe', note: '本人说明是给朋友的货款' })
    expect(await holdForAction(uid, safe.actionId)).toMatchObject({ status: 'released', resolvedBy: 'admin' })
    expect(await balance()).toBe(970_000)
    await expect(resolveCallbackTicket({ ticketId: unreachable.ticketId, outcome: 'confirmed_scam' })).rejects.toThrow('已结束')
  })
  it('只有行为异常、没有话术时提醒并强验证，但不进冷静期', async () => {
    const outcome = await runBankTool(transfer, { fromAccountId: source, payeeId, amount: 6000 }, ctx('帮我转 6000'))
    if (outcome.status !== 'needs_confirmation') throw new Error(JSON.stringify(outcome))
    expect(outcome.reasons.some((r) => r.startsWith(UNUSUAL_REASON_PREFIX))).toBe(true)
    expect(outcome.reasons.some((r) => r.startsWith(FRAUD_REASON_PREFIX))).toBe(false)
    const result = await confirmPending({ ctx: ctx(), actionId: outcome.actionId, resolveTool, stepUp: await face(`action:${outcome.actionId}`) })
    expect(result).toMatchObject({ ok: true })
    expect(await balance()).toBe(400_000)
  })
})
