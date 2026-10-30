import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Hourglass, PhoneCall, ShieldAlert, ShieldCheck, Siren, UsersRound, Wallet } from 'lucide-react'
import { consoleApi, compactYuan, countdown, LAYER_TEXT, yuan } from './api'
import { Kpi, LayerChips, LoadState, OutcomeBadge, Section, eventSummary } from './parts'
import { dateTime } from '../utils'
import type { Go } from './ConsoleApp'
import { AgentSwitch } from './AgentSwitch'

/** “疑似诈骗：识别到“X”、“Y”等典型话术，已升级为强验证” → “X、Y” */
export const reasonBrief = (reasons: string[]) => reasons[0]?.match(/识别到(.+?)等典型话术/)?.[1].replace(/[“”]/g, '') ?? reasons[0]?.slice(0, 24) ?? ''

export function ConsoleDashboard({ go }: { go: Go }) {
  const query = useQuery({ queryKey: ['admin', 'console', 'dashboard'], queryFn: consoleApi.dashboard, refetchInterval: 15_000 })
  if (!query.data) return <LoadState pending={query.isPending} error={query.error} label="工作台" retry={() => void query.refetch()} />
  const d = query.data, f = d.fraud
  const peak = Math.max(1, ...f.trend.map((t) => t.detected))
  const layerPeak = Math.max(1, ...f.byLayer.map((l) => l.count))
  return <>
    <AgentSwitch />
    <div className="kpi-row">
      <Kpi label="待回访" value={d.callbacks.open} note={d.callbacks.open ? '冷静期结束前须联系客户' : '暂无待回访工单'} icon={PhoneCall} tone={d.callbacks.open ? 'danger' : 'good'} onClick={() => go({ section: 'callbacks' })} />
      <Kpi label="冷静期中金额" value={compactYuan(f.total.heldCents)} note="到期前资金未转出" icon={Hourglass} tone={f.total.heldCents ? 'warn' : 'default'} />
      <Kpi label="今日识别" value={f.today.detected} note={`其中诈骗话术 ${f.today.scamScripts} 笔`} icon={ShieldAlert} onClick={() => go({ section: 'fraud' })} />
      <Kpi label="累计保住资金" value={compactYuan(f.total.protectedCents)} note={f.total.stopRate === null ? '劝阻后放弃或冷静期内撤销' : `话术命中后止付率 ${(f.total.stopRate * 100).toFixed(0)}%`} icon={ShieldCheck} tone="good" />
    </div>

    <div className="console-grid">
      <Section title="回访队列" subtitle="按冷静期到期时间排序，越靠前越紧急" action={<button type="button" className="button button-ghost button-sm" onClick={() => go({ section: 'callbacks' })}>进入回访工作台<ArrowRight size={14} /></button>}>
        {d.callbacks.queue.length ? <ul className="queue-list">
          {d.callbacks.queue.map((t) => {
            const due = t.hold ? countdown(t.hold.releaseAt, d.now) : undefined
            return <li key={t.ticketId}>
              <button type="button" onClick={() => go({ section: 'callbacks', ticket: t.ticketId })}>
                <span className={`queue-dot${due?.urgent ? ' is-urgent' : ''}`} />
                <span className="queue-main"><strong>{t.userName}</strong><small>转给 {t.payeeName} · {reasonBrief(t.reasons)}</small></span>
                <span className="queue-side"><b>{yuan(t.amountCents)}</b><small className={due?.urgent ? 'text-danger' : ''}>{due?.text ?? '—'}{t.attempts ? ` · 已联系 ${t.attempts} 次` : ''}</small></span>
              </button>
            </li>
          })}
        </ul> : <p className="console-empty">当前没有待回访的冷静期转账。</p>}
      </Section>

      <Section title="近 7 天识别趋势" subtitle="柱高为识别笔数，深色为诈骗话术命中">
        <div className="trend-chart" role="img" aria-label="近 7 天识别笔数">
          {f.trend.map((t) => <div key={t.date} className="trend-col" title={`${t.date}：识别 ${t.detected} 笔，话术 ${t.scam} 笔，保住 ${yuan(t.protectedCents)}`}>
            <span className="trend-value">{t.detected || ''}</span>
            <div className="trend-bar" style={{ height: `${(t.detected / peak) * 100}%` }}><i style={{ height: t.detected ? `${(t.scam / t.detected) * 100}%` : 0 }} /></div>
            <small>{t.date.slice(5)}</small>
          </div>)}
        </div>
        <div className="layer-bars">
          {f.byLayer.map((l) => <div key={l.layer}><span>{LAYER_TEXT[l.layer]}</span><div><i className={`layer-fill layer-${l.layer}`} style={{ width: `${(l.count / layerPeak) * 100}%` }} /></div><b>{l.count}</b></div>)}
          <p>一笔转账可能同时命中多层。行为画像只提醒和强验证，不进冷静期。</p>
        </div>
      </Section>
    </div>

    <Section title="最新识别事件" action={<button type="button" className="button button-ghost button-sm" onClick={() => go({ section: 'fraud' })}>查看全部<ArrowRight size={14} /></button>}>
      {d.recentEvents.length ? <div className="table-scroll"><table className="data-table console-table">
        <thead><tr><th>时间</th><th>客户</th><th>金额 / 收款人</th><th>识别依据</th><th>处理结果</th></tr></thead>
        <tbody>{d.recentEvents.map((e) => <tr key={e.id} className="row-link" onClick={() => go({ section: 'fraud', event: e.id })}>
          <td>{dateTime(e.createdAt)}</td>
          <td><strong>{e.userName}</strong></td>
          <td><strong>{yuan(e.amountCents)}</strong><small>{e.payeeName}</small></td>
          <td><LayerChips layers={e.layers} /><small>{eventSummary(e)}</small></td>
          <td><OutcomeBadge outcome={e.outcome} text={e.outcomeText} /></td>
        </tr>)}</tbody>
      </table></div> : <p className="console-empty">还没有识别事件。</p>}
    </Section>

    <div className="kpi-row kpi-row-quiet">
      <Kpi label="客户数" value={d.customers.count} note={d.customers.locked ? `${d.customers.locked} 位账户锁定` : '全部正常'} icon={UsersRound} onClick={() => go({ section: 'customers' })} />
      <Kpi label="账户总余额" value={compactYuan(d.customers.totalBalanceCents)} icon={Wallet} />
      <Kpi label="可疑收款账户" value={d.riskFlags.suspected} note={`已确认高危 ${d.riskFlags.confirmed} 个`} icon={Siren} tone={d.riskFlags.suspected ? 'warn' : 'default'} onClick={() => go({ section: 'risk' })} />
    </div>
  </>
}
