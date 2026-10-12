import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireSession, revokeBinding, revokeSession } from '#/server/session'
import { audit } from '#/server/audit/log'
import { setTxPassword } from '#/server/auth/tx-password'
import type { AgentContext } from '#/server/agent/context'
import { StepUpSchema, verifyStrongStepUp } from '#/server/auth/step-up'
import { hashParams } from '#/server/confirm/integrity'
import { withUserExecutionLock } from '#/server/confirm/lock'

/**
 * 安全设置写操作。全部要求已登录，且一律记审计。
 * 注意：这里不做「踢掉自己当前会话」的拦截，由调用方判断。
 */
export const Route = createFileRoute('/api/security')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let session
        try {
          session = await requireSession(request)
        } catch {
          return Response.json({ error: 'unauthorized' }, { status: 401 })
        }
        const body = await request.json().catch(() => null)
        const parsed = BodySchema.safeParse(body)
        if (!parsed.success) return Response.json({ error: 'bad request' }, { status: 400 })
        const ctx: AgentContext = { userId: session.userId, sessionId: session.sessionId, channel: 'web' }

        switch (parsed.data.action) {
          case 'revoke_session': {
            if (parsed.data.sessionId === session.sessionId) {
              return Response.json({ ok: false, message: '不能踢掉当前会话，请直接退出登录' }, { status: 400 })
            }
            const ok = await revokeSession(session.userId, parsed.data.sessionId)
            await audit(ctx, 'session_revoked', { target: parsed.data.sessionId, ok })
            return Response.json({ ok })
          }
          case 'revoke_binding': {
            const ok = await revokeBinding(session.userId, parsed.data.bindingId)
            await audit(ctx, 'channel_unbound', { bindingId: parsed.data.bindingId, ok })
            return Response.json({ ok })
          }
          case 'set_tx_password': {
            const { password, stepUp } = parsed.data
            return withUserExecutionLock(session.userId, async () => {
            const scope = `security:${hashParams({ action: 'set_tx_password', password })}`
            if (!await verifyStrongStepUp(session.userId, scope, stepUp)) {
              await audit(ctx, 'confirm_attempt', { scope: 'set_tx_password', ok: false, reason: 'strong_verification_required' })
              return Response.json({ ok: false, message: '修改交易密码须通过 Passkey 或绑定手机号验证' }, { status: 403 })
            }
            try {
              await setTxPassword(session.userId, password)
            } catch (err) {
              return Response.json({ ok: false, message: err instanceof Error ? err.message : '设置失败' }, { status: 400 })
            }
            await audit(ctx, 'tx_password_set', {})
            return Response.json({ ok: true })
            })
          }
        }
      },
    },
  },
})

const BodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('revoke_session'), sessionId: z.string().min(1).max(100) }),
  z.object({ action: z.literal('revoke_binding'), bindingId: z.string().min(1).max(100) }),
  z.object({ action: z.literal('set_tx_password'), password: z.string().regex(/^\d{6}$/), stepUp: StepUpSchema.optional() }),
])
