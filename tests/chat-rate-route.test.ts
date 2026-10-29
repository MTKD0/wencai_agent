import { describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db, schema } from '#/server/db/client'

// 审计表只追加，每次运行用新的用户编号
const { userId } = vi.hoisted(() => ({ userId: 'chat_rate_' + Date.now() }))

vi.mock('#/server/env', async (original) => {
  const actual = await original<typeof import('#/server/env')>()
  return { env: { ...actual.env, CHAT_RATE_PER_MINUTE: 1 } }
})
vi.mock('#/server/session', () => {
  class UnauthorizedError extends Error {}
  return { UnauthorizedError, requireSession: vi.fn(async () => ({ userId, sessionId: 'chat_rate_session' })) }
})
// 第一条请求放行后会进入审核与模型，这里替换为立即拒绝，只验证限流
vi.mock('#/server/agent/run', async (original) => ({ ...(await original<typeof import('#/server/agent/run')>()), screenInput: vi.fn(async () => { throw new Error('stop') }) }))

const { Route } = await import('#/routes/api/chat')
const post = () => (Route.options.server!.handlers as { POST: (ctx: { request: Request }) => Promise<Response> })
  .POST({ request: new Request('http://localhost/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [] }) }) })

describe('对话接口限流', () => {
  it('超过每分钟上限返回 429、提示原文与 Retry-After，并写审计', async () => {
    await expect(post()).rejects.toThrow('stop')
    const res = await post()
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toMatch(/^\d+$/)
    expect(await res.text()).toMatch(/^发送太频繁：每分钟最多 1 条/)
    const rows = await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.userId, userId), eq(schema.auditLogs.type, 'chat_rate_limited')))
    expect(rows.length).toBe(1)
  })
})
