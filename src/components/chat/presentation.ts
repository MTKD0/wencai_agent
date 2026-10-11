import type { WencaiUIMessage } from '#/server/agent/messages'
import type { ToolUIPart } from './ToolPart'

export type ToolPresentation = 'result' | 'status' | 'hidden'
type Source = { tool: string; period?: string; days?: number; field?: string; fingerprint: string }
type View = { index: number; sources: Source[] }
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}

// 排序后比较数据，避免相同分类因排列、图表类型或工具别名不同而重复展示。
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(',')}}`
  return JSON.stringify(value) ?? 'undefined'
}

function source(tool: string, data: unknown): Source {
  const out = record(data)
  const analysis = record(out.result)
  const categories = tool === 'get_spending_report'
    ? record(out.categories)
    : Object.fromEntries((Array.isArray(analysis.byCategory) ? analysis.byCategory : [])
      .map((row) => { const item = record(row); return [item.category, item.total] }))
  if ((tool === 'get_spending_report' && Number.isFinite(out.expense)) ||
    (tool === 'analyze_spending' && Number.isFinite(analysis.totalSpent))) {
    const period = out.period ?? analysis.period
    return {
      tool: 'spending',
      period: typeof period === 'string' ? period : undefined,
      days: typeof period !== 'string' && typeof out.days === 'number' ? out.days : undefined,
      fingerprint: stable({ categories, total: tool === 'get_spending_report' ? out.expense : analysis.totalSpent }),
    }
  }
  return { tool, fingerprint: stable(data) }
}

function same(a: Source, b: Source) {
  return a.tool === b.tool && a.fingerprint === b.fingerprint &&
    (!a.period || !b.period || a.period === b.period) &&
    (!a.days || !b.days || a.days === b.days) &&
    (!a.field || !b.field || a.field === b.field)
}

/** 只读取根节点能到达的展示数据，孤立元素不能折叠真正的结果。 */
function viewSources(output: unknown): Source[] {
  const spec = record(record(output).spec)
  const elements = record(spec.elements)
  const state = record(spec.state)
  const refs = new Set<string>()
  const visited = new Set<string>()
  const visitProps = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    const ref = record(value).$state
    if (typeof ref === 'string') refs.add(ref)
    else Object.values(value).forEach(visitProps)
  }
  const visitElement = (id: string) => {
    if (visited.has(id)) return
    visited.add(id)
    const element = record(elements[id])
    visitProps(element.props)
    if (Array.isArray(element.children)) element.children.forEach(visitElement)
  }
  if (typeof spec.root === 'string') visitElement(spec.root)
  return [...refs].flatMap((ref) => {
    const [, tool, ...path] = ref.split('/')
    if (!(tool in state)) return []
    const data = source(tool, state[tool])
    const leaf = path.at(-1)
    // 同一数据的不同指标不能互相覆盖；分类图的两种工具路径则归为同一展示。
    const field = data.tool === 'spending' && ['byCategory', 'categories'].includes(leaf ?? '')
      ? 'categories'
      : data.tool === 'spending' && ['expense', 'totalSpent'].includes(leaf ?? '')
        ? 'total'
        : path.join('/')
    return [{ ...data, field }]
  })
}

function richResult(part: ToolUIPart) {
  const out = record(part.output)
  const data = record(out.data)
  if (out.status !== 'done') return false
  switch (part.type) {
    case 'tool-get_accounts':
    case 'tool-list_cards': return Array.isArray(out.data)
    case 'tool-get_spending_report':
      return Number.isFinite(data.expense) && !!data.categories && typeof data.categories === 'object'
    case 'tool-analyze_spending': {
      const result = record(data.result)
      return Number.isFinite(result.totalSpent) && Array.isArray(result.byCategory)
    }
    default: return false
  }
}

/** 每条回答只在结束时挂载最终视图；工具原始数据仍保留在对话中供后续模型使用。 */
export function toolPresentations(parts: WencaiUIMessage['parts'], processing = false): ToolPresentation[] {
  const modes: ToolPresentation[] = parts.map(() => 'result')
  const fixed: View[] = []
  const views: View[] = []
  const viewAttempts: number[] = []
  parts.forEach((raw, index) => {
    if (!raw.type.startsWith('tool-')) return
    const part = raw as ToolUIPart
    if (part.type === 'tool-show_view') {
      viewAttempts.push(index)
      if (part.state === 'output-available' && record(part.output).status === 'view') {
        views.push({ index, sources: viewSources(part.output) })
        if (processing) modes[index] = 'status'
      }
    } else if (richResult(part)) {
      fixed.push({ index, sources: [source(part.type.slice(5), record(part.output).data)] })
      if (processing) modes[index] = 'status'
    }
  })
  if (processing) return modes

  // 后一次完整视图替代同一数据的早期版本，独立账期与不同结果仍可并存。
  const finalViews = views.filter((view, i) => !view.sources.length ||
    !views.slice(i + 1).some((later) => view.sources.every((s) => later.sources.some((t) => same(s, t)))))
  for (const view of views) if (!finalViews.includes(view)) modes[view.index] = 'hidden'
  const finalFixed = fixed.filter((item, i) => {
    const covered = finalViews.some((view) => item.sources.every((s) => view.sources.some((t) => same(s, t))))
    const replaced = fixed.slice(i + 1).some((later) => item.sources.every((s) => later.sources.some((t) =>
      same(s, t) || (parts[item.index].type === parts[later.index].type && s.period === t.period && s.days === t.days))))
    if (covered || replaced) modes[item.index] = 'status'
    return !covered && !replaced
  })
  // 展示层失败由可用的最终视图/固定报表兜底，银行业务错误及确认卡从不隐藏。
  if (finalViews.length || finalFixed.length) {
    for (const index of viewAttempts) if (!finalViews.some((view) => view.index === index)) modes[index] = 'hidden'
  }
  return modes
}
