import { createFileRoute } from '@tanstack/react-router'
import { requireSession } from '#/server/session'
import { authenticationOptions } from '#/server/auth/passkey'
import { putChallenge } from '#/server/auth/challenge'

/** 取 Passkey 强验证选项（红色操作确认前调用一次） */
export const Route = createFileRoute('/api/passkey/options')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        let session
        try {
          session = await requireSession(request)
        } catch {
          return Response.json({ error: 'unauthorized' }, { status: 401 })
        }
        const options = await authenticationOptions(session.userId)
        if (!options) return Response.json({ ok: false, message: '尚未注册 Passkey' }, { status: 400 })
        putChallenge(session.userId, 'auth', options.challenge)
        return Response.json(options)
      },
    },
  },
})
