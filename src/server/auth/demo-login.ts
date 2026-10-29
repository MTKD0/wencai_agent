import { eq } from 'drizzle-orm'
import { db, auth as authTables } from '#/server/db/client'
import { env } from '#/server/env'

/**
 * 演示环境没有短信通道，评委又拿不到后台日志。演示模式下，登录页可直接显示这两类手机号的验证码：
 * - 公开的演示账号（种子数据 13800000000 / 13800000001）；
 * - 尚未注册的手机号（只能开一个空的新账户）。
 * 已注册的其他手机号（如团队成员自己的账号）不显示，验证码只能从后台日志看。非演示模式一律不记录。
 */
export const PUBLIC_DEMO_PHONES = ['13800000000', '13800000001']

const TTL_MS = 300_000
const key = Symbol.for('wencai.demo.login-codes')
const globals = globalThis as typeof globalThis & { [key]?: Map<string, { code: string; expiresAt: number }> }
const codes = (globals[key] ??= new Map())

export async function demoLoginCodeVisible(phone: string) {
  if (!env.AUTH_DEMO_MODE) return false
  if (PUBLIC_DEMO_PHONES.includes(phone)) return true
  const [existing] = await db.select({ id: authTables.baUser.id }).from(authTables.baUser).where(eq(authTables.baUser.phoneNumber, phone))
  return !existing
}

/** 发送验证码时调用；只保存可公开显示的号码，过期即删 */
export async function rememberDemoLoginCode(phone: string, code: string, now = Date.now()) {
  for (const [p, entry] of codes) if (entry.expiresAt <= now) codes.delete(p)
  if (await demoLoginCodeVisible(phone)) codes.set(phone, { code, expiresAt: now + TTL_MS })
  else codes.delete(phone)
}

export function demoLoginCode(phone: string, now = Date.now()) {
  if (!env.AUTH_DEMO_MODE) return undefined
  const entry = codes.get(phone)
  if (!entry || entry.expiresAt <= now) return undefined
  return { code: entry.code, expiresAt: new Date(entry.expiresAt).toISOString() }
}
