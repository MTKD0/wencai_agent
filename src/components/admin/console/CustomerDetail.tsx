import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CreditCard, Snowflake, UnlockKeyhole } from 'lucide-react'
import { Input } from '#/components/ui/input'
import { adminApi } from '../client'
import { consoleApi, yuan } from './api'
import { LoadState, Section } from './parts'
import { FraudEvents } from './FraudEvents'
import { ProfileDetail } from '../views/Profile'
import { AdminTransactions } from '../views/Transactions'
import { AdminInvestments } from '../views/Investments'
import { AdminSubscriptions } from '../views/Subscriptions'
import { AdminTransfers } from '../views/Transfers'
import { AdminPlans } from '../views/Plans'
import { AdminAudit } from '../views/Audit'
import { Badge, type Section as ViewSection, type ViewProps } from '../shared'
import { localDate } from '../utils'
import type { Go } from './ConsoleApp'

const TABS = [
  { id: 'profile', name: '概况与画像' },
  { id: 'accounts', name: '账户与卡' },
  { id: 'ledger', name: '流水' },
  { id: 'wealth', name: '理财' },
  { id: 'services', name: '订阅与任务' },
  { id: 'fraud', name: '反诈记录' },
  { id: 'audit', name: '操作审计' },
] as const
type Tab = (typeof TABS)[number]['id']
// 复用的旧视图里“查看全部”等跳转，映射到客户详情的页签
const SECTION_TAB: Partial<Record<ViewSection, Tab>> = { transactions: 'ledger', investments: 'wealth', cards: 'accounts', subscriptions: 'services', transfers: 'services', plans: 'services', audit: 'audit', profile: 'profile' }

/** 客户详情：全部只读，工作人员唯一能做的是冻结 / 解冻卡片（须填原因） */
export function CustomerDetail({ userId, tab: rawTab, go }: { userId: string; tab?: string; go: Go }) {
  const tab: Tab = TABS.some((t) => t.id === rawTab) ? rawTab as Tab : 'profile'
  const snapshot = useQuery({ queryKey: ['admin', userId, 'snapshot'], queryFn: () => adminApi.snapshot(userId), refetchInterval: 15_000 })
  const anomalies = useQuery({ queryKey: ['admin', userId, 'anomalies'], queryFn: () => adminApi.anomalies(userId) })
  const period = snapshot.data ? localDate(snapshot.data.now).slice(0, 7) : ''
  const report = useQuery({ queryKey: ['admin', userId, 'report', period], queryFn: () => adminApi.report(userId, period), enabled: !!period && tab === 'ledger' })
  const customers = useQuery({ queryKey: ['admin', 'console', 'customers'], queryFn: consoleApi.customers, staleTime: 30_000 })
  const customer = customers.data?.customers.find((c) => c.id === userId)
  const setTab = (next: Tab) => go({ section: 'customer', userId, tab: next })

  if (!snapshot.data) return <LoadState pending={snapshot.isPending} error={snapshot.error} label="客户数据" retry={() => void snapshot.refetch()} />
  const s = snapshot.data
  const view: ViewProps = { s, ledger: s.transactions, report: report.data, period, anomalies: anomalies.data ?? [], audit: [], go: (section) => setTab(SECTION_TAB[section] ?? 'profile') }

  return <>
    <button type="button" className="button button-ghost button-sm console-back" onClick={() => go({ section: 'customers' })}><ArrowLeft size={14} />客户列表</button>
    <header className="customer-hero panel">
      <span className="customer-avatar">{s.user.name.slice(0, 1)}</span>
      <div className="customer-hero-main">
        <h1>{s.user.name}{customer?.locked && <span className="tone-badge tone-danger">账户锁定</span>}</h1>
        <p>{customer?.phoneMasked ?? '未绑定手机'} · 客户号 {s.user.id} · 风险测评 {s.user.riskLevel}</p>
        <div className="tag-row">{customer?.tags.map((t) => <span key={t.code} className={`tag tag-${t.tone}`}>{t.label}</span>)}</div>
      </div>
      <dl className="customer-hero-stats">
        <div><dt>总资产</dt><dd>{yuan(customer?.totalAssetsCents ?? s.accounts.reduce((sum, a) => sum + a.balanceCents, 0))}</dd></div>
        <div><dt>月均收入</dt><dd>{customer ? yuan(customer.monthlyIncomeCents) : '—'}</dd></div>
        <div><dt>近 30 天转给他人</dt><dd>{customer ? yuan(customer.outflow30dCents) : '—'}</dd></div>
        <div><dt>反诈状态</dt><dd>{customer?.fraud.openTickets ? <span className="tone-badge tone-danger">待回访 {customer.fraud.openTickets}</span> : customer?.fraud.scam30d ? <span className="tone-badge tone-warn">近期命中话术</span> : <span className="tone-badge tone-good">正常</span>}</dd></div>
      </dl>
    </header>
    <nav className="customer-tabs" role="tablist" aria-label="客户信息">
      {TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} type="button" className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
        {t.name}{t.id === 'fraud' && !!customer?.fraud.events30d && <b>{customer.fraud.events30d}</b>}
      </button>)}
    </nav>
    <div className="customer-tab-body readonly-view">
      {tab === 'profile' && <ProfileDetail userId={userId} />}
      {tab === 'accounts' && <AccountsPanel userId={userId} s={s} />}
      {tab === 'ledger' && <AdminTransactions {...view} />}
      {tab === 'wealth' && <AdminInvestments {...view} />}
      {tab === 'services' && <><AdminSubscriptions {...view} /><AdminTransfers {...view} /><AdminPlans {...view} /></>}
      {tab === 'fraud' && <FraudEvents go={go} userId={userId} />}
      {tab === 'audit' && <AdminAudit {...view} />}
    </div>
  </>
}

function AccountsPanel({ userId, s }: { userId: string; s: ViewProps['s'] }) {
  const client = useQueryClient()
  const [pending, setPending] = useState<{ cardId: string; action: 'freeze' | 'unlock'; last4: string } | null>(null)
  const [reason, setReason] = useState('')
  const command = useMutation({
    mutationFn: () => adminApi.command(userId, { type: 'updateCard', cardId: pending!.cardId, action: pending!.action, reason: reason.trim() }),
    onSuccess: () => { setPending(null); setReason(''); void client.invalidateQueries({ queryKey: ['admin'] }) },
  })
  return <div className="two-col">
    <Section title="账户" subtitle="余额为实时账面余额">
      <ul className="account-rows">{s.accounts.map((a) => <li key={a.id}><span>{a.name}</span><b>{yuan(a.balanceCents)}</b></li>)}</ul>
    </Section>
    <Section title="银行卡" subtitle="发现风险时可临时冻结卡片，须填写原因，操作写入审计">
      <div className="card-list">{s.cards.map((c) => <div className="card-item" key={c.id}>
        <div className="card-item-head">
          <CreditCard size={20} />
          <div><strong>{c.remark ? `${c.remark} · ` : ''}{c.kind === 'credit' ? '信用卡' : '储蓄卡'} · 尾号 {c.last4}</strong>
            <small>{c.kind === 'credit' ? `额度 ${yuan(c.creditLimit)} · 待还 ${yuan(c.outstanding)}` : `每日转出限额 ${yuan(c.dailyLimit)}`}</small></div>
          <Badge status={c.status} />
        </div>
        <div className="card-actions">
          {c.status === 'active' && <button type="button" className="button button-outline button-sm" onClick={() => { setPending({ cardId: c.id, action: 'freeze', last4: c.last4 }); setReason('') }}><Snowflake size={14} />临时冻结</button>}
          {c.status === 'locked' && <button type="button" className="button button-outline button-sm" onClick={() => { setPending({ cardId: c.id, action: 'unlock', last4: c.last4 }); setReason('') }}><UnlockKeyhole size={14} />解除冻结</button>}
        </div>
        {pending?.cardId === c.id && <form className="freeze-form" onSubmit={(e) => { e.preventDefault(); if (reason.trim().length >= 2) command.mutate() }}>
          <label><span>{pending.action === 'freeze' ? '冻结' : '解冻'}原因（写入审计）</span>
            <Input autoFocus value={reason} maxLength={100} onChange={(e) => setReason(e.target.value)} placeholder={pending.action === 'freeze' ? '例如：回访确认客户正被诈骗，临时冻结' : '例如：客户已到网点核实身份'} /></label>
          {command.isError && <p className="text-danger">{command.error.message}</p>}
          <div><button type="button" className="button button-ghost button-sm" onClick={() => setPending(null)}>取消</button>
            <button type="submit" className="button button-primary button-sm" disabled={reason.trim().length < 2 || command.isPending}>确认{pending.action === 'freeze' ? '冻结' : '解冻'}尾号 {pending.last4}</button></div>
        </form>}
      </div>)}</div>
    </Section>
  </div>
}
