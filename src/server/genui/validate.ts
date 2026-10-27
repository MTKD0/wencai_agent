import { catalog } from '#/genui/catalog'
import type { GenUISpec } from '#/genui/catalog'
import { collectEvidence, verifyNumbers } from '#/server/verify/numbers'
import { checkInteractionTemplate } from './interaction-template'
import { getByPointer, missingPathHint, resolveStatePath } from './state-path'
import { requestedAmounts } from '#/lib/requested-amounts'

export { getByPointer }

export type SpecCheck = { ok: true; spec: GenUISpec } | { ok: false; errors: string[] }

/**
 * 服务端校验模型提交的 spec：
 * 1. 符合组件目录（未知组件、非法 props 一律拒绝；数据 props 只能是 $state 引用）
 * 2. $state 路径必须在服务端数据中存在
 * 3. 文本类 props 中的金额必须有数据出处
 * 4. 丢弃模型自带的 state，由服务端注入
 */
export function checkSpec(input: unknown, state: Record<string, unknown>, requestText = '', currentTools: ReadonlySet<string> = new Set()): SpecCheck {
  const { state: _ignored, interaction, ...rest } = (input ?? {}) as Record<string, unknown>
  const templateCheck = interaction === undefined ? undefined : checkInteractionTemplate(interaction, state, requestText, currentTools)
  if (templateCheck && !templateCheck.ok) return { ok: false, errors: templateCheck.errors }
  // 模型常省略叶子节点的 children，补齐为空数组
  if (rest.elements && typeof rest.elements === 'object') {
    rest.elements = Object.fromEntries(
      Object.entries(rest.elements as Record<string, Record<string, unknown>>).map(([k, el]) => [
        k,
        el && typeof el === 'object' ? { ...el, children: el.children ?? [] } : el,
      ]),
    )
  }
  const result = catalog.validate(rest)
  if (!result.success || !result.data) {
    return { ok: false, errors: result.error?.issues.map((i) => `${i.path.join('.')}: ${i.message}`) ?? ['spec 无效'] }
  }
  const spec = result.data
  const errors: string[] = []
  // 用户在本次需求里说出的办理金额（如“给妈妈转 200”）可以出现在标题里；其他数字仍须来自服务端数据
  const evidence = collectEvidence([state, requestedAmounts(requestText)])

  const elements = (spec as { elements: Record<string, { type: string; props: Record<string, unknown> }> }).elements
  for (const [key, el] of Object.entries(elements)) {
    if (el.type === 'CardDisplay' && Array.isArray(el.props.cardIds)) {
      const ref = el.props.data as { $state: string }
      const rows = resolveStatePath(state, ref.$state).value
      const ids = new Set(Array.isArray(rows) ? rows.map(row => row && typeof row === 'object' ? String(row.cardId ?? row.id) : '') : [])
      if (el.props.cardIds.some(id => !ids.has(String(id)))) errors.push(`${key}.cardIds: 不能显示数据中不存在的银行卡`)
    }
    for (const [prop, value] of Object.entries(el.props ?? {})) {
      if (value && typeof value === 'object' && '$state' in value) {
        const reference = value as { $state: string }
        const { path, value: resolved } = resolveStatePath(state, reference.$state)
        if (resolved === undefined) errors.push(`${key}.${prop}: 数据路径 ${path} 不存在${missingPathHint(state, path)}`)
        else reference.$state = path
        if (path.startsWith('/get_wealth_advice/')) errors.push(`${key}.${prop}: 理财专家结果已由固定建议卡展示，请沿用该卡，不重复生成摘要或转换金额单位`)
        if (el.type === 'Metric' && prop === 'value') {
          if (typeof resolved !== 'number' || !Number.isFinite(resolved)) errors.push(`${key}.${prop}: 指标必须引用有限数值，不能把风险等级、空值或文字转换成0`)
          if (el.props.unit === '元' && /Cents(?:\/|$)/.test(path)) errors.push(`${key}.${prop}: 分金额不能直接按元展示，请使用固定工具卡中的金额`)
        }
      } else if (containsNumber(value)) {
        // 纵深防御：不依赖库的 props 校验，spec 中任何位置都不允许出现数字字面量
        errors.push(`${key}.${prop}: 不允许数字字面量，请用 $state 引用数据`)
      } else if (typeof value === 'string') {
        for (const v of verifyNumbers(value, evidence)) errors.push(`${key}.${prop}: 文本中的「${v.text}」没有数据出处`)
      }
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, spec: { ...spec, ...(templateCheck?.ok ? { interaction: templateCheck.interaction } : {}) } }
}

function containsNumber(v: unknown): boolean {
  if (typeof v === 'number') return true
  if (Array.isArray(v)) return v.some(containsNumber)
  if (v && typeof v === 'object') return Object.values(v).some(containsNumber)
  return false
}

