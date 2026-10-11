import { createFileRoute } from '@tanstack/react-router'
import { requireSession } from '#/server/session'
import { hasBinding, listBindings, listSessions } from '#/server/session'
import { hasTxPassword } from '#/server/auth/tx-password'
import { listPasskeys } from '#/server/auth/passkey'

/** 设置页数据：会话设备、渠道绑定、强验证方式 */
export const Route = createFileRoute('/api/settings')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        let session
        try {
          session = await requireSession(request)
        } catch {
          return Response.json({ error: 'unauthorized' }, { status: 401 })
        }
        const [sessions, bindings, passkeys, txPassword] = await Promise.all([
          listSessions(session.userId),
          listBindings(session.userId),
          listPasskeys(session.userId),
          hasTxPassword(session.userId),
        ])
        return Response.json({
          user: { id: session.userId, name: session.userName },
          sessions: sessions.map((s) => ({ ...s, current: s.id === session.sessionId })),
          bindings: bindings.map((b) => ({ id: b.id, channel: b.channel, boundAt: b.boundAt })),
          passkeys,
          stepUp: {
            password: txPassword,
            passkey: passkeys.length > 0,
            larkBound: await hasBinding(session.userId, 'lark'),
          },
        })
      },
    },
  },
})
