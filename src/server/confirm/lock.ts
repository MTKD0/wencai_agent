import { randomUUID } from 'node:crypto'
import { and, eq, lte } from 'drizzle-orm'
import { db, schema } from '#/server/db/client'

let ready: Promise<unknown> | undefined
const queues = new Map<string, Promise<unknown>>()

/** 同一用户的风险复核、确认与结算串行化；数据库租约同时约束多个服务进程。 */
export function withUserExecutionLock<T>(userId: string, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(userId) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(async () => {
    await (ready ??= db.$client.execute('CREATE TABLE IF NOT EXISTS bank_execution_locks (user_id TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at INTEGER NOT NULL)').catch((error) => { ready = undefined; throw error }))
    const token = randomUUID(), deadline = Date.now() + 10_000
    for (;;) {
      const rows = await db.insert(schema.bankExecutionLocks).values({ userId, token, expiresAt: new Date(Date.now() + 120_000) })
        .onConflictDoUpdate({ target: schema.bankExecutionLocks.userId, set: { token, expiresAt: new Date(Date.now() + 120_000) }, setWhere: lte(schema.bankExecutionLocks.expiresAt, new Date()) }).returning()
      if (rows.length) break
      if (Date.now() > deadline) throw new Error('该账户有操作正在处理，请稍后重试')
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    const renewal = setInterval(() => {
      void db.update(schema.bankExecutionLocks).set({ expiresAt: new Date(Date.now() + 120_000) }).where(and(eq(schema.bankExecutionLocks.userId, userId), eq(schema.bankExecutionLocks.token, token))).catch(() => {})
    }, 30_000)
    renewal.unref()
    try { return await operation() }
    finally {
      clearInterval(renewal)
      await db.delete(schema.bankExecutionLocks).where(and(eq(schema.bankExecutionLocks.userId, userId), eq(schema.bankExecutionLocks.token, token)))
    }
  })
  queues.set(userId, next)
  void next.finally(() => { if (queues.get(userId) === next) queues.delete(userId) }).catch(() => {})
  return next
}
