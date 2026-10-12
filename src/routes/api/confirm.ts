import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { cancelPending, confirmPending, getPendingForUser } from '#/server/confirm/pending'
import { db, schema } from '#/server/db/client'
import { rejectPlanNode, resumePlan } from '#/server/executor/service'
import { resolveTool } from '#/server/tools/bank'
import { requireSession } from '#/server/session'
import type { AgentContext } from '#/server/agent/context'

const BodySchema = z.object({
  actionId: z.string(),
  decision: z.enum(['confirm', 'cancel']),
  stepUp: z
    .discriminatedUnion('method', [
      z.object({ method: z.literal('password'), password: z.string().max(32) }),
      z.object({ method: z.literal('passkey'), response: z.unknown() }),
    ])
    .optional(),
})

/**
 * 用户确认入口——唯一能让黄/红操作真正执行的路径。
 * 只接受已认证用户的请求；模型没有调用它的任何途径。
 */
export const Route = createFileRoute('/api/confirm')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const actionId = new URL(request.url).searchParams.get('actionId')
        if (!actionId) return Response.json({ error: 'missing actionId' }, { status: 400 })
        let ctx
        try {
          ctx = await contextFor(request, actionId)
        } catch {
          return Response.json({ error: 'unauthorized' }, { status: 401 })
        }
        const pending = ctx && (await getPendingForUser(ctx, actionId))
        return pending ? Response.json(pending) : Response.json({ error: 'not found' }, { status: 404 })
      },
      POST: async ({ request }) => {
        const body = BodySchema.safeParse(await request.json())
        if (!body.success) return Response.json({ error: 'bad request' }, { status: 400 })
        const { actionId, decision, stepUp } = body.data
        let ctx
        try {
          ctx = await contextFor(request, actionId)
        } catch {
          return Response.json({ ok: false, code: 'not_found', message: '请先登录' }, { status: 401 })
        }
        if (!ctx) return Response.json({ ok: false, code: 'not_found', message: '待确认操作不存在' }, { status: 404 })

        const [row] = await db.select().from(schema.pendingActions).where(eq(schema.pendingActions.id, actionId))

        if (decision === 'cancel') {
          await cancelPending(ctx, actionId)
          const plan = row?.planId && row.nodeId ? await rejectPlanNode(ctx, row.planId, row.nodeId) : undefined
          return Response.json({ ok: true, cancelled: true, plan })
        }

        const result = await confirmPending({ ctx, actionId, stepUp, resolveTool })
        if (!result.ok) return Response.json(result, { status: 400 })
        const plan = result.planId && result.nodeId ? await resumePlan(ctx, result.planId, result.nodeId, result.output) : undefined
        return Response.json({ ...result, plan, actionId, userId: ctx.userId })
      },
    },
  },
})

/** 会话归属于发起该操作时的会话；用户身份始终来自已认证会话 */
async function contextFor(request: Request, actionId: string): Promise<AgentContext | null> {
  const session = await requireSession(request)
  const [row] = await db.select().from(schema.pendingActions).where(eq(schema.pendingActions.id, actionId))
  if (!row || row.userId !== session.userId) return null
  return { userId: session.userId, sessionId: row.sessionId, channel: 'web' }
}
