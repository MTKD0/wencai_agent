import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireSession } from '#/server/session'
import { cancelHold, listUserHolds } from '#/server/payments/holds'
import { validRequestOrigin } from '#/server/security/request-origin'

const CancelSchema = z.object({ holdId: z.string().min(1).max(100) }).strict()

/** 本人冷静期中的转账：查看与撤销。只对已登录用户开放，只能处理本人的记录 */
export const Route = createFileRoute('/api/holds')({ server: { handlers: {
  GET: async ({ request }) => {
    let session
    try { session = await requireSession(request) } catch { return Response.json({ error: 'unauthorized' }, { status: 401 }) }
    return Response.json({ holds: await listUserHolds(session.userId) }, { headers: { 'cache-control': 'no-store' } })
  },
  POST: async ({ request }) => {
    if (!validRequestOrigin(request)) return Response.json({ ok: false, message: '请求来源无效' }, { status: 403 })
    let session
    try { session = await requireSession(request) } catch { return Response.json({ ok: false, message: '请先登录' }, { status: 401 }) }
    const body = CancelSchema.safeParse(await request.json().catch(() => null))
    if (!body.success) return Response.json({ ok: false, message: '请求格式无效' }, { status: 400 })
    try {
      return Response.json({ ok: true, hold: await cancelHold({ holdId: body.data.holdId, by: 'user', userId: session.userId }) })
    } catch (error) {
      return Response.json({ ok: false, message: error instanceof Error ? error.message : '撤销失败' }, { status: 409 })
    }
  },
} } })
