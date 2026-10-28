import { and, eq, gte, lt } from 'drizzle-orm'
import { db, schema } from '#/server/db/client'
import { listAdminUsers } from './users'
import { listProfileSummaries } from '#/server/profile/profile'
import { fraudStats, listFraudEvents } from '#/server/fraud/events'
import { listCallbackTickets } from '#/server/payments/holds'
import { listAccountRiskFlags } from '#/server/risk/accounts'

/**
 * 银行工作人员后台的全局视图：工作台、客户列表。只读汇总，不提供任何代客交易能力。
 * 画像计算较重（逐个客户读半年流水），结果缓存 30 秒。
 */
export const maskPhone = (phone: string | null) => phone && /^\d{11}$/.test(phone) ? `${phone.slice(0, 3)}****${phone.slice(7)}` : phone

let profileCache: { at: number; key: string; rows: Awaited<ReturnType<typeof listProfileSummaries>> } | undefined
async function profiles(now: Date) {
  const key = now.toISOString().slice(0, 13)
  if (profileCache && profileCache.key === key && Date.now() - profileCache.at < 30_000) return profileCache.rows
  const rows = await listProfileSummaries(now)
  profileCache = { at: Date.now(), key, rows }
  return rows
}

/** 近 30 天转给他人的金额（不含本人互转与信用卡还款），按客户汇总 */
async function outflow30d(now: Date) {
  const rows = await db.select({ userId: schema.accounts.userId, cents: schema.transactions.amountCents, category: schema.transactions.category })
    .from(schema.transactions).innerJoin(schema.accounts, eq(schema.accounts.id, schema.transactions.accountId))
    .where(and(gte(schema.transactions.occurredAt, new Date(now.getTime() - 30 * 86_400_000)), lt(schema.transactions.amountCents, 0), eq(schema.transactions.category, '转账')))
  const byUser = new Map<string, number>()
  for (const row of rows) byUser.set(row.userId, (byUser.get(row.userId) ?? 0) - row.cents)
  return byUser
}

export async function listCustomers(now: Date) {
  const [users, summaries, events, tickets, outflow] = await Promise.all([listAdminUsers(), profiles(now), listFraudEvents({ now }), listCallbackTickets(), outflow30d(now)])
  const summaryById = new Map(summaries.map((s) => [s.userId, s]))
  const since = now.getTime() - 30 * 86_400_000
  return users.map((user) => {
    const summary = summaryById.get(user.id)
    const mine = events.filter((e) => e.userId === user.id && Date.parse(e.createdAt) >= since)
    return {
      id: user.id, name: user.name, phoneMasked: maskPhone(user.phoneNumber), accountCount: user.accountCount, balanceCents: user.balanceCents,
      riskLevel: user.riskLevel, locked: user.locked, totalAssetsCents: summary?.totalAssetsCents ?? user.balanceCents,
      monthlyIncomeCents: summary?.monthlyIncomeCents ?? 0, monthlyExpenseCents: summary?.monthlyExpenseCents ?? 0,
      tags: summary?.tags ?? [], outflow30dCents: outflow.get(user.id) ?? 0,
      fraud: {
        events30d: mine.length,
        scam30d: mine.filter((e) => e.layers.includes('keyword') || e.layers.includes('model')).length,
        openTickets: tickets.filter((t) => t.userId === user.id && t.status === 'open').length,
        heldCents: mine.filter((e) => e.outcome === 'held').reduce((sum, e) => sum + e.amountCents, 0),
      },
    }
  }).sort((a, b) => b.fraud.openTickets - a.fraud.openTickets || b.fraud.scam30d - a.fraud.scam30d || b.totalAssetsCents - a.totalAssetsCents)
}

export async function consoleDashboard(now: Date) {
  const [users, events, tickets, flags] = await Promise.all([listAdminUsers(), listFraudEvents({ now }), listCallbackTickets(), listAccountRiskFlags()])
  const open = tickets.filter((t) => t.status === 'open')
  return {
    now: now.toISOString(),
    customers: { count: users.length, totalBalanceCents: users.reduce((sum, u) => sum + u.balanceCents, 0), locked: users.filter((u) => u.locked).length },
    callbacks: {
      open: open.length,
      // 快到期的排在前面：冷静期结束前必须联系上
      queue: open.sort((a, b) => Date.parse(a.hold?.releaseAt ?? a.createdAt) - Date.parse(b.hold?.releaseAt ?? b.createdAt)).slice(0, 8),
    },
    riskFlags: { suspected: flags.filter((f) => f.status === 'suspected').length, confirmed: flags.filter((f) => f.status === 'confirmed').length },
    fraud: fraudStats(events, now),
    recentEvents: events.slice(0, 8),
  }
}
