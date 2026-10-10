import { RULES, type Rule } from './rules'
import { CHANNEL_CEILING, RISK_ORDER, maxRisk } from './types'
import type { PolicyDecision, PolicyInput } from './types'

/**
 * 策略引擎：纯函数，无 I/O，可完整单测。
 * 等级从工具声明的 baseRisk 出发，规则只能升级或拒绝，不能降级。
 */
export function decide(input: PolicyInput, rules: Rule[] = RULES): PolicyDecision {
  let level = input.baseRisk
  const reasons: string[] = []

  for (const rule of rules) {
    if (!rule.applies(input)) continue
    const result = rule.evaluate(input)
    if (!result) continue
    if (result.kind === 'deny') {
      return { level: 'red', allowed: false, reasons: [result.reason], requiresChannelHandoff: false }
    }
    level = maxRisk(level, result.to)
    reasons.push(result.reason)
  }

  const requiresChannelHandoff =
    RISK_ORDER[level] > RISK_ORDER[CHANNEL_CEILING[input.facts.channel]]

  return { level, allowed: true, reasons, requiresChannelHandoff }
}
