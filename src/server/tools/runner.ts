import { confirmLink } from '#/server/confirm/link'
import { audit } from '#/server/audit/log'
import { createPending } from '#/server/confirm/pending'
import { decide } from '#/server/policy/engine'
import { collectFacts } from '#/server/policy/facts'
import { detectFraudSignals } from '#/server/policy/fraud'
import { judgeScamScript } from '#/server/policy/fraud-model'
import { PAYS_OTHERS_TOOLS, transferBehaviorSignals } from '#/server/policy/rules'
import type { AgentContext } from '#/server/agent/context'
import type { BankToolDef, ToolOutcome } from './define'
import { sanitizeToolOutput } from './sanitize'

/**
 * 所有工具调用的唯一入口：参数校验 → 采集事实 → 策略判定 → 执行或生成待确认动作。
 * 模型只能走到这里，越过这里的路径（/api/confirm）只对已认证用户开放。
 */
export async function runBankTool(
  def: BankToolDef,
  rawArgs: unknown,
  ctx: AgentContext,
  plan?: { planId: string; nodeId: string },
): Promise<ToolOutcome> {
  const parsed = def.inputSchema.safeParse(rawArgs)
  if (!parsed.success) return { status: 'error', message: `参数无效：${parsed.error.message}` }
  let args = parsed.data as Record<string, unknown>
  try {
    if (def.prepare) args = await def.prepare(args, ctx)
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) }
  }

  await audit(ctx, 'tool_call', { tool: def.name, args, plan })

  // 本人在本次对话中的话与备注里的诈骗话术是事实；是否升级由 rules.ts 决定
  const fraudSignals = detectFraudSignals(ctx.riskText ?? ctx.requestText, typeof args.memo === 'string' ? args.memo : undefined, typeof args.note === 'string' ? args.note : undefined)
  // 第三层：关键词没有命中时，由模型判断本人原话是否像被人指挥转账；只会升级。与数据库事实采集并行，不额外排队
  const judging = !fraudSignals.length && PAYS_OTHERS_TOOLS.includes(def.name) ? judgeScamScript(ctx.userId, ctx.riskText ?? ctx.requestText) : undefined
  const facts = await collectFacts({ userId: ctx.userId, channel: ctx.channel, sessionId: ctx.sessionId, ...def.factsHint?.(args) })
  let fraudLayer: 'keyword' | 'model' | undefined, fraudEvidence: string | undefined
  if (fraudSignals.length) { facts.fraudSignals = fraudSignals; fraudLayer = 'keyword' }
  else if (judging) {
    const judged = await judging
    if (judged.status !== 'skipped') await audit(ctx, 'fraud_model_judgment', { tool: def.name, status: judged.status, signals: judged.signals, evidence: judged.evidence })
    if (judged.signals.length) { facts.fraudSignals = judged.signals; fraudLayer = 'model'; fraudEvidence = typeof judged.evidence === 'string' ? judged.evidence : undefined }
  }
  const decision = decide({ tool: def.name, baseRisk: def.baseRisk, args, facts })
  await audit(ctx, 'policy_decision', { tool: def.name, decision, facts })

  if (!decision.allowed) return { status: 'denied', reasons: decision.reasons }

  if (decision.level === 'green') {
    try {
      const output = await def.execute(args, ctx)
      const data = await sanitizeToolOutput(ctx, def.name, output, def.catalogFields)
      const totals = def.totals?.(output)
      await audit(ctx, 'tool_result', { tool: def.name, ok: true, output: data, ...(totals ? { totals } : {}) })
      return { status: 'done', data, ...(totals ? { totals } : {}) }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await audit(ctx, 'tool_result', { tool: def.name, ok: false, message })
      return { status: 'error', message }
    }
  }

  let pending: Awaited<ReturnType<typeof createPending>>
  try {
    pending = await createPending({ ctx, def, args, decision, plan,
      ...(facts.payeeRiskFlag === 'suspected' && facts.payeeRiskAccountId && facts.payeeRiskRevision !== undefined
        ? { riskSnapshot: { accountId: facts.payeeRiskAccountId, revision: facts.payeeRiskRevision } } : {}),
    })
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) }
  }
  // 后台反诈中心的识别记录；写入失败不影响本次确认单
  if (facts.fraudSignals?.length || facts.transferBaseline) {
    const behavior = transferBehaviorSignals({ tool: def.name, baseRisk: def.baseRisk, args, facts })
    await (await import('#/server/fraud/events')).recordFraudEvent({ ctx, tool: def.name, actionId: pending.actionId, args, facts, reasons: decision.reasons, fraudLayer, evidence: fraudEvidence, behavior, summary: pending.summary })
      .catch((error) => audit(ctx, 'tool_result', { tool: def.name, ok: false, stage: 'fraud_event', message: String(error) }))
  }
  // 确认摘要的 value 也可能来自其他用户的 AA 事由/户名，不能绕过输出审核。
  const summary = await sanitizeToolOutput(ctx, def.name, pending.summary)
  if (decision.requiresChannelHandoff) {
    return {
      status: 'needs_handoff',
      actionId: pending.actionId,
      level: pending.level,
      reasons: decision.reasons,
      summary,
      url: confirmLink(pending.actionId),
    }
  }
  return { status: 'needs_confirmation', ...pending, summary, reasons: decision.reasons }
}
