import type { UIMessage } from 'ai'
import type { NumberViolation } from '#/server/verify/numbers'

/** UI 消息上的自定义数据部件 */
export type WencaiUIMessage = UIMessage<
  never,
  {
    verify: { violations: NumberViolation[] }
    blocked: { categories: string[] }
  }
>

export function lastUserText(messages: UIMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === 'user')
  return (
    last?.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('\n') ?? ''
  )
}

/** 历史消息中的用户文本与工具输出，作为数字校验的出处 */
export function historyEvidence(messages: UIMessage[]): unknown[] {
  const out: unknown[] = []
  for (const m of messages) {
    for (const p of m.parts) {
      if (p.type === 'text' && m.role === 'user') out.push(p.text)
      else if (p.type.startsWith('tool-') && 'output' in p) out.push(p.output)
    }
  }
  return out
}
