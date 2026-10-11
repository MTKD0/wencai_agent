/**
 * WebAuthn challenge 的短期存放。
 * 进程内即可：challenge 只在一次注册/验证往返内有效，多实例部署需换成共享存储。
 */

const TTL_MS = 3 * 60 * 1000

interface Entry {
  challenge: string
  expiresAt: number
}

const store = new Map<string, Entry>()

const key = (userId: string, purpose: 'register' | 'auth') => `${userId}:${purpose}`

export function putChallenge(userId: string, purpose: 'register' | 'auth', challenge: string): void {
  store.set(key(userId, purpose), { challenge, expiresAt: Date.now() + TTL_MS })
}

/** 一次性取出：取出即失效，防止重放 */
export function consumeChallenge(userId: string, purpose: 'register' | 'auth'): string | null {
  const entry = store.get(key(userId, purpose))
  if (!entry) return null
  store.delete(key(userId, purpose))
  return entry.expiresAt > Date.now() ? entry.challenge : null
}

export function peekChallenge(userId: string, purpose: 'register' | 'auth'): string | null {
  const entry = store.get(key(userId, purpose))
  return entry && entry.expiresAt > Date.now() ? entry.challenge : null
}
