import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, schema } from '#/server/db/client'
import { DEMO_USER_ID, OTHER_USER_ID } from '#/server/db/constants'
import { deleteAddress, ensureAddressSchema, listAddresses, resolveAddress, saveAddress, setDefaultAddress } from '#/server/life/addresses'
import { runBankTool } from '#/server/tools/runner'
import { resolveTool } from '#/server/tools/bank'

const ctx = (requestText = '') => ({ userId: DEMO_USER_ID, sessionId: `addr-${Date.now()}`, channel: 'web' as const, requestText, riskText: requestText })
const home = { label: '家', recipient: '张小明', phone: '13800001234', address: '深圳市南山区科技园路 1 号' }
const office = { label: '公司', recipient: '张小明', phone: '13800005678', address: '深圳市福田区深南大道 2000 号' }
const clear = async () => { await ensureAddressSchema(); await db.delete(schema.bankAddresses).where(eq(schema.bankAddresses.userId, DEMO_USER_ID)); await db.delete(schema.bankAddresses).where(eq(schema.bankAddresses.userId, OTHER_USER_ID)) }
beforeEach(clear)
afterAll(clear)

describe('常用收货地址', () => {
  it('第一条自动设为默认；设新默认会取消旧默认；删除默认地址后由最近的一条接替', async () => {
    const a = await saveAddress(ctx(), home)
    expect(a.isDefault).toBe(true)
    const b = await saveAddress(ctx(), office)
    expect(b.isDefault).toBe(false)
    await setDefaultAddress(ctx(), b.id)
    expect((await listAddresses(DEMO_USER_ID)).map((x) => [x.label, x.isDefault])).toEqual([['公司', true], ['家', false]])
    await deleteAddress(ctx(), b.id)
    expect(await listAddresses(DEMO_USER_ID)).toMatchObject([{ label: '家', isDefault: true }])
  })
  it('校验手机号与地址，最多保存 10 个', async () => {
    await expect(saveAddress(ctx(), { ...home, phone: '12345' })).rejects.toThrow()
    await expect(saveAddress(ctx(), { ...home, address: '短' })).rejects.toThrow()
    for (let i = 0; i < 10; i++) await saveAddress(ctx(), { ...home, label: `地址${i}` })
    await expect(saveAddress(ctx(), home)).rejects.toThrow('最多保存 10 个')
  })
  it('只能读写本人的地址', async () => {
    const mine = await saveAddress(ctx(), home)
    const other = { userId: OTHER_USER_ID, sessionId: 'addr-other', channel: 'web' as const }
    await expect(resolveAddress(OTHER_USER_ID, mine.id)).rejects.toThrow('不存在')
    await expect(deleteAddress(other, mine.id)).rejects.toThrow('不存在')
    await expect(saveAddress(other, office, mine.id)).rejects.toThrow('不存在')
    expect(await listAddresses(OTHER_USER_ID)).toEqual([])
  })
})

describe('Agent 使用常用地址', () => {
  it('list_addresses 返回脱敏手机号', async () => {
    await saveAddress(ctx(), home)
    const out = await runBankTool(resolveTool('list_addresses')!, {}, ctx())
    if (out.status !== 'done') throw new Error(out.status)
    expect(out.data).toMatchObject({ addresses: [{ alias: '家', recipient: '张小明', phoneMasked: '138****1234', isDefault: true }] })
    expect(JSON.stringify(out.data)).not.toContain('13800001234')
  })
  it('下单传 addressId，由服务端填入完整收件信息；别人的地址 id 用不了', async () => {
    const saved = await saveAddress(ctx(), home)
    const tool = resolveTool('buy_life_product')!
    const out = await runBankTool(tool, { productId: 'gift', quantity: 1, fromCardQuery: '8823', delivery: { addressId: saved.id, mode: 'immediate' } }, ctx('买一张礼品卡送到家里'))
    if (out.status !== 'needs_confirmation') throw new Error(JSON.stringify(out))
    expect(out.summary.fields).toEqual(expect.arrayContaining([{ label: '收件人', value: '张小明 13800001234' }, { label: '收货地址', value: home.address }]))
    const other = await runBankTool(tool, { productId: 'gift', quantity: 1, fromCardQuery: '8823', delivery: { addressId: 'addr_not_mine', mode: 'immediate' } }, ctx())
    expect(other).toMatchObject({ status: 'error' })
    const missing = await runBankTool(tool, { productId: 'gift', quantity: 1, fromCardQuery: '8823', delivery: { mode: 'immediate' } }, ctx())
    expect(missing).toMatchObject({ status: 'error' })
  })
  it('save_address 需要确认，且手机号必须是用户原话', async () => {
    const tool = resolveTool('save_address')!
    const made = await runBankTool(tool, { ...office }, ctx('帮我把公司地址存一下：张小明 13800005678 深圳市福田区深南大道 2000 号'))
    expect(made).toMatchObject({ status: 'needs_confirmation', level: 'yellow' })
    const invented = await runBankTool(tool, { ...office }, ctx('帮我把公司地址存一下'))
    expect(invented).toMatchObject({ status: 'error' })
  })
})
