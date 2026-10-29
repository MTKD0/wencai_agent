import { env } from '#/server/env'

/** The configured browser origin is authoritative; a TLS proxy's internal HTTP URL is not. */
export function validRequestOrigin(request: Request, publicBaseURL = env.PUBLIC_BASE_URL): boolean {
  const supplied = request.headers.get('origin')
  if (supplied === null) return request.headers.get('sec-fetch-site') !== 'cross-site'
  try {
    const origin = new URL(supplied)
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password ||
        origin.pathname !== '/' || origin.search || origin.hash) return false
    const configured = new URL(publicBaseURL)
    if (origin.origin === configured.origin) return true
    // Match the login layer's localhost/127.0.0.1 aliases, preserving protocol and port.
    if (['localhost', '127.0.0.1'].includes(configured.hostname) && ['localhost', '127.0.0.1'].includes(origin.hostname)) {
      return origin.protocol === configured.protocol && origin.port === configured.port
    }
  } catch {
    return false
  }
  // Host, Forwarded and X-Forwarded-* must not widen the allowed origin list.
  return false
}

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS']

/**
 * 全局中间件用：`/api/` 下的写请求来源不可信时返回 403，否则返回 undefined 继续处理。
 * `/api/auth/` 由 Better Auth 按 trustedOrigins 自行校验，这里不重复。
 */
export function originRejection(request: Request, publicBaseURL = env.PUBLIC_BASE_URL): Response | undefined {
  const { pathname } = new URL(request.url)
  if (!pathname.startsWith('/api/') || pathname.startsWith('/api/auth/') || SAFE_METHODS.includes(request.method)) return undefined
  if (validRequestOrigin(request, publicBaseURL)) return undefined
  return Response.json({ message: '请求来源无效' }, { status: 403, headers: { 'cache-control': 'no-store' } })
}
