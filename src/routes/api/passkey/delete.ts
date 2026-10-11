import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireSession } from '#/server/session'
import { deletePasskey } from '#/server/auth/passkey'
import { audit } from '#/server/audit/log'
import type { AgentContext } from '#/server/agent/context'

/** 删除 Passkey */
export const Route = createFileRoute('/api/passkey/delete')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let session
        try {
          session = await requireSession(request)
        } catch {
          return Response.json({ error: 'unauthorized' }, { status: 401 })
        }
        const parsed = BodySchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return Response.json({ error: 'bad request' }, { status: 400 })
        const ok = await deletePasskey(session.userId, parsed.data.id)
        const ctx: AgentContext = { userId: session.userId, sessionId: session.sessionId, channel: 'web' }
        await audit(ctx, 'passkey_deleted', { ok })
        return Response.json({ ok })
      },
    },
  },
})

const BodySchema = z.object({ id: z.string().min(1).max(100) })
