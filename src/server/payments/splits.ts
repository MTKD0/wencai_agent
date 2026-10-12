import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { auth, db, schema } from '#/server/db/client'
import { paymentAccounts, settleTransfer } from './service'
import { notify } from '#/server/automation/service'
import type { AgentContext } from '#/server/agent/context'

let ready: Promise<void> | undefined
export function ensureSplitSchema() {
  return ready ??= (async () => {
    await db.$client.execute('CREATE TABLE IF NOT EXISTS bank_split_requests (id TEXT PRIMARY KEY, split_id TEXT NOT NULL, contact_id TEXT NOT NULL, requester_user_id TEXT NOT NULL, payer_user_id TEXT NOT NULL, target_account_id TEXT NOT NULL, amount_cents INTEGER NOT NULL, status TEXT NOT NULL, transaction_id TEXT)')
    await db.$client.execute('CREATE UNIQUE INDEX IF NOT EXISTS bank_split_participant ON bank_split_requests(split_id, contact_id)')
  })().catch((e) => { ready = undefined; throw e })
}
export async function createSplitRequests(userId: string, splitId: string) {
  await ensureSplitSchema()
  const [split] = await db.select().from(schema.splits).where(and(eq(schema.splits.id, splitId), eq(schema.splits.userId, userId)))
  if (!split) throw new Error('AA账单不存在')
  const target = (await paymentAccounts(userId))[0]
  if (!target) throw new Error('没有可收款的储蓄账户')
  const shares = JSON.parse(split.sharesJson) as { contactId: string; amountCents: number; status: string }[]
  let notified = 0
  for (const share of shares) {
    const [contact] = await db.select().from(schema.contacts).where(and(eq(schema.contacts.id, share.contactId), eq(schema.contacts.userId, userId)))
    const [payer] = contact ? await db.select().from(auth.baUser).where(and(eq(auth.baUser.phoneNumber, contact.phone), eq(auth.baUser.phoneNumberVerified, true))) : []
    if (!payer || payer.id === userId) continue
    const id = `aa_${randomUUID()}`
    const [created] = await db.insert(schema.bankSplitRequests).values({ id, splitId, contactId: share.contactId, requesterUserId: userId, payerUserId: payer.id, targetAccountId: target.id, amountCents: share.amountCents, status: 'pending' }).onConflictDoNothing().returning()
    if (created) { notified++; await notify(payer.id, 'aa', '收到 AA 收款请求', `${split.title}，待付款 ${(share.amountCents / 100).toFixed(2)} 元。可对 Agent 说“查看我的待付款 AA”。`, `aa:${created.id}`) }
  }
  return { notifiedParticipants: notified, unavailableParticipants: shares.length - notified }
}
export async function mySplitRequests(userId: string) {
  await ensureSplitSchema()
  const requests = await db.select().from(schema.bankSplitRequests).where(eq(schema.bankSplitRequests.payerUserId, userId))
  return Promise.all(requests.map(async (request) => {
    const [owner] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, request.requesterUserId))
    const [split] = await db.select({ title: schema.splits.title }).from(schema.splits).where(eq(schema.splits.id, request.splitId))
    return { ...request, requesterName: owner?.name ?? '文财用户', title: split?.title ?? 'AA收款' }
  }))
}
export async function paySplitRequest(userId: string, requestId: string, fromAccountId: string, ctx: AgentContext) {
  await ensureSplitSchema()
  const [request] = await db.select().from(schema.bankSplitRequests).where(and(eq(schema.bankSplitRequests.id, requestId), eq(schema.bankSplitRequests.payerUserId, userId)))
  if (!request || request.status !== 'pending') throw new Error('AA请求不存在或已处理')
  const result = await settleTransfer({ fromAccountId, toAccountId: request.targetAccountId, amountCents: request.amountCents, memo: 'AA分摊付款' }, ctx, new Date(), {
    targetUserId: request.requesterUserId,
    onSettled: async (tx, transactionId) => {
      const [claimed] = await tx.update(schema.bankSplitRequests).set({ status: 'paid', transactionId }).where(and(eq(schema.bankSplitRequests.id, request.id), eq(schema.bankSplitRequests.payerUserId, userId), eq(schema.bankSplitRequests.status, 'pending'))).returning()
      if (!claimed) throw new Error('AA已付款，请勿重复支付')
      const [split] = await tx.select().from(schema.splits).where(eq(schema.splits.id, request.splitId))
      if (!split) throw new Error('AA账单不存在')
      const shares = JSON.parse(split.sharesJson) as { contactId: string; status: string }[]
      const share = shares.find((s) => s.contactId === request.contactId)
      if (!share || share.status === 'paid') throw new Error('AA收款状态已变化')
      share.status = 'paid'
      await tx.update(schema.splits).set({ sharesJson: JSON.stringify(shares) }).where(eq(schema.splits.id, split.id))
    },
  })
  await notify(request.requesterUserId, 'aa', 'AA 已收到付款', `收到 ${(request.amountCents / 100).toFixed(2)} 元，交易号 ${result.transactionId}。`, `aa:${request.id}:paid`).catch(() => {})
  return result
}
