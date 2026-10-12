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
    return { ...base, status: 'completed' as const, output: payload.output }
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
