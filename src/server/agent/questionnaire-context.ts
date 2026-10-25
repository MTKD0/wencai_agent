import { randomUUID } from 'node:crypto'
import { QuestionnaireSchema, QuestionnaireSubmissionSchema, type QuestionnaireData } from '#/lib/questionnaire'
import { getSessionData, putSessionData } from './session'
import { QUESTIONNAIRE_ANSWERS_MARKER } from '#/lib/requested-amounts'

type PendingQuestionnaire = { form: QuestionnaireData; requestText: string; expiresAt: number }

export function rememberQuestionnaire(sessionId: string, input: QuestionnaireData, requestText: string) {
  const submissionId = randomUUID()
  putSessionData(sessionId, `questionnaire:${submissionId}`, {
    form: QuestionnaireSchema.parse(input),
    requestText,
    expiresAt: Date.now() + 30 * 60_000,
  } satisfies PendingQuestionnaire)
  return submissionId
}

/** A distributive answer clarifies the original recipients, rather than turning a question title into a transfer. */
export function applyQuestionnaireAnswers(requestText: string, labels: string[]) {
  const [original, ...priorAnswers] = requestText.split(QUESTIONNAIRE_ANSWERS_MARKER)
  let request = original
  for (const label of labels) {
    const each = label.match(/(?:每人|每位|各)\s*(?:各)?\s*(?:转账|转|支付|付款)?\s*(\d+(?:\.\d{1,2})?)\s*元/)
    if (!each) continue
    request = request.replace(
      /(?:给|向)\s*([^，。；;\n\d]{1,80}?)\s*(?:转账|转)\s*\d+(?:\.\d{1,2})?\s*(?:元|块)?/g,
      (original, names: string) => {
        if (/(?:各|分别|每人)$/.test(names.trim())) return original
        const recipients = names.split(/和|与|及|、/).map((name) => name.trim())
        if (recipients.length < 2 || recipients.some((name) => !name || name.length > 32)) return original
        return recipients.map((name) => `给${name}转${each[1]}元`).join('；')
      },
    )
  }
  return `${request}${QUESTIONNAIRE_ANSWERS_MARKER}${[...priorAnswers, ...labels].join('；')}`
}

export function resolveQuestionnaireRequest(sessionId: string, input: unknown) {
  const submission = QuestionnaireSubmissionSchema.parse(input)
  const stored = getSessionData(sessionId)[`questionnaire:${submission.submissionId}`] as
    PendingQuestionnaire | undefined
  if (!stored || stored.expiresAt <= Date.now()) throw new Error('问卷已失效，请重新发起本次业务')
  if (Object.keys(submission.answers).length !== stored.form.questions.length)
    throw new Error('请完整提交当前问卷的答案')
  const labels = stored.form.questions.map((question) => {
    const selected = question.options.find((option) => option.id === submission.answers[question.id])
    if (!selected) throw new Error('问卷答案不属于当前题目的选项')
    return selected.label
  })
  return applyQuestionnaireAnswers(stored.requestText, labels)
}
