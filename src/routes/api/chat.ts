import { createFileRoute } from '@tanstack/react-router'
import { createUIMessageStream, createUIMessageStreamResponse, toUIMessageStream } from 'ai'
import { z } from 'zod'
import { BLOCKED_REPLY, runAgent, screenInput } from '#/server/agent/run'
import { historyEvidence, lastUserText } from '#/server/agent/messages'
import type { WencaiUIMessage } from '#/server/agent/messages'
import type { AgentContext } from '#/server/agent/context'
import { getUserId } from '#/server/auth'

const BodySchema = z.object({ id: z.string().min(1).max(100), messages: z.array(z.any()) })

export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = BodySchema.safeParse(await request.json())
        if (!body.success) return new Response('bad request', { status: 400 })
        const messages = body.data.messages as WencaiUIMessage[]
        const ctx: AgentContext = { userId: getUserId(request), sessionId: body.data.id, channel: 'web' }

        const verdict = await screenInput(ctx, lastUserText(messages))

        const stream = createUIMessageStream<WencaiUIMessage>({
          execute: async ({ writer }) => {
            if (verdict.verdict === 'block') {
              writer.write({ type: 'start' })
              writer.write({ type: 'data-blocked', data: { categories: verdict.categories } })
              writer.write({ type: 'text-start', id: 'blocked' })
              writer.write({ type: 'text-delta', id: 'blocked', delta: BLOCKED_REPLY })
              writer.write({ type: 'text-end', id: 'blocked' })
              writer.write({ type: 'finish' })
              return
            }

            const { result, tools } = await runAgent({
              ctx,
              messages,
              priorEvidence: historyEvidence(messages),
              abortSignal: request.signal,
              onVerified: (violations) => {
                if (violations.length) writer.write({ type: 'data-verify', data: { violations } })
              },
            })
            writer.merge(toUIMessageStream({ stream: result.stream, tools }))
          },
          // 详细错误只记服务端日志，不向客户端泄露
          onError: (error) => {
            console.error('[chat]', error)
            return '服务暂时不可用，请稍后再试'
          },
        })
        return createUIMessageStreamResponse({ stream })
      },
    },
  },
})
