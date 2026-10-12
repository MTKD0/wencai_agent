import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireSession, revokeBinding, revokeSession } from '#/server/session'
import { audit } from '#/server/audit/log'
import { setTxPassword } from '#/server/auth/tx-password'
import type { AgentContext } from '#/server/agent/context'
import { StepUpSchema, verifyStrongStepUp } from '#/server/auth/step-up'
import { hashParams } from '#/server/confirm/integrity'
import { withUserExecutionLock } from '#/server/confirm/lock'
import { consumePasswordChangeGrant } from '#/server/auth/password-change'

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
            const { password, stepUp, ticket } = parsed.data
            if (!stepUp && !ticket) {
              return Response.json({ ok: false, message: '修改交易密码须通过 Passkey、绑定手机号验证，或从 Agent 确认单跳转' }, { status: 403 })
            }
            return withUserExecutionLock(session.userId, async () => {
              // 路径一：用户从 Agent 的红色确认单跳转过来。凭证已证明强验证完成，
              // 它同时把本次修改绑定到具体那笔 pending action，可追溯。
              if (ticket) {
                const consumed = await consumePasswordChangeGrant(session.userId, ticket)
                if (!consumed.ok) {
                  const message = {
                    not_found: '该修改凭证无效，请重新向 Agent 发起',
                    expired: '修改凭证已超时，请重新向 Agent 发起',
                    consumed: '该修改凭证已使用过，请重新向 Agent 发起',
                  }[consumed.reason]
                  await audit(ctx, 'confirm_attempt', { scope: 'set_tx_password', ok: false, reason: `grant_${consumed.reason}` })
                  return Response.json({ ok: false, message }, { status: 403 })
                }
                const done = await applyPassword(ctx, session.userId, password, { grantActionId: consumed.actionId })
                return done
              }
              // 路径二：用户在设置页当场强验证。挑战绑定新密码，改密码即失效。
              const scope = `security:${hashParams({ action: 'set_tx_password', password })}`
              if (!await verifyStrongStepUp(session.userId, scope, stepUp)) {
                await audit(ctx, 'confirm_attempt', { scope: 'set_tx_password', ok: false, reason: 'strong_verification_required' })
                return Response.json({ ok: false, message: '修改交易密码须通过 Passkey 或绑定手机号验证' }, { status: 403 })
              }
              return applyPassword(ctx, session.userId, password, {})
            })
          }
        }
      },
    },
  },
})

/**
 * 落库并审计。刻意只记"发生了什么"，**不记录任何密码材料**——
 * 既不记新密码，也不记它的哈希：审计表要能整链校验，也就要能长期保留。
 * `grantedActionId` 用于回答"哪一笔红色确认授权了这次修改"。
 */
async function applyPassword(
  ctx: AgentContext,
  userId: string,
  password: string,
  extra: { grantActionId?: string },
) {
  try {
    await setTxPassword(userId, password)
  } catch (err) {
    return Response.json({ ok: false, message: err instanceof Error ? err.message : '设置失败' }, { status: 400 })
  }
  await audit(ctx, 'tx_password_set', extra.grantActionId ? { via: 'agent_confirmation', actionId: extra.grantActionId } : { via: 'settings' })
  return Response.json({ ok: true })
}

const BodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('revoke_session'), sessionId: z.string().min(1).max(100) }),
  z.object({ action: z.literal('revoke_binding'), bindingId: z.string().min(1).max(100) }),
  /**
   * 改交易密码。两条路径二选一：
   * - 用户在设置页手动发起：提供 `stepUp`（Passkey / 短信），当场强验证；
   * - 用户从 Agent 确认单跳转过来：提供 `ticket`，它是确认时已完成红色强验证的一次性凭证。
   * 两者都不接收旧密码，新密码也只在本次请求体内出现一次，不写入审计。
   */
  z.object({
    action: z.literal('set_tx_password'),
    password: z.string().regex(/^\d{6}$/),
    stepUp: StepUpSchema.optional(),
    ticket: z.string().max(200).optional(),
  }),
])
