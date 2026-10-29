import { env } from '#/server/env'
import { CHAT_RATE_PREFIX } from '#/lib/chat-rate'

/**
 * 对话接口限流：每次请求都可能调用模型，公网地址不能让人无限刷费用。
 * 按用户每分钟、每天计数，另设全站每天总量（防止批量注册账号绕过单用户上限）。
 * 用真实时间而不是业务时钟；进程内计数，重启清零（多实例部署见 SECURITY §18 #11）。
 */
export type ChatLimits = { perMinute: number; perDay: number; globalPerDay: number }
export type ChatRateResult = { allowed: true } | { allowed: false; scope: 'minute' | 'day' | 'global'; retryAfterSeconds: number; message: string }

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

export function createChatRateLimiter(limits: ChatLimits) {
  const users = new Map<string, number[]>()
  let global: number[] = []
  const recent = (list: number[], now: number, window: number) => list.filter((t) => t > now - window)
  const deny = (scope: 'minute' | 'day' | 'global', oldest: number, window: number, now: number, text: string): ChatRateResult =>
    ({ allowed: false, scope, retryAfterSeconds: Math.max(1, Math.ceil((oldest + window - now) / 1000)), message: `${CHAT_RATE_PREFIX}：${text}` })

  return {
    check(userId: string, now = Date.now()): ChatRateResult {
      const mine = recent(users.get(userId) ?? [], now, DAY)
      global = recent(global, now, DAY)
      const lastMinute = mine.filter((t) => t > now - MINUTE)
      if (lastMinute.length >= limits.perMinute) { users.set(userId, mine); return deny('minute', lastMinute[0], MINUTE, now, `每分钟最多 ${limits.perMinute} 条，请稍后再发。`) }
      if (mine.length >= limits.perDay) { users.set(userId, mine); return deny('day', mine[0], DAY, now, `今天的对话次数已达上限（${limits.perDay} 条），首页的转账、卡片和任务中心仍可使用。`) }
      if (global.length >= limits.globalPerDay) return deny('global', global[0], DAY, now, '今天的智能助手服务量已满，首页的转账、卡片和任务中心仍可使用。')
      mine.push(now)
      global.push(now)
      users.set(userId, mine)
      // 定期清掉一天没来的用户
      if (users.size > 1000) for (const [id, list] of users) if (!list.some((t) => t > now - DAY)) users.delete(id)
      return { allowed: true }
    },
  }
}

const key = Symbol.for('wencai.chat.rate')
const globals = globalThis as typeof globalThis & { [key]?: ReturnType<typeof createChatRateLimiter> }
export const chatRateLimiter = (globals[key] ??= createChatRateLimiter({
  perMinute: env.CHAT_RATE_PER_MINUTE,
  perDay: env.CHAT_RATE_PER_DAY,
  globalPerDay: env.CHAT_GLOBAL_PER_DAY,
}))
