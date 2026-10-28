import { createFileRoute } from '@tanstack/react-router'
import { env } from '#/server/env'
import { adminAuthorized } from '#/server/admin/access'
import { adminUserExists } from '#/server/admin/users'
import { consoleDashboard, listCustomers } from '#/server/admin/console'
import { fraudStats, listFraudEvents } from '#/server/fraud/events'
import { simNow } from '#/server/tools/jobs'

const failure = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status })

/** 工作人员后台的全局只读视图：工作台、反诈识别事件、客户列表 */
export const Route = createFileRoute('/api/admin-console')({ server: { handlers: {
  GET: async ({ request }) => {
    if (!env.ADMIN_ENABLED) return failure(403, 'ADMIN_DISABLED', '管理后台未启用')
    if (!adminAuthorized(request)) return failure(401, 'ADMIN_AUTH_REQUIRED', '请先登录后台')
    const url = new URL(request.url)
    const view = url.searchParams.get('view'), userId = url.searchParams.get('userId') ?? undefined
    try {
      const now = await simNow()
      if (view === 'dashboard') return Response.json({ data: await consoleDashboard(now) })
      if (view === 'customers') return Response.json({ data: { customers: await listCustomers(now), generatedAt: new Date().toISOString() } })
      if (view === 'fraud') {
        if (userId && !(await adminUserExists(userId))) return failure(404, 'USER_NOT_FOUND', '客户不存在')
        const events = await listFraudEvents({ userId, now })
        return Response.json({ data: { events, stats: fraudStats(events, now), generatedAt: new Date().toISOString() } })
      }
      return failure(400, 'INVALID_VIEW', '未知视图')
    } catch {
      return failure(500, 'CONSOLE_FAILED', '数据暂时无法读取，请稍后重试')
    }
  },
} } })
