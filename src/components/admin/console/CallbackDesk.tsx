import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Eye, PhoneCall, PhoneOff, ShieldCheck, ShieldX, UserRound } from 'lucide-react'
import { callbackApi, type CallbackOutcome, type CallbackTicket } from '../callback-client'
import { consoleApi, countdown, yuan } from './api'
import { EventDetail } from './FraudEvents'
import { LoadState } from './parts'
import { dateTime } from '../utils'
import type { Go } from './ConsoleApp'

type Ticket = CallbackTicket & { handledBy?: string; attempts?: number }
const OUTCOME_TEXT: Record<CallbackOutcome, string> = { confirmed_safe: '确认安全', confirmed_scam: '确认诈骗', unreachable: '未联系上' }

/** 回访核实清单：参照常见电信诈骗类型。勾选只帮助坐席判断，结论仍由坐席选择 */
const CHECKS = [
  { id: 'authority', text: '有人自称公检法、银行客服、领导或熟人，让客户转账', risk: true },
  { id: 'secret', text: '对方要求保密，不让告诉家人或银行', risk: true },
  { id: 'account', text: '收款方是“安全账户”、陌生个人，或客户从未转过钱的账户', risk: true },
  { id: 'lure', text: '承诺高收益、返利、中奖，或要求先交手续费、保证金、解冻费', risk: true },
  { id: 'remote', text: '让客户下载会议软件、共享屏幕或提供验证码', risk: true },
  { id: 'clear', text: '客户能说清收款人身份和这笔钱的用途，并有凭证（合同、发票等）', risk: false },
]

export function CallbackDesk({ go, selected }: { go: Go; selected?: string }) {
  const client = useQueryClient()
  const tickets = useQuery({ queryKey: ['admin', 'callbacks'], queryFn: callbackApi.list, refetchInterval: 10_000 })
  const events = useQuery({ queryKey: ['admin', 'console', 'fraud', 'all'], queryFn: () => consoleApi.fraud(), refetchInterval: 15_000 })
  const customers = useQuery({ queryKey: ['admin', 'console', 'customers'], queryFn: consoleApi.customers, staleTime: 30_000 })
  const dashboard = useQuery({ queryKey: ['admin', 'console', 'dashboard'], queryFn: consoleApi.dashboard, refetchInterval: 15_000 })
  const [filter, setFilter] = useState<'open' | 'closed' | 'all'>('open')
  const [current, setCurrent] = useState<string | undefined>(selected)
  const now = dashboard.data?.now ?? new Date().toISOString()

  const list = useMemo(() => ((tickets.data?.tickets ?? []) as Ticket[])
    .filter((t) => filter === 'all' || t.status === filter)
    .sort((a, b) => a.status !== b.status ? (a.status === 'open' ? -1 : 1)
      : a.status === 'open' ? Date.parse(a.hold?.releaseAt ?? a.createdAt) - Date.parse(b.hold?.releaseAt ?? b.createdAt) : Date.parse(b.updatedAt) - Date.parse(a.updatedAt)), [tickets.data, filter])
  useEffect(() => { if (!current && list[0]) setCurrent(list[0].ticketId) }, [list, current])

  if (!tickets.data) return <LoadState pending={tickets.isPending} error={tickets.error} label="回访工单" retry={() => void tickets.refetch()} />
  const ticket = (tickets.data.tickets as Ticket[]).find((t) => t.ticketId === current)
  const event = events.data?.events.find((e) => e.actionId === ticket?.actionId)
  const customer = customers.data?.customers.find((c) => c.id === ticket?.userId)
  const summary = tickets.data.summary

  return <div className="callback-desk">
    <section className="panel callback-queue" aria-label="回访队列">
      <div className="callback-queue-head">
        <div className="callback-tabs" role="tablist">
          {([['open', `待回访 ${summary.open}`], ['closed', '已结束'], ['all', '全部']] as const).map(([v, t]) =>
            <button key={v} role="tab" aria-selected={filter === v} type="button" className={filter === v ? 'active' : ''} onClick={() => setFilter(v)}>{t}</button>)}
        </div>
        <small>冷静期中 {summary.held} 笔 · 已撤销 {summary.cancelled} 笔</small>
      </div>
      {list.length ? <ul>{list.map((t) => {
        const due = t.status === 'open' && t.hold?.status === 'held' ? countdown(t.hold.releaseAt, now) : undefined
        return <li key={t.ticketId}>
          <button type="button" className={t.ticketId === current ? 'active' : ''} onClick={() => setCurrent(t.ticketId)}>
            <span className="queue-main"><strong>{t.userName}</strong><small>转给 {t.payeeName}</small></span>
            <span className="queue-side"><b>{yuan(t.amountCents)}</b>
              <small className={due?.urgent ? 'text-danger' : ''}>{due ? due.text : t.outcome ? OUTCOME_TEXT[t.outcome] : '已结束'}{t.attempts ? ` · ${t.attempts} 次` : ''}</small></span>
          </button>
        </li>
      })}</ul> : <p className="console-empty">{filter === 'open' ? '没有待回访的工单。' : '没有工单。'}</p>}
    </section>

    {ticket ? <section className="panel callback-detail" aria-label="回访详情">
      <header className="callback-detail-head">
        <div>
          <span className="eyebrow">回访工单 · {dateTime(ticket.createdAt)}</span>
          <h2>{ticket.userName} 向 {ticket.payeeName} 转账 {yuan(ticket.amountCents)}</h2>
          <p>{ticket.hold?.status === 'held' ? <><b className={countdown(ticket.hold.releaseAt, now).urgent ? 'text-danger' : ''}>{countdown(ticket.hold.releaseAt, now).text}</b>，到期后系统按客户原授权自动执行。</> : '冷静期已结束。'}</p>
        </div>
        <button type="button" className="button button-outline button-sm" onClick={() => go({ section: 'customer', userId: ticket.userId })}><UserRound size={14} />客户详情</button>
      </header>
      <CustomerCard phone={event?.phone ?? null} customer={customer} />
      {event ? <EventDetail event={event} now={now} /> : <ul className="reason-list">{ticket.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
      {ticket.status === 'open'
        ? <ResolvePanel key={ticket.ticketId} ticket={ticket} onDone={() => void client.invalidateQueries({ queryKey: ['admin'] })} />
        : <div className="callback-closed"><CheckCircle2 size={18} /><div><strong>{ticket.outcome ? OUTCOME_TEXT[ticket.outcome] : '冷静期已结束'}</strong><p>{ticket.note ?? '无回访记录'}{ticket.handledBy ? ` · 处理人 ${ticket.handledBy}` : ''}</p></div></div>}
    </section> : <section className="panel callback-detail"><p className="console-empty">从左侧选择一张工单。</p></section>}
  </div>
}

function CustomerCard({ phone, customer }: { phone: string | null; customer?: { totalAssetsCents: number; monthlyIncomeCents: number; riskLevel: string; tags: { label: string; tone: string }[] } }) {
  const [reveal, setReveal] = useState(false)
  return <div className="callback-customer">
    <div><span>联系电话</span><b>{phone ? (reveal ? phone : `${phone.slice(0, 3)}****${phone.slice(7)}`) : '未绑定'}</b>
      {phone && !reveal && <button type="button" className="button button-ghost button-sm" onClick={() => setReveal(true)}><Eye size={13} />显示完整号码</button>}</div>
    {customer && <>
      <div><span>总资产</span><b>{yuan(customer.totalAssetsCents)}</b></div>
      <div><span>月均收入</span><b>{yuan(customer.monthlyIncomeCents)}</b></div>
      <div><span>风险等级</span><b>{customer.riskLevel}</b></div>
      {customer.tags.length > 0 && <div className="callback-tags">{customer.tags.map((t) => <span key={t.label} className={`tag tag-${t.tone}`}>{t.label}</span>)}</div>}
    </>}
  </div>
}

function ResolvePanel({ ticket, onDone }: { ticket: Ticket; onDone: () => void }) {
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [note, setNote] = useState(''), [confirmSafe, setConfirmSafe] = useState(false), [message, setMessage] = useState('')
  const resolve = useMutation({
    mutationFn: (outcome: CallbackOutcome) => callbackApi.resolve({ ticketId: ticket.ticketId, outcome, note: note.trim() || undefined }),
    onSuccess: (_r, outcome) => { setMessage(outcome === 'confirmed_scam' ? '已撤销这笔转账，资金未转出。' : outcome === 'confirmed_safe' ? '已提前放行，转账已执行。' : '已记录未联系上，转账仍按冷静期到期执行。'); setConfirmSafe(false); onDone() },
  })
  const risky = CHECKS.filter((c) => c.risk && checked[c.id])
  const held = ticket.hold?.status === 'held'
  return <div className="resolve-panel">
    <h3>回访核实清单</h3>
    <ul className="check-list">{CHECKS.map((c) => <li key={c.id}><label>
      <input type="checkbox" checked={!!checked[c.id]} onChange={(e) => setChecked({ ...checked, [c.id]: e.target.checked })} />
      <span>{c.text}</span>
    </label></li>)}</ul>
    {risky.length > 0 && <div className="resolve-hint is-danger"><ShieldX size={16} />符合 {risky.length} 项诈骗特征，建议确认诈骗并撤销，同时提醒客户拨打 96110 反诈专线。</div>}
    {!risky.length && checked.clear && <div className="resolve-hint is-good"><ShieldCheck size={16} />客户能说清用途并有凭证，可考虑确认安全。</div>}
    <label className="resolve-note"><span>回访记录</span><textarea className="console-textarea" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="例如：客户称对方自称公安，要求转入安全账户；已劝阻" /></label>
    {ticket.outcome && <p className="resolve-last">上次：{OUTCOME_TEXT[ticket.outcome]}{ticket.note ? ` · ${ticket.note}` : ''}{ticket.handledBy ? ` · ${ticket.handledBy}` : ''}</p>}
    {resolve.isError && <div className="resolve-hint is-danger" role="alert">{resolve.error.message}</div>}
    {message && <div className="resolve-hint is-good" role="status"><CheckCircle2 size={16} />{message}</div>}
    {confirmSafe ? <div className="resolve-confirm">
      <p>确认安全后，这笔 {yuan(ticket.amountCents)} 将<b>立即转出</b>，无法再撤销。</p>
      <button type="button" className="button button-outline" onClick={() => setConfirmSafe(false)}>返回</button>
      <button type="button" className="button button-primary" disabled={resolve.isPending} onClick={() => resolve.mutate('confirmed_safe')}>确认放行</button>
    </div> : <div className="resolve-actions">
      <button type="button" className="button button-danger" disabled={resolve.isPending || !held} onClick={() => resolve.mutate('confirmed_scam')}><ShieldX size={15} />确认诈骗并撤销</button>
      <button type="button" className="button button-outline" disabled={resolve.isPending || !held} onClick={() => setConfirmSafe(true)}><ShieldCheck size={15} />确认安全并放行</button>
      <button type="button" className="button button-ghost" disabled={resolve.isPending} onClick={() => resolve.mutate('unreachable')}><PhoneOff size={15} />未联系上</button>
    </div>}
    <small className="resolve-foot"><PhoneCall size={12} />回访结论只作用于这一笔客户已确认的转账，后台不能发起新交易。</small>
  </div>
}
