import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db, schema } from '#/server/db/client'
import { env } from '#/server/env'
import { audit } from '#/server/audit/log'
import type { AgentContext } from '#/server/agent/context'
import type { BankToolDef, ConfirmSummary } from '#/server/tools/define'
import type { PolicyDecision } from '#/server/policy/types'
import { hashParams, signIntegrity, verifyIntegrity } from './integrity'
import { verifyTxPassword } from '#/server/auth/tx-password'
import { verifyPasskeyAssertion } from '#/server/auth/passkey'

const MAX_FAILED_AUTH = 5
const LOCK_MINUTES = 30

export async function createPending(params: {
  ctx: AgentContext
  def: BankToolDef
  args: unknown
  decision: PolicyDecision
  plan?: { planId: string; nodeId: string }
}): Promise<{ actionId: string; level: 'yellow' | 'red'; summary: ConfirmSummary; expiresAt: number }> {
  const { ctx, def, args, decision } = params
  const level = decision.level === 'red' ? 'red' : 'yellow'
  const id = `pa_${randomUUID()}`
  const paramsHash = hashParams(args)
  const expiresAt = Date.now() + env.CONFIRM_TTL_SECONDS * 1000
  const integrity = signIntegrity(env.CONFIRM_SECRET, {
    id,
    userId: ctx.userId,
    tool: def.name,
    paramsHash,
    level,
    expiresAt,
  })
  const summary = await def.summarize!(args, ctx)

  await db.insert(schema.pendingActions).values({
    id,
    userId: ctx.userId,
    sessionId: ctx.sessionId,
    tool: def.name,
    argsJson: JSON.stringify(args),
    paramsHash,
    level,
    reasonsJson: JSON.stringify(decision.reasons),
    summaryJson: JSON.stringify(summary),
    integrity,
    expiresAt: new Date(expiresAt),
    status: 'pending',
    planId: params.plan?.planId,
    nodeId: params.plan?.nodeId,
    createdAt: new Date(),
  })
  await audit(ctx, 'pending_created', { actionId: id, tool: def.name, level, reasons: decision.reasons })
  return { actionId: id, level, summary, expiresAt }
}

export type StepUp = { method: 'password'; password: string } | { method: 'passkey'; response: unknown }

export type ConfirmResult =
  | { ok: true; tool: string; output: unknown; planId?: string; nodeId?: string }
  | { ok: false; code: ConfirmErrorCode; message: string }

export type ConfirmErrorCode =
  | 'not_found'
  | 'forbidden'
  | 'tampered'
  | 'expired'
  | 'already_used'
  | 'step_up_required'
  | 'step_up_failed'
  | 'locked'
  | 'execution_failed'

/**
 * 用户确认入口。只能由已认证的客户端会话调用；系统中不存在可被模型调用的确认工具。
 */
export async function confirmPending(params: {
  ctx: AgentContext
  actionId: string
  stepUp?: StepUp
  resolveTool: (name: string) => BankToolDef | undefined
}): Promise<ConfirmResult> {
  const { ctx, actionId, stepUp } = params
  const fail = async (code: ConfirmErrorCode, message: string): Promise<ConfirmResult> => {
    await audit(ctx, 'confirm_attempt', { actionId, ok: false, code })
    return { ok: false, code, message }
  }

  const [row] = await db.select().from(schema.pendingActions).where(eq(schema.pendingActions.id, actionId))
  if (!row) return fail('not_found', '待确认操作不存在')
  if (row.userId !== ctx.userId) return fail('forbidden', '无权确认该操作')

  const intact =
    hashParams(JSON.parse(row.argsJson)) === row.paramsHash &&
    verifyIntegrity(
      env.CONFIRM_SECRET,
      { id: row.id, userId: row.userId, tool: row.tool, paramsHash: row.paramsHash, level: row.level, expiresAt: row.expiresAt.getTime() },
      row.integrity,
    )
  if (!intact) return fail('tampered', '操作数据校验失败，已拒绝')
  if (row.status !== 'pending') return fail('already_used', '该操作已处理')
  if (row.expiresAt.getTime() < Date.now()) return fail('expired', '确认已超时，请重新发起')

  if (row.level === 'red') {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, ctx.userId))
    if (user?.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      return fail('locked', '账户已临时锁定，请联系人工客服')
    }
    if (!stepUp) return fail('step_up_required', '该操作需要强验证')
    if (!(await verifyStepUp(stepUp, ctx.userId))) {
      const failed = (user?.failedAuthCount ?? 0) + 1
      const lock = failed >= MAX_FAILED_AUTH
      await db
        .update(schema.users)
        .set({
          failedAuthCount: lock ? 0 : failed,
          lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : undefined,
        })
        .where(eq(schema.users.id, ctx.userId))
      if (lock) {
        await audit(ctx, 'circuit_breaker', { reason: 'step_up_failed_repeatedly', lockMinutes: LOCK_MINUTES })
        return fail('locked', `验证连续失败 ${MAX_FAILED_AUTH} 次，账户已锁定 ${LOCK_MINUTES} 分钟`)
      }
      return fail('step_up_failed', `验证失败，还可尝试 ${MAX_FAILED_AUTH - failed} 次`)
    }
    await db.update(schema.users).set({ failedAuthCount: 0 }).where(eq(schema.users.id, ctx.userId))
  }

  // 原子消费：并发重复提交只有一个能成功
  const consumed = await db
    .update(schema.pendingActions)
    .set({ status: 'consumed' })
    .where(and(eq(schema.pendingActions.id, actionId), eq(schema.pendingActions.status, 'pending')))
    .returning({ id: schema.pendingActions.id })
  if (consumed.length === 0) return fail('already_used', '该操作已处理')

  const def = params.resolveTool(row.tool)
  if (!def) return fail('execution_failed', `未知工具 ${row.tool}`)
  try {
    const output = await def.execute(JSON.parse(row.argsJson), ctx)
    await audit(ctx, 'confirm_attempt', { actionId, ok: true })
    await audit(ctx, 'action_executed', { actionId, tool: row.tool, output })
    return { ok: true, tool: row.tool, output, planId: row.planId ?? undefined, nodeId: row.nodeId ?? undefined }
  } catch (err) {
    return fail('execution_failed', err instanceof Error ? err.message : String(err))
  }
}

/** 供 H5 跳转页展示：仅返回属于当前用户的待确认动作 */
export async function getPendingForUser(ctx: AgentContext, actionId: string) {
  const [row] = await db
    .select()
    .from(schema.pendingActions)
    .where(and(eq(schema.pendingActions.id, actionId), eq(schema.pendingActions.userId, ctx.userId)))
  if (!row) return null
  return {
    actionId: row.id,
    level: row.level,
    status: row.expiresAt.getTime() < Date.now() && row.status === 'pending' ? 'expired' : row.status,
    reasons: JSON.parse(row.reasonsJson) as string[],
    summary: JSON.parse(row.summaryJson) as ConfirmSummary,
    expiresAt: row.expiresAt.getTime(),
  }
}

export async function cancelPending(ctx: AgentContext, actionId: string): Promise<void> {
  await db
    .update(schema.pendingActions)
    .set({ status: 'cancelled' })
    .where(
      and(
        eq(schema.pendingActions.id, actionId),
        eq(schema.pendingActions.userId, ctx.userId),
        eq(schema.pendingActions.status, 'pending'),
      ),
    )
  await audit(ctx, 'confirm_attempt', { actionId, cancelled: true })
}

/**
 * 强验证：交易密码走 scrypt 常数时间比较，Passkey 走 WebAuthn 签名校验。
 * 失败计数与锁定见 confirmPending。
 */
async function verifyStepUp(stepUp: StepUp, userId: string): Promise<boolean> {
  if (stepUp.method === 'password') return verifyTxPassword(userId, stepUp.password)
  if (stepUp.method === 'passkey') return verifyPasskeyAssertion(userId, stepUp.response)
  return false
}
