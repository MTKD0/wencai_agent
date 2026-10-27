import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, Hourglass, Loader2, PhoneCall, RefreshCw, ShieldCheck, ShieldX } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { SelectControl, SelectOption } from '#/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#/components/ui/table'
import { Badge, Empty, Metric, Panel } from '../shared'
import { dateTime } from '../utils'
import { callbackApi, type CallbackOutcome, type CallbackTicket } from '../callback-client'

const HOLD: Record<string, { label: string; badge: string }> = {
  held: { label: '冷静期中', badge: 'pending' },
  releasing: { label: '执行中', badge: 'pending' },
  released: { label: '已执行', badge: 'active' },
  cancelled: { label: '已撤销', badge: 'lost' },
  failed: { label: '执行失败', badge: 'lost' },
}
const OUTCOME: Record<CallbackOutcome, string> = { confirmed_safe: '确认安全', confirmed_scam: '确认诈骗', unreachable: '未联系上' }
const money = (cents: number) => `¥${(cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** 反诈回访工单：识别到诈骗话术、用户仍坚持确认的转账进入冷静期，人工联系核实后撤销或提前放行 */
export function AdminCallbacks() {
  const client = useQueryClient()
  const [filter, setFilter] = useState('open')
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState('')
  const query = useQuery({ queryKey: ['admin', 'callbacks'], queryFn: callbackApi.list, refetchInterval: 10000 })
  const mutation = useMutation({
    mutationFn: callbackApi.resolve,
    onSuccess: async (_result, body) => {
      setNotice(body.outcome === 'confirmed_scam' ? '已撤销这笔转账，资金未转出。' : body.outcome === 'confirmed_safe' ? '已提前放行，转账已执行。' : '已记录未联系上，转账仍按冷静期到期执行。')
      await client.invalidateQueries({ queryKey: ['admin'] })
    },
  })
  const rows = (query.data?.tickets ?? []).filter((t) => filter === 'all' || t.status === filter)
  const act = (t: CallbackTicket, outcome: CallbackOutcome) => { setNotice(''); mutation.mutate({ ticketId: t.ticketId, outcome, note: notes[t.ticketId] }) }

  return <>
    {notice && <div className="risk-review-notice" role="status"><ShieldCheck size={18} /><span>{notice}</span></div>}
    {query.data && <div className="risk-review-metrics">
      <Metric label="待回访" value={String(query.data.summary.open)} note="需要人工联系用户" icon={PhoneCall} />
      <Metric label="冷静期中" value={String(query.data.summary.held)} note="到期前资金未转出" icon={Hourglass} />
      <Metric label="已撤销" value={String(query.data.summary.cancelled)} note="用户或回访撤销" icon={ShieldX} />
    </div>}
    <Panel title="反诈回访" subtitle="识别到诈骗话术、用户看过劝阻仍坚持确认的转账进入 24 小时冷静期。回访结论只能撤销或提前放行这一笔，不能代用户发起交易。" action={
      <Button className="button button-outline button-sm" type="button" onClick={() => void query.refetch()} disabled={query.isFetching}>
        <RefreshCw size={14} className={query.isFetching ? 'spin' : ''} />刷新
      </Button>
    }>
      <div className="risk-review-filters">
        <label><span>工单状态</span><SelectControl value={filter} onValueChange={setFilter}>
          <SelectOption value="open">待回访</SelectOption>
          <SelectOption value="closed">已结束</SelectOption>
          <SelectOption value="all">全部</SelectOption>
        </SelectControl></label>
      </div>
      {(query.isError || mutation.isError) && <div className="load-error" role="alert"><CircleAlert size={18} /><div><strong>{query.isError ? '无法读取回访工单' : '回访记录未保存'}</strong><p>{(query.error ?? mutation.error)?.message}</p></div></div>}
      {query.isPending ? <div className="loading-workspace" role="status"><Loader2 className="spin" size={24} /><span>正在读取回访工单</span></div> : rows.length ? <div className="table-scroll">
        <Table className="data-table risk-review-table callback-table">
          <TableHeader><TableRow><TableHead>用户 / 收款人</TableHead><TableHead>金额 / 冷静期</TableHead><TableHead>识别依据</TableHead><TableHead>回访</TableHead></TableRow></TableHeader>
          <TableBody>{rows.map((t) => <TableRow key={t.ticketId}>
            <TableCell><div className="risk-review-account"><strong>{t.userName}</strong><small>转给 {t.payeeName} · {dateTime(t.createdAt)}</small></div></TableCell>
            <TableCell><div className="risk-review-account"><strong>{money(t.amountCents)}</strong>{t.hold && <><Badge status={HOLD[t.hold.status]?.badge ?? 'pending'}>{HOLD[t.hold.status]?.label ?? t.hold.status}</Badge><small>{t.hold.status === 'held' ? `${dateTime(t.hold.releaseAt)} 到期执行` : t.hold.resolvedBy === 'user' ? '用户自行撤销' : t.hold.resolvedBy === 'admin' ? '回访处理' : '冷静期届满处理'}</small></>}</div></TableCell>
            <TableCell><ul className="risk-review-reasons">{t.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul></TableCell>
            <TableCell>{t.status === 'open' ? <div className="risk-review-account">
              {t.outcome && <small>上次：{OUTCOME[t.outcome]}{t.note ? ` · ${t.note}` : ''}</small>}
              <Input value={notes[t.ticketId] ?? ''} onChange={(e) => setNotes({ ...notes, [t.ticketId]: e.target.value })} placeholder="回访记录（可选）" maxLength={200} aria-label={`${t.userName}的回访记录`} />
              <div className="callback-actions">
                <Button type="button" className="button button-danger button-sm" disabled={mutation.isPending || t.hold?.status !== 'held'} onClick={() => act(t, 'confirmed_scam')}>确认诈骗并撤销</Button>
                <Button type="button" className="button button-outline button-sm" disabled={mutation.isPending || t.hold?.status !== 'held'} onClick={() => act(t, 'confirmed_safe')}>确认安全并放行</Button>
                <Button type="button" className="button button-ghost button-sm" disabled={mutation.isPending} onClick={() => act(t, 'unreachable')}>未联系上</Button>
              </div>
            </div> : <div className="risk-review-account"><span>{t.outcome ? OUTCOME[t.outcome] : '冷静期已结束'}</span><small>{t.note ?? '—'}</small></div>}</TableCell>
          </TableRow>)}</TableBody>
        </Table>
      </div> : !query.isError && <Empty icon={ShieldCheck} title="暂无回访工单" text={filter === 'open' ? '当前没有需要回访的冷静期转账。' : '没有匹配的工单。'} />}
      {query.data && <p className="risk-review-updated">数据更新于 {dateTime(query.data.generatedAt)} · 每 10 秒刷新</p>}
    </Panel>
  </>
}
