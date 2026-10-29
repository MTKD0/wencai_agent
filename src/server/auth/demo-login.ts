import { eq } from 'drizzle-orm'
import { db, auth as authTables, schema } from '#/server/db/client'
import { env } from '#/server/env'

/**
 * 演示环境没有短信通道，评委又拿不到后台日志。演示模式下，登录页可直接显示这两类手机号的验证码：
 * - 公开的演示账号（种子数据 13800000000 / 13800000001）；
 * - 尚未注册的手机号（只能开一个空的新账户）；
 * - 在演示模式下注册的手机号（评委自己注册后，退出再登录仍能看到）。
 * 其他已注册的手机号（如演示模式改造前团队成员自己的账号）不显示，验证码只能从后台日志看。非演示模式一律不记录。
 */
export const PUBLIC_DEMO_PHONES = ['13800000000', '13800000001']

const TTL_MS = 300_000
const DEMO_REGISTRATION_PREFIX = 'demo_registered_phone:'
const key = Symbol.for('wencai.demo.login-codes')
const globals = globalThis as typeof globalThis & { [key]?: Map<string, { code: string; expiresAt: number }> }
const codes = (globals[key] ??= new Map())

export async function demoLoginCodeVisible(phone: string) {
  if (!env.AUTH_DEMO_MODE) return false
  if (PUBLIC_DEMO_PHONES.includes(phone)) return true
  const [existing] = await db.select({ id: authTables.baUser.id }).from(authTables.baUser).where(eq(authTables.baUser.phoneNumber, phone))
  if (!existing) return true
  const [marked] = await db.select({ key: schema.settings.key }).from(schema.settings).where(eq(schema.settings.key, DEMO_REGISTRATION_PREFIX + phone))
  return !!marked
}

/** 演示模式下开户时调用，记下这个号码以后登录也可在登录页显示验证码 */
export async function markDemoRegistration(phone: string, now = new Date()) {
  if (!env.AUTH_DEMO_MODE || !/^\+?\d{7,15}$/.test(phone)) return
  await db.insert(schema.settings).values({ key: DEMO_REGISTRATION_PREFIX + phone, value: now.toISOString() }).onConflictDoNothing()
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
