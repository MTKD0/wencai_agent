/**
 * 诱导转账识别评测：留出集（src/server/security/fraud-corpus.ts）逐条经过三层识别，
 * 输出 eval/fraud/<时间>/report.md 与 results.json。第三层需要 .env.local 中的模型密钥，未配置时只统计前两层。
 *
 * 用法：pnpm fraud-eval [--repeat=3]
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { prepareIsolatedDatabase, runStamp } from '../eval/isolated-db'

const stamp = runStamp()
const database = prepareIsolatedDatabase('fraud', stamp)
const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=') as [string, string]))
const repeats = Math.max(1, Number(args.get('repeat') ?? 1))

const { runFraudCorpus, fraudStats } = await import('../src/server/security/fraud-corpus')
const { judgeScamScript } = await import('../src/server/policy/fraud-model')
const { env } = await import('../src/server/env')
const hasModel = !!(env.DEEPSEEK_API_KEY || env.FALLBACK_BASE_URL)
const commit = (() => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD']).toString().trim() } catch { return 'unknown' } })()

type Results = Awaited<ReturnType<typeof runFraudCorpus>>
const runs: Results[] = []
for (let i = 0; i < repeats; i++) {
  // 每轮换一个用户标识，避开 10 分钟缓存，才能看到模型判断的波动
  runs.push(await runFraudCorpus(hasModel ? async (text) => {
    const r = await judgeScamScript(`fraud-eval-${stamp}-${i}`, text, 15_000)
    return r.status === 'hit' ? true : r.status === 'clear' || r.status === 'rejected' ? false : null
  } : undefined))
  console.log(`[fraud-eval] 第 ${i + 1}/${repeats} 轮完成`)
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`
const layers = hasModel ? (['keyword', 'behavior', 'model', 'keyword+behavior', 'all'] as const) : (['keyword', 'behavior', 'keyword+behavior'] as const)
const layerText = { keyword: '① 关键词', behavior: '② 行为画像', model: '③ 模型话术判断', 'keyword+behavior': '①+②', all: '①+②+③（上线组合）' } as const
const last = runs[runs.length - 1]
const unavailable = hasModel ? runs.flat().filter((r) => r.model === null).length : 0
const row = (layer: typeof layers[number]) => {
  const per = runs.map((r) => fraudStats(r, layer))
  const s = per[per.length - 1]
  const spread = repeats > 1 ? `（${repeats} 轮：识别 ${per.map((p) => p.recall.count).join(' / ')}；误报 ${per.map((p) => p.falsePositive.count).join(' / ')}）` : ''
  return `| ${layerText[layer]} | ${s.recall.count} / ${s.recall.total}（${pct(s.recall.rate)}，${pct(s.recall.ci[0])}–${pct(s.recall.ci[1])}） | ${s.falsePositive.count} / ${s.falsePositive.total}（${pct(s.falsePositive.rate)}） | ${spread} |`
}
const mark = (v: boolean | null | undefined) => v === undefined ? '—' : v === null ? '超时' : v ? '✓' : ''

const report = [
  '# 诱导转账识别评测（留出集）', '',
  `> 生成时间 ${new Date().toISOString()}，代码版本 \`${commit}\`，独立库 \`${database}\`。${hasModel ? `第三层使用当前配置的模型，共 ${repeats} 轮${unavailable ? `，其中 ${unavailable} 次调用超时或失败（按未命中计）` : ''}。` : '未配置模型密钥，只统计前两层。'}`,
  '> 样本定义见 `src/server/security/fraud-corpus.ts`：写于第二层阈值确定之后、第三层动手之前，未用于调规则。情形由团队编写，不是真实案件数据。', '',
  '## 识别率与误报率', '',
  '| 层 | 诈骗样本识别 | 正常样本误报 | 波动 |', '|---|---|---|---|',
  ...layers.map(row), '',
  '“误报”的代价：第一、三层命中显示诈骗劝阻，第二层命中显示较温和的“与平时习惯差别较大”提醒；两者都升为红色强验证、要求勾选已核实，都**不拒绝交易**。只有话术命中（第一、三层）的转账在用户坚持确认后才进入冷静期。', '',
  '## 逐条结果（最后一轮）', '',
  '| 编号 | 类型 | 说明 | 金额 | ① | ② 行为信号 | ③ |', '|---|---|---|---|---|---|---|',
  ...last.map((r) => `| ${r.id} | ${r.kind === 'scam' ? '诈骗' : '正常'} | ${r.label} | ${r.amountYuan} | ${mark(r.keyword)} | ${r.behavior ? '✓ ' : ''}${r.behaviorSignals.join('、')} | ${mark(r.model)} |`), '',
  '## 解读边界', '',
  '- 样本 50 条，置信区间很宽；比例只说明这份样本上的表现。',
  '- 第二层的情形（收款人新旧、金额、余额）是按常见案发特征编写的，对第二层偏有利；正常样本里刻意放入了首次交押金、买车首付、大额孝敬父母等容易误报的情形。',
  '- 第三层是模型判断，同一输入多次运行可能不同，用 `--repeat` 观察波动。',
  '- fs-01 至 fs-30 中用户都讲出了来龙去脉（“对方说……让我……”），对第三层有利；fs-31 至 fs-35 是“沉默型”，用户只说要转账，话术层按设计无从判断，只能靠第二层。',
]
const outDir = join('eval', 'fraud', stamp)
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'results.json'), JSON.stringify({ commit, database, repeats, hasModel, stats: layers.map((l) => runs.map((r) => fraudStats(r, l))), runs }, null, 2))
writeFileSync(join(outDir, 'report.md'), report.join('\n') + '\n')
for (const l of layers) { const s = fraudStats(last, l); console.log(`[fraud-eval] ${layerText[l]}：识别 ${s.recall.count}/${s.recall.total}，误报 ${s.falsePositive.count}/${s.falsePositive.total}`) }
console.log(`[fraud-eval] 报告：${join(outDir, 'report.md')}`)
process.exit(0)
