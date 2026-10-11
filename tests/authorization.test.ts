import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { auth as authTables, db, schema } from '#/server/db/client'
import { bindChannel, checkBindCode, createBindCode } from '#/server/auth/bind'
import { hasBinding, listBindings, resolveChannelUser, revokeBinding } from '#/server/session'
import { getPendingForUser } from '#/server/confirm/pending'
import { hashParams, signIntegrity } from '#/server/confirm/integrity'
import { env } from '#/server/env'
import type { AgentContext } from '#/server/agent/context'

/**
 * 越权防护：身份只能来自服务端会话，跨用户访问必须被拒绝。
 * 这些是「谁能代表某个银行用户操作」的实际执行点，用真实数据库验证。
 */

const USER_A = 'u_test_a'
const USER_B = 'u_test_b'
const LARK_A = 'ou_open_id_a'
const LARK_B = 'ou_open_id_b'

const ctxA: AgentContext = { userId: USER_A, sessionId: 'sess_a', channel: 'web' }
const ctxB: AgentContext = { userId: USER_B, sessionId: 'sess_b', channel: 'web' }

beforeAll(async () => {
  for (const id of [USER_A, USER_B]) {
    await db
      .insert(authTables.baUser)
      .values({ id, name: `测试用户${id}`, email: `${id}@test.local`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() })
      .onConflictDoNothing()
  }
  await db.insert(schema.pendingActions).values({
    id: 'pa_cross_user',
    userId: USER_A,
    sessionId: 'sess_a',
    tool: 'transfer',
    argsJson: JSON.stringify({ amount: 50 }),
    paramsHash: hashParams({ amount: 50 }),
    level: 'yellow',
    reasonsJson: JSON.stringify(['测试']),
    summaryJson: JSON.stringify({ title: '转账', fields: [{ label: '金额', value: '¥50.00' }] }),
    integrity: signIntegrity(env.CONFIRM_SECRET, {
      id: 'pa_cross_user',
      userId: USER_A,
      tool: 'transfer',
      paramsHash: hashParams({ amount: 50 }),
      level: 'yellow',
      expiresAt: Date.now() + 600_000,
    }),
    expiresAt: new Date(Date.now() + 600_000),
    status: 'pending',
    createdAt: new Date(),
  })
})

afterAll(async () => {
  await db.delete(schema.pendingActions).where(eq(schema.pendingActions.id, 'pa_cross_user'))
  await db.delete(schema.channelBindings).where(eq(schema.channelBindings.userId, USER_A))
  await db.delete(schema.channelBindings).where(eq(schema.channelBindings.userId, USER_B))
  await db.delete(schema.channelBindings).where(eq(schema.channelBindings.externalId, LARK_A))
  await db.delete(schema.channelBindings).where(eq(schema.channelBindings.externalId, LARK_B))
})

describe('待确认操作的归属', () => {
  it('发起者本人可以查看', async () => {
    const pending = await getPendingForUser(ctxA, 'pa_cross_user')
    expect(pending?.summary.title).toBe('转账')
  })

  it('其他用户看不到，也拿不到数据', async () => {
    expect(await getPendingForUser(ctxB, 'pa_cross_user')).toBeNull()
  })

  it('不存在的操作返回 null（不泄露存在性）', async () => {
    expect(await getPendingForUser(ctxA, 'pa_does_not_exist')).toBeNull()
  })
})

describe('渠道绑定', () => {
  it('绑定后该渠道账号可解析出 userId', async () => {
    const code = await createBindCode('lark', LARK_A)
    expect((await checkBindCode(code)).ok).toBe(true)
    await bindChannel({ ctx: ctxA, channel: 'lark', externalId: LARK_A, stepUpVerified: true })
    expect(await resolveChannelUser('lark', LARK_A)).toBe(USER_A)
    expect(await hasBinding(USER_A, 'lark')).toBe(true)
  })

  it('同一个渠道账号不能被第二个银行用户绑定', async () => {
    // LARK_A 已在上一例绑定到 USER_A
    const res = await bindChannel({ ctx: ctxB, channel: 'lark', externalId: LARK_A, stepUpVerified: true })
    expect(res.ok).toBe(false)
    expect(res.reason).toContain('已绑定')
    // 绑定关系未被改写
    expect(await resolveChannelUser('lark', LARK_A)).toBe(USER_A)
  })

  it('未绑定的渠道账号解析不到任何用户', async () => {
    expect(await resolveChannelUser('lark', 'ou_never_bound')).toBeNull()
    expect(await resolveChannelUser('lark', '')).toBeNull()
  })

  it('绑定必须带强验证', async () => {
    const code = await createBindCode('lark', LARK_B)
    expect((await checkBindCode(code)).ok).toBe(true)
    const res = await bindChannel({ ctx: ctxB, channel: 'lark', externalId: LARK_B, stepUpVerified: false })
    expect(res.ok).toBe(false)
    expect(await resolveChannelUser('lark', LARK_B)).toBeNull()
  })

  it('绑定用户与解绑用户必须一致：乙不能解绑甲的渠道', async () => {
    const [binding] = await listBindings(USER_A)
    expect(binding).toBeDefined()
    expect(await revokeBinding(USER_B, binding.id)).toBe(false)
    expect(await resolveChannelUser('lark', LARK_A)).toBe(USER_A)
    expect(await revokeBinding(USER_A, binding.id)).toBe(true)
    expect(await resolveChannelUser('lark', LARK_A)).toBeNull()
  })
})
