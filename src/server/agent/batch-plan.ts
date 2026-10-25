import { BatchTransferSelectionSchema, type BatchTransferReady } from '#/lib/batch-transfer'
import type { AgentContext } from './context'
import { getSessionData } from './session'
import { startPlan } from '#/server/executor/service'
import type { Plan } from '#/server/planner/dag'

/** Choices reference a server-owned draft. Amounts, accounts and ordering never come from the client. */
export function selectedTransferPlan(batch: BatchTransferReady, input: unknown): Plan {
  const selection = BatchTransferSelectionSchema.parse(input)
  if (batch.batchId !== selection.batchId) throw new Error('转账批次已失效，请重新查询')
  const card = batch.cards.find((item) => item.id === selection.cardId)
  if (!card?.accountId) throw new Error('付款卡不属于本次候选，请重新查询')
  if (
    selection.recipients.length !== batch.recipients.length ||
    new Set(selection.recipients.map((item) => item.stepId)).size !== batch.recipients.length
  )
    throw new Error('请逐笔确认全部收款人')
  return {
    goal: `依次办理 ${batch.recipients.length} 笔转账`,
    nodes: batch.recipients.map((group, index) => {
      const selected = selection.recipients.find((item) => item.stepId === group.stepId)
      const payee = group.candidates.find((item) => item.id === selected?.payeeId)
      if (!payee) throw new Error(`第${index + 1}笔收款人不属于本次候选`)
      return {
        id: `transfer_${index + 1}`,
        kind: 'tool',
        tool: 'transfer',
        args: {
          fromAccountId: card.accountId,
          payeeId: payee.id,
          amount: Number(group.amount),
          ...(batch.interaction.steps?.[index]?.fields.note
            ? { memo: batch.interaction.steps[index].fields.note }
            : {}),
        },
        dependsOn: index ? [`transfer_${index}`] : [],
        note: `第${index + 1}笔 · 转账 ${group.amount} 元`,
      }
    }),
  }
}

export async function startSelectedTransferBatch(ctx: AgentContext, input: unknown, signal?: AbortSignal) {
  const selection = BatchTransferSelectionSchema.parse(input)
  const batch = getSessionData(ctx.sessionId)[`transfer_batch:${selection.batchId}`] as BatchTransferReady | undefined
  if (!batch || batch.status !== 'batch_transfer_ready') throw new Error('转账批次已失效，请重新查询并核对收款人')
  const result = await startPlan(
    ctx,
    selectedTransferPlan(batch, selection),
    new Set(['transfer']),
    signal,
    `plan_batch_${batch.batchId}`,
  )
  if (!result.ok) throw new Error(result.errors.join('；'))
  return result.state
}
