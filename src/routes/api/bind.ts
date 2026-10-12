import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireSession, resolveChannelUser } from '#/server/session'
import { bindChannel, checkBindCode, consumeBindCode } from '#/server/auth/bind'
import type { AgentContext } from '#/server/agent/context'
import type { StepUp } from '#/server/confirm/pending'
import { verifyTxPassword } from '#/server/auth/tx-password'
import { verifyPasskeyAssertion } from '#/server/auth/passkey'

/**
 * 渠道绑定（飞书）。
 * GET  ?code=…  → 返回该 code 对应的渠道信息，供绑定页展示
 * POST {code, stepUp} → 带强验证执行绑定
 *
 * 与业务确认的区别：这里绑的是「账号归属」，必须重新证明一次身份。
 */
export const Route = createFileRoute('/api/bind')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const code = new URL(request.url).searchParams.get('code')
        if (!code) return Response.json({ error: 'missing code' }, { status: 400 })
        const info = await checkBindCode(code)
        if (!info.ok) return Response.json({ ok: false, reason: info.reason }, { status: 400 })
        let session
        try {
          session = await requireSession(request)
        } catch {
          return Response.json({ ok: true, needsLogin: true, channel: info.channel })
        }
        const bound = await resolveChannelUser(info.channel, info.externalId)
        return Response.json({
          ok: true,
          channel: info.channel,
          alreadyBoundToMe: bound === session.userId,
          alreadyBoundToOther: !!bound && bound !== session.userId,
        })
      },
      POST: async ({ request }) => {
        let session
        try {
          session = await requireSession(request)
        } catch {
          return Response.json({ ok: false, code: 'unauthorized', message: '请先登录' }, { status: 401 })
        }
        const parsed = BodySchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return Response.json({ ok: false, message: 'bad request' }, { status: 400 })
        const info = await checkBindCode(parsed.data.code)
        if (!info.ok) return Response.json({ ok: false, message: info.reason }, { status: 400 })

        const verified = await verifyStepUp(session.userId, parsed.data.stepUp)
        if (!verified) return Response.json({ ok: false, message: '强验证失败' }, { status: 400 })

        const ctx: AgentContext = { userId: session.userId, sessionId: session.sessionId, channel: 'web' }
        const res = await bindChannel({ ctx, channel: info.channel, externalId: info.externalId, stepUpVerified: verified })
        if (res.ok) await consumeBindCode(parsed.data.code)
        return Response.json(res)
      },
    },
  },
})

const BodySchema = z.object({
  code: z.string().min(10).max(4096),
  stepUp: z.discriminatedUnion('method', [
    z.object({ method: z.literal('password'), password: z.string().max(32) }),
    z.object({ method: z.literal('passkey'), response: z.record(z.string(), z.unknown()) }),
  ]),
})

async function verifyStepUp(userId: string, stepUp: StepUp): Promise<boolean> {
  if (stepUp.method === 'password') return verifyTxPassword(userId, stepUp.password)
  return stepUp.method === 'passkey' && verifyPasskeyAssertion(userId, stepUp.response)
}
