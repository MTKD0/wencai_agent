import type { ReactNode } from 'react'
import {
  ArrowUpRight,
  ArrowDownLeft,
  Inbox,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react'
import { categories, money, dateTime, statuses, type Ledger } from './utils'
import type { AdminSnapshot } from './client'
import type { AdminActions } from './actions'

export type Section =
  | 'overview'
  | 'transactions'
  | 'transfers'
  | 'investments'
  | 'cards'
  | 'subscriptions'
  | 'plans'
  | 'audit'
  | 'security'

export type ViewProps = {
  s: AdminSnapshot
  ledger: Ledger
  report:
    | {
        period: string
        income: number
        expense: number
        net: number
        transactionCount: number
        categories: Record<string, number>
      }
    | undefined
  period: string
  anomalies: Array<{ id: string; amount: number; merchant: string; category: string; occurredAt: string; reasons: string[]; needsReview: true }>
  audit: Array<{ seq: number; at: string; userId: string; type: string; payloadJson: string }>
  actions: AdminActions
  go: (section: Section) => void
}

export function Panel({
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  title: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export function Empty({
  title = '暂无记录',
  text,
  action,
  icon: Icon = Inbox,
}: {
  title?: string
  text: string
  action?: ReactNode
  icon?: LucideIcon
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={24} strokeWidth={1.5} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  )
}

export function Badge({
  status,
  children,
}: {
  status?: string
  children?: ReactNode
}) {
  return (
    <span className={`badge badge-${status ?? 'neutral'}`}>
      <i />
      {children ?? statuses[status ?? ''] ?? status}
    </span>
  )
}

export function TransactionTable({
  rows,
  anomalyIds = new Set(),
  limit,
}: {
  rows: Ledger
  anomalyIds?: Set<string>
  limit?: number
}) {
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>交易对象 / 时间</th>
            <th>分类</th>
            <th>状态</th>
            <th className="align-right">金额</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, limit).map((t) => (
            <tr key={t.id}>
              <td>
                <div className="transaction-name">
                  <span className={`transaction-icon ${t.amount > 0 ? 'income' : ''}`}>
                    {t.amount > 0 ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
                  </span>
                  <div>
                    <strong>{t.merchant}</strong>
                    <small>{dateTime(t.occurredAt)}</small>
                  </div>
                </div>
              </td>
              <td>
                <span className="category-tag">{categories[t.category] ?? t.category}</span>
              </td>
              <td>
                {anomalyIds.has(t.id) ? (
                  <Badge status="warning">待复核</Badge>
                ) : (
                  <Badge status="active">已入账</Badge>
                )}
              </td>
              <td className={`amount align-right ${t.amount > 0 ? 'text-green' : ''}`}>
                {t.amount > 0 ? '+' : '−'}
                {money(Math.abs(t.amount))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function More({ onClick, children = '查看全部' }: { onClick: () => void; children?: ReactNode }) {
  return (
    <button className="button button-ghost button-sm" onClick={onClick}>
      {children}
      <ChevronRight size={14} />
    </button>
  )
}

export function Metric({
  label,
  value,
  note,
  icon: Icon,
  accent = false,
}: {
  label: string
  value: string
  note: ReactNode
  icon: LucideIcon
  accent?: boolean
}) {
  return (
    <div className={`metric ${accent ? 'metric-accent' : ''}`}>
      <div className="metric-top">
        <span>{label}</span>
        <span className="metric-icon">
          <Icon size={18} />
        </span>
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  )
}
