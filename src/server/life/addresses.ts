import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '#/server/db/client'
import { audit } from '#/server/audit/log'
import type { AgentContext } from '#/server/agent/context'
import type { SavedAddress } from '#/lib/life-commerce'

/**
 * 生活商城常用收货地址。本人在生活页维护，Agent 可以读取并在下单时按 id 引用，
 * 收件人、手机号、地址由服务端填入，模型不需要也不应该重新拼写这些个人信息。
 */
export const MAX_ADDRESSES = 10

export const AddressInput = z.object({
  label: z.string().trim().min(1).max(20),
  recipient: z.string().trim().min(1).max(50),
  phone: z.string().regex(/^1\d{10}$/, '请输入 11 位手机号'),
  address: z.string().trim().min(5).max(200),
  isDefault: z.boolean().optional(),
})
export type AddressInput = z.infer<typeof AddressInput>

let ready: Promise<void> | undefined
export function ensureAddressSchema() {
  return (ready ??= (async () => {
    await db.$client.execute(`CREATE TABLE IF NOT EXISTS bank_addresses (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, label TEXT NOT NULL,
      recipient TEXT NOT NULL, phone TEXT NOT NULL, address TEXT NOT NULL, is_default INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`)
    await db.$client.execute('CREATE INDEX IF NOT EXISTS bank_addresses_user ON bank_addresses(user_id)')
  })().catch((error) => { ready = undefined; throw error }))
}

const view = (row: typeof schema.bankAddresses.$inferSelect): SavedAddress =>
  ({ id: row.id, label: row.label, recipient: row.recipient, phone: row.phone, address: row.address, isDefault: row.isDefault })

/** 默认地址排在最前，其余按最近使用（更新）排序 */
export async function listAddresses(userId: string): Promise<SavedAddress[]> {
  await ensureAddressSchema()
  const rows = await db.select().from(schema.bankAddresses).where(eq(schema.bankAddresses.userId, userId))
    .orderBy(desc(schema.bankAddresses.isDefault), desc(schema.bankAddresses.updatedAt), asc(schema.bankAddresses.createdAt))
  return rows.map(view)
}

export async function resolveAddress(userId: string, id: string): Promise<SavedAddress> {
  await ensureAddressSchema()
  const [row] = await db.select().from(schema.bankAddresses).where(and(eq(schema.bankAddresses.id, id), eq(schema.bankAddresses.userId, userId)))
  if (!row) throw new Error('常用地址不存在，请重新选择')
  return view(row)
}

/** 新增或修改（带 id）。第一条地址自动设为默认；设为默认时取消其他默认 */
export async function saveAddress(ctx: AgentContext, raw: unknown, id?: string): Promise<SavedAddress> {
  await ensureAddressSchema()
  const input = AddressInput.parse(raw)
  const now = new Date()
  const saved = await db.transaction(async (tx) => {
    const existing = await tx.select().from(schema.bankAddresses).where(eq(schema.bankAddresses.userId, ctx.userId))
    if (id && !existing.some((a) => a.id === id)) throw new Error('常用地址不存在')
    if (!id && existing.length >= MAX_ADDRESSES) throw new Error(`最多保存 ${MAX_ADDRESSES} 个常用地址，请先删除不用的`)
    const isDefault = input.isDefault ?? (existing.length === 0 || existing.find((a) => a.id === id)?.isDefault === true)
    if (isDefault) await tx.update(schema.bankAddresses).set({ isDefault: false }).where(eq(schema.bankAddresses.userId, ctx.userId))
    const values = { label: input.label, recipient: input.recipient, phone: input.phone, address: input.address, isDefault, updatedAt: now }
    if (id) {
      const [row] = await tx.update(schema.bankAddresses).set(values).where(and(eq(schema.bankAddresses.id, id), eq(schema.bankAddresses.userId, ctx.userId))).returning()
      return row
    }
    const [row] = await tx.insert(schema.bankAddresses).values({ id: `addr_${randomUUID()}`, userId: ctx.userId, createdAt: now, ...values }).returning()
    return row
  })
  // 审计不记录手机号和详细地址，只记录发生了什么
  await audit(ctx, 'address_changed', { action: id ? 'updated' : 'created', addressId: saved.id, isDefault: saved.isDefault })
  return view(saved)
}

export async function deleteAddress(ctx: AgentContext, id: string) {
  await ensureAddressSchema()
  await db.transaction(async (tx) => {
    const [row] = await tx.delete(schema.bankAddresses).where(and(eq(schema.bankAddresses.id, id), eq(schema.bankAddresses.userId, ctx.userId))).returning()
    if (!row) throw new Error('常用地址不存在')
    if (row.isDefault) {
      // 删掉默认地址后，把最近更新的一条设为默认
      const [next] = await tx.select().from(schema.bankAddresses).where(eq(schema.bankAddresses.userId, ctx.userId)).orderBy(desc(schema.bankAddresses.updatedAt)).limit(1)
      if (next) await tx.update(schema.bankAddresses).set({ isDefault: true }).where(eq(schema.bankAddresses.id, next.id))
    }
  })
  await audit(ctx, 'address_changed', { action: 'deleted', addressId: id })
}

export async function setDefaultAddress(ctx: AgentContext, id: string) {
  const current = await resolveAddress(ctx.userId, id)
  return saveAddress(ctx, { ...current, isDefault: true }, id)
}

/** 交给模型的版本：手机号只保留前三后四位 */
export const maskPhone = (phone: string) => `${phone.slice(0, 3)}****${phone.slice(-4)}`
