import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db, schema } from '#/server/db/client'
import { getDashboard } from '#/server/dashboard'
import { businessMonth } from '#/lib/dashboard'
import { Route } from '#/routes/api/dashboard'
import { getSpendingReport } from '#/server/tools/bank-extended'

const { session } = vi.hoisted(() => ({ session: vi.fn() }))
vi.mock('#/server/session', () => ({ requireSession: session }))
vi.mock('#/server/tools/jobs', () => ({ simNow: async () => new Date('2026-01-15T00:00:00Z') }))
const A = 'u_dashboard_a'
const B = 'u_dashboard_b'
const EMPTY = 'u_dashboard_empty'
const handler = (
  Route.options.server!.handlers as { GET: (context: { request: Request }) => Promise<Response> }
).GET

beforeAll(async () => {
  await db.insert(schema.users).values([A, B, EMPTY].map((id) => ({ id, name: id })))
  await db.insert(schema.accounts).values([
    { id: 'dashboard_a1', userId: A, name: '甲活期', balanceCents: 10_001 },
    { id: 'dashboard_a2', userId: A, name: '甲储蓄', balanceCents: 20_002 },
    { id: 'dashboard_b', userId: B, name: '乙账户', balanceCents: 99_999 },
  ])
  await db
    .insert(schema.cards)
    .values(
      [A, B].map((id) => ({
        id: `card_${id}`,
        userId: id,
        accountId: id === A ? 'dashboard_a1' : 'dashboard_b',
        last4: id === A ? '1234' : '9999',
        kind: 'debit' as const,
        status: 'active' as const,
        dailyLimitCents: 100_000,
      })),
    )
  await db
    .insert(schema.holdings)
    .values(
      [A, B].map((id) => ({
        id: `holding_${id}`,
        userId: id,
        productId: 'product_test',
        principalCents: id === A ? 30_003 : 88_888,
        redeemableAt: '2026-02-01',
        createdAt: '2026-01-01',
      })),
    )
  await db
    .insert(schema.subscriptions)
    .values(
      [A, B].map((id) => ({
        id: `sub_${id}`,
        userId: id,
        merchant: id,
        amountCents: 999,
        cycle: 'monthly' as const,
        status: 'active' as const,
      })),
    )
  await db.insert(schema.transactions).values([
    {
      id: 'dashboard_income',
      accountId: 'dashboard_a1',
      amountCents: 100_000,
      counterparty: '工资',
      category: '收入',
      occurredAt: new Date('2026-01-02T00:00:00Z'),
    },
    {
      id: 'dashboard_boundary',
      accountId: 'dashboard_a1',
      amountCents: -101,
      counterparty: '早餐',
      category: '餐饮',
      occurredAt: new Date('2025-12-31T16:00:00Z'),
    },
    {
      id: 'dashboard_food',
      accountId: 'dashboard_a2',
      amountCents: -202,
      counterparty: '午餐',
      category: '餐饮',
      occurredAt: new Date('2026-01-03T00:00:00Z'),
    },
    {
      id: 'dashboard_shopping',
      accountId: 'dashboard_a1',
      amountCents: -400,
      counterparty: '购物',
      category: '购物',
      occurredAt: new Date('2026-01-04T00:00:00Z'),
    },
    {
      id: 'dashboard_december',
      accountId: 'dashboard_a1',
      amountCents: -500,
      counterparty: '上月',
      category: '餐饮',
      occurredAt: new Date('2025-12-31T15:59:59Z'),
    },
    {
      id: 'dashboard_other',
      accountId: 'dashboard_b',
      amountCents: -90_000,
      counterparty: '乙交易',
      category: '其他',
      occurredAt: new Date('2026-01-05T00:00:00Z'),
    },
  ])
})

afterAll(async () => {
  await db
    .delete(schema.transactions)
    .where(inArray(schema.transactions.accountId, ['dashboard_a1', 'dashboard_a2', 'dashboard_b']))
  for (const table of [schema.cards, schema.holdings, schema.subscriptions, schema.accounts])
    await db.delete(table).where(inArray(table.userId, [A, B, EMPTY]))
  await db.delete(schema.users).where(inArray(schema.users.id, [A, B, EMPTY]))
})

describe('用户首页数据', () => {
  it('汇总本人账户和持仓，以分计算，且各类记录不泄露其他用户的数据', async () => {
    const data = await getDashboard(A)
    expect(data.availableBalance).toBe(300.03)
    expect(data.investmentPrincipal).toBe(300.03)
    expect(data.totalAssets).toBe(600.06)
    expect(data.accounts.map((item) => item.id)).toEqual(['dashboard_a1', 'dashboard_a2'])
    expect(data.cards.map((item) => item.last4)).toEqual(['1234'])
    expect(data.subscriptions.map((item) => item.merchant)).toEqual([A])
    expect(data.transactions).toHaveLength(5)
    expect(data.transactions.some((item) => item.counterparty === '乙交易')).toBe(false)
    expect(data.transactions[0].counterparty).toBe('购物')
  })
  it('账期采用 UTC+8，跨年趋势保留空月份，收入不会混入支出分类', async () => {
    const data = await getDashboard(A)
    expect(businessMonth(new Date('2025-12-31T16:00:00Z'))).toBe('2026-01')
    expect(data.monthly).toEqual({
      period: '2026-01',
      income: 1000,
      expense: 7.03,
      categories: [
        { label: '购物', value: 4 },
        { label: '餐饮', value: 3.03 },
      ],
    })
    expect(data.trend).toEqual([
      { label: '8月', value: 0 },
      { label: '9月', value: 0 },
      { label: '10月', value: 0 },
      { label: '11月', value: 0 },
      { label: '12月', value: 5 },
      { label: '1月', value: 7.03 },
    ])
  })
  it('无账户用户返回空数据和零金额', async () => {
    const data = await getDashboard(EMPTY)
    expect(data.totalAssets).toBe(0)
    expect(data.accounts).toEqual([])
    expect(data.transactions).toEqual([])
    expect(data.monthly.categories).toEqual([])
    expect(data.trend.every((item) => item.value === 0)).toBe(true)
  })
  it('Agent 月度报表与首页遵循相同账期，跨年边界不会少计支出', async () => {
    const report = (await getSpendingReport.execute(
      { period: '2026-01' },
      { userId: A, sessionId: 'dashboard_test', channel: 'web' },
    )) as { expense: number; categories: Record<string, number> }
    const home = await getDashboard(A)
    expect(report.expense).toBe(home.monthly.expense)
    expect(report.categories).toEqual({ 餐饮: 3.03, 购物: 4 })
  })
  it('接口拒绝未登录请求，只使用会话身份，忽略 query 与 header 中的伪造用户', async () => {
    session.mockRejectedValueOnce(new Error('未登录'))
    expect((await handler({ request: new Request('http://localhost/api/dashboard') })).status).toBe(
      401,
    )
    session.mockResolvedValueOnce({ userId: A })
    const response = await handler({
      request: new Request(`http://localhost/api/dashboard?userId=${B}`, {
        headers: { 'x-admin-user': B },
      }),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect((await response.json()).totalAssets).toBe(600.06)
    const [other] = await db.select().from(schema.accounts).where(eq(schema.accounts.userId, B))
    expect(other.balanceCents).toBe(99_999)
  })
})
