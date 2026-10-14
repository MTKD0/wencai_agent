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
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card'
import { Badge as ShadcnBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from 'cn'

export type Section =
  | 'overview'
  | 'transactions'
  | 'transfers'
  | 'investments'
  | 'cards'
  | 'subscriptions'
  | 'plans'
  | 'security'
  | 'risk-review'
  | 'profile'
  | 'audit'

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
    <Card className={cn('overflow-hidden border-border/80 shadow-xs bg-card/90 transition-all', className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 px-6 py-4.5 border-b border-border/50">
        <div>
          <CardTitle className="text-base font-semibold text-foreground tracking-tight">{title}</CardTitle>
          {subtitle && <CardDescription className="text-xs text-muted-foreground mt-0.5">{subtitle}</CardDescription>}
        </div>
        {action}
      </CardHeader>
      <CardContent className="p-6">{children}</CardContent>
    </Card>
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
    <div className="flex flex-col items-center justify-center p-8 text-center rounded-xl border border-dashed border-border/70 bg-muted/20">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground mb-3">
        <Icon size={22} strokeWidth={1.75} />
      </div>
      <h3 className="text-sm font-semibold text-foreground m-0 mb-1">{title}</h3>
      <p className="text-xs text-muted-foreground m-0 max-w-sm mb-4">{text}</p>
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
  const variant =
    status === 'active' || status === 'completed'
      ? 'default'
      : status === 'warning' || status === 'frozen'
        ? 'destructive'
        : 'secondary'

  return (
    <ShadcnBadge variant={variant} className="text-xs font-medium px-2 py-0.5 rounded-full">
      {children ?? statuses[status ?? ''] ?? status}
    </ShadcnBadge>
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
    <div className="rounded-xl border border-border/80 overflow-hidden bg-background">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30">
            <TableHead className="font-semibold text-xs">交易对象 / 时间</TableHead>
            <TableHead className="font-semibold text-xs">分类</TableHead>
            <TableHead className="font-semibold text-xs">状态</TableHead>
            <TableHead className="font-semibold text-xs text-right">金额</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, limit).map((t) => (
            <TableRow key={t.id} className="hover:bg-muted/40 transition-colors">
              <TableCell>
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold',
                      t.amount > 0 ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {t.amount > 0 ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
                  </div>
                  <div>
                    <div className="font-medium text-sm text-foreground">{t.merchant}</div>
                    <div className="text-[11px] text-muted-foreground">{dateTime(t.occurredAt)}</div>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <span className="inline-block rounded-md bg-secondary/80 px-2 py-0.5 text-xs text-secondary-foreground font-medium">
                  {categories[t.category] ?? t.category}
                </span>
              </TableCell>
              <TableCell>
                {anomalyIds.has(t.id) ? (
                  <Badge status="warning">待复核</Badge>
                ) : (
                  <Badge status="active">已入账</Badge>
                )}
              </TableCell>
              <TableCell className="text-right font-mono font-medium text-sm">
                <span className={t.amount > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground'}>
                  {t.amount > 0 ? '+' : '−'}
                  {money(Math.abs(t.amount))}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function More({ onClick, children = '查看全部' }: { onClick: () => void; children?: ReactNode }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} className="h-8 gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
      {children}
      <ChevronRight size={14} />
    </Button>
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
    <Card
      className={cn(
        'overflow-hidden transition-all shadow-xs',
        accent
          ? 'bg-primary text-primary-foreground border-primary/20'
          : 'bg-card text-card-foreground border-border/80 hover:border-border'
      )}
    >
      <CardContent className="p-5 flex flex-col justify-between h-full space-y-3">
        <div className="flex items-center justify-between text-xs font-medium">
          <span className={accent ? 'text-primary-foreground/80' : 'text-muted-foreground'}>{label}</span>
          <div className={cn('p-1.5 rounded-lg', accent ? 'bg-primary-foreground/10 text-primary-foreground' : 'bg-muted text-muted-foreground')}>
            <Icon size={16} />
          </div>
        </div>
        <div>
          <div className="text-2xl font-bold tracking-tight font-mono">{value}</div>
          <div className={cn('text-xs mt-1 flex items-center gap-1.5', accent ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
            {note}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
