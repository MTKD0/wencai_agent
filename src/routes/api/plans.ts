import { createFileRoute } from '@tanstack/react-router'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '#/server/db/client'
import { requireSession } from '#/server/session'
import { controlPlan } from '#/server/executor/service'

export const Route = createFileRoute('/api/plans')({ server: { handlers: {
  GET: async ({ request }) => {
    const session = await requireSession(request).catch(() => null)
    if (!session) return Response.json({ message: '请先登录' }, { status: 401 })
    const plans = await db.select().from(schema.plans).where(eq(schema.plans.userId, session.userId)).orderBy(desc(schema.plans.updatedAt)).limit(30)
    const tasks = await db.select().from(schema.scheduledTasks).where(eq(schema.scheduledTasks.userId, session.userId)).orderBy(desc(schema.scheduledTasks.dueAt)).limit(30)
    return Response.json({ plans: plans.map((p) => ({ ...p, state: JSON.parse(p.stateJson), stateJson: undefined })), tasks })
  },
  POST: async ({ request }) => {
    try {
      const session = await requireSession(request)
      const body = z.object({ planId: z.string(), command: z.enum(['pause', 'resume', 'cancel', 'complete_handoff', 'acknowledge_failure']), note: z.string().max(500).default('') }).parse(await request.json())
      const [owned] = await db.select().from(schema.plans).where(and(eq(schema.plans.id, body.planId), eq(schema.plans.userId, session.userId)))
      if (!owned) return Response.json({ message: '计划不存在' }, { status: 404 })
      return Response.json(await controlPlan({ userId: session.userId, sessionId: session.sessionId, channel: 'web' }, body.planId, body.command, body.note))
    } catch (error) { return Response.json({ message: error instanceof Error ? error.message : '操作失败' }, { status: 400 }) }
  },
} } })
