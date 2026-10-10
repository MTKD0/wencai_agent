/** @jsxImportSource chat */
import { Actions, Button, Card, CardText, Chat, Field, Fields } from 'chat'
import { createMemoryState } from '@chat-adapter/state-memory'
import { createLarkAdapter } from '@larksuite/vercel-chat-adapter'
import type { ModelMessage } from 'ai'
import { BLOCKED_REPLY, runAgent, screenInput } from '#/server/agent/run'
import type { AgentContext } from '#/server/agent/context'
import { cancelPending, confirmPending } from '#/server/confirm/pending'
import { DEMO_USER_ID } from '#/server/db/constants'
import { resolveTool } from '#/server/tools/bank'
import type { ToolOutcome } from '#/server/tools/define'

/**
 * 飞书渠道。能力上限为 🟡：黄色操作用卡片按钮就地确认；
 * 🔴 操作由策略引擎标记 requiresChannelHandoff，返回 H5 链接完成强验证。
 */

/** TODO: 飞书账号与银行用户的绑定（OAuth + 一次性绑定码）。未绑定用户不得访问任何数据。 */
function bankUserFor(_larkUserId: string): string | null {
  return DEMO_USER_ID
}

// 骨架阶段：每个会话线程的模型消息历史保存在内存
const histories = new Map<string, ModelMessage[]>()

export function createLarkBot() {
  const bot = new Chat({
    userName: process.env.LARK_BOT_USERNAME ?? 'wencai',
    adapters: { lark: createLarkAdapter() },
    state: createMemoryState(),
  })

  const handle = async (thread: Parameters<Parameters<typeof bot.onDirectMessage>[0]>[0], message: { text: string; author: { userId: string } }) => {
    const userId = bankUserFor(message.author.userId)
    if (!userId) {
      await thread.post('请先在文财 App 中绑定飞书账号。')
      return
    }
    const ctx: AgentContext = { userId, sessionId: `lark:${thread.id}`, channel: 'lark' }
    const verdict = await screenInput(ctx, message.text)
    if (verdict.verdict === 'block') {
      await thread.post(BLOCKED_REPLY)
      return
    }

    const history = histories.get(thread.id) ?? []
    history.push({ role: 'user', content: message.text })
    const { result } = await runAgent({ ctx, messages: history, priorEvidence: [message.text], abortSignal: thread.signal })
    await thread.post(result.fullStream)

    const response = await result.response
    history.push(...response.messages)
    histories.set(thread.id, history.slice(-30))

    for (const step of await result.steps) {
      for (const r of step.toolResults) await postOutcomeCard(thread, r.output as ToolOutcome)
    }
  }

  bot.onDirectMessage(handle)
  bot.onNewMention(async (thread, message) => {
    await thread.subscribe()
    await handle(thread, message)
  })
  bot.onSubscribedMessage(handle)

  bot.onAction(['confirm', 'cancel'], async (event) => {
    const userId = bankUserFor(event.user.userId)
    if (!userId || !event.value || !event.thread) return
    const ctx: AgentContext = { userId, sessionId: `lark:${event.threadId}`, channel: 'lark' }
    if (event.actionId === 'cancel') {
      await cancelPending(ctx, event.value)
      await event.thread.post('已取消。')
      return
    }
    // confirmPending 会校验点击者即操作所属用户、完整性、时效与一次性
    const res = await confirmPending({ ctx, actionId: event.value, resolveTool })
    await event.thread.post(res.ok ? '✅ 操作已完成。' : `未能完成：${res.message}`)
  })

  return bot
}

async function postOutcomeCard(thread: { post: (m: never) => Promise<unknown> }, outcome: ToolOutcome | undefined) {
  if (!outcome || typeof outcome !== 'object') return
  if (outcome.status === 'needs_confirmation') {
    await thread.post(
      (
        <Card title={outcome.summary.title} subtitle={outcome.reasons.join('；') || '请核对后确认'}>
          <Fields>
            {outcome.summary.fields.map((f) => (
              <Field label={f.label} value={f.value} />
            ))}
          </Fields>
          <Actions>
            <Button id="confirm" value={outcome.actionId} style="primary">确认</Button>
            <Button id="cancel" value={outcome.actionId} style="danger">取消</Button>
          </Actions>
        </Card>
      ) as never,
    )
  } else if (outcome.status === 'needs_handoff') {
    await thread.post(
      (
        <Card title={outcome.summary.title} subtitle="该操作需要在 App 内完成强验证">
          <CardText>{outcome.reasons.join('；')}</CardText>
          <CardText>{`[前往验证](${outcome.url})`}</CardText>
        </Card>
      ) as never,
    )
  }
}
