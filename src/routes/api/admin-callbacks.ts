import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { env } from '#/server/env'
import { adminAuthorized } from '#/server/admin/access'
import { listCallbackTickets, resolveCallbackTicket } from '#/server/payments/holds'

const resolveSchema = z.object({
  ticketId: z.string().min(1).max(100),
  outcome: z.enum(['confirmed_safe', 'confirmed_scam', 'unreachable']),
  note: z.string().max(200).optional(),
}).strict()
const failure = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status })
function deny(request: Request) {
  if (!env.ADMIN_ENABLED) return failure(403, 'ADMIN_DISABLED', '管理后台未启用')
  if (!adminAuthorized(request)) return failure(401, 'ADMIN_AUTH_REQUIRED', '请输入后台访问凭据')
}

/** 反诈回访：仅后台人工可用。结论只能撤销或提前放行冷静期中的那一笔，不能发起新交易 */
export const Route = createFileRoute('/api/admin-callbacks')({ server: { handlers: {
  GET: async ({ request }) => {
    const denied = deny(request)
    if (denied) return denied
    const tickets = await listCallbackTickets()
    return Response.json({ data: { tickets, generatedAt: new Date().toISOString(), summary: {
      open: tickets.filter((t) => t.status === 'open').length,
      held: tickets.filter((t) => t.hold?.status === 'held').length,
      cancelled: tickets.filter((t) => t.hold?.status === 'cancelled').length,
      released: tickets.filter((t) => t.hold?.status === 'released').length,
    } } })
  },
  POST: async ({ request }) => {
    const denied = deny(request)
    if (denied) return denied
    const parsed = resolveSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return failure(400, 'INVALID_COMMAND', '请提供工单和明确的回访结论')
    try {
      return Response.json({ data: await resolveCallbackTicket(parsed.data) })
    } catch (error) {
      return failure(409, 'CALLBACK_CONFLICT', error instanceof Error ? error.message : '回访记录未保存，请刷新后重试')
    }
  },
} } })
