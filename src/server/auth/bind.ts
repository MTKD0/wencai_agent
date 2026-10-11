import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { auth as authTables, db, schema } from '#/server/db/client'
import { env } from '#/server/env'
import { audit } from '#/server/audit/log'
import type { AgentContext } from '#/server/agent/context'

/**
 * 飞书账号绑定。
 *
 * 流程：未绑定用户在飞书发消息 → 收到一次性绑定链接（HMAC 签名，10 分钟有效）
 *      → 在 H5 登录并完成一次强验证 → 点确认 → 写入 channel_bindings。
 *
 * 要点：
 * - 链接一次性：code 用后即废（存 verification 表）
 * - 绑定动作必须发生在「已登录会话」里，且做过一次 step-up
 * - 一个飞书账号只能绑定一个银行用户
 */

const BIND_TTL_MS = 10 * 60 * 1000

function sign(payload: string): string {
  return createHmac('sha256', env.CONFIRM_SECRET).update(payload).digest('hex')
}

/** 生成绑定 code：channel + externalId + nonce，签名防伪造 */
export async function createBindCode(channel: 'lark', externalId: string): Promise<string> {
  const exp = Date.now() + BIND_TTL_MS
  const nonce = randomUUID()
  const payload = `${channel}|${externalId}|${exp}|${nonce}`
  const code = `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`
  const identifier = `bind:${createHash('sha256').update(code).digest('hex')}`
  await db.insert(authTables.baVerification).values({
    id: randomUUID(),
    identifier,
    value: payload,
    expiresAt: new Date(exp),
  })
  return code
}

export type BindCodeInfo = { ok: true; channel: 'lark'; externalId: string } | { ok: false; reason: string }

/** 校验绑定 code：签名有效、未过期、未被使用过 */
export async function checkBindCode(code: string): Promise<BindCodeInfo> {
  const [payloadB64, signature] = code.split('.')
  if (!payloadB64 || !signature) return { ok: false, reason: '链接无效' }
  let payload: string
  try {
    payload = Buffer.from(payloadB64, 'base64url').toString('utf8')
  } catch {
    return { ok: false, reason: '链接无效' }
  }
  const expected = Buffer.from(sign(payload), 'hex')
  const actual = Buffer.from(signature, 'hex')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { ok: false, reason: '链接无效' }

  const [channel, externalId, expRaw] = payload.split('|')
  const exp = Number(expRaw)
  if (channel !== 'lark' || !externalId || !Number.isFinite(exp)) return { ok: false, reason: '链接无效' }
  if (exp < Date.now()) return { ok: false, reason: '链接已过期，请在飞书重新获取' }

  const identifier = `bind:${createHash('sha256').update(code).digest('hex')}`
  const [row] = await db.select().from(authTables.baVerification).where(eq(authTables.baVerification.identifier, identifier))
  if (!row) return { ok: false, reason: '链接已被使用，请在飞书重新获取' }
  return { ok: true, channel, externalId }
}

/**
 * 执行绑定。调用方必须已确认 session 持有者就是当前登录用户。
 * 幂等：同一会话重复绑定同一账号不报错。
 */
export async function bindChannel(params: {
  ctx: AgentContext
  channel: 'lark'
  externalId: string
  stepUpVerified: boolean
}): Promise<{ ok: boolean; reason?: string }> {
  const { ctx, channel, externalId } = params
  if (!params.stepUpVerified) {
    await audit(ctx, 'bind_rejected', { channel, reason: 'missing_step_up' })
    return { ok: false, reason: '绑定需要先完成一次强验证' }
  }
  if (await resolveBinding(channel, externalId)) {
    const [existing] = await db
      .select({ userId: schema.channelBindings.userId })
      .from(schema.channelBindings)
      .where(and(eq(schema.channelBindings.channel, channel), eq(schema.channelBindings.externalId, externalId)))
      .limit(1)
    if (existing?.userId === ctx.userId) return { ok: true }
    await audit(ctx, 'bind_rejected', { channel, reason: 'already_bound_to_other_user' })
    return { ok: false, reason: '该飞书账号已绑定到其他用户' }
  }

  await db.insert(schema.channelBindings).values({
    id: `cb_${randomUUID()}`,
    channel,
    externalId,
    userId: ctx.userId,
    boundAt: new Date(),
    boundBySessionId: ctx.sessionId,
  })
  await audit(ctx, 'channel_bound', { channel })
  return { ok: true }
}

/** 绑定成功后消费掉 code */
export async function consumeBindCode(code: string): Promise<void> {
  const identifier = `bind:${createHash('sha256').update(code).digest('hex')}`
  await db.delete(authTables.baVerification).where(eq(authTables.baVerification.identifier, identifier))
}

export async function resolveBinding(channel: 'lark', externalId: string): Promise<string | null> {
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

export function bindLink(code: string): string {
  return `${env.PUBLIC_BASE_URL}/bind?code=${encodeURIComponent(code)}`
}
