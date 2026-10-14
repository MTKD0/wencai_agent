import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { Search, Download, AlertTriangle, ArrowUpRight, ArrowDownLeft, ChartNoAxesCombined } from 'lucide-react'
import { Panel, Metric, TransactionTable, Empty, type ViewProps } from '../shared'
import { money, categories, periodRows, exportLedger } from '../utils'

export function AdminTransactions({ ledger, period, report, anomalies }: ViewProps) {
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [direction, setDirection] = useState('all')
  const [page, setPage] = useState(0)
  const [onlyAnomalies, setOnlyAnomalies] = useState(false)

  const ids = new Set(anomalies.map((t) => t.id))
  const periodLedger = periodRows(ledger, period)
  const rows = periodLedger.filter(
    (t) =>
      (!q || `${t.merchant} ${t.id}`.toLowerCase().includes(q.toLowerCase())) &&
      (!category || t.category === category) &&
      (direction === 'all' || (direction === 'income' ? t.amount > 0 : t.amount < 0)) &&
      (!onlyAnomalies || ids.has(t.id)),
  )
  const count = Math.max(1, Math.ceil(rows.length / 15))

  return (
    <>
      <div className="metric-grid three">
        <Metric label="本期现金收入" value={money(report?.income ?? 0)} note="排除期初余额与理财赎回" icon={ArrowDownLeft} />
        <Metric label="本期现金支出" value={money(report?.expense ?? 0)} note="排除理财申购等资产移动" icon={ArrowUpRight} />
        <Metric label="本期现金净额" value={money(report?.net ?? 0)} note={`${report?.transactionCount ?? 0} 笔收支记录`} icon={ChartNoAxesCombined} />
      </div>
      <Panel
        title="交易明细"
        subtitle={`${rows.length} 笔记录${anomalies.length ? ` · ${anomalies.length} 笔待复核` : ''}`}
        action={
          <Button variant="outline" size="sm" onClick={() => exportLedger(periodLedger, period)}>
            <Download size={15} />导出
          </Button>
        }
      >
        <div className="table-toolbar">
          <div className="search-input">
            <Search size={15} />
            <input placeholder="搜索交易对象或流水号" value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} />
          </div>
          <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(0) }}>
            <option value="">全部分类</option>
            {Object.entries(categories).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <div className="segmented">
            {(['all', 'income', 'expense'] as const).map((d) => (
              <button key={d} className={direction === d ? 'selected' : ''} onClick={() => { setDirection(d); setPage(0) }}>
                {d === 'all' ? '全部' : d === 'income' ? '收入' : '支出'}
              </button>
            ))}
          </div>
          {anomalies.length > 0 && (
            <label className="toggle-label">
              <input type="checkbox" checked={onlyAnomalies} onChange={(e) => { setOnlyAnomalies(e.target.checked); setPage(0) }} />
              <AlertTriangle size={14} />只看异常
            </label>
          )}
        </div>
        {rows.length ? (
          <>
            <TransactionTable rows={rows} anomalyIds={ids} limit={(page + 1) * 15} />
            {rows.length > 15 && (
              <div className="pagination">
                <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>上一页</Button>
                <span>{page + 1} / {count}</span>
                <Button variant="ghost" size="sm" disabled={page >= count - 1} onClick={() => setPage(p => p + 1)}>下一页</Button>
              </div>
            )}
          </>
        ) : (
          <Empty icon={ChartNoAxesCombined} text="当前筛选条件下没有交易记录" />
        )}
      </Panel>
    </>
  )
}
