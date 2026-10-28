import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, schema } from '#/server/db/client'
import {
  commitTransfer,
  previewTransfer,
  resolveRecipient,
  checkTransferLimit,
} from '#/server/tools/bank-extended'
import { runBankTool } from '#/server/tools/runner'
import type { AgentContext } from '#/server/agent/context'

/**
 * 两段式确认令牌：preview_* 签发、commit_* 校验并消费。
 * 令牌绑定 操作类型 + 已解析实体 ID 指纹 + 用户，任何一项不符都必须拒绝。
 */

const USER_A = 'u_tok_a'
const USER_B = 'u_tok_b'
const ACC_A = 'acc_tok_a'
const PAYEE_A = 'p_tok_a'
const PAYEE_A2 = 'p_tok_a2'
const ctxA: AgentContext = { userId: USER_A, sessionId: 's_a', channel: 'web' }
const ctxB: AgentContext = { userId: USER_B, sessionId: 's_b', channel: 'web' }

const transferArgs = { fromAccountId: ACC_A, payeeId: PAYEE_A, amountCents: 10_000, memo: '生日' }

async function preview(args = transferArgs, ctx = ctxA) {
  return (await previewTransfer.execute(args, ctx)) as { confirmationToken: string }
}

beforeAll(async () => {
  await db.insert(schema.users).values([
    { id: USER_A, name: '令牌甲' },
    { id: USER_B, name: '令牌乙' },
  ]).onConflictDoNothing()
  await db.insert(schema.accounts).values({ id: ACC_A, userId: USER_A, name: '测试卡', balanceCents: 1_000_000 }).onConflictDoNothing()
  const old = new Date(Date.now() - 100 * 24 * 3600_000)
  await db.insert(schema.payees).values([
    { id: PAYEE_A, userId: USER_A, name: '赵敏', alias: '妈妈', accountNo: '6222000011112222', bank: '工商银行', createdAt: old },
    { id: PAYEE_A2, userId: USER_A, name: '赵明', accountNo: '6222000033334444', bank: '建设银行', createdAt: old },
  ]).onConflictDoNothing()
})

afterAll(async () => {
  await db.delete(schema.confirmationTokens).where(eq(schema.confirmationTokens.userId, USER_A))
  await db.delete(schema.transactions).where(eq(schema.transactions.accountId, ACC_A))
  await db.delete(schema.payees).where(eq(schema.payees.userId, USER_A))
  await db.delete(schema.accounts).where(eq(schema.accounts.id, ACC_A))
  await db.delete(schema.users).where(eq(schema.users.id, USER_A))
  await db.delete(schema.users).where(eq(schema.users.id, USER_B))
})

describe('实体解析', () => {
  it('别名精确命中直接返回 payeeId', async () => {
    const r = (await resolveRecipient.execute({ query: '妈妈' }, ctxA)) as { found: boolean; payeeId: string }
    expect(r).toMatchObject({ found: true, payeeId: PAYEE_A })
  })

  it('同音近名返回候选让用户选，不替用户决定', async () => {
    const r = (await resolveRecipient.execute({ query: '赵' }, ctxA)) as { needsDisambiguation: boolean; candidates: unknown[] }
    expect(r.needsDisambiguation).toBe(true)
    expect(r.candidates).toHaveLength(2)
  })

  it('他人的收款人对当前用户不可见', async () => {
    const r = (await resolveRecipient.execute({ query: '妈妈' }, ctxB)) as { found: boolean }
    expect(r.found).toBe(false)
  })
})

describe('额度预检', () => {
  it('超过借记卡每日转出限额时 allowed=false 并说明原因', async () => {
    const r = (await checkTransferLimit.execute({ amountCents: 300_000_00 }, ctxA)) as { allowed: boolean; reasons: string[] }
    expect(r.allowed).toBe(false)
    expect(r.reasons.join()).toContain('转出限额')
  })
})

describe('两段式确认', () => {
  it('预览是只读的：不经策略确认、不动余额', async () => {
    const outcome = await runBankTool(previewTransfer, transferArgs, ctxA)
    expect(outcome.status).toBe('done')
    const [acc] = await db.select().from(schema.accounts).where(eq(schema.accounts.id, ACC_A))
    expect(acc.balanceCents).toBe(1_000_000)
  })

  it('提交被策略引擎拦为待确认，模型无法直接执行', async () => {
    const { confirmationToken } = await preview()
    const outcome = await runBankTool(commitTransfer, { ...transferArgs, confirmationToken }, ctxA)
    expect(outcome.status).toBe('needs_confirmation')
  })

  it('完整流程：预览 → 提交成功，余额扣减', async () => {
    const { confirmationToken } = await preview()
    const out = (await commitTransfer.execute({ ...transferArgs, confirmationToken }, ctxA)) as { balanceAfter: number }
    expect(out.balanceAfter).toBe(9_900)
  })

  it('伪造令牌 → TOKEN_INVALID', async () => {
    await expect(commitTransfer.execute({ ...transferArgs, confirmationToken: 'tok_forged' }, ctxA)).rejects.toThrow('TOKEN_INVALID')
  })

  it('预览后改金额 → TOKEN_PARAM_MISMATCH', async () => {
    const { confirmationToken } = await preview()
    await expect(
      commitTransfer.execute({ ...transferArgs, amountCents: 999_000, confirmationToken }, ctxA),
    ).rejects.toThrow('TOKEN_PARAM_MISMATCH')
  })

  it('预览后换收款人 → TOKEN_PARAM_MISMATCH', async () => {
    const { confirmationToken } = await preview()
    await expect(
      commitTransfer.execute({ ...transferArgs, payeeId: PAYEE_A2, confirmationToken }, ctxA),
    ).rejects.toThrow('TOKEN_PARAM_MISMATCH')
  })

  it('同一令牌用两次 → TOKEN_CONSUMED', async () => {
    const { confirmationToken } = await preview()
    await commitTransfer.execute({ ...transferArgs, confirmationToken }, ctxA)
    await expect(commitTransfer.execute({ ...transferArgs, confirmationToken }, ctxA)).rejects.toThrow('TOKEN_CONSUMED')
  })

  it('他人令牌 → TOKEN_OWNER_MISMATCH', async () => {
    const { confirmationToken } = await preview()
    await expect(commitTransfer.execute({ ...transferArgs, confirmationToken }, ctxB)).rejects.toThrow('TOKEN_OWNER_MISMATCH')
  })

  it('过期令牌 → TOKEN_EXPIRED', async () => {
    const { confirmationToken } = await preview()
    await db
      .update(schema.confirmationTokens)
      .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
      .where(eq(schema.confirmationTokens.id, confirmationToken))
    await expect(commitTransfer.execute({ ...transferArgs, confirmationToken }, ctxA)).rejects.toThrow('TOKEN_EXPIRED')
  })
})
