/**
 * 管理后台 API 客户端（对接 /api/admin）
 */

export type AdminUser = {
  id: string
  name: string
  phoneNumber: string | null
  accountCount: number
  balanceCents: number
  riskLevel: string
  locked: boolean
}

export type AdminSnapshot = {
  now: string
  user: { id: string; name: string; riskLevel: string; riskAssessedAt: string | null }
  account: { id: string; name: string; balance: number; available: number; held: number }
  accounts: Array<{ id: string; name: string; balanceCents: number; balance: number; available: number }>
  contacts: Array<{ id: string; name: string; phone: string; note: string; bank: string; accountMask: string }>
  cards: Array<{ id: string; accountId: string; remark: string; last4: string; kind: string; status: string; dailyLimit: number; creditLimit: number; outstanding: number; onlineEnabled: boolean }>
  products: Array<{ id: string; name: string; riskLevel: string; minAmount: number; annualRate: number; lockDays: number; description: string }>
  holdings: Array<{ id: string; productId: string; principal: number; redeemableAt: string }>
  subscriptions: Array<{ id: string; merchant: string; amount: number; cycle: string; status: string; nextChargeAt: string | null; remindDays: number; lastReminderAt: string | null }>
  tasks: Array<{ id: string; kind: string; status: string; dueAt: string; payload: Record<string, unknown>; result: Record<string, unknown> | null }>
  splits: Array<{ id: string; title: string; total: number; shares: Array<{ contactId: string; amount: number; status: string }>; selfAmount: number; createdAt: string }>
  plans: Array<{ id: string; contactId: string; birthday: string; budget: number; status: string; createdAt: string }>
  orders: Array<{ id: string; planId: string; merchant: string; item: string; amount: number; deliveryDate: string; status: string }>
  transactions: Array<{ id: string; accountId: string; amount: number; merchant: string; category: string; occurredAt: string; reference: string; subscriptionId: string | null }>
  auditLogs: Array<{ seq: number; at: string; userId: string; sessionId: string; channel: string; type: string; payloadJson: string; hash: string }>
}

export type AdminReport = {
  period: string
  income: number
  expense: number
  net: number
  transactionCount: number
  categories: Record<string, number>
  excludedCategories: string[]
}

export type AdminAnomaly = {
  id: string
  amount: number
  merchant: string
  category: string
  occurredAt: string
  reasons: string[]
  needsReview: true
}

export type AdminCommand =
  | { type: 'transfer'; recipient: string; amount: number; memo?: string; executeAt?: string }
  | { type: 'createSplit'; title: string; total: number; contactIds: string[] }
  | { type: 'settleSplit'; splitId: string; contactId: string }
  | { type: 'cancelTask'; taskId: string }
  | { type: 'assessRisk'; answers: number[] }
  | { type: 'purchase'; productId: string; amount: number }
  | { type: 'redeem'; holdingId: string; amount: number }
  | { type: 'applyCard'; kind: 'debit' | 'credit' }
  | { type: 'cardRemark'; cardId: string; remark: string }
  | { type: 'creditSpend'; cardId: string; amount: number; merchant: string }
  | { type: 'updateCard'; cardId: string; action: 'freeze' | 'unlock' | 'reportLost' | 'limits'; dailyLimit?: number; onlineEnabled?: boolean }
  | { type: 'cancelSubscription'; subscriptionId: string }
  | { type: 'subscriptionReminder'; subscriptionId: string; days: number }
  | { type: 'birthdayPlan'; contactId: string; birthday: string; budget: number }
  | { type: 'cancelPlan'; planId: string }
  | { type: 'advanceClock'; to: string }
  | { type: 'runJobs' }

export class AdminApiError extends Error {
  constructor(public code: string, message: string) { super(message) }
}

const BASE = '/api/admin'

async function get<T>(action: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams({ action, ...params }).toString()
  const res = await fetch(`${BASE}?${qs}`)
  const body = await res.json()
  if (!res.ok) throw new AdminApiError(body.error?.code ?? 'ERROR', body.error?.message ?? res.statusText)
  return body.data as T
}

async function post<T>(userId: string, command: AdminCommand): Promise<T> {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-user': userId },
    body: JSON.stringify(command),
  })
  const body = await res.json()
  if (!res.ok) throw new AdminApiError(body.error?.code ?? 'ERROR', body.error?.message ?? res.statusText)
  return body.data as T
}

export const adminApi = {
  users: () => get<AdminUser[]>('users'),
  snapshot: (userId: string) => get<AdminSnapshot>('snapshot', { userId }),
  report: (userId: string, period: string) => get<AdminReport>('report', { userId, period }),
  anomalies: (userId: string) => get<AdminAnomaly[]>('anomalies', { userId }),
  command: (userId: string, cmd: AdminCommand) => post<unknown>(userId, cmd),
}
