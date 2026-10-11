import { createHash, scryptSync, timingSafeEqual } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { auth as authTables, db } from '#/server/db/client'
import { env } from '#/server/env'

/**
 * 交易密码：红色操作强验证用的本地凭据。
 * 演示环境用 env.DEMO_TX_PASSWORD 兜底，未显式设置的账号仍可演示。
 */

const PROVIDER = 'wencai-tx-password'

function hash(password: string, salt: string): string {
  return scryptSync(password.normalize('NFKC'), salt, 32).toString('hex')
}

function saltFor(userId: string): string {
  return createHash('sha256').update(`${env.CONFIRM_SECRET}:${userId}`).digest('hex').slice(0, 16)
}

export async function setTxPassword(userId: string, password: string): Promise<void> {
  if (!/^\d{6}$/.test(password)) throw new Error('交易密码须为 6 位数字')
  const salt = saltFor(userId)
  await db
    .insert(authTables.baAccount)
    .values({ id: `acct_txpw_${userId}`, accountId: userId, providerId: PROVIDER, userId, password: `${salt}:${hash(password, salt)}` })
    .onConflictDoUpdate({ target: authTables.baAccount.id, set: { password: `${salt}:${hash(password, salt)}` } })
}

/** 常数时间比较；未设置过密码的账号回落到演示密码 */
export async function verifyTxPassword(userId: string, password: string): Promise<boolean> {
  const input = password.normalize('NFKC')
  const [row] = await db
    .select({ password: authTables.baAccount.password })
    .from(authTables.baAccount)
    .where(eq(authTables.baAccount.id, `acct_txpw_${userId}`))
  const stored = row?.password
  const expected = stored ?? `${saltFor(userId)}:${hash(env.DEMO_TX_PASSWORD, saltFor(userId))}`
  const [salt, digest] = expected.split(':')
  const actual = Buffer.from(hash(input, salt), 'hex')
  const want = Buffer.from(digest, 'hex')
  return actual.length === want.length && timingSafeEqual(actual, want)
}

export async function hasTxPassword(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ password: authTables.baAccount.password })
    .from(authTables.baAccount)
    .where(eq(authTables.baAccount.id, `acct_txpw_${userId}`))
  return !!row?.password
}
