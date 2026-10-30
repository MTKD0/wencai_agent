/** 工作人员后台的全局接口：登录会话、工作台、反诈识别事件、客户列表 */
import type { CallbackTicket } from '../callback-client'

export type StaffSession = { authorized: boolean; staff: { id: string; name: string; role: 'agent' | 'supervisor' | 'system'; username?: string } | null; demoMode: boolean }
export type FraudLayer = 'keyword' | 'model' | 'behavior'
export type FraudOutcome = 'awaiting' | 'abandoned' | 'held' | 'released' | 'hold_cancelled' | 'failed' | 'executed'
export type FraudEvent = {
  id: string; userId: string; userName: string; phone: string | null; actionId: string; tool: string; amountCents: number; payeeName: string
  layers: FraudLayer[]; signals: { id: string; text: string }[]; evidence?: string; behavior: { id: string; text: string }[]
  baseline?: { medianOutCents: number | null; sampleCount: number; liquidBalanceCents: number; monthlyIncomeCents: number; payeePaidBefore?: boolean }
  reasons: string[]; createdAt: string; outcome: FraudOutcome; outcomeText: string
  hold?: { holdId: string; status: string; releaseAt: string; resolvedBy?: string }
  ticket?: { ticketId: string; status: string; outcome?: string; handledBy?: string; attempts: number }
}
export type FraudStats = {
  today: { detected: number; scamScripts: number; abandoned: number; protectedCents: number }
  total: { detected: number; protectedCents: number; heldCents: number; stopRate: number | null }
  byLayer: { layer: FraudLayer; count: number }[]
  byOutcome: { outcome: FraudOutcome; text: string; count: number }[]
  trend: { date: string; detected: number; scam: number; protectedCents: number }[]
}
export type Dashboard = {
  now: string
  customers: { count: number; totalBalanceCents: number; locked: number }
  callbacks: { open: number; queue: (CallbackTicket & { handledBy?: string; attempts?: number })[] }
  riskFlags: { suspected: number; confirmed: number }
  fraud: FraudStats
  recentEvents: FraudEvent[]
}
export type Customer = {
  id: string; name: string; phoneMasked: string | null; accountCount: number; balanceCents: number; riskLevel: string; locked: boolean
  totalAssetsCents: number; monthlyIncomeCents: number; monthlyExpenseCents: number; tags: { code: string; label: string; tone: 'good' | 'warn' | 'info' }[]
  outflow30dCents: number; fraud: { events30d: number; scam30d: number; openTickets: number; heldCents: number }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(body?.error?.message ?? '后台服务暂时不可用，请重试') as Error & { status?: number }
    error.status = response.status
    throw error
  }
  return body.data as T
}

export const consoleApi = {
  session: () => call<StaffSession>('/api/admin-session'),
  login: (username: string, password: string) => call<{ staff: StaffSession['staff'] }>('/api/admin-session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) }),
  logout: () => call<{ ok: true }>('/api/admin-session', { method: 'DELETE' }),
  dashboard: () => call<Dashboard>('/api/admin-console?view=dashboard'),
  fraud: (userId?: string) => call<{ events: FraudEvent[]; stats: FraudStats; generatedAt: string }>(`/api/admin-console?view=fraud${userId ? `&userId=${encodeURIComponent(userId)}` : ''}`),
  customers: () => call<{ customers: Customer[]; generatedAt: string }>('/api/admin-console?view=customers'),
  agent: () => call<AgentPause>('/api/admin-agent'),
  setAgent: (paused: boolean, reason: string) => call<AgentPause>('/api/admin-agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paused, reason }) }),
}

export type AgentPause = { paused: boolean; reason?: string; by?: string; at?: string }

export const LAYER_TEXT: Record<FraudLayer, string> = { keyword: '关键词话术', model: '模型判断', behavior: '行为画像' }
export const yuan = (cents: number) => `¥${(cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
export const compactYuan = (cents: number) => cents >= 1_000_000 ? `¥${(cents / 1_000_000).toLocaleString('zh-CN', { maximumFractionDigits: 1 })}万` : yuan(cents)
export const OUTCOME_TONE: Record<FraudOutcome, 'danger' | 'warn' | 'good' | 'muted'> = {
  awaiting: 'warn', held: 'danger', abandoned: 'good', hold_cancelled: 'good', released: 'muted', executed: 'muted', failed: 'muted',
}

/** 距冷静期到期还有多久（按业务时钟） */
export function countdown(releaseAt: string, now: string) {
  const ms = Date.parse(releaseAt) - Date.parse(now)
  if (ms <= 0) return { text: '已到期', urgent: true }
  const hours = Math.floor(ms / 3_600_000), minutes = Math.floor((ms % 3_600_000) / 60_000)
  return { text: hours ? `${hours} 小时 ${minutes} 分后到期` : `${minutes} 分钟后到期`, urgent: ms < 6 * 3_600_000 }
}
