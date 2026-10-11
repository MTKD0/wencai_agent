/**
 * 扩展演示数据：补充 contacts、holdings、scheduledTasks、splits、birthdayPlans、settings（仿真时钟）
 * 在 seed.ts 主流程结束后调用，不重置已有数据。
 */
import { db, schema } from './client'
import { DEMO_USER_ID, OTHER_USER_ID } from './constants'

const DAY = 24 * 60 * 60 * 1000
export const SEED_CLOCK = '2026-10-11T02:00:00.000Z'

export async function seedExtended() {
  const now = Date.now()

  // 仿真时钟
  await db
    .insert(schema.settings)
    .values({ key: 'clock', value: SEED_CLOCK })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: SEED_CLOCK } })

  // 清理并重写扩展表
  await db.delete(schema.birthdayOrders)
  await db.delete(schema.birthdayPlans)
  await db.delete(schema.splits)
  await db.delete(schema.scheduledTasks)
  await db.delete(schema.holdings)
  await db.delete(schema.contacts)

  // contacts（比 payees 多 note/accountMask，用于后台展示与 AA 分摊）
  await db.insert(schema.contacts).values([
    {
      id: 'c_wife',
      userId: DEMO_USER_ID,
      name: '张晓琳',
      phone: '13800000099',
      note: '爱人 老婆 生日',
      bank: '工商银行',
      accountMask: '6222 **** **** 1001',
    },
    {
      id: 'c_zhang',
      userId: DEMO_USER_ID,
      name: '王伟',
      phone: '13800000002',
      note: '同事 小王 AA',
      bank: '建设银行',
      accountMask: '6217 **** **** 1002',
    },
    {
      id: 'c_zhang2',
      userId: DEMO_USER_ID,
      name: '王威',
      phone: '13800000003',
      note: '大学同学',
      bank: '招商银行',
      accountMask: '6228 **** **** 1003',
    },
    {
      id: 'c_li',
      userId: DEMO_USER_ID,
      name: '陈晓',
      phone: '13800000004',
      note: '朋友 小陈 AA',
      bank: '农业银行',
      accountMask: '6228 **** **** 1004',
    },
    {
      id: 'c_other',
      userId: OTHER_USER_ID,
      name: '张小明',
      phone: '13800000000',
      note: '邻居',
      bank: '工商银行',
      accountMask: '6222 **** **** 9999',
    },
  ])

  // 理财持仓（两笔，一笔已解锁可赎回，一笔锁定中）
  await db.insert(schema.holdings).values([
    {
      id: 'h_cash',
      userId: DEMO_USER_ID,
      productId: 'prd_cash',
      principalCents: 50_000_00, // ¥50,000
      redeemableAt: new Date(now - DAY).toISOString(), // 已可赎回
      createdAt: new Date(now - 30 * DAY).toISOString(),
    },
    {
      id: 'h_90',
      userId: DEMO_USER_ID,
      productId: 'prd_90',
      principalCents: 100_000_00, // ¥100,000
      redeemableAt: new Date(now + 60 * DAY).toISOString(), // 锁定中
      createdAt: new Date(now - 30 * DAY).toISOString(),
    },
  ])

  // 定时任务（一笔待执行的定时转账）
  await db.insert(schema.scheduledTasks).values([
    {
      id: 'task_1',
      userId: DEMO_USER_ID,
      kind: 'transfer',
      status: 'pending',
      dueAt: new Date(now + 3 * DAY).toISOString(),
      payloadJson: JSON.stringify({
        payeeId: 'p_landlord',
        fromAccountId: 'acc_main',
        amountCents: 550_000, // ¥5,500
        memo: '10月房租',
      }),
      resultJson: null,
      createdAt: new Date(now - DAY).toISOString(),
    },
  ])

  // AA 分摊（一笔周末聚餐，两人已付一人未付）
  await db.insert(schema.splits).values([
    {
      id: 'split_1',
      userId: DEMO_USER_ID,
      title: '周末聚餐',
      totalCents: 30_000, // ¥300
      sharesJson: JSON.stringify([
        { contactId: 'c_zhang', amountCents: 7500, status: 'paid' },
        { contactId: 'c_zhang2', amountCents: 7500, status: 'paid' },
        { contactId: 'c_li', amountCents: 7500, status: 'pending' },
      ]),
      createdAt: new Date(now - 2 * DAY).toISOString(),
    },
  ])

  // 生日计划（预算已预留）
  const birthdayDate = new Date(now + 14 * DAY).toISOString().slice(0, 10)
  await db.insert(schema.birthdayPlans).values([
    {
      id: 'bplan_1',
      userId: DEMO_USER_ID,
      contactId: 'c_wife',
      birthday: birthdayDate,
      budgetCents: 100_000, // ¥1,000
      status: 'reserved',
      createdAt: new Date(now - DAY).toISOString(),
    },
  ])

  console.log('seeded extended data (contacts, holdings, tasks, splits, birthday plans)')
}
