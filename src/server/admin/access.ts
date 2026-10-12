import { timingSafeEqual } from 'node:crypto'
import { env } from '#/server/env'

/** 免认证仅限本地开发；非本地或生产环境必须提供独立后台凭据。 */
export function adminAuthorized(request: Request) {
  if (env.ADMIN_TOKEN) {
    const given = Buffer.from(request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '')
    const expected = Buffer.from(env.ADMIN_TOKEN)
    return given.length === expected.length && timingSafeEqual(given, expected)
  }
  const local = (host: string) => ['localhost', '127.0.0.1', '[::1]'].includes(host)
  if (process.env.NODE_ENV === 'production' || !local(new URL(request.url).hostname) || !local(new URL(env.PUBLIC_BASE_URL).hostname)) return false
  const origin = request.headers.get('origin')
  return !origin || origin === new URL(request.url).origin
}
