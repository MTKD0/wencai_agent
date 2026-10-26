import { BUSINESS_SCENARIOS, SCENARIO_LABELS, VARIANT_LABELS } from './tasks'
import type { EvalTask, Scenario, Variant } from './tasks'
import { wilson } from './grade'
import type { GradeResult, TaskObservation } from './grade'

export interface TaskRecord {
  task: EvalTask
  repeat: number
  observation: TaskObservation
  grade: GradeResult
}

export interface RunMeta {
  startedAt: string
  finishedAt: string
  model: string
  commit: string
  database: string
  repeats: number
  guard: string
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`
const row = (label: string, records: TaskRecord[]) => {
  const passed = records.filter((r) => r.grade.passed).length
  const [lo, hi] = wilson(passed, records.length)
  return `| ${label} | ${passed} / ${records.length} | ${records.length ? pct(passed / records.length) : '—'} | ${records.length ? `${pct(lo)} – ${pct(hi)}` : '—'} |`
}
const median = (values: number[]) => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) / 2)]
}
const percentile = (values: number[], p: number) => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]
}

export function buildReport(records: TaskRecord[], meta: RunMeta): string {
  const inScope = records.filter((r) => BUSINESS_SCENARIOS.includes(r.task.scenario))
  const scenarios = Object.keys(SCENARIO_LABELS) as Scenario[]
  const variants = Object.keys(VARIANT_LABELS) as Variant[]
  const turns = records.flatMap((r) => r.observation.turns)
  const taskMs = records.map((r) => r.observation.turns.reduce((s, t) => s + t.ms, 0))
  const toolCalls = turns.reduce((s, t) => s + t.toolCalls.length, 0)
  const tokens = turns.reduce((s, t) => s + t.inputTokens + t.outputTokens, 0)
  const falseBlocks = records.filter((r) => r.grade.outcome === 'false_block').length
  const verifierHits = turns.filter((t) => t.violations > 0).length
  const rejected = turns.flatMap((t) => t.toolCalls).filter((c) => c.status === 'error' || c.status?.startsWith('invalid_'))
  const rejectedBy = new Map<string, number>()
  for (const c of rejected) rejectedBy.set(`${c.name}:${c.status}`, (rejectedBy.get(`${c.name}:${c.status}`) ?? 0) + 1)
  const followed = records.filter((r) => r.observation.turns.length > r.task.turns.length)
  const outcomes = new Map<string, number>()
  for (const r of records) outcomes.set(r.grade.outcome, (outcomes.get(r.grade.outcome) ?? 0) + 1)

  const lines = [
    '# Agent 端到端任务评测报告',
    '',
    `> 生成时间 ${meta.finishedAt}。代码版本 \`${meta.commit}\`，模型 \`${meta.model}\`，输入审核 ${meta.guard}，每个任务运行 ${meta.repeats} 次。`,
    `> 独立评测库 \`${meta.database}\`（演示种子数据），没有任何确认单被执行。评分只依据服务端事实：输入审核结果、工具调用结果、数据库中的待确认动作和核验后发给用户的正文。`,
    '',
    '## 1. 总体结果',
    '',
    '| 范围 | 通过 / 总数 | 完成率 | 95% 置信区间（Wilson） |',
    '|---|---|---|---|',
    row('六个业务场景合计', inScope),
    row('超范围兜底', records.filter((r) => r.task.scenario === 'out_of_scope')),
    row('诱导转账防护', records.filter((r) => r.task.scenario === 'fraud')),
    row('全部任务', records),
    '',
    ...(outcomes.get('error') ? [`> ⚠️ 有 ${outcomes.get('error')} 个任务因模型调用或运行错误没有完成（见第 5 节），计入失败。如果是密钥、网络或限流问题，修复后应重新运行，不能把这部分当作 Agent 行为的结果。`, ''] : []),
    '“通过”的定义：查询类成功调用了对应工具且没有生成确认单；办理类生成了**工具、对象、金额、风险等级都正确**的确认单；需要追问的任务没有擅自生成确认单；超范围请求没有调用写工具并明确说明不支持。确认单生成即视为 Agent 完成了自己的部分——按设计，授权必须由用户在独立安全页面完成，评测不代替用户确认。',
    '',
    '## 2. 按场景',
    '',
    '| 场景 | 通过 / 总数 | 完成率 | 95% 置信区间 |',
    '|---|---|---|---|',
    ...scenarios.map((s) => row(SCENARIO_LABELS[s], records.filter((r) => r.task.scenario === s))),
    '',
    '## 3. 按表达方式',
    '',
    '| 表达方式 | 通过 / 总数 | 完成率 | 95% 置信区间 |',
    '|---|---|---|---|',
    ...variants.map((v) => row(VARIANT_LABELS[v], records.filter((r) => r.task.variant === v))),
    '',
    '## 4. 过程指标',
    '',
    '| 指标 | 数值 |',
    '|---|---|',
    `| 任务数 × 运行次数 | ${records.length} |`,
    `| 对话轮次 | ${turns.length}（平均每任务 ${(turns.length / Math.max(1, records.length)).toFixed(2)}） |`,
    `| 工具调用 | ${toolCalls}（平均每轮 ${(toolCalls / Math.max(1, turns.length)).toFixed(2)}） |`,
    `| 工具调用被服务端校验拒绝 | ${rejected.length} / ${toolCalls}${rejectedBy.size ? `（${[...rejectedBy].map(([k, v]) => `${k} ×${v}`).join('，')}）` : ''} |`,
    `| 需要模拟用户补充回答（选付款卡等）的任务 | ${followed.length} / ${records.length} |`,
    `| 正常请求被输入审核误拦 | ${falseBlocks} / ${records.length} |`,
    `| 回复触发数字核验提示的轮次 | ${verifierHits} / ${turns.length} |`,
    `| 任务耗时 中位数 / P95 | ${(median(taskMs) / 1000).toFixed(1)} 秒 / ${(percentile(taskMs, 0.95) / 1000).toFixed(1)} 秒 |`,
    `| 模型 token 合计 | ${tokens.toLocaleString('en-US')}（平均每任务 ${Math.round(tokens / Math.max(1, records.length)).toLocaleString('en-US')}） |`,
    '',
    '终态分布：' + [...outcomes].map(([k, v]) => `${k} ${v}`).join('，') + '。',
    '',
    '## 5. 未通过的任务',
    '',
  ]
  const failed = records.filter((r) => !r.grade.passed)
  if (!failed.length) lines.push('无。')
  else {
    lines.push('| 任务 | 场景 | 输入 | 原因 | 实际调用的工具 |', '|---|---|---|---|---|')
    for (const r of failed) {
      const tools = [...new Set(r.observation.turns.flatMap((t) => t.toolCalls.map((c) => c.name)))].join('、') || '无'
      lines.push(`| ${r.task.id}${meta.repeats > 1 ? ` #${r.repeat + 1}` : ''} | ${SCENARIO_LABELS[r.task.scenario]} | ${r.task.turns.join(' → ')} | ${r.grade.reasons.join('；')} | ${tools} |`)
    }
  }
  lines.push(
    '',
    '## 6. 解读边界',
    '',
    '- 任务集由开发团队编写，覆盖六个场景、口语化与多轮改口，但不是独立第三方测试集；同一模型、同一提示词下的结果，不代表其他模型或其他数据。',
    '- 置信区间假设任务之间相互独立；同一任务重复运行不能增加独立样本。',
    '- 评测在 Agent 生成确认单处停止，不包含用户完成安全验证后的结算；结算正确性由单元测试（`tests/`）覆盖。',
    '- 逐条结果（每轮输入、正文、工具调用、待确认动作参数）见同目录 `results.json`。',
  )
  return lines.join('\n') + '\n'
}
