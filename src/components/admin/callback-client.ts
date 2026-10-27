/** 反诈回访使用独立管理接口；结论只作用于冷静期中的那一笔转账 */
export type CallbackOutcome = 'confirmed_safe' | 'confirmed_scam' | 'unreachable'
export type CallbackTicket = {
  ticketId: string
  userId: string
  userName: string
  actionId: string
  reasons: string[]
  amountCents: number
  payeeName: string
  status: 'open' | 'closed'
  outcome?: CallbackOutcome
  note?: string
  createdAt: string
  updatedAt: string
  hold?: { holdId: string; status: 'held' | 'releasing' | 'released' | 'cancelled' | 'failed'; releaseAt: string; resolvedBy?: string }
}
export type CallbackOverview = { tickets: CallbackTicket[]; summary: { open: number; held: number; cancelled: number; released: number }; generatedAt: string }

function accessHeaders(): Record<string, string> {
  const token = typeof window === 'undefined' ? null : sessionStorage.getItem('wencai_admin_token')
  return token ? { authorization: `Bearer ${token}` } : {}
}

async function request<T>(body?: { ticketId: string; outcome: CallbackOutcome; note?: string }): Promise<T> {
  const response = await fetch('/api/admin-callbacks', {
    method: body ? 'POST' : 'GET',
    headers: { ...accessHeaders(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.error?.message ?? '无法连接回访服务，请重试')
  if (!data || !('data' in data)) throw new Error('回访服务返回了无效数据，请重试')
  return data.data as T
}

export const callbackApi = {
  list: () => request<CallbackOverview>(),
  resolve: (body: { ticketId: string; outcome: CallbackOutcome; note?: string }) => request<CallbackTicket>(body),
}
