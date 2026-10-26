/**
 * Agent 端到端任务评测：新建独立 SQLite 库并播种演示数据，用真实模型逐条执行 eval/tasks.ts，
 * 按服务端事实评分，输出 eval/results/<时间>/report.md 与 results.json。
 *
 * 用法：pnpm eval [--only=tr-01,bl-02] [--scenario=transfer] [--repeat=3]
 * 需要 .env.local 中配置 DEEPSEEK_API_KEY 或 FALLBACK_BASE_URL。不会读写 data/bank.db。
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { prepareIsolatedDatabase, runStamp } from '../eval/isolated-db'

const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=') as [string, string]))
const repeats = Math.max(1, Number(args.get('repeat') ?? 1))

if (!process.env.DEEPSEEK_API_KEY && !process.env.FALLBACK_BASE_URL) {
  console.error('未配置模型：请在 .env.local 中设置 DEEPSEEK_API_KEY 或 FALLBACK_BASE_URL 后再运行。')
  process.exit(1)
}

const stamp = runStamp()
const database = prepareIsolatedDatabase('eval', stamp)

const { TASKS } = await import('../eval/tasks')
const { runTask } = await import('../eval/run-task')
const { grade } = await import('../eval/grade')
const { buildReport } = await import('../eval/report')
const { BANK_TOOLS } = await import('../src/server/tools/bank')
const { syncWorkerClock } = await import('../src/server/tools/jobs')
type TaskRecord = import('../eval/report').TaskRecord
// 运行中的系统由 worker 每 10 秒把仿真时钟同步到当前时间；评测不启动 worker，这里同步一次，
// 否则时钟停在种子值，种子里按真实时间生成的到期日、流水日期会与"现在"错位
await syncWorkerClock(new Date())

const only = args.get('only')?.split(',')
const scenario = args.get('scenario')
const tasks = TASKS.filter((t) => (!only || only.includes(t.id)) && (!scenario || t.scenario === scenario))
const writeTools = new Set(BANK_TOOLS.filter((t) => t.kind === 'write').map((t) => t.name))
const model = process.env.DEEPSEEK_API_KEY ? process.env.DEEPSEEK_MODEL ?? 'deepseek-flash' : process.env.FALLBACK_MODEL ?? 'fallback'
const startedAt = new Date().toISOString()
const records: TaskRecord[] = []

console.log(`[eval] ${tasks.length} 个任务 × ${repeats} 次，模型 ${model}`)
for (let repeat = 0; repeat < repeats; repeat++) {
  for (const task of tasks) {
    const observation = await runTask(task, `${stamp}-${repeat}`)
    const result = grade(task, observation, writeTools)
    records.push({ task, repeat, observation, grade: result })
    console.log(`${result.passed ? '✓' : '✗'} ${task.id}${repeats > 1 ? ` #${repeat + 1}` : ''} ${result.outcome}${result.passed ? '' : ` — ${result.reasons.join('；')}`}`)
  }
}

const commit = (() => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD']).toString().trim() } catch { return 'unknown' } })()
const outDir = join('eval', 'results', stamp)
mkdirSync(outDir, { recursive: true })
const meta = { startedAt, finishedAt: new Date().toISOString(), model, commit, database, repeats, guard: process.env.GUARD_BASE_URL ? '规则 + Qwen3Guard' : '规则启发式' }
writeFileSync(join(outDir, 'results.json'), JSON.stringify({ meta, records }, null, 2))
writeFileSync(join(outDir, 'report.md'), buildReport(records, meta))
const passed = records.filter((r) => r.grade.passed).length
console.log(`[eval] 通过 ${passed} / ${records.length}，报告：${join(outDir, 'report.md')}`)
process.exit(0)
