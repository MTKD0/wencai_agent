import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, lte } from 'drizzle-orm'
import { db, schema } from '#/server/db/client'
import { audit } from '#/server/audit/log'
import type { AgentContext } from '#/server/agent/context'
import { FRAUD_REASON_PREFIX, type HeldTransfer } from '#/lib/fraud'
import { simNow } from '#/server/tools/jobs'
import { notify } from '#/server/automation/service'
import { reverseTransfer, settleTransfer } from './service'

/**
 * 劝阻后的冷静期（延时执行）与反诈回访。
 *
 * 只对“识别到诈骗话术、用户看过劝阻仍坚持确认”的转给他人转账生效：确认与强验证照常完成，
 * 但不立即扣款，而是登记一笔冷静期，到期后由 worker 按原授权执行。期间：
 * - 用户可随时撤销，钱从未离开账户；
 * - 后台生成回访工单，人工联系用户核实后可以撤销，或确认安全后提前放行；
 * - 回访不能替用户发起或确认任何新交易，只能处理这一笔已经由用户本人确认过的转账。
 * 只有行为画像异常（没有诈骗话术）的转账不进冷静期：那一层误报较多，只做提醒与强验证。
 * 多步计划和批量转账里的转账步骤同样登记冷静期，计划按“已登记”继续，回滚时撤销登记；
 * 预约转账不再另建定时任务，而是登记一笔在“预约时间”和“确认后 24 小时”两者较晚时执行的冷静期。
 */
export const COOLING_OFF_MS = 24 * 3600_000
const HOLD_TOOLS = ['transfer', 'commit_transfer', 'commit_scheduled_transfer']

export type HoldStatus = 'held' | 'releasing' | 'released' | 'cancelled' | 'failed'
type SettleInput = { fromAccountId: string; payeeId: string; amountCents: number; memo?: string }
type StoredInput = { input: SettleInput; payeeRisk?: { accountId: string; revision: number } }

let ready: Promise<void> | undefined
export function ensureHoldSchema() {
  return (ready ??= (async () => {
    await db.$client.execute(`CREATE TABLE IF NOT EXISTS bank_transfer_holds (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, action_id TEXT NOT NULL UNIQUE,
      tool TEXT NOT NULL, input_json TEXT NOT NULL, amount_cents INTEGER NOT NULL, payee_name TEXT NOT NULL, reasons_json TEXT NOT NULL, status TEXT NOT NULL,
      created_at INTEGER NOT NULL, release_at INTEGER NOT NULL, resolved_at INTEGER, resolved_by TEXT, result_json TEXT)`)
    await db.$client.execute(`CREATE TABLE IF NOT EXISTS bank_callback_tickets (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, hold_id TEXT, action_id TEXT NOT NULL,
      reasons_json TEXT NOT NULL, amount_cents INTEGER NOT NULL, payee_name TEXT NOT NULL, status TEXT NOT NULL, outcome TEXT, note TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`)
  })().catch((error) => { ready = undefined; throw error }))
}

/** 确认单是否要进冷静期：话术命中的转给他人转账（含计划步骤与预约转账）。worker 到期执行的任务不再重复登记 */
export function shouldHold(row: { tool: string; sessionId: string }, reasons: string[]) {
  return HOLD_TOOLS.includes(row.tool) && !row.sessionId.startsWith('scheduled:') && reasons.some((r) => r.startsWith(FRAUD_REASON_PREFIX))
}

const yuan = (cents: number) => `${(cents / 100).toFixed(2)} 元`
const beijing = (date: Date) => new Date(date.getTime() + 8 * 3600_000).toISOString().replace('T', ' ').slice(0, 16)

export type HeldOutput = HeldTransfer

/** 在确认链路中、确认单已原子消费之后调用：登记冷静期与回访工单，代替立即执行 */
export async function holdTransfer(ctx: AgentContext, row: { id: string; tool: string }, args: Record<string, unknown>, reasons: string[], payeeRisk?: StoredInput['payeeRisk']): Promise<HeldOutput> {
  await ensureHoldSchema()
  const input: SettleInput = row.tool === 'transfer'
    ? { fromAccountId: String(args.fromAccountId), payeeId: String(args.payeeId), amountCents: Math.round(Number(args.amount) * 100), ...(args.memo ? { memo: String(args.memo) } : {}) }
    : { fromAccountId: String(args.fromAccountId), payeeId: String(args.payeeId), amountCents: Number(args.amountCents), ...(args.memo ? { memo: String(args.memo) } : {}) }
  const now = await simNow()
  let releaseAt = new Date(now.getTime() + COOLING_OFF_MS)
  // 预览令牌在登记时就消费掉，不能留到到期再用
  const { consumeToken } = await import('#/server/tools/bank-extended')
  if (row.tool === 'commit_transfer') {
    await consumeToken(ctx, String(args.confirmationToken), 'transfer', { fromAccountId: input.fromAccountId, payeeId: input.payeeId, amountCents: input.amountCents, memo: input.memo ?? '' })
  } else if (row.tool === 'commit_scheduled_transfer') {
    const executeAt = new Date(String(args.executeAt))
    if (!Number.isFinite(executeAt.getTime()) || executeAt <= now) throw new Error('INVALID_TIME: 预约时间必须晚于当前业务时间')
    await consumeToken(ctx, String(args.confirmationToken), 'scheduled_transfer', { fromAccountId: input.fromAccountId, payeeId: input.payeeId, amountCents: input.amountCents, executeAt: executeAt.toISOString(), memo: input.memo ?? '' })
    if (executeAt > releaseAt) releaseAt = executeAt
  }
  const [payee] = await db.select().from(schema.payees).where(and(eq(schema.payees.id, input.payeeId), eq(schema.payees.userId, ctx.userId)))
  if (!payee) throw new Error('收款人不存在')
  const hold = {
    id: `hold_${randomUUID()}`, userId: ctx.userId, actionId: row.id, tool: row.tool,
    inputJson: JSON.stringify({ input, ...(payeeRisk ? { payeeRisk } : {}) } satisfies StoredInput),
    amountCents: input.amountCents, payeeName: payee.name, reasonsJson: JSON.stringify(reasons), status: 'held',
    createdAt: now, releaseAt,
  }
  const ticket = { id: `cb_${randomUUID()}`, userId: ctx.userId, holdId: hold.id, actionId: row.id, reasonsJson: hold.reasonsJson, amountCents: hold.amountCents, payeeName: hold.payeeName, status: 'open', createdAt: now, updatedAt: now }
  await db.transaction(async (tx) => {
    await tx.insert(schema.bankTransferHolds).values(hold)
    await tx.insert(schema.bankCallbackTickets).values(ticket)
  })
  await audit(ctx, 'transfer_held', { actionId: row.id, holdId: hold.id, amountCents: hold.amountCents, releaseAt: hold.releaseAt.toISOString() })
  await audit(ctx, 'callback_ticket', { ticketId: ticket.id, holdId: hold.id, actionId: row.id, event: 'opened' })
  await notify(ctx.userId, 'transfer_held', '转账已进入冷静期', `向 ${payee.name} 转账 ${yuan(hold.amountCents)} 将于 ${beijing(hold.releaseAt)}（北京时间）执行，期间可随时撤销。银行工作人员可能会联系您核实。`, `hold:${hold.id}`, row.id)
  return { status: 'held', holdId: hold.id, releaseAt: hold.releaseAt.toISOString(), amountCents: hold.amountCents, payeeName: hold.payeeName }
}

export async function holdForAction(userId: string, actionId: string) {
  await ensureHoldSchema()
  const [hold] = await db.select().from(schema.bankTransferHolds).where(and(eq(schema.bankTransferHolds.actionId, actionId), eq(schema.bankTransferHolds.userId, userId)))
  return hold ? publicHold(hold) : undefined
}

function publicHold(h: typeof schema.bankTransferHolds.$inferSelect) {
  return { holdId: h.id, actionId: h.actionId, status: h.status as HoldStatus, amountCents: h.amountCents, payeeName: h.payeeName, releaseAt: h.releaseAt.toISOString(), resolvedBy: h.resolvedBy ?? undefined }
}

async function closeTicket(holdId: string, now: Date, outcome?: string, note?: string) {
  await db.update(schema.bankCallbackTickets).set({ status: 'closed', ...(outcome ? { outcome } : {}), ...(note ? { note } : {}), updatedAt: now })
    .where(and(eq(schema.bankCallbackTickets.holdId, holdId), eq(schema.bankCallbackTickets.status, 'open')))
}

/** 多步计划回滚：冷静期中的直接撤销；已到期执行的按执行流水冲正；已撤销或执行失败的无需处理 */
export async function compensateHold(ctx: AgentContext, holdId: string) {
  await ensureHoldSchema()
  const [hold] = await db.select().from(schema.bankTransferHolds).where(and(eq(schema.bankTransferHolds.id, holdId), eq(schema.bankTransferHolds.userId, ctx.userId)))
  if (!hold) throw new Error('冷静期记录不存在')
  if (hold.status === 'held') await cancelHold({ holdId, by: 'user', userId: ctx.userId, note: '多步任务回滚，撤销冷静期中的转账' })
  else if (hold.status === 'released') await reverseTransfer((JSON.parse(hold.resultJson ?? '{}') as { transactionId: string }).transactionId, ctx)
  else if (hold.status === 'releasing') throw new Error('转账正在执行，请稍后由人工处理')
}

/** 撤销冷静期中的转账：用户本人（userId 必须匹配）或后台回访。钱从未扣出，无需冲正 */
export async function cancelHold(params: { holdId: string; by: 'user' | 'admin'; userId?: string; note?: string }) {
  await ensureHoldSchema()
  const now = await simNow()
  const where = params.by === 'user'
    ? and(eq(schema.bankTransferHolds.id, params.holdId), eq(schema.bankTransferHolds.userId, params.userId ?? ''), eq(schema.bankTransferHolds.status, 'held'))
    : and(eq(schema.bankTransferHolds.id, params.holdId), eq(schema.bankTransferHolds.status, 'held'))
  const [hold] = await db.update(schema.bankTransferHolds).set({ status: 'cancelled', resolvedAt: now, resolvedBy: params.by }).where(where).returning()
  if (!hold) throw new Error('这笔转账已执行、已撤销或不存在')
  await closeTicket(hold.id, now, params.by === 'admin' ? 'confirmed_scam' : undefined, params.note ?? (params.by === 'user' ? '用户在冷静期内自行撤销' : undefined))
  const ctx = { userId: hold.userId, sessionId: `hold:${hold.id}`, channel: 'web' as const }
  await audit(ctx, 'transfer_hold_cancelled', { holdId: hold.id, actionId: hold.actionId, by: params.by })
  await notify(hold.userId, 'transfer_hold_cancelled', '冷静期中的转账已撤销', `向 ${hold.payeeName} 的 ${yuan(hold.amountCents)} 转账已撤销，资金未转出。`, `hold-cancelled:${hold.id}`, hold.actionId)
  return publicHold(hold)
}

/** 执行一笔冷静期转账。先把状态从 held 抢占为 releasing，与撤销互斥 */
async function releaseHold(holdId: string, by: 'worker' | 'admin') {
  const now = await simNow()
  const [hold] = await db.update(schema.bankTransferHolds).set({ status: 'releasing' }).where(and(eq(schema.bankTransferHolds.id, holdId), eq(schema.bankTransferHolds.status, 'held'))).returning()
  if (!hold) return undefined
  const stored = JSON.parse(hold.inputJson) as StoredInput
  const ctx: AgentContext = { userId: hold.userId, sessionId: `hold:${hold.id}`, channel: 'web',
    authorization: { level: 'red', actionId: hold.actionId, ...(stored.payeeRisk ? { payeeRisk: stored.payeeRisk } : {}) } }
  try {
    // 余额、卡片限额、收款账户风险等在扣款事务内照常复查
    const output = await settleTransfer(stored.input, ctx)
    await db.update(schema.bankTransferHolds).set({ status: 'released', resolvedAt: now, resolvedBy: by, resultJson: JSON.stringify(output) }).where(eq(schema.bankTransferHolds.id, hold.id))
    await closeTicket(hold.id, now, by === 'admin' ? 'confirmed_safe' : undefined, by === 'worker' ? '冷静期届满，按原授权执行' : undefined)
    await audit(ctx, 'action_executed', { actionId: hold.actionId, tool: hold.tool, output })
    await audit(ctx, 'transfer_hold_released', { holdId: hold.id, actionId: hold.actionId, by })
    await notify(hold.userId, 'transfer_hold_released', '冷静期结束，转账已执行', `向 ${hold.payeeName} 转账 ${yuan(hold.amountCents)} 已执行。`, `hold-released:${hold.id}`, hold.actionId)
    return { ...publicHold(hold), status: 'released' as const }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await db.update(schema.bankTransferHolds).set({ status: 'failed', resolvedAt: now, resolvedBy: by, resultJson: JSON.stringify({ error: message }) }).where(eq(schema.bankTransferHolds.id, hold.id))
    await closeTicket(hold.id, now, undefined, `到期执行失败：${message}`)
    await audit(ctx, 'confirm_attempt', { actionId: hold.actionId, ok: false, code: 'execution_failed', stage: 'cooling_off_release', message })
    await notify(hold.userId, 'transfer_hold_failed', '冷静期转账未能执行', `向 ${hold.payeeName} 的 ${yuan(hold.amountCents)} 转账未能执行：${message}`, `hold-failed:${hold.id}`, hold.actionId)
    return { ...publicHold(hold), status: 'failed' as const }
  }
}

/** worker 每轮调用：执行到期的冷静期转账 */
export async function releaseDueHolds(userId: string, now: Date) {
  await ensureHoldSchema()
  const due = await db.select({ id: schema.bankTransferHolds.id }).from(schema.bankTransferHolds)
    .where(and(eq(schema.bankTransferHolds.userId, userId), eq(schema.bankTransferHolds.status, 'held'), lte(schema.bankTransferHolds.releaseAt, now)))
  const results = []
  for (const { id } of due) { const r = await releaseHold(id, 'worker'); if (r) results.push(r) }
  return results
}

export async function listUserHolds(userId: string) {
  await ensureHoldSchema()
  return (await db.select().from(schema.bankTransferHolds).where(eq(schema.bankTransferHolds.userId, userId)).orderBy(desc(schema.bankTransferHolds.createdAt)).limit(50)).map(publicHold)
}

// ── 后台回访 ──────────────────────────────────────────────────────────────

export async function listCallbackTickets() {
  await ensureHoldSchema()
  const tickets = await db.select().from(schema.bankCallbackTickets).orderBy(desc(schema.bankCallbackTickets.createdAt)).limit(200)
  const holdIds = tickets.map((t) => t.holdId).filter((id): id is string => !!id)
  const holds = holdIds.length ? await db.select().from(schema.bankTransferHolds).where(inArray(schema.bankTransferHolds.id, holdIds)) : []
  const users = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users)
  const byHold = new Map(holds.map((h) => [h.id, h])), names = new Map(users.map((u) => [u.id, u.name]))
  return tickets.map((t) => {
    const hold = t.holdId ? byHold.get(t.holdId) : undefined
    return {
      ticketId: t.id, userId: t.userId, userName: names.get(t.userId) ?? t.userId, actionId: t.actionId,
      reasons: JSON.parse(t.reasonsJson) as string[], amountCents: t.amountCents, payeeName: t.payeeName,
      status: t.status as 'open' | 'closed', outcome: t.outcome ?? undefined, note: t.note ?? undefined,
      createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString(),
      hold: hold ? publicHold(hold) : undefined,
    }
  })
}

/**
 * 记录回访结论。confirmed_scam 撤销冷静期中的转账；confirmed_safe 提前放行；unreachable 只记录，转账按期执行。
 * 结论只作用于这一笔用户已确认过的转账，不产生任何新交易。
 */
export async function resolveCallbackTicket(params: { ticketId: string; outcome: 'confirmed_safe' | 'confirmed_scam' | 'unreachable'; note?: string }) {
  await ensureHoldSchema()
  const [ticket] = await db.select().from(schema.bankCallbackTickets).where(eq(schema.bankCallbackTickets.id, params.ticketId))
  if (!ticket) throw new Error('工单不存在')
  if (ticket.status !== 'open') throw new Error('工单已结束')
  const now = await simNow()
  const note = params.note?.trim().slice(0, 200) || undefined
  const ctx = { userId: ticket.userId, sessionId: `callback:${ticket.id}`, channel: 'web' as const }
  if (params.outcome === 'confirmed_scam' && ticket.holdId) await cancelHold({ holdId: ticket.holdId, by: 'admin', note: note ?? '回访确认疑似诈骗，已撤销' })
  else if (params.outcome === 'confirmed_safe' && ticket.holdId) {
    const released = await releaseHold(ticket.holdId, 'admin')
    if (!released) throw new Error('这笔转账已不在冷静期中')
  }
  await db.update(schema.bankCallbackTickets).set({ status: params.outcome === 'unreachable' ? 'open' : 'closed', outcome: params.outcome, ...(note ? { note } : {}), updatedAt: now }).where(eq(schema.bankCallbackTickets.id, ticket.id))
  await audit(ctx, 'callback_ticket', { ticketId: ticket.id, holdId: ticket.holdId, actionId: ticket.actionId, event: 'resolved', outcome: params.outcome })
  return (await listCallbackTickets()).find((t) => t.ticketId === ticket.id)
}
