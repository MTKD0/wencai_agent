import { describe, expect, it } from 'vitest'
import { GENESIS_HASH, hashEntry, verifyChain } from '#/server/audit/chain'
import type { AuditEntry, StoredAuditEntry } from '#/server/audit/chain'

function build(entries: AuditEntry[]): StoredAuditEntry[] {
  let prev = GENESIS_HASH
  return entries.map((e) => {
    const hash = hashEntry(prev, e)
    const stored = { ...e, prevHash: prev, hash }
    prev = hash
    return stored
  })
}

const entry = (i: number): AuditEntry => ({ at: i, userId: 'u1', sessionId: 's1', channel: 'web', type: 'tool_call', payload: { i } })

describe('审计哈希链', () => {
  it('完整链校验通过', () => {
    expect(verifyChain(build([entry(1), entry(2), entry(3)]))).toBe(-1)
  })

  it('篡改中间记录被定位', () => {
    const chain = build([entry(1), entry(2), entry(3)])
    chain[1] = { ...chain[1], payload: { i: 999 } }
    expect(verifyChain(chain)).toBe(1)
  })

  it('删除记录被发现', () => {
    const chain = build([entry(1), entry(2), entry(3)])
    expect(verifyChain([chain[0], chain[2]])).toBe(1)
  })
})

describe('审计载荷归一化', () => {
  it('含 Date 的载荷经 JSON 往返后哈希不变', () => {
    const payload = JSON.parse(JSON.stringify({ now: new Date(0), skip: undefined }))
    const e: AuditEntry = { ...entry(1), payload }
    const stored = build([e])
    const roundTripped = JSON.parse(JSON.stringify(stored))
    expect(verifyChain(roundTripped)).toBe(-1)
  })
})
