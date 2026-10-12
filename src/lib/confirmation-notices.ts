export interface ConfirmationNotice { actionId: string; userId: string }
const EVENT = 'wencai-action-confirmed'

/** 仅通知操作编号和归属，不传播密码、签名或账户明细；服务端仍须查询执行回执。 */
export function notifyConfirmation(notice: ConfirmationNotice) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(EVENT, { detail: notice }))
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(EVENT)
    channel.postMessage(notice)
    channel.close()
  }
}

export function subscribeConfirmations(listener: (notice: ConfirmationNotice) => void) {
  const receive = (notice: unknown) => {
    if (!notice || typeof notice !== 'object') return
    const data = notice as Partial<ConfirmationNotice>
    if (typeof data.actionId === 'string' && typeof data.userId === 'string') listener(data as ConfirmationNotice)
  }
  const local = (event: Event) => receive((event as CustomEvent).detail)
  window.addEventListener(EVENT, local)
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(EVENT) : undefined
  if (channel) channel.onmessage = (event) => receive(event.data)
  return () => { window.removeEventListener(EVENT, local); channel?.close() }
}
