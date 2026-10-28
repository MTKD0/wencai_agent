import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, schema } from '#/server/db/client'
import { ensurePaymentsSchema } from '#/server/payments/migrate'
import { runBankTool } from '#/server/tools/runner'
import { resolveTool } from '#/server/tools/bank'
import { simNow } from '#/server/tools/jobs'

const uid = 'limit_user', account = 'limit_account'
const ctx = { userId: uid, sessionId: 'limit-session', channel: 'web' as const }
const check = async (amountCents: number) => {
  const out = await runBankTool(resolveTool('check_transfer_limit')!, { amountCents }, ctx)
  if (out.status !== 'done') throw new Error(JSON.stringify(out))
  return out.data as { allowed: boolean; needsStrongVerification: boolean; verificationReasons: string[]; reasons: string[]; cards: { last4: string; remainingToday: number }[] }
}
const cleanup = async () => {
  await db.delete(schema.transactions).where(eq(schema.transactions.accountId, account))
  await db.delete(schema.cards).where(eq(schema.cards.userId, uid))
  await db.delete(schema.accounts).where(eq(schema.accounts.userId, uid))
  await db.delete(schema.users).where(eq(schema.users.id, uid))
}

beforeAll(async () => {
  await ensurePaymentsSchema(); await cleanup()
  await db.insert(schema.users).values({ id: uid, name: '额度用户' })
  await db.insert(schema.accounts).values({ id: account, userId: uid, name: '工资卡', balanceCents: 10_000_000 })
  await db.insert(schema.cards).values({ id: 'limit_card', userId: uid, accountId: account, last4: '4321', kind: 'debit', status: 'active', dailyLimitCents: 5_000_000 })
})
afterAll(cleanup)

describe('check_transfer_limit 与风控规则口径一致', () => {
  it('500 元无需强验证；3500 元需要强验证但不是禁止；超过卡每日限额才不能转', async () => {
    expect(await check(50_000)).toMatchObject({ allowed: true, needsStrongVerification: false, cards: [{ last4: '4321', remainingToday: 50_000 }] })
    const large = await check(350_000)
    expect(large).toMatchObject({ allowed: true, needsStrongVerification: true })
    expect(large.verificationReasons).toHaveLength(2)
    expect(await check(6_000_000)).toMatchObject({ allowed: false })
  })
  it('今天已给他人转出 900 元后，再转 200 元就要强验证，卡的剩余额度同步减少', async () => {
    await db.insert(schema.transactions).values({ id: 'limit_tx', accountId: account, amountCents: -90_000, counterparty: '陌生人', category: '转账', occurredAt: await simNow() })
    const out = await check(20_000)
    expect(out).toMatchObject({ allowed: true, needsStrongVerification: true, cards: [{ remainingToday: 49_100 }] })
  })
})
