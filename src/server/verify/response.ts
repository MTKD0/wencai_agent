import type { StreamTextTransform, ToolSet } from 'ai'
import { collectEvidence, verifyNumbers } from './numbers'
import { verifyTransactionReferences } from './transactions'
import { audit } from '#/server/audit/log'
import type { AgentContext } from '#/server/agent/context'

const successClaim = /(?:已(?:经)?(?:成功)?(?:完成)?(?:转账|转出|扣款|付款|还款|申购|赎回|挂失|解锁|冻结|开卡|取消订阅)|(?:转账|还款|申购|赎回|挂失|解锁|冻结|开卡|取消订阅)(?:已)?(?:成功|完成)|(?:操作|业务|交易)已经?(?:完成|成功))/
const violationsOf = (text: string, evidence: unknown[]) => [...verifyNumbers(text, collectEvidence(evidence), evidence), ...verifyTransactionReferences(text, evidence)]
export const OMITTED_NOTE = '（个别无法与银行数据核对的数字已省略，请以页面显示的数据为准。）'

/**
 * 只删掉含未核实数字的句子（或表格行）：模型自己心算出的合计常常只占一句，整段替换会让用户什么也看不到。
 * 删完后整段重新核验，仍有问题、或剩下的内容太少，才换成固定提示。保留下来的每个数字都有出处。
 */
function withoutUnverifiedSentences(text: string, evidence: unknown[]) {
  const pieces = text.split(/(?<=[。！？!?；;\n])/)
  const kept = pieces.filter((piece) => !violationsOf(piece, evidence).length).join('').trim()
  if (kept.replace(/[\s*#>|\-：:，,。]/g, '').length < 12 || violationsOf(kept, evidence).length) return undefined
  return `${kept}\n\n${OMITTED_NOTE}`
}

export function checkedResponse(text: string, evidence: unknown[], completed: boolean, pending: boolean) {
  const violations = violationsOf(text, evidence)
  if (successClaim.test(text) && !completed) return { text: pending ? '操作尚未执行，请在确认卡上核对并确认。' : '目前没有可核对的执行成功回执，请先查询或发起对应操作。', violations, blocked: true }
  if (violations.length) {
    const partial = withoutUnverifiedSentences(text, evidence)
    return partial ? { text: partial, violations, blocked: true, partial: true } : { text: '部分内容未通过银行数据核对，已停止展示。请以已显示的账户数据和操作卡片为准。', violations, blocked: true }
  }
  return { text, violations, blocked: false }
}

/** 工具进度仍流式展示，模型正文先核验再发送，避免错误文字先到用户端。 */
export function verifiedOutputTransform(ctx: AgentContext, initialEvidence: unknown[], completed = false): StreamTextTransform<ToolSet> {
  return () => {
    const buffers = new Map<string, string>(), evidence = [...initialEvidence]
    let pending = false, questionnaire = false
    return new TransformStream({
      async transform(part, controller) {
        if (part.type === 'tool-result') {
          evidence.push(part.output)
          const output = part.output as { status?: string }
          if (['needs_confirmation', 'needs_handoff'].includes(output?.status ?? '')) pending = true
          if (output?.status === 'plan') pending = true
          if (part.toolName === 'ask_questions' && output?.status === 'questionnaire') questionnaire = true
        }
        if (part.type === 'text-delta') { buffers.set(part.id, (buffers.get(part.id) ?? '') + part.text); return }
        if (part.type === 'text-end') {
          const text = buffers.get(part.id) ?? ''
          const visibleText = questionnaire && !pending ? '请在上方问卷中选择并提交答案，我会根据你的选择继续办理。' : text.slice(0, 40_000)
          const result = checkedResponse(visibleText, evidence, completed, pending)
          if (result.blocked) await audit(ctx, 'output_verification', { blocked: true, ...('partial' in result ? { partial: true } : {}), violations: result.violations, reason: successClaim.test(text) && !completed ? 'unverified_execution_claim' : 'unsupported_numbers' })
          controller.enqueue({ type: 'text-delta', id: part.id, text: result.text })
          buffers.delete(part.id)
        }
        controller.enqueue(part)
      },
    })
  }
}
