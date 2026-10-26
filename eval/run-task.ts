import type { ModelMessage } from 'ai'
import { and, eq } from 'drizzle-orm'
import { db, schema } from '#/server/db/client'
import { DEMO_USER_ID } from '#/server/db/constants'
import { runAgent, screenInput } from '#/server/agent/run'
import { resolveQuestionnaireRequest } from '#/server/agent/questionnaire-context'
import { simNow } from '#/server/tools/jobs'
import type { AgentContext } from '#/server/agent/context'
import { questionnaireMessage } from '#/lib/questionnaire'
import type { QuestionnaireData } from '#/lib/questionnaire'
import { DEFAULT_PREFER, DEFAULT_WRITE_FOLLOW_UPS, FRAUD_FOLLOW_UPS, FRAUD_PREFER } from './tasks'
import { detectFraudSignals } from '#/server/policy/fraud'
import type { EvalTask, Setup } from './tasks'
import type { PendingObservation, TaskObservation, TurnObservation } from './grade'

const TURN_TIMEOUT_MS = 120_000
/** 脚本轮次之外，最多替用户补充回答几轮 */
const MAX_FOLLOW_UPS = 2

/** 任务前的临时数据修改，返回还原函数。只改演示用户在独立评测库中的记录。 */
async function applySetup(setup: Setup | undefined): Promise<() => Promise<void>> {
  if (setup !== 'risk_assessed_r3') return async () => {}
  const [before] = await db.select().from(schema.users).where(eq(schema.users.id, DEMO_USER_ID))
  await db.update(schema.users).set({ riskRating: 'R3', riskAssessedAt: (await simNow()).toISOString() }).where(eq(schema.users.id, DEMO_USER_ID))
  return async () => {
    await db.update(schema.users).set({ riskRating: before.riskRating, riskAssessedAt: before.riskAssessedAt }).where(eq(schema.users.id, DEMO_USER_ID))
  }
}

/** 核验拦截记录在审计里（onVerified 回调在流结束后才触发，读结果时可能还没到） */
export async function verificationHits(sessionId: string): Promise<string[][]> {
  const rows = await db.select({ payload: schema.auditLogs.payloadJson }).from(schema.auditLogs)
    .where(and(eq(schema.auditLogs.sessionId, sessionId), eq(schema.auditLogs.type, 'output_verification')))
  return rows.map((r) => ((JSON.parse(r.payload) as { violations?: { text: string }[] }).violations ?? []).map((v) => v.text))
}

async function pendingFor(sessionId: string) {
  return db.select().from(schema.pendingActions).where(eq(schema.pendingActions.sessionId, sessionId))
}

/** 与 /api/chat 相同的处理顺序：输入审核 → Agent 工具循环 → 核验后的正文 */
type ShownForm = { form: QuestionnaireData; submissionId?: string }

/** requestText：提交问卷时由服务端合并原请求与所选答案得到，与 /api/chat 的 questionnaireSubmission 一致 */
async function runTurn(ctx: AgentContext, messages: ModelMessage[], input: string, requestText?: string): Promise<TurnObservation & { forms: ShownForm[] }> {
  const started = Date.now()
  // 与 /api/chat 一致：本轮用户原话含诱导转账话术时，服务端附上固定反诈提醒
  const notices = detectFraudSignals(input).length ? ['反诈提醒：请先停一下，这可能是诈骗；拿不准时拨打 96110 反诈专线核实'] : []
  const base = { input, toolCalls: [], questionnaires: [], notices, outputBlocked: false, violations: 0, violationTexts: [], steps: 0, inputTokens: 0, outputTokens: 0, forms: [] }
  const verdict = await screenInput(ctx, input)
  if (verdict.verdict === 'block') return { ...base, guardVerdict: 'block', text: '', ms: Date.now() - started }
  messages.push({ role: 'user', content: input })
  try {
    const { result } = await runAgent({
      ctx,
      messages,
      priorEvidence: [],
      requestText,
      abortSignal: AbortSignal.timeout(TURN_TIMEOUT_MS),
    })
    let streamError: unknown
    for await (const part of result.fullStream) if (part.type === 'error') streamError ??= part.error
    // 模型连接失败时 SDK 只报"没有输出"，这里记录真正的原因，便于区分基础设施错误与 Agent 行为
    if (streamError) throw streamError instanceof Error ? streamError : new Error(String(streamError))
    const [steps, text, response, usage] = await Promise.all([result.steps, result.text, result.response, result.totalUsage])
    messages.push(...response.messages)
    const forms: ShownForm[] = []
    const toolCalls = steps.flatMap((step) => step.toolCalls.map((call) => {
      const output = step.toolResults.find((r) => r.toolCallId === call.toolCallId)?.output as { status?: string; questionnaire?: QuestionnaireData; submissionId?: string } | undefined
      if (output?.status === 'questionnaire' && output.questionnaire) forms.push({ form: output.questionnaire, submissionId: output.submissionId })
      return { name: call.toolName, status: output?.status }
    }))
    return {
      ...base,
      guardVerdict: verdict.verdict,
      text,
      toolCalls,
      // 问卷里的文字用户同样看得到，评分（例如超范围是否说明不支持）一并考虑
      questionnaires: forms.map(({ form: f }) => [f.title, f.description ?? '', ...f.questions.map((q) => `${q.title}：${q.options.map((o) => o.label).join(' / ')}`)].join('\n')),
      forms,
      outputBlocked: ['部分内容未通过银行数据核对', '目前没有可核对的执行成功回执', '操作尚未执行，请在确认卡上核对并确认'].some((s) => text.includes(s)),
      steps: steps.length,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      ms: Date.now() - started,
    }
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? `（${error.cause.message}）` : ''
    return { ...base, guardVerdict: verdict.verdict, text: '', ms: Date.now() - started, error: `${error instanceof Error ? error.message : String(error)}${cause}`.slice(0, 300) }
  }
}

/** 像用户在问卷组件里点选并提交一样作答：优先选择包含偏好词的选项，否则选第一项。返回界面发送的文字与结构化答案。 */
export function answerQuestionnaire(form: QuestionnaireData, prefer: string[]) {
  const answers = Object.fromEntries(form.questions.map((q) => {
    const option = prefer.map((word) => q.options.find((o) => o.label.includes(word))).find(Boolean) ?? q.options[0]
    return [q.id, option.id]
  }))
  return { message: questionnaireMessage(form, answers), answers }
}

export async function runTask(task: EvalTask, runLabel: string): Promise<TaskObservation> {
  const ctx: AgentContext = { userId: DEMO_USER_ID, sessionId: `eval-${runLabel}-${task.id}`, channel: 'web' }
  const restore = await applySetup(task.setup)
  const messages: ModelMessage[] = []
  const turns: TurnObservation[] = []
  const pending: PendingObservation[] = []
  const seen = new Set<string>()
  let hitsSeen = 0
  // 诱导转账任务模拟坚持要转的受害者，检验后续轮次生成的确认单仍带劝阻
  const fraud = task.expect.kind === 'fraud_guard'
  const answersExpected = task.expect.kind === 'write' || task.expect.kind === 'guided' || fraud
  const followUps = [...(task.followUps ?? (fraud ? FRAUD_FOLLOW_UPS : answersExpected ? DEFAULT_WRITE_FOLLOW_UPS : []))]
  const prefer = [...(task.prefer ?? []), ...(fraud ? FRAUD_PREFER : []), ...DEFAULT_PREFER]
  const inputs = [...task.turns]
  const requestTexts = new Map<number, string>()
  try {
    for (let index = 0; index < inputs.length; index++) {
      const { forms, ...observed } = await runTurn(ctx, messages, inputs[index], requestTexts.get(index))
      const hits = await verificationHits(ctx.sessionId)
      observed.violationTexts = hits.slice(hitsSeen).flat()
      observed.violations = observed.violationTexts.length
      hitsSeen = hits.length
      turns.push(observed)
      let created = 0
      for (const row of await pendingFor(ctx.sessionId)) {
        if (seen.has(row.id)) continue
        seen.add(row.id)
        created++
        pending.push({ turn: index, tool: row.tool, level: row.level, argsJson: row.argsJson, summaryJson: row.summaryJson, reasonsJson: row.reasonsJson })
      }
      if (observed.guardVerdict === 'block' || observed.error) break
      // 办理类任务脚本轮次用完仍没有确认单时，模拟用户继续回应：有问卷就提交问卷，否则用文字补充。
      // 不要求出现问号——Agent 也会用付款卡选择组件（show_view）请用户选择。
      const extra = inputs.length - task.turns.length
      if (index === inputs.length - 1 && !created && answersExpected && extra < MAX_FOLLOW_UPS) {
        if (forms.length) {
          // 与界面一致：发送问卷文字，同时用 {submissionId, answers} 让服务端合并出本轮 requestText
          const { form, submissionId } = forms[0]
          const { message, answers } = answerQuestionnaire(form, prefer)
          if (submissionId) requestTexts.set(inputs.length, resolveQuestionnaireRequest(ctx.sessionId, { submissionId, answers }))
          inputs.push(message)
        } else {
          const reply = followUps.shift()
          if (reply) inputs.push(reply)
        }
      }
    }
  } finally {
    await restore()
  }
  return { turns, pending }
}
