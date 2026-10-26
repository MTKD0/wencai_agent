import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

/**
 * 新建独立 SQLite 库并播种演示数据，然后让本进程使用它。评测与红队统计都必须在独立库上进行：
 * 子进程与本进程都显式使用这个地址，绝不回落到 data/bank.db。必须在导入任何服务端模块之前调用。
 */
export function prepareIsolatedDatabase(prefix: string, stamp: string): string {
  mkdirSync('.scratch', { recursive: true })
  const database = `file:./.scratch/${prefix}-${stamp}.db`
  const childEnv = { ...process.env, DATABASE_URL: database }
  console.log(`[${prefix}] 新建独立库 ${database}`)
  execFileSync(process.execPath, ['./node_modules/drizzle-kit/bin.cjs', 'push', '--force'], { env: childEnv, stdio: 'ignore' })
  execFileSync(process.execPath, ['--import=tsx', 'src/server/db/seed.ts'], { env: childEnv, stdio: 'inherit' })
  process.env.DATABASE_URL = database
  // 基金数据用离线快照，避免公开接口的网络波动影响结果
  process.env.FUND_DATA_MODE = 'fixture'
  return database
}

export const runStamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
