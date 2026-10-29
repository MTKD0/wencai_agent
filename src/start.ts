import { createMiddleware, createStart } from '@tanstack/react-start'

const runtimeLogging = createMiddleware().server(async ({ request, next }) => {
  const { observeRuntimeRequest } = await import('#/server/logging/runtime')
  return observeRuntimeRequest(request, next)
})
// 所有业务写接口统一校验请求来源（放在日志之后，被拒请求也会记入运行日志）
const requestOrigin = createMiddleware().server(async ({ request, next }) => {
  const { originRejection } = await import('#/server/security/request-origin')
  return originRejection(request) ?? next()
})
export const startInstance = createStart(() => ({ requestMiddleware: [runtimeLogging, requestOrigin] }))
