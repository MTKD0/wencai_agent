import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/** 稳定序列化：键排序，保证同一参数得到同一哈希 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

export function hashParams(args: unknown): string {
  return createHash('sha256').update(stableStringify(args)).digest('hex')
}

export interface IntegrityFields {
  id: string
  userId: string
  tool: string
  paramsHash: string
  level: 'yellow' | 'red'
  expiresAt: number
}

/** 待确认动作的完整性签名：数据库行被篡改（换收款人、改金额、降等级）都会导致校验失败 */
export function signIntegrity(secret: string, f: IntegrityFields): string {
  const msg = [f.id, f.userId, f.tool, f.paramsHash, f.level, f.expiresAt].join('|')
  return createHmac('sha256', secret).update(msg).digest('hex')
}

export function verifyIntegrity(secret: string, f: IntegrityFields, signature: string): boolean {
  const expected = Buffer.from(signIntegrity(secret, f), 'hex')
  const actual = Buffer.from(signature, 'hex')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
