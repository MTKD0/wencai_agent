import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { db, schema, auth } from '#/server/db/client'
import { prepareTransferBatch } from '#/server/agent/batch-transfer'
import { selectedTransferPlan, startSelectedTransferBatch } from '#/server/agent/batch-plan'
import { putSessionData } from '#/server/agent/session'
import { getConfirmationResult } from '#/server/confirm/result'
import { confirmPending as unverifiedConfirm } from '#/server/confirm/pending'
import { confirmPending } from './helpers/card-confirmation'
import { resolveTool } from '#/server/tools/bank'
import { cancelActionAndPlan, controlPlan } from '#/server/executor/service'
import { setTxPassword } from '#/server/auth/tx-password'
import { confirmationOptions, choiceFromRow } from '#/components/chat/interaction-message'
import type { BatchTransferReady } from '#/lib/batch-transfer'
import { createUIMessageStream, readUIMessageStream } from 'ai'
import type { WencaiUIMessage } from '#/server/agent/messages'

const suffix = randomUUID().slice(0, 8)
const userId = `batch_chain_${suffix}`,
  accountId = `acc_${suffix}`,
  cardId = `card_${suffix}`
const ctx = { userId, sessionId: `session_${suffix}`, channel: 'web' as const }
const payees = ['甲', '乙'].map((name, index) => ({
  id: `payee_${suffix}_${index}`,
  name,
  bank: '外部银行',
  account: `6214 **** ${index ? '2222' : '1111'}`,
}))
const card = {
  id: cardId,
  accountId,
  remark: '测试付款卡',
  last4: '8823',
  kind: 'debit' as const,
  status: 'active' as const,
  balance: 1000,
}
async function prepare() {
  const batch = await prepareTransferBatch(
    {
      transfers: [
        { recipientQuery: '甲', amountYuan: 1 },
        { recipientQuery: '乙', amountYuan: 2 },
      ],
    },
    '给甲转1再给乙转2',
    async (tool, args) => ({
      status: 'done',
      data: tool === 'list_cards' ? [card] : { candidates: payees.filter((row) => row.name === args.query) },
    }),
  )
  if (batch.status !== 'batch_transfer_ready') throw new Error(batch.errors.join(';'))
  putSessionData(ctx.sessionId, `transfer_batch:${batch.batchId}`, batch)
  return batch
}
const selection = (batch: BatchTransferReady) => ({
  batchId: batch.batchId,
  cardId,
  recipients: batch.recipients.map((group) => ({ stepId: group.stepId, payeeId: group.candidates[0].id })),
})
const accountBalance = async () =>
  (await db.select().from(schema.accounts).where(eq(schema.accounts.id, accountId)))[0].balanceCents
beforeAll(async () => {
  await db.insert(schema.users).values({ id: userId, name: '批次衔接测试' })
  await db
    .insert(auth.baUser)
    .values({
      id: userId,
      name: '批次衔接测试',
      email: `${userId}@test.local`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  await db.insert(schema.accounts).values({ id: accountId, userId, name: '批次账户', balanceCents: 100_000 })
  await db
    .insert(schema.cards)
    .values({
      id: cardId,
      userId,
      accountId,
      last4: '8823',
      kind: 'debit',
      status: 'active',
      dailyLimitCents: 1_000_000,
    })
  await db
    .insert(schema.payees)
    .values(
      payees.map((payee, index) => ({
        id: payee.id,
        userId,
        name: payee.name,
        bank: payee.bank,
        accountNo: `621400000000${index ? '2222' : '1111'}`,
        createdAt: new Date(0),
      })),
    )
  await setTxPassword(userId, '983701')
})
afterAll(async () => {
  await db.delete(schema.pendingActions).where(eq(schema.pendingActions.userId, userId))
  await db.delete(schema.plans).where(eq(schema.plans.userId, userId))
  await db.delete(schema.transactions).where(eq(schema.transactions.accountId, accountId))
  await db.delete(schema.payees).where(eq(schema.payees.userId, userId))
  await db.delete(schema.cards).where(eq(schema.cards.userId, userId))
  await db.delete(schema.accounts).where(eq(schema.accounts.userId, userId))
  await db.delete(auth.baUser).where(eq(auth.baUser.id, userId))
  await db.delete(schema.users).where(eq(schema.users.id, userId))
})

describe('多笔转账自动衔接', () => {
  it('按钮传稳定对象编号，金额与执行顺序由服务器草稿决定', async () => {
    const batch = await prepare()
    const choices = [
      choiceFromRow(card, 'card')!,
      ...batch.recipients.map((group) => ({
        ...choiceFromRow(group.candidates[0], 'recipient')!,
        stepId: group.stepId,
      })),
    ]
    const options = confirmationOptions({ requests: [], selections: [], template: batch.interaction }, choices)
    expect(options?.transferBatch).toEqual(selection(batch))
    const input = selection(batch)
    input.recipients.reverse()
    expect(
      selectedTransferPlan(batch, input).nodes.map((node) => [node.args.payeeId, node.args.amount, node.dependsOn]),
    ).toEqual([
      [payees[0].id, 1, []],
      [payees[1].id, 2, ['transfer_1']],
    ])
    expect(() => selectedTransferPlan(batch, { ...input, amount: 99999 })).toThrow()
    expect(() => selectedTransferPlan(batch, { ...input, cardId: 'someone-elses-card' })).toThrow()
    expect(() =>
      selectedTransferPlan(batch, { ...input, recipients: [input.recipients[0], input.recipients[0]] }),
    ).toThrow()
    await expect(startSelectedTransferBatch({ ...ctx, sessionId: 'another-session' }, input)).rejects.toThrow('失效')
  })
  it('第一笔成功后直接生成第二笔确认单；两笔分别验证；重复通知与按钮不重复扣款', async () => {
    const batch = await prepare(),
      input = selection(batch),
      before = await accountBalance()
    const [initial, duplicate] = await Promise.all([
      startSelectedTransferBatch(ctx, input),
      startSelectedTransferBatch(ctx, input),
    ])
    expect(initial.id).toBe(duplicate.id)
    expect(initial.nodes.transfer_1.actionId).toBe(duplicate.nodes.transfer_1.actionId)
    expect(initial.nodes.transfer_2.status).toBe('pending')
    const first = initial.nodes.transfer_1.actionId!
    expect(await accountBalance()).toBe(before)
    expect(await unverifiedConfirm({ ctx, actionId: first, resolveTool })).toMatchObject({
      ok: false,
      code: 'card_password_required',
    })
    const result = await confirmPending({ ctx, actionId: first, resolveTool })
    expect(result.ok).toBe(true)
    if (!result.ok || !result.plan) throw new Error('missing plan')
    const second = result.plan.nodes.transfer_2.actionId!
    expect(result.plan.nodes.transfer_1.status).toBe('done')
    expect(result.plan.nodes.transfer_2.status).toBe('suspended')
    expect(await accountBalance()).toBe(before - 100)
    expect(await getConfirmationResult(userId, first)).toMatchObject({
      status: 'completed',
      planProgress: { completed: 1, total: 2, pendingActionIds: [second] },
    })
    expect(await unverifiedConfirm({ ctx, actionId: second, resolveTool })).toMatchObject({
      ok: false,
      code: 'card_password_required',
    })
    expect((await startSelectedTransferBatch(ctx, input)).nodes.transfer_2.actionId).toBe(second)
    expect(await unverifiedConfirm({ ctx, actionId: first, resolveTool })).toMatchObject({ ok: false })
    expect(await confirmPending({ ctx, actionId: second, resolveTool })).toMatchObject({
      ok: true,
      plan: { status: 'completed' },
    })
    expect(await accountBalance()).toBe(before - 300)
    expect((await startSelectedTransferBatch(ctx, input)).status).toBe('completed')
    const pending = await db
      .select()
      .from(schema.pendingActions)
      .where(and(eq(schema.pendingActions.userId, userId), eq(schema.pendingActions.planId, initial.id)))
    expect(pending).toHaveLength(2)
  })
  it('暂停和取消仍有效，取消第二笔不会撤回已完成的第一笔', async () => {
    const batch = await prepare(),
      input = selection(batch),
      before = await accountBalance()
    const initial = await startSelectedTransferBatch(ctx, input),
      first = initial.nodes.transfer_1.actionId!
    await controlPlan(ctx, initial.id, 'pause')
    expect(await confirmPending({ ctx, actionId: first, resolveTool })).toMatchObject({
      ok: false,
      code: 'plan_paused',
    })
    await controlPlan(ctx, initial.id, 'resume')
    const result = await confirmPending({ ctx, actionId: first, resolveTool })
    if (!result.ok || !result.plan) throw new Error('missing plan')
    const second = result.plan.nodes.transfer_2.actionId!
    await cancelActionAndPlan(ctx, second)
    expect(await accountBalance()).toBe(before - 100)
    expect((await getConfirmationResult(userId, second)).status).toBe('cancelled')
    expect((await startSelectedTransferBatch(ctx, input)).nodes.transfer_1.status).toBe('done')
  })
  it('服务端计划数据作为消息流部件保留，界面不依赖模型再次调用交易工具', async () => {
    const batch = await prepare(),
      plan = await startSelectedTransferBatch(ctx, selection(batch))
    const stream = createUIMessageStream<WencaiUIMessage>({
      execute: ({ writer }) => {
        writer.write({ type: 'start' })
        writer.write({ type: 'data-plan', data: plan })
        writer.write({ type: 'finish' })
      },
    })
    let result: WencaiUIMessage | undefined
    for await (const message of readUIMessageStream<WencaiUIMessage>({ stream })) result = message
    expect(result?.parts).toContainEqual({ type: 'data-plan', data: plan })
  })
})
