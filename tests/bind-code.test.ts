import { describe, expect, it } from 'vitest'
import { checkBindCode, createBindCode } from '#/server/auth/bind'
import { consumeChallenge, peekChallenge, putChallenge } from '#/server/auth/challenge'

/**
 * 绑定链接与 WebAuthn challenge 的安全性：伪造、过期、重放都必须被拒绝。
 * 这些是「谁能代表某个银行用户操作」的唯一入口。
 */

const OPEN_ID = 'ou_test_open_id_123'

describe('飞书绑定链接', () => {
  it('签发的链接可以校验通过', async () => {
    const code = await createBindCode('lark', OPEN_ID)
    const info = await checkBindCode(code)
    expect(info).toMatchObject({ ok: true, channel: 'lark', externalId: OPEN_ID })
  })

  it('篡改 payload 的链接因签名失效被拒绝', async () => {
    const code = await createBindCode('lark', OPEN_ID)
    const [payloadB64, signature] = code.split('.')
    const [channel, , exp, nonce] = Buffer.from(payloadB64, 'base64url').toString().split('|')
    // 换成另一个飞书 open_id，签名保持原样
    const tampered = Buffer.from([channel, 'ou_someone_else', exp, nonce].join('|')).toString('base64url')
    expect(tampered).not.toBe(payloadB64)
    expect((await checkBindCode(`${tampered}.${signature}`)).ok).toBe(false)
  })

  it('降级渠道（lark → 更宽渠道）被拒绝', async () => {
    const code = await createBindCode('lark', OPEN_ID)
    const [payloadB64, signature] = code.split('.')
    const [, externalId, exp, nonce] = Buffer.from(payloadB64, 'base64url').toString().split('|')
    const swapped = Buffer.from(['web', externalId, exp, nonce].join('|')).toString('base64url')
    expect((await checkBindCode(`${swapped}.${signature}`)).ok).toBe(false)
  })

  it('空签名、缺段、非 base64url 都被拒绝', async () => {
    const payload = Buffer.from(`lark|${OPEN_ID}|${Date.now() + 60_000}|n`).toString('base64url')
    expect((await checkBindCode(`${payload}.`)).ok).toBe(false)
    expect((await checkBindCode(payload)).ok).toBe(false)
    expect((await checkBindCode('!'.repeat(20) + '.sig')).ok).toBe(false)
    expect((await checkBindCode('')).ok).toBe(false)
  })

  it('已过期的链接被拒绝', async () => {
    const expired = Buffer.from(`lark|${OPEN_ID}|${Date.now() - 1000}|n`).toString('base64url')
    expect((await checkBindCode(`${expired}.whatever`)).ok).toBe(false)
  })
})

describe('WebAuthn challenge', () => {
  it('只能被消费一次（防重放）', () => {
    putChallenge('u_demo', 'auth', 'challenge-abc')
    expect(consumeChallenge('u_demo', 'auth')).toBe('challenge-abc')
    expect(consumeChallenge('u_demo', 'auth')).toBeNull()
    expect(peekChallenge('u_demo', 'auth')).toBeNull()
  })

  it('peek 不消费，可重复读取', () => {
    putChallenge('u_demo', 'auth', 'stay')
    expect(peekChallenge('u_demo', 'auth')).toBe('stay')
    expect(peekChallenge('u_demo', 'auth')).toBe('stay')
    expect(consumeChallenge('u_demo', 'auth')).toBe('stay')
  })

  it('不同用途的 challenge 互不串用', () => {
    putChallenge('u_demo', 'auth', 'for-auth')
    putChallenge('u_demo', 'register', 'for-register')
    expect(consumeChallenge('u_demo', 'auth')).toBe('for-auth')
    expect(consumeChallenge('u_demo', 'register')).toBe('for-register')
  })

  it('不同用户的 challenge 互不串用', () => {
    putChallenge('u_a', 'auth', 'a')
    putChallenge('u_b', 'auth', 'b')
    expect(consumeChallenge('u_b', 'auth')).toBe('b')
    expect(consumeChallenge('u_a', 'auth')).toBe('a')
  })
})
