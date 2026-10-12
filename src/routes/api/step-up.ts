import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireSession, UnauthorizedError } from '#/server/session'
import { getPendingForUser } from '#/server/confirm/pending'
import { requestStepUpCode } from '#/server/auth/step-up'
import { authenticationOptions } from '#/server/auth/passkey'
import { putChallenge } from '#/server/auth/challenge'
import { hashParams } from '#/server/confirm/integrity'

const bodySchema = z.intersection(z.object({ method: z.enum(['sms', 'passkey']) }), z.discriminatedUnion('purpose', [
  z.object({ purpose: z.literal('action'), actionId: z.string().min(1).max(100) }),
  z.object({ purpose: z.literal('set_tx_password'), password: z.string().regex(/^\d{6}$/) }),
]))
export const Route = createFileRoute('/api/step-up')({ server: { handlers: {
  POST: async ({ request }) => {
    try {
      const session = await requireSession(request)
      const body = bodySchema.parse(await request.json())
      let scope: string
      if (body.purpose === 'action') {
        const pending = await getPendingForUser({ userId: session.userId, sessionId: session.sessionId, channel: 'web' }, body.actionId)
        if (!pending || pending.status !== 'pending') throw new Error('该操作不存在、已处理或已过期')
        scope = `action:${body.actionId}`
      } else scope = `security:${hashParams({ action: 'set_tx_password', password: body.password })}`
      if (body.method === 'sms') return Response.json({ ...await requestStepUpCode(session.userId, scope), scope })
      const options = await authenticationOptions(session.userId)
      if (!options) throw new Error('尚未注册 Passkey，请在安全设置中注册，或选择短信验证')
      putChallenge(session.userId, 'auth', options.challenge, scope)
      return Response.json({ options, scope })
    } catch (error) {
      return Response.json({ message: error instanceof Error ? error.message : '无法发起验证' }, { status: error instanceof UnauthorizedError ? 401 : 400 })
    }
  },
} } })
