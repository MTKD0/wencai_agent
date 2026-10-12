import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '#/server/db/client'
import { createPending, confirmPending, cancelPending } from '#/server/confirm/pending'
import { getConfirmationResult } from '#/server/confirm/result'
import { defineBankTool } from '#/server/tools/define'
import { buildAgentTools } from '#/server/agent/tools'
import { BANK_TOOLS } from '#/server/tools/bank'
import { isRetryableConfirmError, ConfirmError } from '#/lib/queries'
import { createUIMessageStream, readUIMessageStream } from 'ai'
import { historyEvidence } from '#/server/agent/messages'
import type { WencaiUIMessage } from '#/server/agent/messages'

const userId = 'u_confirmation_receipt'
const ctx = { userId, sessionId: 'receipt-session', channel: 'web' as const }
const ids: string[] = []
let executions = 0
const def = defineBankTool({
  name: 'receipt_test_write', description: '测试操作', kind: 'write', baseRisk: 'yellow', inputSchema: z.object({}),
  summarize: async () => ({ title: '测试确认', fields: [{ label: '金额', value: '¥12.34' }] }),
  execute: async () => { executions++; return { transactionId: 'receipt-transaction', amount: 12.34 } },
})
const pending = async (tool = def) => {
  const result = await createPending({ ctx, def: tool, args: {}, decision: { allowed: true, level: 'yellow', reasons: [], requiresChannelHandoff: false } })
  ids.push(result.actionId)
  return result.actionId
}
beforeAll(async () => { await db.insert(schema.users).values({ id: userId, name: '回执测试' }) })
afterAll(async () => {
  if (ids.length) await db.delete(schema.pendingActions).where(inArray(schema.pendingActions.id, ids))
  await db.delete(schema.users).where(eq(schema.users.id, userId))
})
describe('确认后的实际执行核对', () => {
  it('只有执行成功的服务端回执能证明完成，查询不会再次执行业务操作', async () => {
    const actionId = await pending()
    expect((await getConfirmationResult(userId, actionId)).status).toBe('pending')
    const before = executions
    expect((await confirmPending({ ctx, actionId, resolveTool: () => def })).ok).toBe(true)
    for (let i = 0; i < 2; i++) expect(await getConfirmationResult(userId, actionId)).toMatchObject({ status: 'completed', tool: def.name, output: { transactionId: 'receipt-transaction', amount: 12.34 } })
    expect(executions).toBe(before + 1)
    const receipt = await getConfirmationResult(userId, actionId)
    expect(receipt).not.toHaveProperty('argsJson')
    expect(receipt).not.toHaveProperty('integrity')
    expect((await confirmPending({ ctx, actionId, resolveTool: () => def })).ok).toBe(false)
  })
  it('其他用户、伪造编号均拿不到回执、摘要或存在性信息', async () => {
    const actionId = ids[0]
    expect(await getConfirmationResult('u_someone_else', actionId)).toEqual({ actionId, status: 'not_found' })
    expect(await getConfirmationResult(userId, 'pa_missing')).toEqual({ actionId: 'pa_missing', status: 'not_found' })
  })
  it('取消、过期、执行失败和正在执行分别展示真实状态，不能把已消费误报为成功', async () => {
    const cancelled = await pending()
    await cancelPending(ctx, cancelled)
    expect((await getConfirmationResult(userId, cancelled)).status).toBe('cancelled')
    const expired = await pending()
    await db.update(schema.pendingActions).set({ expiresAt: new Date(1) }).where(eq(schema.pendingActions.id, expired))
    expect((await getConfirmationResult(userId, expired)).status).toBe('expired')
    const processing = await pending()
    await db.update(schema.pendingActions).set({ status: 'consumed' }).where(eq(schema.pendingActions.id, processing))
    expect((await getConfirmationResult(userId, processing)).status).toBe('processing')
    const failing = { ...def, execute: async () => { throw new Error('业务失败') } }
    const failed = await pending(failing)
    expect(await confirmPending({ ctx, actionId: failed, resolveTool: () => failing })).toMatchObject({ ok: false, code: 'execution_failed' })
    expect((await getConfirmationResult(userId, failed)).status).toBe('failed')
    expect(isRetryableConfirmError(new ConfirmError('失败', { ok: false, code: 'execution_failed' }))).toBe(false)
  })
  it('自动核对轮次只允许查询与展示，无法再次转账、登记风险评测或发起计划', () => {
    const tools = buildAgentTools(ctx, { readOnly: true })
    for (const tool of BANK_TOOLS.filter((tool) => tool.kind === 'write')) expect(tools).not.toHaveProperty(tool.name)
    expect(tools).not.toHaveProperty('plan_task')
    expect(tools).toHaveProperty('get_accounts')
    expect(tools).toHaveProperty('show_view')
    expect(buildAgentTools(ctx)).toHaveProperty('commit_risk_assessment')
  })
  it('服务端回执随 SDK 消息流保留，后续对话能用实际回执校验数字出处', async () => {
    const receipt = await getConfirmationResult(userId, ids[0])
    const stream = createUIMessageStream<WencaiUIMessage>({ execute: ({ writer }) => {
      writer.write({ type: 'start', messageId: 'receipt-message' })
      writer.write({ type: 'data-confirmation', data: receipt })
      writer.write({ type: 'text-start', id: 'receipt-text' })
      writer.write({ type: 'text-delta', id: 'receipt-text', delta: '已核对完成' })
      writer.write({ type: 'text-end', id: 'receipt-text' })
      writer.write({ type: 'finish' })
    } })
    let message: WencaiUIMessage | undefined
    for await (const next of readUIMessageStream<WencaiUIMessage>({ stream })) message = next
    expect(message?.parts).toContainEqual({ type: 'data-confirmation', data: receipt })
    expect(historyEvidence([message!])).toContainEqual(receipt)
  })
})
