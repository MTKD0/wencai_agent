import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { env } from '#/server/env'
import { adminActor, adminAuthorized } from '#/server/admin/access'
import { agentPauseState, setAgentPause } from '#/server/agent/pause'

const commandSchema = z.object({ paused: z.boolean(), reason: z.string().trim().min(2).max(200) }).strict()
const failure = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status })
function deny(request: Request) {
  if (!env.ADMIN_ENABLED) return failure(403, 'ADMIN_DISABLED', '管理后台未启用')
  if (!adminAuthorized(request)) return failure(401, 'ADMIN_AUTH_REQUIRED', '请先登录后台')
}

/** 智能助手运行状态：工作人员可紧急停用或恢复，须填写原因并写审计（来源由全局中间件校验） */
export const Route = createFileRoute('/api/admin-agent')({ server: { handlers: {
  GET: async ({ request }) => {
    const denied = deny(request)
    if (denied) return denied
    return Response.json({ data: await agentPauseState() }, { headers: { 'cache-control': 'no-store' } })
  },
  POST: async ({ request }) => {
    const denied = deny(request)
    if (denied) return denied
    const parsed = commandSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return failure(400, 'INVALID_COMMAND', '请填写停用或恢复的原因（至少 2 个字）')
    const actor = adminActor(request)
    return Response.json({ data: await setAgentPause(parsed.data.paused, parsed.data.reason, actor.name) })
  },
} } })
