import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Hourglass, PhoneCall, Quote, ShieldAlert, ShieldCheck, UserRound, X } from 'lucide-react'
import { Input } from '#/components/ui/input'
import { SelectControl, SelectOption } from '#/components/ui/select'
import { consoleApi, countdown, LAYER_TEXT, yuan, type FraudEvent, type FraudLayer, type FraudOutcome } from './api'
import { Kpi, LayerChips, LoadState, OutcomeBadge, Section, eventSummary } from './parts'
import { dateTime } from '../utils'
import type { Go } from './ConsoleApp'

const OUTCOMES: [FraudOutcome | 'all', string][] = [['all', '全部结果'], ['awaiting', '待用户确认'], ['held', '冷静期中'], ['abandoned', '劝阻后放弃'], ['hold_cancelled', '冷静期内撤销'], ['released', '冷静期后执行'], ['executed', '已确认执行']]

export function FraudEvents({ go, selected, userId }: { go: Go; selected?: string; userId?: string }) {
  const query = useQuery({ queryKey: ['admin', 'console', 'fraud', userId ?? 'all'], queryFn: () => consoleApi.fraud(userId), refetchInterval: 15_000 })
  const dashboard = useQuery({ queryKey: ['admin', 'console', 'dashboard'], queryFn: consoleApi.dashboard, enabled: !userId })
  const [term, setTerm] = useState(''), [layer, setLayer] = useState<FraudLayer | 'all'>('all'), [outcome, setOutcome] = useState<FraudOutcome | 'all'>('all')
  const [open, setOpen] = useState<string | undefined>(selected)
  const events = useMemo(() => (query.data?.events ?? []).filter((e) =>
    (layer === 'all' || e.layers.includes(layer)) && (outcome === 'all' || e.outcome === outcome) &&
    (!term.trim() || [e.userName, e.payeeName, eventSummary(e)].some((v) => v.includes(term.trim())))), [query.data, term, layer, outcome])
  if (!query.data) return <LoadState pending={query.isPending} error={query.error} label="识别事件" retry={() => void query.refetch()} />
  const stats = query.data.stats
  const current = query.data.events.find((e) => e.id === open)
  const close = () => { setOpen(undefined); if (selected && !userId) go({ section: 'fraud' }) }

  return <>
    {!userId && <div className="kpi-row">
      <Kpi label="累计识别" value={stats.total.detected} note={stats.byLayer.map((l) => `${LAYER_TEXT[l.layer]} ${l.count}`).join(' · ')} icon={ShieldAlert} />
      <Kpi label="劝阻后放弃" value={stats.byOutcome.find((o) => o.outcome === 'abandoned')?.count ?? 0} note="客户看到提醒后自行取消" icon={ShieldCheck} tone="good" />
      <Kpi label="冷静期内撤销" value={stats.byOutcome.find((o) => o.outcome === 'hold_cancelled')?.count ?? 0} note="客户或回访撤销，资金未转出" icon={Hourglass} tone="good" />
      <Kpi label="话术命中后止付率" value={stats.total.stopRate === null ? '—' : `${(stats.total.stopRate * 100).toFixed(0)}%`} note={`累计保住 ${yuan(stats.total.protectedCents)}`} icon={ShieldCheck} />
    </div>}
    <Section title={userId ? '反诈记录' : '识别事件'} subtitle="点一行查看识别依据、与平时的对比和处理经过">
      <div className="console-filters">
        <label className="console-filter-search"><span>搜索</span><Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="客户、收款人或话术" aria-label="搜索识别事件" /></label>
        <label><span>识别层</span><SelectControl value={layer} onValueChange={(v) => setLayer(v as FraudLayer | 'all')}>
          <SelectOption value="all">全部</SelectOption>{(Object.keys(LAYER_TEXT) as FraudLayer[]).map((l) => <SelectOption key={l} value={l}>{LAYER_TEXT[l]}</SelectOption>)}
        </SelectControl></label>
        <label><span>处理结果</span><SelectControl value={outcome} onValueChange={(v) => setOutcome(v as FraudOutcome | 'all')}>
          {OUTCOMES.map(([v, t]) => <SelectOption key={v} value={v}>{t}</SelectOption>)}
        </SelectControl></label>
      </div>
      {events.length ? <div className="table-scroll"><table className="data-table console-table">
        <thead><tr><th>时间</th>{!userId && <th>客户</th>}<th>金额 / 收款人</th><th>识别依据</th><th>处理结果</th></tr></thead>
        <tbody>{events.map((e) => <tr key={e.id} className={`row-link${e.id === open ? ' is-selected' : ''}`} onClick={() => setOpen(e.id)}>
          <td>{dateTime(e.createdAt)}</td>
          {!userId && <td><strong>{e.userName}</strong><small>{e.phone ? `${e.phone.slice(0, 3)}****${e.phone.slice(7)}` : ''}</small></td>}
          <td><strong>{yuan(e.amountCents)}</strong><small>{e.payeeName}</small></td>
          <td><LayerChips layers={e.layers} /><small>{eventSummary(e)}</small></td>
          <td><OutcomeBadge outcome={e.outcome} text={e.outcomeText} />{e.ticket?.handledBy && <small>处理人 {e.ticket.handledBy}</small>}</td>
        </tr>)}</tbody>
      </table></div> : <p className="console-empty">{query.data.events.length ? '没有符合筛选条件的事件。' : '还没有识别事件。'}</p>}
    </Section>
    {current && <aside className="console-drawer" aria-label="识别事件详情">
      <div className="console-drawer-head">
        <div><span className="eyebrow">识别事件</span><h2>{yuan(current.amountCents)} → {current.payeeName}</h2></div>
        <button type="button" className="button button-ghost button-icon" aria-label="关闭" onClick={close}><X size={18} /></button>
      </div>
      <EventDetail event={current} now={dashboard.data?.now} />
      <div className="console-drawer-actions">
        {!userId && <button type="button" className="button button-outline" onClick={() => go({ section: 'customer', userId: current.userId })}><UserRound size={15} />查看客户</button>}
        {current.ticket?.status === 'open' && <button type="button" className="button button-primary" onClick={() => go({ section: 'callbacks', ticket: current.ticket!.ticketId })}><PhoneCall size={15} />去回访<ArrowRight size={14} /></button>}
      </div>
    </aside>}
  </>
}

/** 识别依据与处理经过；回访工作台和识别事件共用 */
export function EventDetail({ event: e, now }: { event: FraudEvent; now?: string }) {
  const b = e.baseline
  const times = b?.medianOutCents ? e.amountCents / b.medianOutCents : null
  const share = b?.liquidBalanceCents ? e.amountCents / b.liquidBalanceCents : null
  return <div className="event-detail">
    <dl className="event-facts">
      <div><dt>客户</dt><dd>{e.userName}</dd></div>
      <div><dt>识别时间</dt><dd>{dateTime(e.createdAt)}</dd></div>
      <div><dt>处理结果</dt><dd><OutcomeBadge outcome={e.outcome} text={e.outcomeText} /></dd></div>
    </dl>
    <h3>识别依据 <LayerChips layers={e.layers} /></h3>
    {e.signals.length > 0 && <ul className="evidence-list">{e.signals.map((s) => <li key={s.id}><ShieldAlert size={14} />诈骗话术：{s.text}</li>)}</ul>}
    {e.evidence && <blockquote className="evidence-quote"><Quote size={14} /><span>客户原话：“{e.evidence}”</span><small>模型判断必须逐字引用客户原话，引用不到不算命中</small></blockquote>}
    {e.behavior.length > 0 && <ul className="evidence-list is-behavior">{e.behavior.map((s) => <li key={s.id}><UserRound size={14} />行为异常：{s.text}</li>)}</ul>}
    {b && <>
      <h3>与客户平时相比</h3>
      <div className="baseline-grid">
        <div><span>本笔金额</span><b>{yuan(e.amountCents)}</b></div>
        <div><span>平时单笔转账（中位数）</span><b>{b.medianOutCents ? yuan(b.medianOutCents) : '样本不足'}</b>{times && <small className={times >= 5 ? 'text-danger' : ''}>本笔是平时的 {times.toFixed(1)} 倍</small>}</div>
        <div><span>可用活期与储蓄</span><b>{yuan(b.liquidBalanceCents)}</b>{share !== null && <small className={share >= 0.5 ? 'text-danger' : ''}>本笔占 {(share * 100).toFixed(0)}%</small>}</div>
        <div><span>是否转过该收款人</span><b>{b.payeePaidBefore === undefined ? '—' : b.payeePaidBefore ? '转过' : '首次'}</b></div>
      </div>
    </>}
    <h3>客户在确认单上看到的提示</h3>
    <ul className="reason-list">{e.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
    {(e.hold || e.ticket) && <>
      <h3>处理经过</h3>
      <ul className="timeline">
        <li>识别并劝阻：{dateTime(e.createdAt)}</li>
        {e.hold && <li>客户坚持确认，进入冷静期；{e.hold.status === 'held' ? `${dateTime(e.hold.releaseAt)} 到期${now ? `（${countdown(e.hold.releaseAt, now).text}）` : ''}` : e.hold.resolvedBy === 'user' ? '客户在冷静期内自行撤销' : e.hold.resolvedBy === 'admin' ? '回访后处理' : '冷静期届满'}</li>}
        {e.ticket && <li>回访工单：{e.ticket.status === 'open' ? '待回访' : '已结束'}{e.ticket.attempts ? ` · 已联系 ${e.ticket.attempts} 次` : ''}{e.ticket.handledBy ? ` · 处理人 ${e.ticket.handledBy}` : ''}</li>}
      </ul>
    </>}
  </div>
}
