import { convertToModelMessages, isStepCount, streamText } from 'ai'
import type { ModelMessage, UIMessage } from 'ai'
import { audit } from '#/server/audit/log'
import { guard } from '#/server/guard'
import type { GuardVerdict } from '#/server/guard'
import { primaryModel } from '#/server/llm/models'
import { collectEvidence, verifyNumbers } from '#/server/verify/numbers'
import type { NumberViolation } from '#/server/verify/numbers'
import type { AgentContext } from './context'
import { buildInstructions } from './instructions'
import { buildAgentTools } from './tools'

export const BLOCKED_REPLY = '抱歉，这条消息包含试图改变我工作规则的内容，我无法处理。如需办理业务，请直接描述您的需求。'

/** 入口审核：block 的消息不进入模型，直接确定性拒答 */
export async function screenInput(ctx: AgentContext, text: string): Promise<GuardVerdict> {
  await audit(ctx, 'user_input', { text })
  const verdict = await guard.check(text, 'user')
  await audit(ctx, 'guard_verdict', verdict)
  return verdict
}

export async function runAgent(params: {
  ctx: AgentContext
  messages: UIMessage[] | ModelMessage[]
  /** 历史中的数据（用户输入、历史工具结果），作为数字校验的补充出处 */
  priorEvidence: unknown[]
  onVerified?: (violations: NumberViolation[]) => void
  abortSignal?: AbortSignal
}) {
  const { ctx } = params
  const tools = buildAgentTools(ctx)
  const messages = isUIMessages(params.messages)
    ? await convertToModelMessages(params.messages, { tools, ignoreIncompleteToolCalls: true })
    : params.messages
  const result = streamText({
    model: primaryModel(),
    instructions: buildInstructions(ctx),
    messages,
    tools,
    stopWhen: isStepCount(8),
    temperature: 0.2,
    abortSignal: params.abortSignal,
    onEnd: async ({ text, steps }) => {
      const evidence = collectEvidence([
        ...params.priorEvidence,
        ...steps.flatMap((s) => s.toolResults.map((r) => r.output)),
      ])
      const violations = verifyNumbers(text, evidence)
      if (violations.length) await audit(ctx, 'output_verification', { violations })
      params.onVerified?.(violations)
    },
  })
  return { result, tools }
}

function isUIMessages(messages: UIMessage[] | ModelMessage[]): messages is UIMessage[] {
  return messages.length > 0 && 'parts' in messages[0]
}
