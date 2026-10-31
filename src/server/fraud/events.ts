import { randomUUID } from 'node:crypto'
import { desc, eq, inArray } from 'drizzle-orm'
import { db, schema } from '#/server/db/client'
import type { AgentContext } from '#/server/agent/context'
import type { PolicyFacts } from '#/server/policy/types'
import { FRAUD_SIGNAL_TEXT, type FraudSignal } from '#/server/policy/fraud'
import { BEHAVIOR_SIGNAL_TEXT, BEHAVIOR_THRESHOLDS, type BehaviorSignal } from '#/server/policy/behavior'
import { FRAUD_REASON_PREFIX, UNUSUAL_REASON_PREFIX } from '#/lib/fraud'
import { ensureHoldSchema } from '#/server/payments/holds'
import { listAdminUsers } from '#/server/admin/users'
import { simNow } from '#/server/tools/jobs'

/**
 * 反诈识别事件（后台反诈中心的数据源）。
 * 生成确认单时，若命中诈骗话术（关键词或模型判断）或行为画像异常，就记一条识别依据；
 * 之后用户放弃、进入冷静期、被撤销或放行，都从确认单和冷静期的状态读出，不在各处回写。
 * 只供后台人工查看：不进入策略引擎，也不会交给 Agent。
 */
export type FraudLayer = 'keyword' | 'model' | 'behavior'
export type FraudOutcome = 'awaiting' | 'abandoned' | 'held' | 'released' | 'hold_cancelled' | 'failed' | 'executed'

export const FRAUD_OUTCOME_TEXT: Record<FraudOutcome, string> = {
  awaiting: '待用户确认',
  abandoned: '劝阻后放弃',
  held: '冷静期中',
  released: '冷静期后执行',
  hold_cancelled: '冷静期内撤销',
  failed: '执行失败',
  executed: '已确认执行',
}

let ready: Promise<void> | undefined
export function ensureFraudEventSchema() {
  return (ready ??= (async () => {
    await db.$client.execute(`CREATE TABLE IF NOT EXISTS bank_fraud_events (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, action_id TEXT NOT NULL UNIQUE,
      tool TEXT NOT NULL, amount_cents INTEGER NOT NULL, payee_id TEXT, payee_name TEXT NOT NULL, layers_json TEXT NOT NULL, signals_json TEXT NOT NULL,
      evidence TEXT, behavior_json TEXT NOT NULL, baseline_json TEXT, reasons_json TEXT NOT NULL, created_at INTEGER NOT NULL)`)
    await db.$client.execute('CREATE INDEX IF NOT EXISTS bank_fraud_events_user ON bank_fraud_events (user_id, created_at)')
    await backfillFromPendingActions()
  })().catch((error) => { ready = undefined; throw error }))
}

const amountOf = (args: Record<string, unknown>) =>
  typeof args.amountCents === 'number' ? args.amountCents : typeof args.amount === 'number' ? Math.round(args.amount * 100) : 0

async function payeeNameOf(userId: string, args: Record<string, unknown>, summary?: { fields?: { label: string; value: string }[] }) {
  if (typeof args.payeeId === 'string') {
    const [payee] = await db.select({ name: schema.payees.name, userId: schema.payees.userId }).from(schema.payees).where(eq(schema.payees.id, args.payeeId))
    if (payee && payee.userId === userId) return payee.name
  }
  const field = summary?.fields?.find((f) => /收款|对方|收件/.test(f.label))
  return field?.value.slice(0, 60) ?? (typeof args.name === 'string' ? args.name.slice(0, 60) : '—')
}

/** 在确认单创建之后调用；没有命中任何一层时不记录 */
export async function recordFraudEvent(params: {
  ctx: AgentContext; tool: string; actionId: string; args: Record<string, unknown>; facts: PolicyFacts; reasons: string[]
  fraudLayer?: 'keyword' | 'model'; evidence?: string; behavior: BehaviorSignal[]; summary?: { fields?: { label: string; value: string }[] }
}) {
  const signals = params.facts.fraudSignals ?? []
  const layers: FraudLayer[] = [
    ...(signals.length ? [params.fraudLayer ?? 'keyword'] : []),
    ...(params.behavior.length >= BEHAVIOR_THRESHOLDS.minSignals ? ['behavior' as const] : []),
  ]
  if (!layers.length) return
  await ensureFraudEventSchema()
  const baseline = params.facts.transferBaseline
  const live = {
    userId: params.ctx.userId, actionId: params.actionId, tool: params.tool,
    amountCents: amountOf(params.args), payeeId: typeof params.args.payeeId === 'string' ? params.args.payeeId : null,
    payeeName: await payeeNameOf(params.ctx.userId, params.args, params.summary),
    layersJson: JSON.stringify(layers), signalsJson: JSON.stringify(signals), evidence: params.evidence?.slice(0, 200) ?? null,
    behaviorJson: JSON.stringify(params.behavior),
    baselineJson: baseline ? JSON.stringify({ medianOutCents: baseline.medianOutCents, sampleCount: baseline.sampleCount, liquidBalanceCents: baseline.liquidBalanceCents, monthlyIncomeCents: baseline.monthlyIncomeCents, payeePaidBefore: baseline.payeePaidBefore }) : null,
    reasonsJson: JSON.stringify(params.reasons), createdAt: await simNow(), // 后台统计按业务时钟算“今日”，这里也必须用业务时钟
  }
  // 进程内第一次写入时，ensureFraudEventSchema 的补记会先按这张确认单补一条（真实时间、没有证据原文），以本次实时记录覆盖
  await db.insert(schema.bankFraudEvents).values({ id: `fe_${randomUUID()}`, ...live })
    .onConflictDoUpdate({ target: schema.bankFraudEvents.actionId, set: live })
}

/** 上线前已有的确认单：按确认单上展示过的原因补记（分不清关键词还是模型时记为关键词） */
async function backfillFromPendingActions() {
  const rows = await db.select().from(schema.pendingActions)
  const known = new Set((await db.select({ actionId: schema.bankFraudEvents.actionId }).from(schema.bankFraudEvents)).map((r) => r.actionId))
  for (const row of rows) {
    if (known.has(row.id)) continue
    const reasons = JSON.parse(row.reasonsJson) as string[]
    const fraud = reasons.some((r) => r.startsWith(FRAUD_REASON_PREFIX)), unusual = reasons.some((r) => r.startsWith(UNUSUAL_REASON_PREFIX))
    if (!fraud && !unusual) continue
    const args = JSON.parse(row.argsJson) as Record<string, unknown>
    const signals = (Object.keys(FRAUD_SIGNAL_TEXT) as FraudSignal[]).filter((s) => reasons.some((r) => r.startsWith(FRAUD_REASON_PREFIX) && r.includes(FRAUD_SIGNAL_TEXT[s])))
    const behavior = (Object.keys(BEHAVIOR_SIGNAL_TEXT) as BehaviorSignal[]).filter((s) => reasons.some((r) => r.startsWith(UNUSUAL_REASON_PREFIX) && r.includes(BEHAVIOR_SIGNAL_TEXT[s])))
    await db.insert(schema.bankFraudEvents).values({
      id: `fe_${randomUUID()}`, userId: row.userId, actionId: row.id, tool: row.tool, amountCents: amountOf(args),
      payeeId: typeof args.payeeId === 'string' ? args.payeeId : null, payeeName: await payeeNameOf(row.userId, args, JSON.parse(row.summaryJson)),
      layersJson: JSON.stringify([...(fraud ? ['keyword'] : []), ...(unusual ? ['behavior'] : [])]), signalsJson: JSON.stringify(signals), evidence: null,
      behaviorJson: JSON.stringify(behavior), baselineJson: null, reasonsJson: row.reasonsJson, createdAt: row.createdAt,
    }).onConflictDoNothing()
  }
}

export interface FraudEventView {
  id: string; userId: string; userName: string; phone: string | null; actionId: string; tool: string; amountCents: number; payeeName: string
  layers: FraudLayer[]; signals: { id: string; text: string }[]; evidence?: string; behavior: { id: string; text: string }[]
  baseline?: { medianOutCents: number | null; sampleCount: number; liquidBalanceCents: number; monthlyIncomeCents: number; payeePaidBefore?: boolean }
  reasons: string[]; createdAt: string; outcome: FraudOutcome; outcomeText: string
  hold?: { holdId: string; status: string; releaseAt: string; resolvedBy?: string }
  ticket?: { ticketId: string; status: string; outcome?: string; handledBy?: string; attempts: number }
}

/** 识别事件及其处理结果；userId 指定时只看这位客户 */
export async function listFraudEvents(options: { userId?: string; limit?: number; now?: Date } = {}): Promise<FraudEventView[]> {
  await Promise.all([ensureFraudEventSchema(), ensureHoldSchema()])
  const events = await db.select().from(schema.bankFraudEvents)
    .where(options.userId ? eq(schema.bankFraudEvents.userId, options.userId) : undefined)
    .orderBy(desc(schema.bankFraudEvents.createdAt)).limit(options.limit ?? 500)
  if (!events.length) return []
  const actionIds = events.map((e) => e.actionId)
  const [pending, holds, tickets, users] = await Promise.all([
    db.select({ id: schema.pendingActions.id, status: schema.pendingActions.status, expiresAt: schema.pendingActions.expiresAt }).from(schema.pendingActions).where(inArray(schema.pendingActions.id, actionIds)),
    db.select().from(schema.bankTransferHolds).where(inArray(schema.bankTransferHolds.actionId, actionIds)),
    db.select().from(schema.bankCallbackTickets).where(inArray(schema.bankCallbackTickets.actionId, actionIds)),
    listAdminUsers(),
  ])
  const pendingById = new Map(pending.map((p) => [p.id, p])), holdByAction = new Map(holds.map((h) => [h.actionId, h]))
  const ticketByAction = new Map(tickets.map((t) => [t.actionId, t])), userById = new Map(users.map((u) => [u.id, u]))
  const now = (options.now ?? new Date()).getTime()
  return events.map((e) => {
    const p = pendingById.get(e.actionId), hold = holdByAction.get(e.actionId), ticket = ticketByAction.get(e.actionId)
    const outcome: FraudOutcome = hold
      ? hold.status === 'held' || hold.status === 'releasing' ? 'held' : hold.status === 'released' ? 'released' : hold.status === 'cancelled' ? 'hold_cancelled' : 'failed'
      : !p || p.status === 'cancelled' || p.status === 'expired' || (p.status === 'pending' && p.expiresAt.getTime() <= now) ? 'abandoned'
        : p.status === 'pending' ? 'awaiting' : 'executed'
    const user = userById.get(e.userId)
    const baseline = e.baselineJson ? JSON.parse(e.baselineJson) as FraudEventView['baseline'] : undefined
    return {
      id: e.id, userId: e.userId, userName: user?.name ?? e.userId, phone: user?.phoneNumber ?? null, actionId: e.actionId, tool: e.tool,
      amountCents: e.amountCents, payeeName: e.payeeName, layers: JSON.parse(e.layersJson) as FraudLayer[],
      signals: (JSON.parse(e.signalsJson) as FraudSignal[]).map((id) => ({ id, text: FRAUD_SIGNAL_TEXT[id] ?? id })),
      ...(e.evidence ? { evidence: e.evidence } : {}),
      behavior: (JSON.parse(e.behaviorJson) as BehaviorSignal[]).map((id) => ({ id, text: BEHAVIOR_SIGNAL_TEXT[id] ?? id })),
      ...(baseline ? { baseline } : {}),
      reasons: JSON.parse(e.reasonsJson) as string[], createdAt: e.createdAt.toISOString(), outcome, outcomeText: FRAUD_OUTCOME_TEXT[outcome],
      ...(hold ? { hold: { holdId: hold.id, status: hold.status, releaseAt: hold.releaseAt.toISOString(), ...(hold.resolvedBy ? { resolvedBy: hold.resolvedBy } : {}) } } : {}),
      ...(ticket ? { ticket: { ticketId: ticket.id, status: ticket.status, ...(ticket.outcome ? { outcome: ticket.outcome } : {}), ...(ticket.handledBy ? { handledBy: ticket.handledBy } : {}), attempts: ticket.attempts } } : {}),
    }
  })
}

const dayKey = (date: Date) => new Date(date.getTime() + 8 * 3600_000).toISOString().slice(0, 10)

/** 反诈效果统计：按北京时间自然日 */
export function fraudStats(events: FraudEventView[], now: Date, days = 7) {
  const today = dayKey(now)
  const keys = Array.from({ length: days }, (_, i) => dayKey(new Date(now.getTime() - (days - 1 - i) * 86_400_000)))
  const scam = (e: FraudEventView) => e.layers.includes('keyword') || e.layers.includes('model')
  const protectedCents = (list: FraudEventView[]) => list.filter((e) => e.outcome === 'abandoned' || e.outcome === 'hold_cancelled').reduce((sum, e) => sum + e.amountCents, 0)
  const todays = events.filter((e) => dayKey(new Date(e.createdAt)) === today)
  const decided = events.filter((e) => scam(e) && e.outcome !== 'awaiting')
  return {
    today: {
      detected: todays.length,
      scamScripts: todays.filter(scam).length,
      abandoned: todays.filter((e) => e.outcome === 'abandoned').length,
      protectedCents: protectedCents(todays),
    },
    total: {
      detected: events.length,
      protectedCents: protectedCents(events),
      heldCents: events.filter((e) => e.outcome === 'held').reduce((sum, e) => sum + e.amountCents, 0),
      // 话术命中后用户放弃或在冷静期内撤销的比例
      stopRate: decided.length ? decided.filter((e) => e.outcome === 'abandoned' || e.outcome === 'hold_cancelled').length / decided.length : null,
    },
    byLayer: (['keyword', 'model', 'behavior'] as const).map((layer) => ({ layer, count: events.filter((e) => e.layers.includes(layer)).length })),
    byOutcome: (Object.keys(FRAUD_OUTCOME_TEXT) as FraudOutcome[]).map((outcome) => ({ outcome, text: FRAUD_OUTCOME_TEXT[outcome], count: events.filter((e) => e.outcome === outcome).length })),
    trend: keys.map((key) => {
      const list = events.filter((e) => dayKey(new Date(e.createdAt)) === key)
      return { date: key, detected: list.length, scam: list.filter(scam).length, protectedCents: protectedCents(list) }
    }),
  }
}
