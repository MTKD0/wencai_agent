import { and, eq, gte, lt, inArray } from 'drizzle-orm'
import { db, schema } from '#/server/db/client'
import type { Channel, PolicyFacts } from './types'

const DAY = 24 * 60 * 60 * 1000

/** 从数据库采集策略事实。模型提供的参数只用于定位对象（如收款人 ID），不参与事实本身。 */
export async function collectFacts(params: {
  userId: string
  channel: Channel
  payeeId?: string
  now?: Date
}): Promise<PolicyFacts> {
  const now = params.now ?? new Date()
  const startOfDay = new Date(now)
  startOfDay.setHours(0, 0, 0, 0)

  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, params.userId))
  const userAccounts = await db
    .select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(eq(schema.accounts.userId, params.userId))

  let dailyOutgoingCents = 0
  let recentTransferCount = 0
  for (const { id } of userAccounts) {
    const todays = await db
      .select()
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.accountId, id),
          inArray(schema.transactions.category, ['转账', '信用卡还款']),
          lt(schema.transactions.amountCents, 0),
          gte(schema.transactions.occurredAt, startOfDay),
        ),
      )
    for (const tx of todays) {
      dailyOutgoingCents += -tx.amountCents
      if (now.getTime() - tx.occurredAt.getTime() < 10 * 60 * 1000) recentTransferCount++
    }
  }

  let payeeAgeDays: number | undefined
  if (params.payeeId) {
    const [payee] = await db
      .select()
      .from(schema.payees)
      .where(and(eq(schema.payees.id, params.payeeId), eq(schema.payees.userId, params.userId)))
    if (payee) payeeAgeDays = (now.getTime() - payee.createdAt.getTime()) / DAY
  }

  return {
    now,
    channel: params.channel,
    accountLocked: !!user?.lockedUntil && user.lockedUntil.getTime() > now.getTime(),
    dailyOutgoingCents,
    payeeAgeDays,
    recentTransferCount,
  }
}
