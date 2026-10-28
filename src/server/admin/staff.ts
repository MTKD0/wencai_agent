import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db, schema } from '#/server/db/client'
import { env } from '#/server/env'
import { signSession, type StaffIdentity, type StaffRole } from './staff-session'
export { clearStaffCookieHeader, readStaffSession, staffCookieHeader, staffFromRequest, STAFF_COOKIE, type StaffIdentity, type StaffRole } from './staff-session'

/**
 * 银行工作人员登录。后台不再借演示模式免登录：工作人员用账号密码登录，拿到带签名的会话 Cookie。
 * 会话自带姓名与角色并签名，校验不查库（adminAuthorized 是同步函数）；有效期 8 小时。
 * 账号由部署方通过 ADMIN_STAFF_ACCOUNTS 预置，仓库里不存任何密码。
 */

let ready: Promise<void> | undefined
export function ensureStaffSchema() {
  return (ready ??= (async () => {
    await db.$client.execute(`CREATE TABLE IF NOT EXISTS bank_staff (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      role TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL, disabled_at INTEGER)`)
    await bootstrapStaff()
  })().catch((error) => { ready = undefined; throw error }))
}

const hashPassword = (password: string, salt = randomBytes(16).toString('hex')) => `scrypt:${salt}:${scryptSync(password, salt, 32).toString('hex')}`
function passwordMatches(password: string, stored: string) {
  const [, salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const given = scryptSync(password, salt, 32), expected = Buffer.from(hash, 'hex')
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/** ADMIN_STAFF_ACCOUNTS="用户名:密码:姓名:角色,…"，角色 agent（回访坐席）或 supervisor（风控主管）；密码至少 10 位 */
export function parseStaffAccounts(raw: string | undefined) {
  return (raw ?? '').split(',').map((item) => item.trim()).filter(Boolean).map((item) => {
    const [username, password, name, role] = item.split(':').map((part) => part?.trim() ?? '')
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username) || password.length < 10 || !name || name.length > 20 || !['agent', 'supervisor'].includes(role)) {
      throw new Error(`ADMIN_STAFF_ACCOUNTS 格式无效：${username || item.slice(0, 12)}（用户名:至少10位密码:姓名:agent|supervisor）`)
    }
    return { username, password, name, role: role as StaffRole }
  })
}

async function bootstrapStaff() {
  for (const account of parseStaffAccounts(env.ADMIN_STAFF_ACCOUNTS)) {
    const [existing] = await db.select().from(schema.bankStaff).where(eq(schema.bankStaff.username, account.username))
    if (existing && passwordMatches(account.password, existing.passwordHash) && existing.name === account.name && existing.role === account.role) continue
    if (existing) await db.update(schema.bankStaff).set({ name: account.name, role: account.role, passwordHash: hashPassword(account.password), disabledAt: null }).where(eq(schema.bankStaff.id, existing.id))
    else await db.insert(schema.bankStaff).values({ id: `staff_${randomUUID()}`, username: account.username, name: account.name, role: account.role, passwordHash: hashPassword(account.password), createdAt: new Date() })
  }
}

// 登录失败限流：同一用户名或同一来源 10 分钟内最多失败 5 次
const failures = new Map<string, number[]>()
const WINDOW_MS = 10 * 60_000, MAX_FAILURES = 5
const recent = (key: string, now: number) => (failures.get(key) ?? []).filter((at) => now - at < WINDOW_MS)

export class StaffLoginError extends Error { constructor(message: string, readonly status: 401 | 429) { super(message) } }

export async function staffLogin(username: string, password: string, source: string, now = Date.now()) {
  await ensureStaffSchema()
  const keys = [`u:${username.toLowerCase()}`, `s:${source}`]
  if (keys.some((key) => recent(key, now).length >= MAX_FAILURES)) throw new StaffLoginError('登录失败次数过多，请 10 分钟后再试', 429)
  const [staff] = await db.select().from(schema.bankStaff).where(eq(schema.bankStaff.username, username))
  // 用户名不存在时也做一次哈希，避免按耗时猜出账号
  const ok = staff && !staff.disabledAt ? passwordMatches(password, staff.passwordHash) : (hashPassword(password), false)
  if (!ok || !staff) {
    for (const key of keys) failures.set(key, [...recent(key, now), now])
    throw new StaffLoginError('用户名或密码错误', 401)
  }
  for (const key of keys) failures.delete(key)
  const identity: StaffIdentity = { id: staff.id, username: staff.username, name: staff.name, role: staff.role as StaffRole }
  return { identity, cookie: signSession(identity, now) }
}
