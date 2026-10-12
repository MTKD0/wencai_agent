import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, unlink } from 'node:fs/promises'
import { createClient } from '@libsql/client'
import { expect, it } from 'vitest'
import { verifyChain } from '#/server/audit/chain'
import type { StoredAuditEntry } from '#/server/audit/chain'

it('两个独立进程同时写审计，无数据库锁错误且哈希链不分叉', async () => {
  await mkdir('.scratch', { recursive: true })
  const file = `.scratch/dbconcurrent-${randomUUID()}.db`
  const url = `file:./${file}`
  const client = createClient({ url })
  try {
    await client.execute('CREATE TABLE audit_logs (seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, user_id TEXT NOT NULL, session_id TEXT NOT NULL, channel TEXT NOT NULL, type TEXT NOT NULL, payload_json TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL)')
    await Promise.all([1, 2].map(() => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import=tsx', 'tests/fixtures/audit-writer.ts'], { env: { ...process.env, DATABASE_URL: url }, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
      let errors = ''
      child.stderr.on('data', (data) => { errors += data })
      child.once('error', reject)
      child.once('close', (code) => code === 0 ? resolve() : reject(new Error(errors)))
    })))
    const { rows } = await client.execute('SELECT * FROM audit_logs ORDER BY seq')
    expect(rows).toHaveLength(40)
    const entries = rows.map((row) => ({ at: Number(row.at), userId: row.user_id, sessionId: row.session_id, channel: row.channel, type: row.type, payload: JSON.parse(String(row.payload_json)), prevHash: row.prev_hash, hash: row.hash })) as StoredAuditEntry[]
    expect(verifyChain(entries)).toBe(-1)
  } finally {
    client.close()
    // Windows 原生驱动可能延迟释放文件句柄；清理失败保留隔离样本，不覆盖测试错误。
    await unlink(file).catch(() => {})
  }
}, 20_000)
