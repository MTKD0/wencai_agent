import { randomUUID } from 'node:crypto'
import { and, eq, gte, sql } from 'drizzle-orm'
import { db, schema } from '#/server/db/client'

/** 仅撤销本计划产生的流水；本金已变更或资金不足时交人工，不伪造回退成功。 */
export async function rollbackInvestment(userId: string, transactionId: string, holdingId: string, direction: 'purchase' | 'redemption') {
  return db.transaction(async (tx) => {
    const [original] = await tx.select().from(schema.transactions).where(eq(schema.transactions.id, transactionId))
    if (!original) throw new Error('原理财流水不存在')
    const [account] = await tx.select().from(schema.accounts).where(and(eq(schema.accounts.id, original.accountId), eq(schema.accounts.userId, userId)))
    const [holding] = await tx.select().from(schema.holdings).where(and(eq(schema.holdings.id, holdingId), eq(schema.holdings.userId, userId)))
    if (!account || !holding) throw new Error('无权撤销该理财操作')
    if ((direction === 'purchase') !== (original.amountCents < 0) || original.category !== '理财') throw new Error('原交易与回退类型不符')
    const [reversed] = await tx.select().from(schema.transactions).where(eq(schema.transactions.reversalOf, transactionId))
    if (reversed) return
    const cents = Math.abs(original.amountCents)
    if (direction === 'purchase') {
      const [claimed] = await tx.update(schema.holdings).set({ principalCents: 0 }).where(and(eq(schema.holdings.id, holdingId), eq(schema.holdings.principalCents, cents))).returning()
      if (!claimed) throw new Error('持仓已变化，需人工核对后回退')
      await tx.update(schema.accounts).set({ balanceCents: sql`${schema.accounts.balanceCents} + ${cents}` }).where(eq(schema.accounts.id, account.id))
    } else {
      const [claimed] = await tx.update(schema.accounts).set({ balanceCents: sql`${schema.accounts.balanceCents} - ${cents}` }).where(and(eq(schema.accounts.id, account.id), gte(schema.accounts.balanceCents, cents))).returning()
      if (!claimed) throw new Error('赎回资金已使用，需人工核对后回退')
      await tx.update(schema.holdings).set({ principalCents: sql`${schema.holdings.principalCents} + ${cents}` }).where(eq(schema.holdings.id, holdingId))
    }
    await tx.insert(schema.transactions).values({ id: `reverse_${randomUUID()}`, accountId: account.id, amountCents: -original.amountCents, counterparty: '理财操作回退', category: '冲正', occurredAt: new Date(), reversalOf: original.id })
  })
}
