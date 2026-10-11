import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { auth as authTables, db, schema } from '#/server/db/client'
import { Route } from '#/routes/api/admin'

const A = 'u_admin_test_a'
const B = 'u_admin_test_b'
const C = 'u_admin_test_registered'
const handlers = Route.options.server!.handlers as {
  GET: (context: { request: Request }) => Promise<Response>
  POST: (context: { request: Request }) => Promise<Response>
}
const get = (action: string, userId?: string) => handlers.GET({ request: new Request(`http://localhost/api/admin?${new URLSearchParams({ action, ...(userId ? { userId } : {}) })}`) })
const post = (userId: string) => handlers.POST({ request: new Request('http://localhost/api/admin', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-user': userId },
  body: JSON.stringify({ type: 'assessRisk', answers: [5, 5, 5, 5, 5] }),
}) })

beforeAll(async () => {
  await db.insert(schema.users).values([{ id: A, name: '后台甲' }, { id: B, name: '后台乙' }])
  await db.insert(authTables.baUser).values([
    { id: A, name: '后台甲', email: `${A}@test.local`, phoneNumber: '13990000001' },
    { id: C, name: '新注册用户', email: `${C}@test.local`, phoneNumber: '13990000003' },
  ])
  await db.insert(schema.accounts).values([
    { id: 'acc_admin_a1', userId: A, name: '甲工资卡', balanceCents: 10_000 },
    { id: 'acc_admin_a2', userId: A, name: '甲储蓄卡', balanceCents: 15_000 },
    { id: 'acc_admin_b1', userId: B, name: '乙工资卡', balanceCents: 70_000 },
  ])
  await db.insert(schema.birthdayPlans).values([A, B].map((userId) => ({
    id: `bp_${userId}`, userId, contactId: 'test_contact', birthday: '2026-12-01',
    budgetCents: 1000, status: 'planned', createdAt: new Date().toISOString(),
  })))
  await db.insert(schema.birthdayOrders).values([A, B].map((userId) => ({
    id: `bo_${userId}`, planId: `bp_${userId}`, merchant: '花店', item: '鲜花',
    amountCents: 1000, deliveryDate: '2026-12-01', status: 'pending',
  })))
})

afterAll(async () => {
  await db.delete(schema.birthdayOrders).where(inArray(schema.birthdayOrders.planId, [`bp_${A}`, `bp_${B}`]))
  await db.delete(schema.birthdayPlans).where(inArray(schema.birthdayPlans.userId, [A, B]))
  await db.delete(schema.auditLogs).where(inArray(schema.auditLogs.userId, [A, B]))
  await db.delete(schema.accounts).where(inArray(schema.accounts.userId, [A, B]))
  await db.delete(schema.users).where(inArray(schema.users.id, [A, B]))
  await db.delete(authTables.baUser).where(inArray(authTables.baUser.id, [A, C]))
})

describe('后台用户首页与账户切换', () => {
  it('列出全部银行及注册用户，去重且按用户汇总账户余额', async () => {
    const response = await get('users')
    expect(response.status).toBe(200)
    const { data } = await response.json()
    expect(data.filter((user: { id: string }) => user.id === A)).toHaveLength(1)
    expect(data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: A, phoneNumber: '13990000001', accountCount: 2, balanceCents: 25_000 }),
      expect.objectContaining({ id: B, phoneNumber: null, accountCount: 1, balanceCents: 70_000 }),
      expect.objectContaining({ id: C, name: '新注册用户', accountCount: 0, balanceCents: 0 }),
    ]))
  })

  it('切换账户时快照、生日订单和无账户用户名称都属于所选用户', async () => {
    for (const [id, balance, orders] of [[A, 10_000, [`bo_${A}`]], [B, 70_000, [`bo_${B}`]], [C, 0, []]] as const) {
      const response = await get('snapshot', id)
      expect(response.status).toBe(200)
      const { data } = await response.json()
      expect(data.user.id).toBe(id)
      expect(data.account.balance).toBe(balance)
      expect(data.orders.map((order: { id: string }) => order.id)).toEqual(orders)
      if (id === C) expect(data.user.name).toBe('新注册用户')
    }
  })

  it('管理命令及审计只写入指定用户，不修改默认用户或其他账户', async () => {
    const response = await post(B)
    expect(response.status).toBe(200)
    const [a] = await db.select().from(schema.users).where(eq(schema.users.id, A))
    const [b] = await db.select().from(schema.users).where(eq(schema.users.id, B))
    expect(a.riskRating).toBe('R1')
    expect(b.riskRating).toBe('R5')
    const logs = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.userId, B))
    expect(logs).toHaveLength(1)
    expect(logs[0].type).toBe('admin_command')
  })

  it('不存在的账户读写均返回 404', async () => {
    expect((await get('snapshot', 'u_admin_missing')).status).toBe(404)
    expect((await post('u_admin_missing')).status).toBe(404)
  })
})
