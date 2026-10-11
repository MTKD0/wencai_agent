import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireSession } from '#/server/session'
import { registrationOptions, verifyRegistration } from '#/server/auth/passkey'
import { consumeChallenge, putChallenge } from '#/server/auth/challenge'
import { audit } from '#/server/audit/log'
import type { RegistrationResponseJSON } from '@simplewebauthn/server'
import type { AgentContext } from '#/server/agent/context'

/** Passkey 注册：GET 取选项 → 浏览器签名 → POST 落库 */
export const Route = createFileRoute('/api/passkey/register')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        let session
        try {
          session = await requireSession(request)
        } catch {
          return Response.json({ error: 'unauthorized' }, { status: 401 })
        }
        const options = await registrationOptions(session.userId, session.userName)
        putChallenge(session.userId, 'register', options.challenge)
        return Response.json(options)
      },
      POST: async ({ request }) => {
        let session
        try {
          session = await requireSession(request)
        } catch {
          return Response.json({ error: 'unauthorized' }, { status: 401 })
        }
        const expectedChallenge = consumeChallenge(session.userId, 'register')
        if (!expectedChallenge) return Response.json({ ok: false, message: '注册会话已过期，请重试' }, { status: 400 })
        const parsed = CredentialSchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return Response.json({ ok: false, message: 'bad request' }, { status: 400 })
        const ok = await verifyRegistration(session.userId, parsed.data.credential as unknown as RegistrationResponseJSON, expectedChallenge)
        const ctx: AgentContext = { userId: session.userId, sessionId: session.sessionId, channel: 'web' }
        await audit(ctx, 'passkey_registered', { ok })
        return Response.json({ ok })
      },
    },
  },
})

const CredentialSchema = z.object({ credential: z.record(z.string(), z.unknown()) })
