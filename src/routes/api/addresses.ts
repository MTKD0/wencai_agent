import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireSession } from '#/server/session'
import { validRequestOrigin } from '#/server/security/request-origin'
import { deleteAddress, listAddresses, saveAddress, setDefaultAddress } from '#/server/life/addresses'

const Command = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), id: z.string().max(80).optional(), address: z.unknown() }),
  z.object({ action: z.literal('delete'), id: z.string().max(80) }),
  z.object({ action: z.literal('default'), id: z.string().max(80) }),
])

/** 本人常用收货地址：只对已登录用户开放，只能读写本人的地址 */
export const Route = createFileRoute('/api/addresses')({ server: { handlers: {
  GET: async ({ request }) => {
    let session
    try { session = await requireSession(request) } catch { return Response.json({ error: 'unauthorized' }, { status: 401 }) }
    return Response.json({ addresses: await listAddresses(session.userId) }, { headers: { 'cache-control': 'no-store' } })
  },
  POST: async ({ request }) => {
    if (!validRequestOrigin(request)) return Response.json({ ok: false, message: '请求来源无效' }, { status: 403 })
    let session
    try { session = await requireSession(request) } catch { return Response.json({ ok: false, message: '请先登录' }, { status: 401 }) }
    const command = Command.safeParse(await request.json().catch(() => null))
    if (!command.success) return Response.json({ ok: false, message: '请求格式无效' }, { status: 400 })
    const ctx = { userId: session.userId, sessionId: session.sessionId, channel: 'web' as const }
    try {
      const c = command.data
      if (c.action === 'save') await saveAddress(ctx, c.address, c.id)
      else if (c.action === 'delete') await deleteAddress(ctx, c.id)
      else await setDefaultAddress(ctx, c.id)
      return Response.json({ ok: true, addresses: await listAddresses(session.userId) })
    } catch (error) {
      const message = error instanceof z.ZodError ? error.issues[0]?.message ?? '地址信息不完整' : error instanceof Error ? error.message : '保存失败'
      return Response.json({ ok: false, message }, { status: 400 })
    }
  },
} } })
