import { settleTransfer } from '#/server/payments/service'
/**
 * 到期任务执行器：admin 后台与 Agent 系统工具（advance_simulation_clock / run_due_jobs）共用。
 */
import { and, eq, lte } from 'drizzle-orm'
import { db, schema } from '#/server/db/client'

export type JobResult = { id: string; kind: string; status: 'succeeded' | 'failed'; message?: string }

/** 仿真时钟：读 settings 表，未设置则返回当前时间 */
export async function simNow(): Promise<Date> {
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, 'clock'))
  return row ? new Date(row.value) : new Date()
}

export type RiskRating = 'R1' | 'R2' | 'R3' | 'R4' | 'R5'

/** 风险测评计分：五项答案（1–5），与 ai-banking-agent 口径一致 */
export function scoreRisk(answers: number[]): RiskRating {
  const sum = answers.reduce((a, b) => a + b, 0)
  const level = Math.min(5, Math.max(1, Math.ceil((sum - 4) / 4.2)))
  return `R${level}` as RiskRating
}

/** 执行 dueAt <= now 的待执行任务 */
export async function runDueJobs(userId: string, now: Date): Promise<JobResult[]> {
  const pending = await db
    .select()
    .from(schema.scheduledTasks)
    .where(
      and(
        eq(schema.scheduledTasks.userId, userId),
        eq(schema.scheduledTasks.status, 'pending'),
        lte(schema.scheduledTasks.dueAt, now.toISOString()),
      ),
    )
  const results: JobResult[] = []
  const finish = async (id: string, kind: string, status: 'succeeded' | 'failed', result: object) => {
    await db
      .update(schema.scheduledTasks)
      .set({ status, resultJson: JSON.stringify(result) })
      .where(eq(schema.scheduledTasks.id, id))
    results.push({ id, kind, status, ...('message' in result ? { message: String(result.message) } : {}) })
  }
  for (const task of pending) {
    try {
      const payload = JSON.parse(task.payloadJson)
      if (task.kind === 'transfer') {
        const [claimed] = await db.update(schema.scheduledTasks).set({ status: 'processing' })
          .where(and(eq(schema.scheduledTasks.id, task.id), eq(schema.scheduledTasks.status, 'pending'))).returning()
        if (!claimed) continue
        const result = await settleTransfer({ fromAccountId: payload.fromAccountId, payeeId: payload.payeeId, amountCents: payload.amountCents, memo: payload.memo || '定时转账' }, { userId, sessionId: 'scheduled', channel: 'web' }, now)
        await finish(task.id, task.kind, 'succeeded', { transactionId: result.transactionId })
      }
    } catch (e) {
      await finish(task.id, task.kind, 'failed', { message: e instanceof Error ? e.message : String(e) })
    }
  }
  return results
}
