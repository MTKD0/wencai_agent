import type { WencaiUIMessage } from '#/server/agent/messages'
import type { PlanState } from '#/server/executor/executor'

/** Keep historical status in place, but put the active confirmation beside the newest receipt. */
export function planPlacements(messages: WencaiUIMessage[]) {
  const plans = new Map<string, PlanState>()
  const atMessage = new Map<string, PlanState[]>()
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const part of message.parts) {
      const state =
        part.type === 'data-plan'
          ? part.data
          : 'output' in part &&
              part.output &&
              typeof part.output === 'object' &&
              'status' in part.output &&
              part.output.status === 'plan' &&
              'state' in part.output
            ? (part.output.state as PlanState)
            : undefined
      if (state?.id && state.nodes && state.plan?.nodes) plans.set(state.id, state)
    }
  }
  const latest = new Map<string, string>()
  const completedActionIds = new Set<string>()
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const part of message.parts) {
      if (part.type !== 'data-confirmation' || part.data.status !== 'completed') continue
      completedActionIds.add(part.data.actionId)
      const progress = 'planProgress' in part.data ? part.data.planProgress : undefined
      const id =
        progress?.planId ??
        [...plans.values()].find((state) =>
          Object.values(state.nodes).some((node) => node.actionId === part.data.actionId),
        )?.id
      if (id && plans.has(id)) latest.set(id, message.id)
    }
  }
  for (const [id, messageId] of latest) atMessage.set(messageId, [...(atMessage.get(messageId) ?? []), plans.get(id)!])
  return { relocated: new Set(latest.keys()), atMessage, completedActionIds }
}
