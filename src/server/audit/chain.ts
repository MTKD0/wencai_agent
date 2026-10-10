import { createHash } from 'node:crypto'
import { stableStringify } from '#/server/confirm/integrity'

export const GENESIS_HASH = '0'.repeat(64)

export interface AuditEntry {
  at: number
  userId: string
  sessionId: string
  channel: string
  type: AuditType
  payload: unknown
}

export type AuditType =
  | 'user_input'
  | 'guard_verdict'
  | 'plan_created'
  | 'tool_call'
  | 'policy_decision'
  | 'pending_created'
  | 'confirm_attempt'
  | 'action_executed'
  | 'action_compensated'
  | 'injection_redacted'
  | 'output_verification'
  | 'circuit_breaker'
  | 'handoff'

export function hashEntry(prevHash: string, entry: AuditEntry): string {
  return createHash('sha256').update(prevHash).update(stableStringify(entry)).digest('hex')
}

export interface StoredAuditEntry extends AuditEntry {
  prevHash: string
  hash: string
}

/** 整链校验：返回第一条被篡改记录的下标，-1 表示完整 */
export function verifyChain(entries: StoredAuditEntry[]): number {
  let prev = GENESIS_HASH
  for (let i = 0; i < entries.length; i++) {
    const { prevHash, hash, ...entry } = entries[i]
    if (prevHash !== prev || hashEntry(prev, entry) !== hash) return i
    prev = hash
  }
  return -1
}
