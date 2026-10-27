import { and, desc, eq, sql } from 'drizzle-orm'
import { db, schema } from '#/server/db/client'
import type { ConfirmSummary } from '#/server/tools/define'

/** consumed 只代表确认单已消费；只有执行审计回执才能证明业务操作成功。 */
export async function getConfirmationResult(userId: string, actionId: string) {
  const [row] = await db.select().from(schema.pendingActions).where(and(
    eq(schema.pendingActions.id, actionId), eq(schema.pendingActions.userId, userId),
  ))
  if (!row) return { actionId, status: 'not_found' as const }
  const base = { actionId, tool: row.tool, summary: JSON.parse(row.summaryJson) as ConfirmSummary }
  const [receipt] = await db.select().from(schema.auditLogs).where(and(
    eq(schema.auditLogs.userId, userId), eq(schema.auditLogs.type, 'action_executed'),
    sql`json_extract(${schema.auditLogs.payloadJson}, '$.actionId') = ${actionId}`,
  )).orderBy(desc(schema.auditLogs.seq)).limit(1)
  if (receipt) {
    const payload = JSON.parse(receipt.payloadJson) as { output: unknown }
    const [planRow] = row.planId ? await db.select().from(schema.plans).where(and(eq(schema.plans.id, row.planId), eq(schema.plans.userId, userId))) : []
    const plan = planRow ? JSON.parse(planRow.stateJson) as import('#/server/executor/executor').PlanState : undefined
    const planProgress = plan && planRow ? { planId: plan.id, status: planRow.status, completed: plan.completed.length, total: plan.plan.nodes.length,
      pendingActionIds: Object.values(plan.nodes).filter((node) => node.status === 'suspended' && node.actionId !== actionId).map((node) => node.actionId!),
    } : undefined
    return { ...base, status: 'completed' as const, output: payload.output, ...(planProgress ? { planProgress } : {}) }
  }
  if (row.status === 'consumed') {
    // 冷静期中的转账尚未执行：不能报“已完成”，也不是“执行中”
    const hold = await (await import('#/server/payments/holds')).holdForAction(userId, actionId)
    if (hold && (hold.status === 'held' || hold.status === 'releasing')) return { ...base, status: 'held' as const, hold }
    if (hold?.status === 'cancelled') return { ...base, status: 'cancelled' as const, hold }
  }
  if (row.sessionId.startsWith('scheduled:') && row.status === 'consumed') {
    await (await import('#/server/automation/service')).ensureAutomationSchema()
    const [link] = await db.select().from(schema.bankTaskApprovals).where(eq(schema.bankTaskApprovals.actionId, actionId))
    const [task] = link ? await db.select().from(schema.scheduledTasks).where(and(eq(schema.scheduledTasks.id, link.taskId), eq(schema.scheduledTasks.userId, userId))) : []
    if (task?.status === 'succeeded' && task.resultJson) return { ...base, status: 'completed' as const, output: JSON.parse(task.resultJson) as unknown }
  }
  if (row.status === 'consumed') {
    const [failure] = await db.select().from(schema.auditLogs).where(and(
      eq(schema.auditLogs.userId, userId), eq(schema.auditLogs.type, 'confirm_attempt'),
      sql`json_extract(${schema.auditLogs.payloadJson}, '$.actionId') = ${actionId}`,
      sql`json_extract(${schema.auditLogs.payloadJson}, '$.code') = 'execution_failed'`,
    )).limit(1)
    return { ...base, status: failure ? 'failed' as const : 'processing' as const }
  }
  return { ...base, status: row.status === 'pending' && row.expiresAt.getTime() <= Date.now() ? 'expired' as const : row.status }
}
