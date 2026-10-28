import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { env } from '#/server/env'
import { adminActor, adminAuthorized } from '#/server/admin/access'
import { clearStaffCookieHeader, ensureStaffSchema, staffCookieHeader, staffFromRequest, staffLogin, StaffLoginError } from '#/server/admin/staff'
import { validRequestOrigin } from '#/server/security/request-origin'
import { audit } from '#/server/audit/log'

const failure = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status, headers: { 'cache-control': 'no-store' } })
const LoginSchema = z.object({ username: z.string().trim().min(1).max(32), password: z.string().min(1).max(200) }).strict()
const secure = () => env.PUBLIC_BASE_URL.startsWith('https://')
const source = (request: Request) => request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'direct'

/** 工作人员登录、退出与当前身份。后台其余接口凭这里签发的会话 Cookie 访问 */
export const Route = createFileRoute('/api/admin-session')({ server: { handlers: {
  GET: async ({ request }) => {
    if (!env.ADMIN_ENABLED) return failure(403, 'ADMIN_DISABLED', '管理后台未启用')
    const staff = staffFromRequest(request)
    const authorized = adminAuthorized(request)
    return Response.json({ data: {
      authorized,
      staff: staff ?? (authorized ? adminActor(request) : null),
      demoMode: env.AUTH_DEMO_MODE,
    } }, { headers: { 'cache-control': 'no-store' } })
  },
  POST: async ({ request }) => {
    if (!env.ADMIN_ENABLED) return failure(403, 'ADMIN_DISABLED', '管理后台未启用')
    if (!validRequestOrigin(request)) return failure(403, 'INVALID_ORIGIN', '请求来源无效')
    const parsed = LoginSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return failure(400, 'INVALID_LOGIN', '请输入用户名和密码')
    try {
      await ensureStaffSchema()
      const { identity, cookie } = await staffLogin(parsed.data.username, parsed.data.password, source(request))
      await audit({ userId: identity.id, sessionId: 'admin-session', channel: 'web' }, 'admin_command', { command: 'staff_login', staff: identity.username })
      return Response.json({ data: { staff: identity } }, { headers: { 'set-cookie': staffCookieHeader(cookie, secure()), 'cache-control': 'no-store' } })
    } catch (error) {
      if (error instanceof StaffLoginError) {
        await audit({ userId: `staff:${parsed.data.username}`, sessionId: 'admin-session', channel: 'web' }, 'login_failed', { scope: 'admin', username: parsed.data.username })
        return failure(error.status, error.status === 429 ? 'TOO_MANY_ATTEMPTS' : 'INVALID_CREDENTIALS', error.message)
      }
      return failure(500, 'LOGIN_FAILED', '登录服务暂时不可用')
    }
  },
  DELETE: async ({ request }) => {
    if (!validRequestOrigin(request)) return failure(403, 'INVALID_ORIGIN', '请求来源无效')
    return Response.json({ data: { ok: true } }, { headers: { 'set-cookie': clearStaffCookieHeader(secure()), 'cache-control': 'no-store' } })
  },
} } })
