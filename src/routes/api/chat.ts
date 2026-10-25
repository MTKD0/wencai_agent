import { createFileRoute } from '@tanstack/react-router'
import { createUIMessageStream, createUIMessageStreamResponse, toUIMessageStream } from 'ai'
import { z } from 'zod'
import { BLOCKED_REPLY, runAgent, screenInput } from '#/server/agent/run'
import { historyEvidence, lastUserText } from '#/server/agent/messages'
import type { WencaiUIMessage } from '#/server/agent/messages'
import type { AgentContext } from '#/server/agent/context'
import { interactionReceiptText, resolveInteractionCommand } from '#/server/agent/interaction-command'
import { getConfirmationResult } from '#/server/confirm/result'
import { audit } from '#/server/audit/log'
import { requireSession } from '#/server/session'
import { runtimeLog } from '#/server/logging/runtime'
import { BatchTransferSelectionSchema } from '#/lib/batch-transfer'
import { startSelectedTransferBatch } from '#/server/agent/batch-plan'
import { QuestionnaireSubmissionSchema } from '#/lib/questionnaire'
import { resolveQuestionnaireRequest } from '#/server/agent/questionnaire-context'

// 会话标识由认证会话决定，客户端传来的 id 仅用于兼容 ChatSDK 的传输协议
const BodySchema = z.looseObject({ messages: z.array(z.any()), confirmedActionId: z.string().min(1).max(100).optional(), verificationActionId: z.string().min(1).max(100).optional(), cancelActionId: z.string().min(1).max(100).optional(), transferBatch: BatchTransferSelectionSchema.optional(), questionnaireSubmission: QuestionnaireSubmissionSchema.optional() })
  .refine((body) => [body.confirmedActionId, body.verificationActionId, body.cancelActionId, body.transferBatch, body.questionnaireSubmission].filter(Boolean).length <= 1, '一次只能处理一个消息操作')

export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let session
        try {
          session = await requireSession(request)
        } catch {
          return Response.json({ error: 'unauthorized' }, { status: 401 })
        }
        const body = BodySchema.safeParse(await request.json())
        if (!body.success) return new Response('bad request', { status: 400 })
        const messages = body.data.messages as WencaiUIMessage[]
        const ctx: AgentContext = { userId: session.userId, sessionId: session.sessionId, channel: 'web' }
        let requestText: string | undefined
        if (body.data.questionnaireSubmission) {
          try { requestText = resolveQuestionnaireRequest(ctx.sessionId, body.data.questionnaireSubmission) }
          catch (error) { return Response.json({ error: error instanceof Error ? error.message : '问卷答案无效' }, { status: 400 }) }
        }

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

            if (body.data.transferBatch) {
              const plan = await startSelectedTransferBatch(ctx, body.data.transferBatch, request.signal)
              writer.write({ type: 'start' })
              writer.write({ type: 'data-plan', data: plan })
              writer.write({ type: 'text-start', id: 'batch-plan' })
              writer.write({ type: 'text-delta', id: 'batch-plan', delta: '已登记逐笔办理任务。请核对当前确认单并在独立安全页验证；完成后会自动展示下一笔确认单，每笔都需单独验证。' })
              writer.write({ type: 'text-end', id: 'batch-plan' })
              writer.write({ type: 'finish' })
              return
            }
            const actionId = await resolveInteractionCommand(ctx, body.data)
            if (actionId && (body.data.verificationActionId || body.data.cancelActionId)) {
              const receipt = await getConfirmationResult(ctx.userId, actionId)
              await audit(ctx, 'agent_interaction', { actionId, intent: body.data.cancelActionId ? 'cancel' : 'verify', status: receipt.status })
              writer.write({ type: 'start' })
              writer.write({ type: 'data-confirmation', data: receipt })
              writer.write({ type: 'text-start', id: 'interaction' })
              writer.write({ type: 'text-delta', id: 'interaction', delta: interactionReceiptText(receipt) })
              writer.write({ type: 'text-end', id: 'interaction' })
              writer.write({ type: 'finish' })
              return
            }
            const { result, tools, confirmation } = await runAgent({
              ctx,
              messages,
              priorEvidence: historyEvidence(messages),
              abortSignal: request.signal,
              confirmedActionId: actionId,
              requestText,
              onVerified: (violations) => {
                if (violations.length) writer.write({ type: 'data-verify', data: { violations } })
              },
            })
            if (confirmation) {
              writer.write({ type: 'start' })
              writer.write({ type: 'data-confirmation', data: confirmation })
            }
            writer.merge(toUIMessageStream({ stream: result.stream, tools, sendStart: !confirmation }))
          },
          // 详细错误只记服务端日志，不向客户端泄露
          onError: (error) => {
            runtimeLog('error', 'agent', `对话处理失败：${error instanceof Error ? error.message : '未知错误'}`)
            console.error('[chat]', error)
            return '服务暂时不可用，请稍后再试'
          },
        })
        return createUIMessageStreamResponse({ stream })
      },
    },
  },
})
