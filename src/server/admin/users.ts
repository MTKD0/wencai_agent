import { eq } from 'drizzle-orm'
import { auth as authTables, db, schema } from '#/server/db/client'

/** 合并银行用户与已注册用户，包含尚未开立银行账户的注册用户。 */
export async function listAdminUsers() {
  const [bankUsers, registeredUsers, accounts] = await Promise.all([
    db.select().from(schema.users),
    db.select({ id: authTables.baUser.id, name: authTables.baUser.name, phoneNumber: authTables.baUser.phoneNumber }).from(authTables.baUser),
    db.select({ userId: schema.accounts.userId, balanceCents: schema.accounts.balanceCents }).from(schema.accounts),
  ])
  const bankById = new Map(bankUsers.map((user) => [user.id, user]))
  const registeredById = new Map(registeredUsers.map((user) => [user.id, user]))
  const totals = new Map<string, { accountCount: number; balanceCents: number }>()
  for (const account of accounts) {
    const total = totals.get(account.userId) ?? { accountCount: 0, balanceCents: 0 }
    total.accountCount++
    total.balanceCents += account.balanceCents
    totals.set(account.userId, total)
  }
  const now = Date.now()
  return [...new Set([...bankById.keys(), ...registeredById.keys()])].map((id) => {
    const bank = bankById.get(id)
    const registered = registeredById.get(id)
    return {
      id,
      name: bank?.name ?? registered!.name,
      phoneNumber: registered?.phoneNumber ?? null,
      accountCount: totals.get(id)?.accountCount ?? 0,
      balanceCents: totals.get(id)?.balanceCents ?? 0,
      riskLevel: bank?.riskRating ?? 'R1',
      locked: !!bank?.lockedUntil && bank.lockedUntil.getTime() > now,
    }
  }).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN') || a.id.localeCompare(b.id))
}

export async function adminUserExists(userId: string): Promise<boolean> {
  const [bank, registered] = await Promise.all([
    db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, userId)).limit(1),
    db.select({ id: authTables.baUser.id }).from(authTables.baUser).where(eq(authTables.baUser.id, userId)).limit(1),
  ])
  return bank.length > 0 || registered.length > 0
}
