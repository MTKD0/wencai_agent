import { randomUUID } from 'node:crypto'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { db, schema } from '#/server/db/client'

/**
 * 交易密码修改凭证。
 *
 * 背景：Agent 发起"改交易密码"时，**新密码绝不能经过模型**——一旦作为工具参数传入，
 * 它会同时进入模型上下文、`pending_actions.args_json` 参数快照和审计日志，
 * 与 ARCHITECTURE.md §0「关键数据不经模型转述」直接冲突。
 *
 * 因此拆成两步：
 *   1. Agent 调 `request_password_change`（不接收任何密码）→ 红色确认单 → 用户完成强验证
 *   2. 确认成功后签发本凭证，用户带着它到 `/settings` 亲自输入新密码
 *
 * 凭证只证明"该用户刚刚为这次修改完成了红色强验证"，本身不是密码，有效期 5 分钟、单次消费。
 */

let ready: Promise<void> | undefined
export function ensurePasswordChangeSchema() {
  return (ready ??= (async () => {
    await db.$client.execute(
      'CREATE TABLE IF NOT EXISTS bank_password_change_grants (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, action_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER)',
    )
  })().catch((error) => {
    ready = undefined
    throw error
  }))
}

export const GRANT_TTL_MS = 5 * 60_000

/** 签发凭证。只由 `request_password_change` 的 execute 调用——即红色强验证通过之后。 */
export async function issuePasswordChangeGrant(userId: string, actionId: string): Promise<{ ticket: string; expiresAt: number }> {
  await ensurePasswordChangeSchema()
  const now = Date.now()
  const ticket = `pwg_${randomUUID()}`
  await db.insert(schema.bankPasswordChangeGrants).values({
    id: ticket,
    userId,
    actionId,
    createdAt: new Date(now),
    expiresAt: new Date(now + GRANT_TTL_MS),
  })
  return { ticket, expiresAt: now + GRANT_TTL_MS }
}

export type GrantResult =
  | { ok: true; actionId: string }
  | { ok: false; reason: 'not_found' | 'expired' | 'consumed' }

/**
 * 单次消费。条件更新保证并发重复提交只有一个能成功——
 * 与待确认动作的消费是同一套模式。
 */
export async function consumePasswordChangeGrant(userId: string, ticket: string): Promise<GrantResult> {
  await ensurePasswordChangeSchema()
  const [row] = await db
    .select()
    .from(schema.bankPasswordChangeGrants)
    .where(and(eq(schema.bankPasswordChangeGrants.id, ticket), eq(schema.bankPasswordChangeGrants.userId, userId)))
  if (!row) return { ok: false, reason: 'not_found' }
  if (row.consumedAt) return { ok: false, reason: 'consumed' }
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, reason: 'expired' }

  const claimed = await db
    .update(schema.bankPasswordChangeGrants)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(schema.bankPasswordChangeGrants.id, ticket),
        eq(schema.bankPasswordChangeGrants.userId, userId),
        isNull(schema.bankPasswordChangeGrants.consumedAt),
        gt(schema.bankPasswordChangeGrants.expiresAt, new Date()),
      ),
    )
    .returning({ actionId: schema.bankPasswordChangeGrants.actionId })
  return claimed.length === 1 ? { ok: true, actionId: claimed[0].actionId } : { ok: false, reason: 'consumed' }
}
