import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Input } from '#/components/ui/input'
import { consoleApi, yuan, type Customer } from './api'
import { LoadState, Section } from './parts'
import type { Go } from './ConsoleApp'

const FILTERS: { id: string; label: string; test: (c: Customer) => boolean }[] = [
  { id: 'all', label: '全部', test: () => true },
  { id: 'callback', label: '待回访', test: (c) => c.fraud.openTickets > 0 },
  { id: 'scam', label: '近 30 天命中话术', test: (c) => c.fraud.scam30d > 0 },
  { id: 'warn', label: '画像需关注', test: (c) => c.tags.some((t) => t.tone === 'warn') },
  { id: 'locked', label: '账户锁定', test: (c) => c.locked },
]

export function CustomerList({ go }: { go: Go }) {
  const query = useQuery({ queryKey: ['admin', 'console', 'customers'], queryFn: consoleApi.customers, refetchInterval: 30_000 })
  const [term, setTerm] = useState(''), [filter, setFilter] = useState('all')
  const rows = useMemo(() => {
    const test = FILTERS.find((f) => f.id === filter)!.test, q = term.trim().toLowerCase()
    return (query.data?.customers ?? []).filter((c) => test(c) && (!q || [c.name, c.id, c.phoneMasked ?? ''].some((v) => v.toLowerCase().includes(q))))
  }, [query.data, term, filter])
  if (!query.data) return <LoadState pending={query.isPending} error={query.error} label="客户列表" retry={() => void query.refetch()} />
  const all = query.data.customers
  return <Section title={`全部客户 · ${all.length} 位`} subtitle="手机号默认脱敏；有待回访或近期命中话术的客户排在前面">
    <div className="console-filters">
      <label className="console-filter-search"><span>搜索</span><Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="姓名、客户号或手机尾号" aria-label="搜索客户" /></label>
      <div className="filter-chips" role="group" aria-label="筛选客户">
        {FILTERS.map((f) => <button key={f.id} type="button" aria-pressed={filter === f.id} className={filter === f.id ? 'active' : ''} onClick={() => setFilter(f.id)}>
          {f.label}<b>{all.filter(f.test).length}</b>
        </button>)}
      </div>
    </div>
    {rows.length ? <div className="table-scroll"><table className="data-table console-table">
      <thead><tr><th>客户</th><th>总资产</th><th>月均收入 / 支出</th><th>近 30 天转给他人</th><th>画像标签</th><th>反诈状态</th></tr></thead>
      <tbody>{rows.map((c) => <tr key={c.id} className="row-link" onClick={() => go({ section: 'customer', userId: c.id })}>
        <td><strong>{c.name}{c.locked && <span className="tone-badge tone-danger">锁定</span>}</strong><small>{c.phoneMasked ?? '未绑定手机'} · {c.riskLevel}</small></td>
        <td><strong>{yuan(c.totalAssetsCents)}</strong><small>{c.accountCount} 个账户</small></td>
        <td>{yuan(c.monthlyIncomeCents)}<small>支出 {yuan(c.monthlyExpenseCents)}</small></td>
        <td>{yuan(c.outflow30dCents)}</td>
        <td><span className="tag-row">{c.tags.slice(0, 3).map((t) => <span key={t.code} className={`tag tag-${t.tone}`}>{t.label}</span>)}</span></td>
        <td>{c.fraud.openTickets ? <span className="tone-badge tone-danger">待回访 {c.fraud.openTickets}</span>
          : c.fraud.scam30d ? <span className="tone-badge tone-warn">命中话术 {c.fraud.scam30d}</span>
          : c.fraud.events30d ? <span className="tone-badge tone-muted">行为提醒 {c.fraud.events30d}</span>
          : <span className="tone-badge tone-good">正常</span>}</td>
      </tr>)}</tbody>
    </table></div> : <p className="console-empty">没有符合条件的客户。</p>}
  </Section>
}
