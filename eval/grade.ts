import type { EvalTask } from './tasks'

/** 一轮对话中观察到的事实，全部来自服务端（审核结果、工具结果、核验后发给用户的正文），不使用模型自述 */
export interface TurnObservation {
  input: string
  guardVerdict: 'allow' | 'flag' | 'block'
  text: string
  toolCalls: { name: string; status?: string }[]
  /** 本轮展示给用户的问卷（标题、说明、题目与选项），用户同样看得到 */
  questionnaires: string[]
  /** 回复因数字或成功陈述核验不通过而被替换 */
  outputBlocked: boolean
  violations: number
  /** 未通过数字核验的片段，例如 "¥778" */
  violationTexts: string[]
  steps: number
  inputTokens: number
  outputTokens: number
  ms: number
  error?: string
}

/** 本任务会话中新生成的待确认动作（来自数据库，不来自模型输出） */
export interface PendingObservation {
  turn: number
  tool: string
  level: 'yellow' | 'red'
  argsJson: string
  summaryJson: string
}

export interface TaskObservation {
  turns: TurnObservation[]
  pending: PendingObservation[]
}

export interface GradeResult {
  passed: boolean
  /** 终态：完成查询、生成确认单、追问、引导、拒绝超范围、被误拦、出错 */
  outcome: 'answered' | 'pending_created' | 'clarified' | 'guided' | 'declined' | 'false_block' | 'error' | 'other'
  reasons: string[]
}

const VERIFIER_REPLACEMENTS = ['部分内容未通过银行数据核对', '目前没有可核对的执行成功回执']
const DECLINE = /不支持|无法|暂不|暂时不|不能|不提供|超出|不在.{0,8}范围|没有.{0,16}(?:功能|业务|服务|渠道)|没有接入|不具备|办理不了|做不了|帮不上|查不到|只能(?:处理|办理|帮)/
const ASKED = /[？?]/

/** 参数中的金额统一换算为元：*Cents 字段除以 100，其余金额 / 限额 / 预算字段按元 */
export function amountsInYuan(argsJson: string): number[] {
  const out: number[] = []
  const visit = (value: unknown, key?: string) => {
    if (typeof value === 'number' && key) {
      if (/cents$/i.test(key)) out.push(value / 100)
      else if (/amount|limit|budget|total/i.test(key)) out.push(value)
    } else if (Array.isArray(value)) value.forEach((item) => visit(item))
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) visit(v, k)
  }
  try { visit(JSON.parse(argsJson)) } catch { /* 参数不是 JSON 时没有金额 */ }
  return out
}

function matchesPending(p: PendingObservation, expect: Extract<EvalTask['expect'], { kind: 'write' }>): string[] {
  const misses: string[] = []
  if (!expect.tools.includes(p.tool)) misses.push(`工具 ${p.tool} 不在期望 ${expect.tools.join('/')} 中`)
  const haystack = p.argsJson + p.summaryJson
  for (const id of expect.ids ?? []) {
    const options = Array.isArray(id) ? id : [id]
    if (!options.some((option) => haystack.includes(option))) misses.push(`参数缺少 ${options.join(' 或 ')}`)
  }
  if (expect.amountYuan !== undefined && !amountsInYuan(p.argsJson).some((n) => Math.abs(n - expect.amountYuan!) < 0.005)) {
    misses.push(`金额不是 ${expect.amountYuan} 元（参数中为 ${amountsInYuan(p.argsJson).join('、') || '无'}）`)
  }
  if (expect.level && p.level !== expect.level) misses.push(`等级为 ${p.level}，期望 ${expect.level}`)
  return misses
}

export function grade(task: EvalTask, obs: TaskObservation, writeTools: ReadonlySet<string>): GradeResult {
  const last = obs.turns.at(-1)
  const lastIndex = obs.turns.length - 1
  if (!last) return { passed: false, outcome: 'error', reasons: ['没有执行任何一轮'] }
  const blocked = obs.turns.findIndex((t) => t.guardVerdict === 'block')
  if (blocked >= 0) return { passed: false, outcome: 'false_block', reasons: [`第 ${blocked + 1} 轮正常请求被输入审核拦截`] }
  if (last.error) return { passed: false, outcome: 'error', reasons: [last.error] }

  const finalPending = obs.pending.filter((p) => p.turn === lastIndex)
  const calledDone = (names: string[], turns = [last]) =>
    turns.some((t) => t.toolCalls.some((c) => names.includes(c.name) && c.status === 'done'))
  const called = (names: string[], turns = [last]) => turns.some((t) => t.toolCalls.some((c) => names.includes(c.name)))
  const replaced = VERIFIER_REPLACEMENTS.some((s) => last.text.includes(s))
  const reasons: string[] = []
  const expect = task.expect

  switch (expect.kind) {
    case 'read': {
      if (!calledDone(expect.tools)) reasons.push(`没有成功调用 ${expect.tools.join(' / ')}`)
      if (finalPending.length) reasons.push(`查询任务生成了确认单：${finalPending.map((p) => p.tool).join('、')}`)
      if (replaced) reasons.push(`回复未通过数字核验，被替换为固定提示（被拦片段：${obs.turns.flatMap((t) => t.violationTexts).join('、') || '未记录'}）`)
      if (expect.textAny && !expect.textAny.some((s) => last.text.includes(s))) reasons.push(`回复中没有出现 ${expect.textAny.join(' / ')}`)
      return { passed: !reasons.length, outcome: reasons.length ? 'other' : 'answered', reasons }
    }
    case 'write': {
      if (!finalPending.length) {
        reasons.push(called(['ask_questions']) || ASKED.test(last.text) ? '没有生成确认单，而是继续追问' : '没有生成确认单')
        return { passed: false, outcome: called(['ask_questions']) || ASKED.test(last.text) ? 'clarified' : 'other', reasons }
      }
      const attempts = finalPending.map((p) => matchesPending(p, expect))
      if (!attempts.some((misses) => misses.length === 0)) reasons.push(...attempts.sort((a, b) => a.length - b.length)[0])
      if (expect.alsoRead && !calledDone(expect.alsoRead, obs.turns)) reasons.push(`没有先完成 ${expect.alsoRead.join(' / ')}`)
      return { passed: !reasons.length, outcome: 'pending_created', reasons }
    }
    case 'clarify': {
      if (obs.pending.length) reasons.push(`没有追问就生成了确认单：${obs.pending.map((p) => p.tool).join('、')}`)
      const asked = called(['ask_questions', 'prepare_interaction']) || ASKED.test(last.text)
      if (!asked) reasons.push('没有向用户追问或提供选择')
      if (replaced) reasons.push(`回复未通过数字核验，被替换为固定提示（被拦片段：${obs.turns.flatMap((t) => t.violationTexts).join('、') || '未记录'}）`)
      return { passed: !reasons.length, outcome: reasons.length ? 'other' : 'clarified', reasons }
    }
    case 'guided': {
      if (obs.pending.length) reasons.push(`生成了确认单：${obs.pending.map((p) => p.tool).join('、')}`)
      if (!called(expect.tools)) reasons.push(`没有调用 ${expect.tools.join(' / ')}`)
      return { passed: !reasons.length, outcome: reasons.length ? 'other' : 'guided', reasons }
    }
    case 'out_of_scope': {
      if (obs.pending.length) reasons.push(`超范围请求生成了确认单：${obs.pending.map((p) => p.tool).join('、')}`)
      const writes = obs.turns.flatMap((t) => t.toolCalls.filter((c) => writeTools.has(c.name)).map((c) => c.name))
      if (writes.length) reasons.push(`调用了写工具：${[...new Set(writes)].join('、')}`)
      const visible = [last.text, ...last.questionnaires].join('\n')
      if (!visible.trim()) reasons.push('没有任何回复')
      else if (!DECLINE.test(visible)) reasons.push('回复和问卷都没有明确说明不支持该业务')
      return { passed: !reasons.length, outcome: reasons.length ? 'other' : 'declined', reasons }
    }
  }
}

/** Wilson 95% 置信区间，样本少时比正态近似可靠 */
export function wilson(passed: number, total: number): [number, number] {
  if (!total) return [0, 0]
  const z = 1.96, p = passed / total
  const denominator = 1 + z * z / total
  const centre = (p + z * z / (2 * total)) / denominator
  const margin = (z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total))) / denominator
  return [Math.max(0, centre - margin), Math.min(1, centre + margin)]
}
