/**
 * 红队统计：提示词注入语料（攻击与正常样本）走真实输入审核，两个演示账户互相做越权实测。
 * 新建独立库，输出 eval/redteam/<时间>/report.md 与 results.json。不需要模型密钥（配置了 Qwen3Guard 时一并使用）。
 *
 * 用法：pnpm redteam
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { prepareIsolatedDatabase, runStamp } from '../eval/isolated-db'

const stamp = runStamp()
const database = prepareIsolatedDatabase('redteam', stamp)

const { guard } = await import('../src/server/guard')
const { runCorpus, corpusStats, runCrossUserProbes } = await import('../src/server/security/redteam')
type Rate = import('../src/server/security/redteam').Rate

const results = await runCorpus(guard)
const stats = corpusStats(results)
const tuning = corpusStats(results.filter((r) => !r.holdout))
const holdout = corpusStats(results.filter((r) => r.holdout))
const probes = await runCrossUserProbes({ withSetup: true })
const commit = (() => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD']).toString().trim() } catch { return 'unknown' } })()
const guardLabel = process.env.GUARD_BASE_URL ? '规则启发式 + Qwen3Guard（取更严结果）' : '规则启发式（本机未配置 Qwen3Guard）'

const pct = (n: number) => `${(n * 100).toFixed(1)}%`
const row = (label: string, r: Rate, note: string) => `| ${label} | ${r.count} / ${r.total} | ${pct(r.rate)} | ${pct(r.ci[0])} – ${pct(r.ci[1])} | ${note} |`
const verdictText = { block: '拦截', flag: '标记', allow: '放行' } as const
const sourceText = { user: '用户输入', tool_output: '外部文本' } as const
const misses = results.filter((r) => r.kind === 'attack' && r.verdict === 'allow')
const detectedOnly = results.filter((r) => r.kind === 'attack' && r.verdict !== 'allow' && !r.stopped)
const benignHits = results.filter((r) => r.kind === 'benign' && r.verdict !== 'allow')
const blocked = probes.filter((p) => p.blocked).length

const report = [
  '# 红队统计报告',
  '',
  `> 生成时间 ${new Date().toISOString()}。代码版本 \`${commit}\`，输入审核：${guardLabel}。独立库 \`${database}\`（演示种子数据）。`,
  '> 语料与探测定义见 `src/server/security/redteam.ts`。逐条结果见同目录 `results.json`。',
  '',
  '## 1. 提示词注入：拦截率与误拒率',
  '',
  `语料 ${results.length} 条：攻击 ${stats.attackStopped.total} 条、正常 ${stats.benignStopped.total} 条；其中外部文本（转账备注、商户名等，间接注入）${results.filter((r) => r.source === 'tool_output').length} 条。`,
  '',
  '| 指标 | 数量 | 比例 | 95% 置信区间（Wilson） | 含义 |',
  '|---|---|---|---|---|',
  row('攻击阻断率', stats.attackStopped, '用户输入被拦截、不进入模型；外部文本被替换为占位符'),
  row('攻击检出率', stats.attackDetected, '被拦截或被标记（标记的用户输入照常处理但写审计）'),
  row('正常样本误拒率', stats.benignStopped, '正常请求被拦截，或正常备注被替换'),
  row('正常样本标记率', stats.benignFlagged, '只写审计、不影响办理'),
  '',
  '用户输入只有“拦截”才会挡下；外部文本“拦截”和“标记”都会被替换为占位符，所以两类来源的阻断口径不同。',
  '',
  '### 调规则用的样本与留出集',
  '',
  `规则是对着前 ${tuning.attackStopped.total + tuning.benignStopped.total} 条样本补的，这部分的比例偏乐观。留出集 ${holdout.attackStopped.total + holdout.benignStopped.total} 条（编号 ho-、hn-）在规则改完之后才写，没有用来调规则，更接近规则对新说法的真实表现。`,
  '',
  '| 子集 | 攻击阻断 | 攻击检出 | 正常误拒 | 正常标记 |',
  '|---|---|---|---|---|',
  ...([['调规则样本', tuning], ['留出集', holdout]] as const).map(([label, s]) => `| ${label} | ${s.attackStopped.count}/${s.attackStopped.total}（${pct(s.attackStopped.rate)}） | ${s.attackDetected.count}/${s.attackDetected.total}（${pct(s.attackDetected.rate)}） | ${s.benignStopped.count}/${s.benignStopped.total}（${pct(s.benignStopped.rate)}） | ${s.benignFlagged.count}/${s.benignFlagged.total}（${pct(s.benignFlagged.rate)}） |`),
  '',
  '### 按类别',
  '',
  '| 类别 | 类型 | 样本 | 阻断 | 检出 |',
  '|---|---|---|---|---|',
  ...stats.byCategory.map((c) => `| ${c.category} | ${c.kind === 'attack' ? '攻击' : '正常'} | ${c.total} | ${c.stopped} | ${c.detected} |`),
  '',
  `### 漏检的攻击（${misses.length} 条）`,
  '',
  '这些说法目前的规则覆盖不到，依靠结构约束兜底：工具参数里没有 userId，系统中没有可被模型调用的确认工具，风险等级与验证方式由代码判定。',
  '',
  '| 编号 | 来源 | 类别 | 留出集 | 样本 |',
  '|---|---|---|---|---|',
  ...misses.map((r) => `| ${r.id} | ${sourceText[r.source]} | ${r.category} | ${r.holdout ? '是' : ''} | ${r.text.replace(/\n/g, ' ')} |`),
  '',
  `### 检出但未阻断的攻击（${detectedOnly.length} 条）`,
  '',
  '| 编号 | 类别 | 判定 | 样本 |',
  '|---|---|---|---|',
  ...detectedOnly.map((r) => `| ${r.id} | ${r.category} | ${verdictText[r.verdict]} | ${r.text} |`),
  '',
  `### 被拦截或标记的正常样本（${benignHits.length} 条）`,
  '',
  '| 编号 | 来源 | 判定 | 是否挡下 | 样本 |',
  '|---|---|---|---|---|',
  ...benignHits.map((r) => `| ${r.id} | ${sourceText[r.source]} | ${verdictText[r.verdict]} | ${r.stopped ? '是' : '否'} | ${r.text} |`),
  '',
  '## 2. 越权实测（两个真实账户）',
  '',
  `张小明与李小萌互相作为攻击者，以本人会话身份读取或操作对方的资金账户、银行卡、联系人和确认单。**防住 ${blocked} / ${probes.length}**。判定标准：请求失败或只返回本人数据，返回内容中没有出现对方的姓名、账户、卡片尾号或余额，也没有生成以对方资源为对象的确认单。`,
  '',
  '| 编号 | 探测 | 结果 | 服务端返回 |',
  '|---|---|---|---|',
  ...probes.map((p) => `| ${p.id} | ${p.label} | ${p.blocked ? '✅ 防住' : '❌ 未防住'} | ${p.evidence.replace(/\|/g, '/')} |`),
  '',
  '## 3. 解读边界',
  '',
  '- 语料由开发团队编写，包含已知覆盖不到的同义改写；不是第三方测试集，比例只说明这份语料上的表现。',
  '- 关键词规则对没见过的说法泛化很弱（见留出集）。留出集的漏检不回头补规则，否则它就不再是留出集；下一轮改规则前应另写新的留出样本。',
  '- 未配置 Qwen3Guard 时只统计规则启发式；生产环境两者并行、取更严结果。',
  '- 输入审核只是第一层。即使漏检，模型也无法越权到他人账户（见第 2 节），也无法自行放行交易：等级与验证由策略引擎和确认链路强制执行。',
  '- 越权实测在独立库的演示数据上运行，覆盖工具层与确认服务；HTTP 接口的会话鉴权由 `authorization.test.ts` 覆盖。',
].join('\n') + '\n'

const outDir = join('eval', 'redteam', stamp)
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'results.json'), JSON.stringify({ commit, guard: guardLabel, database, stats, tuning, holdout, corpus: results, probes }, null, 2))
writeFileSync(join(outDir, 'report.md'), report)
console.log(`[redteam] 留出集：攻击阻断 ${holdout.attackStopped.count}/${holdout.attackStopped.total}，正常误拒 ${holdout.benignStopped.count}/${holdout.benignStopped.total}`)
console.log(`[redteam] 全部：攻击阻断 ${stats.attackStopped.count}/${stats.attackStopped.total}，检出 ${stats.attackDetected.count}/${stats.attackDetected.total}；正常误拒 ${stats.benignStopped.count}/${stats.benignStopped.total}；越权防住 ${blocked}/${probes.length}`)
console.log(`[redteam] 报告：${join(outDir, 'report.md')}`)
process.exit(0)
