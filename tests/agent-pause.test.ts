import { afterAll, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db, schema } from '#/server/db/client'

const { userId } = vi.hoisted(() => ({ userId: 'agent_pause_' + Date.now() }))
vi.mock('#/server/session', () => {
  class UnauthorizedError extends Error {}
  return { UnauthorizedError, requireSession: vi.fn(async () => ({ userId, sessionId: 'agent_pause_session' })) }
})
// 放行时会进入审核与模型，这里替换为立即拒绝，只验证停用开关
vi.mock('#/server/agent/run', async (original) => ({ ...(await original<typeof import('#/server/agent/run')>()), screenInput: vi.fn(async () => { throw new Error('model reached') }) }))

const { Route: Chat } = await import('#/routes/api/chat')
const { Route: AdminAgent } = await import('#/routes/api/admin-agent')
const { agentPauseState, setAgentPause } = await import('#/server/agent/pause')
type Handler = (ctx: { request: Request }) => Promise<Response>
const chat = () => (Chat.options.server!.handlers as { POST: Handler }).POST({ request: new Request('http://localhost/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [] }) }) })
const toggle = (body: unknown) => (AdminAgent.options.server!.handlers as { POST: Handler }).POST({ request: new Request('http://localhost/api/admin-agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) })

afterAll(async () => { await setAgentPause(false, '测试结束恢复', '测试') })

describe('智能助手紧急停用', () => {
  it('停用必须填写原因', async () => {
    expect((await toggle({ paused: true })).status).toBe(400)
    expect((await toggle({ paused: true, reason: '' })).status).toBe(400)
  })

  it('停用后对话不再调用模型，返回固定提示；恢复后照常进入模型', async () => {
    const res = await toggle({ paused: true, reason: '发现可绕过的注入话术' })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({ paused: true, reason: '发现可绕过的注入话术' })
    expect((await agentPauseState()).paused).toBe(true)

    const blocked = await chat()
    expect(blocked.status).toBe(503)
    expect(await blocked.text()).toMatch(/^智能助手已暂停：.*首页的转账、卡片和任务中心仍可正常办理/)

    expect((await toggle({ paused: false, reason: '已排查' })).status).toBe(200)
    await expect(chat()).rejects.toThrow('model reached')
  })

  it('停用与恢复都写审计并记录原因', async () => {
    const rows = await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.userId, 'system'), eq(schema.auditLogs.type, 'admin_command')))
    const commands = rows.map((r) => JSON.parse(r.payloadJson).command).filter((c) => c?.type === 'pauseAgent' || c?.type === 'resumeAgent')
    expect(commands).toEqual(expect.arrayContaining([{ type: 'pauseAgent', reason: '发现可绕过的注入话术' }, { type: 'resumeAgent', reason: '已排查' }]))
  })
})
