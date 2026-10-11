import { desc, eq, inArray } from 'drizzle-orm'
import { db, schema } from '#/server/db/client'
import { businessMonth } from '#/lib/dashboard'
import type { DashboardData } from '#/lib/dashboard'
import { simNow } from '#/server/tools/jobs'

/** 用户首页只接受已认证会话中的身份，所有业务数据按归属过滤。金额返回元。 */
export async function getDashboard(userId: string): Promise<DashboardData> {
  const [accounts, cards, holdings, subscriptions, now] = await Promise.all([
    db.select().from(schema.accounts).where(eq(schema.accounts.userId, userId)),
    db.select().from(schema.cards).where(eq(schema.cards.userId, userId)),
    db
      .select({ principal: schema.holdings.principalCents })
      .from(schema.holdings)
      .where(eq(schema.holdings.userId, userId)),
    db.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, userId)),
    simNow(),
  ])
  const rows = accounts.length
    ? await db
        .select()
        .from(schema.transactions)
        .where(
          inArray(
            schema.transactions.accountId,
            accounts.map((account) => account.id),
          ),
        )
        .orderBy(desc(schema.transactions.occurredAt))
    : []
  const period = businessMonth(now)
  const current = rows.filter((row) => businessMonth(row.occurredAt) === period)
  const categories = new Map<string, number>()
  let incomeCents = 0
  let expenseCents = 0
  for (const row of current) {
    if (row.amountCents >= 0) incomeCents += row.amountCents
    else {
      expenseCents -= row.amountCents
      categories.set(row.category, (categories.get(row.category) ?? 0) - row.amountCents)
    }
  }
  const availableCents = accounts.reduce((sum, account) => sum + account.balanceCents, 0)
  const principalCents = holdings.reduce((sum, holding) => sum + holding.principal, 0)
  const [year, month] = period.split('-').map(Number)
  const trend = Array.from({ length: 6 }, (_, i) => {
    const date = new Date(Date.UTC(year, month - 6 + i, 1))
    const key = date.toISOString().slice(0, 7)
    const total = rows
      .filter((row) => businessMonth(row.occurredAt) === key && row.amountCents < 0)
      .reduce((sum, row) => sum - row.amountCents, 0)
    return { label: `${date.getUTCMonth() + 1}月`, value: total / 100 }
  })
  return {
    now: now.toISOString(),
    totalAssets: (availableCents + principalCents) / 100,
    availableBalance: availableCents / 100,
    investmentPrincipal: principalCents / 100,
    accounts: accounts.map((account) => ({
      id: account.id,
      name: account.name,
      balance: account.balanceCents / 100,
      currency: account.currency,
    })),
    cards: cards.map((card) => ({
      id: card.id,
      last4: card.last4,
      kind: card.kind,
      status: card.status,
      accountName: accounts.find((account) => account.id === card.accountId)?.name ?? '银行卡',
    })),
    transactions: rows
      .slice(0, 50)
      .map((row) => ({
        id: row.id,
        amount: row.amountCents / 100,
        counterparty: row.counterparty,
        category: row.category,
        occurredAt: row.occurredAt.toISOString(),
      })),
    subscriptions: subscriptions.map((item) => ({
      id: item.id,
      merchant: item.merchant,
      amount: item.amountCents / 100,
      cycle: item.cycle,
      status: item.status,
    })),
    monthly: {
      period,
      income: incomeCents / 100,
      expense: expenseCents / 100,
      categories: [...categories]
        .map(([label, value]) => ({ label, value: value / 100 }))
        .sort((a, b) => b.value - a.value),
    },
    trend,
  }
}
