import { randomUUID } from 'node:crypto'
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '#/server/db/client'
import { runInSandbox } from '#/server/sandbox/quickjs'
import type { AgentContext } from '#/server/agent/context'
import { defineBankTool } from './define'
import type { BankToolDef } from './define'

const yuan = (cents: number) => Math.round(cents) / 100
const fmt = (cents: number) => `¥${yuan(cents).toFixed(2)}`
const DAY = 24 * 60 * 60 * 1000

async function ownAccount(ctx: AgentContext, accountId: string) {
  const [acc] = await db
    .select()
    .from(schema.accounts)
    .where(and(eq(schema.accounts.id, accountId), eq(schema.accounts.userId, ctx.userId)))
  if (!acc) throw new Error('账户不存在')
  return acc
}

async function ownPayee(ctx: AgentContext, payeeId: string) {
  const [p] = await db
    .select()
    .from(schema.payees)
    .where(and(eq(schema.payees.id, payeeId), eq(schema.payees.userId, ctx.userId)))
  if (!p) throw new Error('收款人不存在')
  return p
}

async function ownCard(ctx: AgentContext, cardId: string) {
  const [c] = await db
    .select()
    .from(schema.cards)
    .where(and(eq(schema.cards.id, cardId), eq(schema.cards.userId, ctx.userId)))
  if (!c) throw new Error('卡片不存在')
  return c
}

const maskAccount = (no: string) => `${no.slice(0, 4)} **** ${no.slice(-4)}`

// ───────────────────────────── 🟢 只读 ─────────────────────────────

export const getAccounts = defineBankTool({
  name: 'get_accounts',
  description: '查询用户的全部账户及余额',
  baseRisk: 'green',
  kind: 'read',
  inputSchema: z.object({}),
  execute: async (_args, ctx) => {
    const rows = await db.select().from(schema.accounts).where(eq(schema.accounts.userId, ctx.userId))
    return rows.map((a) => ({ id: a.id, name: a.name, balance: yuan(a.balanceCents), currency: a.currency }))
  },
})

export const listTransactions = defineBankTool({
  name: 'list_transactions',
  description: '查询最近的交易记录',
  baseRisk: 'green',
  kind: 'read',
  inputSchema: z.object({
    days: z.number().int().min(1).max(365).default(30),
    category: z.string().optional().describe('如：餐饮、交通、购物、娱乐、生活缴费、转账'),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  execute: async ({ days, category, limit }, ctx) => {
    const accs = await db.select({ id: schema.accounts.id }).from(schema.accounts).where(eq(schema.accounts.userId, ctx.userId))
    const since = new Date(Date.now() - days * DAY)
    const rows = await db
      .select()
      .from(schema.transactions)
      .where(
        and(
          inArray(schema.transactions.accountId, accs.map((a) => a.id)),
          gte(schema.transactions.occurredAt, since),
          category ? eq(schema.transactions.category, category) : undefined,
        ),
      )
      .orderBy(desc(schema.transactions.occurredAt))
      .limit(limit)
    return rows.map((t) => ({
      id: t.id,
      amount: yuan(t.amountCents),
      counterparty: t.counterparty,
      memo: t.memo,
      category: t.category,
      date: t.occurredAt.toISOString().slice(0, 10),
    }))
  },
})

export const findPayee = defineBankTool({
  name: 'find_payee',
  description: '按姓名、备注名（如"妈妈"）、手机号或卡号后四位查找收款人。多个候选时必须让用户选择，不得自行决定。',
  baseRisk: 'green',
  kind: 'read',
  inputSchema: z.object({ query: z.string().min(1) }),
  execute: async ({ query }, ctx) => {
    const rows = await db.select().from(schema.payees).where(eq(schema.payees.userId, ctx.userId))
    const scored = rows
      .map((p) => ({ p, score: payeeScore(query, p) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
    return {
      candidates: scored.map(({ p, score }) => ({
        id: p.id,
        name: p.name,
        alias: p.alias,
        bank: p.bank,
        account: maskAccount(p.accountNo),
        exact: score >= 100,
      })),
      needsDisambiguation: scored.length > 1 && scored[0].score < 100,
    }
  },
})

/** 简易模糊匹配；TODO: 接入拼音（pinyin-pro）以处理同音字 */
function payeeScore(q: string, p: typeof schema.payees.$inferSelect): number {
  const query = q.trim()
  if (query === p.name || query === p.alias || query === p.phone || p.accountNo.endsWith(query)) return 100
  if (p.name.includes(query) || p.alias?.includes(query)) return 60
  if (editDistance(query, p.name) === 1) return 40
  return 0
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return dp[a.length][b.length]
}

export const listCards = defineBankTool({
  name: 'list_cards',
  description: '查询用户名下的银行卡及状态、每日限额',
  baseRisk: 'green',
  kind: 'read',
  inputSchema: z.object({}),
  execute: async (_args, ctx) => {
    const rows = await db.select().from(schema.cards).where(eq(schema.cards.userId, ctx.userId))
    return rows.map((c) => ({ id: c.id, last4: c.last4, kind: c.kind, status: c.status, dailyLimit: yuan(c.dailyLimitCents) }))
  },
})

export const listSubscriptions = defineBankTool({
  name: 'list_subscriptions',
  description: '识别用户的订阅与自动扣费',
  baseRisk: 'green',
  kind: 'read',
  inputSchema: z.object({}),
  execute: async (_args, ctx) => {
    const rows = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, ctx.userId))
    return rows.map((s) => ({ id: s.id, merchant: s.merchant, amount: yuan(s.amountCents), cycle: s.cycle, status: s.status }))
  },
})

export const listProducts = defineBankTool({
  name: 'list_products',
  description: '查询可购买的理财产品（风险等级、预期年化、起购金额、期限）',
  baseRisk: 'green',
  kind: 'read',
  inputSchema: z.object({}),
  execute: async () => {
    const rows = await db.select().from(schema.products)
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      riskRating: p.riskRating,
      expectedYieldPct: Math.round(p.expectedYield * 10000) / 100,
      minAmount: yuan(p.minAmountCents),
      termDays: p.termDays,
    }))
  },
})

export const analyzeSpending = defineBankTool({
  name: 'analyze_spending',
  description:
    '账单分析。可选提供一段 JavaScript 函数体（在隔离沙箱执行，只能读取只读变量 input.transactions，' +
    '元素形如 {amount, category, counterparty, date}，支出为负数），必须 return 可 JSON 序列化的结果。' +
    '不提供 code 时返回按类别汇总。',
  baseRisk: 'green',
  kind: 'read',
  inputSchema: z.object({
    days: z.number().int().min(1).max(365).default(30),
    code: z.string().max(4000).optional(),
  }),
  execute: async ({ days, code }, ctx) => {
    const accs = await db.select({ id: schema.accounts.id }).from(schema.accounts).where(eq(schema.accounts.userId, ctx.userId))
    const rows = await db
      .select()
      .from(schema.transactions)
      .where(
        and(
          inArray(schema.transactions.accountId, accs.map((a) => a.id)),
          gte(schema.transactions.occurredAt, new Date(Date.now() - days * DAY)),
        ),
      )
    const transactions = rows.map((t) => ({
      amount: yuan(t.amountCents),
      category: t.category,
      counterparty: t.counterparty,
      date: t.occurredAt.toISOString().slice(0, 10),
    }))
    const program =
      code ??
      `const by = {}; for (const t of input.transactions) if (t.amount < 0) by[t.category] = (by[t.category] || 0) - t.amount;
       const byCategory = Object.entries(by).map(([category, total]) => ({ category, total: Math.round(total * 100) / 100 })).sort((a, b) => b.total - a.total);
       return { totalSpent: Math.round(byCategory.reduce((s, x) => s + x.total, 0) * 100) / 100, byCategory };`
    const result = await runInSandbox(program, { transactions })
    if (!result.ok) throw new Error(`分析代码执行失败：${result.error}`)
    return { days, result: result.value, sandboxMs: result.durationMs }
  },
})

// ───────────────────────────── 🟡/🔴 写操作 ─────────────────────────────

export const transfer = defineBankTool({
  name: 'transfer',
  description: '向已登记收款人转账。payeeId 必须来自 find_payee 的结果。金额单位：元。',
  baseRisk: 'yellow',
  kind: 'write',
  inputSchema: z.object({
    fromAccountId: z.string(),
    payeeId: z.string(),
    amount: z.number().positive().max(1_000_000).multipleOf(0.01),
    memo: z.string().max(50).optional(),
  }),
  factsHint: (a) => ({ payeeId: a.payeeId }),
  summarize: async (a, ctx) => {
    const [acc, payee] = await Promise.all([ownAccount(ctx, a.fromAccountId), ownPayee(ctx, a.payeeId)])
    return {
      title: '确认转账',
      fields: [
        { label: '金额', value: fmt(a.amount * 100) },
        { label: '收款人', value: `${payee.name}${payee.alias ? `（${payee.alias}）` : ''}` },
        { label: '收款账户', value: `${payee.bank} ${maskAccount(payee.accountNo)}` },
        { label: '付款账户', value: `${acc.name}（余额 ${fmt(acc.balanceCents)}）` },
        ...(a.memo ? [{ label: '附言', value: a.memo }] : []),
      ],
    }
  },
  execute: async (a, ctx) => {
    const cents = Math.round(a.amount * 100)
    const acc = await ownAccount(ctx, a.fromAccountId)
    const payee = await ownPayee(ctx, a.payeeId)
    if (acc.balanceCents < cents) throw new Error('余额不足')
    const txId = `tx_${randomUUID()}`
    await db.transaction(async (tx) => {
      await tx
        .update(schema.accounts)
        .set({ balanceCents: sql`${schema.accounts.balanceCents} - ${cents}` })
        .where(eq(schema.accounts.id, acc.id))
      await tx.insert(schema.transactions).values({
        id: txId,
        accountId: acc.id,
        amountCents: -cents,
        counterparty: payee.name,
        memo: a.memo ?? null,
        category: '转账',
        occurredAt: new Date(),
      })
    })
    return { transactionId: txId, amount: a.amount, payee: payee.name, balanceAfter: yuan(acc.balanceCents - cents) }
  },
  compensate: async (a, out, ctx) => {
    // 冲正：生成一笔反向流水并退回余额
    const cents = Math.round(a.amount * 100)
    await db.transaction(async (tx) => {
      await tx
        .update(schema.accounts)
        .set({ balanceCents: sql`${schema.accounts.balanceCents} + ${cents}` })
        .where(and(eq(schema.accounts.id, a.fromAccountId), eq(schema.accounts.userId, ctx.userId)))
      await tx.insert(schema.transactions).values({
        id: `tx_${randomUUID()}`,
        accountId: a.fromAccountId,
        amountCents: cents,
        counterparty: out.payee,
        memo: '冲正',
        category: '冲正',
        occurredAt: new Date(),
        reversalOf: out.transactionId,
      })
    })
  },
})

const setCardStatus = async (ctx: AgentContext, cardId: string, status: 'active' | 'locked' | 'lost') => {
  await ownCard(ctx, cardId)
  await db.update(schema.cards).set({ status }).where(eq(schema.cards.id, cardId))
}

const cardSummary = (title: string, extra: { label: string; value: string }[] = []) =>
  async (a: { cardId: string }, ctx: AgentContext) => {
    const c = await ownCard(ctx, a.cardId)
    return { title, fields: [{ label: '卡片', value: `${c.kind === 'credit' ? '信用卡' : '借记卡'} 尾号 ${c.last4}` }, ...extra] }
  }

export const lockCard = defineBankTool({
  name: 'lock_card',
  description: '临时锁卡（可随时解锁）',
  baseRisk: 'yellow',
  kind: 'write',
  inputSchema: z.object({ cardId: z.string() }),
  summarize: cardSummary('确认临时锁卡', [{ label: '影响', value: '锁定期间该卡所有交易将被拒绝' }]),
  execute: async (a, ctx) => {
    await setCardStatus(ctx, a.cardId, 'locked')
    return { cardId: a.cardId, status: 'locked' }
  },
  compensate: async (a, _o, ctx) => setCardStatus(ctx, a.cardId, 'active'),
})

export const unlockCard = defineBankTool({
  name: 'unlock_card',
  description: '解除临时锁卡',
  baseRisk: 'red',
  kind: 'write',
  inputSchema: z.object({ cardId: z.string() }),
  summarize: cardSummary('确认解锁卡片'),
  execute: async (a, ctx) => {
    await setCardStatus(ctx, a.cardId, 'active')
    return { cardId: a.cardId, status: 'active' }
  },
})

export const reportCardLost = defineBankTool({
  name: 'report_card_lost',
  description: '挂失卡片（不可撤销，需重新办卡）',
  baseRisk: 'red',
  kind: 'write',
  inputSchema: z.object({ cardId: z.string() }),
  summarize: cardSummary('确认挂失', [{ label: '注意', value: '挂失后不可撤销，需要重新办卡' }]),
  execute: async (a, ctx) => {
    await setCardStatus(ctx, a.cardId, 'lost')
    return { cardId: a.cardId, status: 'lost' }
  },
})

export const adjustCardLimit = defineBankTool({
  name: 'adjust_card_limit',
  description: '调整卡片每日交易限额（元）',
  baseRisk: 'red',
  kind: 'write',
  inputSchema: z.object({ cardId: z.string(), dailyLimit: z.number().positive().max(500_000) }),
  summarize: async (a, ctx) => {
    const c = await ownCard(ctx, a.cardId)
    return {
      title: '确认调整限额',
      fields: [
        { label: '卡片', value: `尾号 ${c.last4}` },
        { label: '当前限额', value: fmt(c.dailyLimitCents) },
        { label: '调整为', value: fmt(a.dailyLimit * 100) },
      ],
    }
  },
  execute: async (a, ctx) => {
    const before = await ownCard(ctx, a.cardId)
    await db.update(schema.cards).set({ dailyLimitCents: Math.round(a.dailyLimit * 100) }).where(eq(schema.cards.id, a.cardId))
    return { cardId: a.cardId, dailyLimit: a.dailyLimit, previous: yuan(before.dailyLimitCents) }
  },
  compensate: async (a, out, ctx) => {
    await ownCard(ctx, a.cardId)
    await db.update(schema.cards).set({ dailyLimitCents: Math.round(out.previous * 100) }).where(eq(schema.cards.id, a.cardId))
  },
})

export const cancelSubscription = defineBankTool({
  name: 'cancel_subscription',
  description: '取消一项订阅/自动扣费',
  baseRisk: 'yellow',
  kind: 'write',
  inputSchema: z.object({ subscriptionId: z.string() }),
  summarize: async (a, ctx) => {
    const [s] = await db
      .select()
      .from(schema.subscriptions)
      .where(and(eq(schema.subscriptions.id, a.subscriptionId), eq(schema.subscriptions.userId, ctx.userId)))
    if (!s) throw new Error('订阅不存在')
    return {
      title: '确认取消订阅',
      fields: [
        { label: '商户', value: s.merchant },
        { label: '扣费', value: `${fmt(s.amountCents)} / ${s.cycle === 'monthly' ? '月' : '年'}` },
      ],
    }
  },
  execute: async (a, ctx) => {
    await db
      .update(schema.subscriptions)
      .set({ status: 'cancelled' })
      .where(and(eq(schema.subscriptions.id, a.subscriptionId), eq(schema.subscriptions.userId, ctx.userId)))
    return { subscriptionId: a.subscriptionId, status: 'cancelled' }
  },
})

import { EXTENDED_TOOLS } from './bank-extended'
import { PLANNING_TOOLS } from './bank-planning'

export const BANK_TOOLS: BankToolDef[] = [
  getAccounts,
  listTransactions,
  findPayee,
  listCards,
  listSubscriptions,
  listProducts,
  analyzeSpending,
  transfer,
  lockCard,
  unlockCard,
  reportCardLost,
  adjustCardLimit,
  cancelSubscription,
  // --- ai-banking-agent 扩展工具 ---
  ...EXTENDED_TOOLS,
  ...PLANNING_TOOLS,
]

const byName = new Map<string, BankToolDef>(BANK_TOOLS.map((t) => [t.name, t]))
export const resolveTool = (name: string) => byName.get(name)
