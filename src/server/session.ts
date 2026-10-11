import { and, eq, isNull } from 'drizzle-orm'
import { auth as authTables, db, schema } from '#/server/db/client'
import { auth } from './auth'
import type { AuthSession } from './types'

/**
 * 会话解析。整个系统唯一的身份来源：
 *   请求 → Cookie → session 表 → bank user id
 * 模型参数、URL 查询串、渠道回调里的用户标识都不能直接成为 userId。
 */
export async function getSession(request: Request): Promise<AuthSession | null> {
  const data = await auth.api.getSession({ headers: request.headers })
  if (!data) return null
  return { userId: data.user.id, userName: data.user.name, sessionId: data.session.id }
}

/** 与 getSession 相同，但未登录时抛错；用于必须登录的 API */
export async function requireSession(request: Request): Promise<AuthSession> {
  const session = await getSession(request)
  if (!session) throw new UnauthorizedError()
  return session
}

export class UnauthorizedError extends Error {
  readonly status = 401
  constructor() {
    super('未登录')
  }
}

/**
 * 渠道身份绑定查询：外部账号 → 银行用户。
 * 只有有效绑定（未撤销）的行才被认可。
 */
export async function resolveChannelUser(channel: 'lark' | 'mcp', externalId: string): Promise<string | null> {
  if (!externalId) return null
  const [row] = await db
    .select({ userId: schema.channelBindings.userId })
    .from(schema.channelBindings)
    .where(
      and(
        eq(schema.channelBindings.channel, channel),
        eq(schema.channelBindings.externalId, externalId),
        isNull(schema.channelBindings.revokedAt),
      ),
    )
    .limit(1)
  return row?.userId ?? null
}

/** 当前会话是否已绑定该渠道 */
export async function isBoundBySession(channel: 'lark' | 'mcp', externalId: string, sessionId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.channelBindings.id })
    .from(schema.channelBindings)
    .where(
      and(
        eq(schema.channelBindings.channel, channel),
        eq(schema.channelBindings.externalId, externalId),
        eq(schema.channelBindings.boundBySessionId, sessionId),
        isNull(schema.channelBindings.revokedAt),
      ),
    )
    .limit(1)
  return !!row
}

/** 列出某用户的所有渠道绑定（设置页用） */
export async function listBindings(userId: string) {
  return db
    .select()
    .from(schema.channelBindings)
    .where(and(eq(schema.channelBindings.userId, userId), isNull(schema.channelBindings.revokedAt)))
}

/** 解绑：立即生效 */
export async function revokeBinding(userId: string, bindingId: string): Promise<boolean> {
  const res = await db
    .update(schema.channelBindings)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.channelBindings.id, bindingId),
        eq(schema.channelBindings.userId, userId),
        isNull(schema.channelBindings.revokedAt),
      ),
    )
    .returning({ id: schema.channelBindings.id })
  return res.length > 0
}

/** 单个渠道是否已绑定（未列出具体账号，避免在设置页泄露 open_id） */
export async function hasBinding(userId: string, channel: 'lark' | 'mcp'): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.channelBindings.id })
    .from(schema.channelBindings)
    .where(and(eq(schema.channelBindings.userId, userId), eq(schema.channelBindings.channel, channel), isNull(schema.channelBindings.revokedAt)))
    .limit(1)
  return !!row
}

/** 同一外部渠道账号是否已被别的用户占用 */
export async function externalIdTaken(channel: 'lark' | 'mcp', externalId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.channelBindings.id })
    .from(schema.channelBindings)
    .where(
      and(
        eq(schema.channelBindings.channel, channel),
        eq(schema.channelBindings.externalId, externalId),
        isNull(schema.channelBindings.revokedAt),
      ),
    )
    .limit(1)
  return !!row
}

/** 已登录会话列表（设备管理，设置页用） */
export async function listSessions(userId: string) {
  const rows = await db
    .select({
      id: authTables.baSession.id,
      createdAt: authTables.baSession.createdAt,
      expiresAt: authTables.baSession.expiresAt,
      ipAddress: authTables.baSession.ipAddress,
      userAgent: authTables.baSession.userAgent,
    })
    .from(authTables.baSession)
    .where(eq(authTables.baSession.userId, userId))
  const now = Date.now()
  return rows.filter((r) => r.expiresAt.getTime() > now).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}

/** 踢掉指定会话（不能踢当前会话，否则用户立刻登出） */
export async function revokeSession(userId: string, sessionId: string): Promise<boolean> {
  const res = await db
    .delete(authTables.baSession)
    .where(and(eq(authTables.baSession.id, sessionId), eq(authTables.baSession.userId, userId)))
    .returning({ id: authTables.baSession.id })
  return res.length > 0
}
