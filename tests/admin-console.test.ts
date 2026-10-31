import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, like } from 'drizzle-orm'
import { auth, db, schema } from '#/server/db/client'
import { env } from '#/server/env'
import { ensureStaffSchema, parseStaffAccounts, staffLogin, StaffLoginError } from '#/server/admin/staff'
import { readStaffSession } from '#/server/admin/staff-session'
import { ensurePaymentsSchema } from '#/server/payments/migrate'
import { runBankTool } from '#/server/tools/runner'
import { transfer } from '#/server/tools/bank'
import { listFraudEvents } from '#/server/fraud/events'
import { seedDemoCustomers, CUSTOMER_FIXTURE_MARKER, FRAUD_CASE_COUNT } from '#/server/db/seed-customers'
import { consoleDashboard, listCustomers } from '#/server/admin/console'
import { simNow } from '#/server/tools/jobs'

const uid = 'console_user', source = 'console_source', payeeId = 'console_payee'
const cleanupCustomers = async () => {
  const ids = (await db.select({ id: schema.users.id }).from(schema.users).where(like(schema.users.id, 'cust_%'))).map((r) => r.id)
  for (const id of ids) {
    const accounts = (await db.select({ id: schema.accounts.id }).from(schema.accounts).where(eq(schema.accounts.userId, id))).map((a) => a.id)
    for (const a of accounts) await db.delete(schema.transactions).where(eq(schema.transactions.accountId, a))
    for (const table of [schema.bankFraudEvents, schema.bankTransferHolds, schema.bankCallbackTickets, schema.pendingActions, schema.payees, schema.cards, schema.accounts] as const) await db.delete(table).where(eq(table.userId, id))
    await db.delete(auth.baUser).where(eq(auth.baUser.id, id))
    await db.delete(schema.users).where(eq(schema.users.id, id))
  }
  await db.delete(schema.settings).where(eq(schema.settings.key, CUSTOMER_FIXTURE_MARKER))
}

beforeAll(async () => {
  await ensurePaymentsSchema()
  await db.insert(schema.users).values({ id: uid, name: '后台测试用户' }).onConflictDoNothing()
  await db.insert(schema.accounts).values({ id: source, userId: uid, name: '付款账户', balanceCents: 1_000_000 }).onConflictDoNothing()
  await db.insert(schema.payees).values({ id: payeeId, userId: uid, name: '陌生收款人', bank: '工商银行', accountNo: '6222000011112222', createdAt: new Date(0) }).onConflictDoNothing()
})
afterAll(async () => {
  await cleanupCustomers()
  for (const table of [schema.bankFraudEvents, schema.pendingActions, schema.payees, schema.accounts] as const) await db.delete(table).where(eq(table.userId, uid))
  await db.delete(schema.users).where(eq(schema.users.id, uid))
  await db.delete(schema.bankStaff).where(eq(schema.bankStaff.username, 'agent01'))
})

describe('工作人员登录', () => {
  it('账号格式校验：密码至少 10 位、角色只能是坐席或主管', () => {
    expect(parseStaffAccounts('agent01:long-enough-pw:演示坐席:agent')).toEqual([{ username: 'agent01', password: 'long-enough-pw', name: '演示坐席', role: 'agent' }])
    expect(() => parseStaffAccounts('agent01:short:演示坐席:agent')).toThrow()
    expect(() => parseStaffAccounts('agent01:long-enough-pw:演示坐席:root')).toThrow()
  })
  it('预置账号可以登录，会话带姓名与角色；错误密码连续 5 次后限流', async () => {
    env.ADMIN_STAFF_ACCOUNTS = 'agent01:long-enough-pw:演示坐席:agent'
    await ensureStaffSchema()
    const { identity, cookie } = await staffLogin('agent01', 'long-enough-pw', 'test-source')
    expect(identity).toMatchObject({ username: 'agent01', name: '演示坐席', role: 'agent' })
    expect(readStaffSession(cookie)).toMatchObject({ name: '演示坐席' })
    const [row] = await db.select().from(schema.bankStaff).where(eq(schema.bankStaff.username, 'agent01'))
    expect(row.passwordHash).not.toContain('long-enough-pw')
    for (let i = 0; i < 5; i++) await expect(staffLogin('agent01', 'wrong-password', 'bad-source')).rejects.toBeInstanceOf(StaffLoginError)
    await expect(staffLogin('agent01', 'long-enough-pw', 'bad-source')).rejects.toThrow('次数过多')
  })
})

describe('反诈识别事件', () => {
  it('命中话术的转账生成确认单时记录识别依据，结果为待用户确认', async () => {
    const ctx = { userId: uid, sessionId: 'console-session', channel: 'web' as const, requestText: '对方说我的账户涉嫌洗钱，让我转到安全账户核查', riskText: '对方说我的账户涉嫌洗钱，让我转到安全账户核查' }
    // 演示环境的业务时钟拨在别的日期：识别时间必须跟业务时钟走，否则后台“今日”统计数不到这条
    const [prevClock] = await db.select().from(schema.settings).where(eq(schema.settings.key, 'clock'))
    const clock = '2026-10-11T02:00:00.000Z'
    await db.insert(schema.settings).values({ key: 'clock', value: clock }).onConflictDoUpdate({ target: schema.settings.key, set: { value: clock } })
    const outcome = await runBankTool(transfer, { fromAccountId: source, payeeId, amount: 800 }, ctx).finally(async () => {
      if (prevClock) await db.update(schema.settings).set({ value: prevClock.value }).where(eq(schema.settings.key, 'clock'))
      else await db.delete(schema.settings).where(eq(schema.settings.key, 'clock'))
    })
    if (outcome.status !== 'needs_confirmation') throw new Error(JSON.stringify(outcome))
    const [event] = await listFraudEvents({ userId: uid })
    expect(event).toMatchObject({ actionId: outcome.actionId, amountCents: 80_000, payeeName: '陌生收款人', outcome: 'awaiting' })
    expect(event.layers).toContain('keyword')
    expect(event.signals.map((s) => s.id)).toContain('safe_account')
    expect(event.createdAt).toBe(clock)
  })
  it('普通转账不记录', async () => {
    const before = (await listFraudEvents({ userId: uid })).length
    const outcome = await runBankTool(transfer, { fromAccountId: source, payeeId, amount: 20 }, { userId: uid, sessionId: 'console-plain', channel: 'web' as const, requestText: '给他转 20 元', riskText: '给他转 20 元' })
    expect(outcome.status).toBe('needs_confirmation')
    expect((await listFraudEvents({ userId: uid })).length).toBe(before)
  })
})

describe('演示客户与工作台', () => {
  it('合成客户只追加一次；工作台按到期时间排列回访队列', async () => {
    await cleanupCustomers()
    const now = await simNow()
    expect(await seedDemoCustomers(now)).toBe(true)
    expect(await seedDemoCustomers(now)).toBe(false)
    const dashboard = await consoleDashboard(now)
    const queue = dashboard.callbacks.queue.filter((t) => t.userId.startsWith('cust_'))
    expect(queue.length).toBe(3)
    expect(queue.map((t) => Date.parse(t.hold!.releaseAt))).toEqual([...queue.map((t) => Date.parse(t.hold!.releaseAt))].sort((a, b) => a - b))
    const events = (await listFraudEvents({ now })).filter((e) => e.userId.startsWith('cust_'))
    expect(events.length).toBe(FRAUD_CASE_COUNT)
    expect(new Set(events.map((e) => e.outcome))).toEqual(new Set(['held', 'abandoned', 'hold_cancelled', 'released', 'executed', 'awaiting']))
    const customers = await listCustomers(now)
    const wang = customers.find((c) => c.name === '王桂芳')!
    expect(wang).toMatchObject({ phoneMasked: '199****0000', fraud: { openTickets: 1 } })
  })
})
