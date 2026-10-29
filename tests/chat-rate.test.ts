import { describe, expect, it } from 'vitest'
import { createChatRateLimiter } from '#/server/security/chat-rate'
import { CHAT_RATE_PREFIX } from '#/lib/chat-rate'

const T0 = Date.UTC(2026, 9, 29, 2)

describe('对话接口限流', () => {
  it('单用户每分钟超过上限即拒绝，一分钟后恢复', () => {
    const limiter = createChatRateLimiter({ perMinute: 3, perDay: 100, globalPerDay: 1000 })
    for (let i = 0; i < 3; i++) expect(limiter.check('u1', T0 + i * 1000).allowed).toBe(true)
    const denied = limiter.check('u1', T0 + 5000)
    expect(denied).toMatchObject({ allowed: false, scope: 'minute', retryAfterSeconds: 55 })
    if (!denied.allowed) expect(denied.message.startsWith(CHAT_RATE_PREFIX)).toBe(true)
    // 被拒绝的请求不计数
    expect(limiter.check('u1', T0 + 60_001).allowed).toBe(true)
    // 其他用户不受影响
    expect(limiter.check('u2', T0 + 5000).allowed).toBe(true)
  })

  it('单用户每天上限', () => {
    const limiter = createChatRateLimiter({ perMinute: 100, perDay: 5, globalPerDay: 1000 })
    for (let i = 0; i < 5; i++) expect(limiter.check('u1', T0 + i * 120_000).allowed).toBe(true)
    expect(limiter.check('u1', T0 + 3_600_000)).toMatchObject({ allowed: false, scope: 'day' })
    expect(limiter.check('u1', T0 + 24 * 3_600_000 + 1).allowed).toBe(true)
  })

  it('全站每天总量：换账号也绕不过', () => {
    const limiter = createChatRateLimiter({ perMinute: 100, perDay: 100, globalPerDay: 4 })
    for (let i = 0; i < 4; i++) expect(limiter.check(`u${i}`, T0 + i).allowed).toBe(true)
    expect(limiter.check('u9', T0 + 10)).toMatchObject({ allowed: false, scope: 'global' })
  })
})
