import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '#/server/env'

/**
 * 工作人员会话 Cookie 的签发与校验（不查库，供同步的 adminAuthorized 使用）。
 * 会话自带姓名与角色并用 CONFIRM_SECRET 派生的密钥签名，有效期 8 小时。
 */
export type StaffRole = 'agent' | 'supervisor'
export interface StaffIdentity { id: string; username: string; name: string; role: StaffRole }

export const STAFF_COOKIE = 'wencai_staff'
const SESSION_MS = 8 * 3600_000
const sessionKey = () => createHmac('sha256', env.CONFIRM_SECRET).update('staff-session-v1').digest()

export function signSession(identity: StaffIdentity, now: number) {
  const payload = Buffer.from(JSON.stringify({ ...identity, exp: now + SESSION_MS })).toString('base64url')
  return `${payload}.${createHmac('sha256', sessionKey()).update(payload).digest('base64url')}`
}

export function readStaffSession(cookieValue: string | undefined, now = Date.now()): StaffIdentity | undefined {
  if (!cookieValue) return undefined
  const [payload, signature] = cookieValue.split('.')
  if (!payload || !signature) return undefined
  const expected = createHmac('sha256', sessionKey()).update(payload).digest()
  const given = Buffer.from(signature, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as StaffIdentity & { exp: number }
    if (typeof data.exp !== 'number' || data.exp <= now || !['agent', 'supervisor'].includes(data.role)) return undefined
    return { id: data.id, username: data.username, name: data.name, role: data.role }
  } catch {
    return undefined
  }
}

export function staffFromRequest(request: Request): StaffIdentity | undefined {
  const cookie = request.headers.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${STAFF_COOKIE}=`))
  return readStaffSession(cookie?.slice(STAFF_COOKIE.length + 1))
}

export function staffCookieHeader(value: string, secure: boolean) {
  return `${STAFF_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${secure ? '; Secure' : ''}`
}
export const clearStaffCookieHeader = (secure: boolean) => `${STAFF_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`
