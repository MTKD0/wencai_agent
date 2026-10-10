import { describe, expect, it } from 'vitest'
import { hashParams, signIntegrity, stableStringify, verifyIntegrity } from '#/server/confirm/integrity'

const SECRET = 'test-secret-0123456789'
const base = { id: 'pa_1', userId: 'u1', tool: 'transfer', paramsHash: hashParams({ amount: 200, payeeId: 'p_mom' }), level: 'yellow' as const, expiresAt: 1 }

describe('待确认动作完整性', () => {
  it('参数哈希与键顺序无关', () => {
    expect(hashParams({ a: 1, b: 2 })).toBe(hashParams({ b: 2, a: 1 }))
    expect(stableStringify({ b: [1, { d: 1, c: 2 }], a: undefined })).toBe('{"b":[1,{"c":2,"d":1}]}')
  })

  it('原始签名可通过校验', () => {
    expect(verifyIntegrity(SECRET, base, signIntegrity(SECRET, base))).toBe(true)
  })

  it.each([
    ['改金额', { paramsHash: hashParams({ amount: 20000, payeeId: 'p_mom' }) }],
    ['换收款人', { paramsHash: hashParams({ amount: 200, payeeId: 'p_attacker' }) }],
    ['红降黄', { level: 'yellow' as const }],
    ['换用户', { userId: 'u2' }],
    ['延长时效', { expiresAt: 999 }],
  ])('篡改「%s」被识别', (_name, patch) => {
    const original = { ...base, level: 'red' as const }
    const sig = signIntegrity(SECRET, original)
    expect(verifyIntegrity(SECRET, { ...original, ...patch }, sig)).toBe(false)
  })

  it('不同密钥签名无效', () => {
    expect(verifyIntegrity(SECRET, base, signIntegrity('another-secret-xxxxxx', base))).toBe(false)
  })
})
