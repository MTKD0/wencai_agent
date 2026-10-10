import { defineRegistry } from '@json-render/react'
import { createContext, useContext } from 'react'
import { catalog } from './catalog'

/** FollowUp 点击后以用户身份发送消息 */
export const FollowUpContext = createContext<(prompt: string) => void>(() => {})

type Row = Record<string, unknown>
const asRows = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : [])
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0)
const money = (v: unknown) => num(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * 展示类组件实现。props 中的 $state 引用已由 json-render 解析为服务端注入的数据。
 * TODO: 图表换成正式图表库（如 Recharts），并统一配色。
 */
export const { registry } = defineRegistry(catalog, {
  components: {
    Panel: ({ props, children }) => (
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-4">
        <p className="m-0 font-semibold text-[var(--sea-ink)]">{props.title}</p>
        {props.subtitle && <p className="m-0 text-xs text-[var(--sea-ink-soft)]">{props.subtitle}</p>}
        <div className="mt-3 space-y-3">{children}</div>
      </section>
    ),
    Metric: ({ props }) => (
      <div>
        <p className="m-0 text-xs text-[var(--sea-ink-soft)]">{props.label}</p>
        <p className="m-0 text-2xl font-bold text-[var(--sea-ink)]">
          {props.unit === '元' ? `¥${money(props.value)}` : `${num(props.value)}${props.unit ?? ''}`}
        </p>
      </div>
    ),
    BarChart: ({ props }) => <Bars title={props.title} rows={asRows(props.data)} labelKey={props.labelKey} valueKey={props.valueKey} />,
    PieChart: ({ props }) => <Bars title={props.title} rows={asRows(props.data)} labelKey={props.labelKey} valueKey={props.valueKey} share />,
    Table: ({ props }) => (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {props.columns.map((c) => (
                <th key={c.key} className="py-1 text-left text-xs font-medium text-[var(--sea-ink-soft)]">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {asRows(props.rows).map((r, i) => (
              <tr key={i} className="border-t border-[var(--line)]">
                {props.columns.map((c) => (
                  <td key={c.key} className="py-1.5">{String(r[c.key] ?? '')}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
    Note: ({ props }) => <p className="m-0 text-sm text-[var(--sea-ink-soft)]">{props.text}</p>,
    FollowUp: ({ props }) => <FollowUpButton label={props.label} prompt={props.prompt} />,
  },
})

function FollowUpButton(p: { label: string; prompt: string }) {
  const send = useContext(FollowUpContext)
  return (
    <button onClick={() => send(p.prompt)} className="rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1 text-sm">
      {p.label}
    </button>
  )
}

function Bars(p: { title: string; rows: Row[]; labelKey: string; valueKey: string; share?: boolean }) {
  const total = p.rows.reduce((s, r) => s + num(r[p.valueKey]), 0)
  const max = Math.max(...p.rows.map((r) => num(r[p.valueKey])), 1)
  return (
    <div>
      <p className="m-0 mb-2 text-sm font-medium text-[var(--sea-ink)]">{p.title}</p>
      <div className="space-y-1.5">
        {p.rows.map((r, i) => {
          const v = num(r[p.valueKey])
          return (
            <div key={i} className="text-xs">
              <div className="flex justify-between">
                <span>{String(r[p.labelKey])}</span>
                <span>{p.share && total ? `${((v / total) * 100).toFixed(1)}%` : `¥${money(v)}`}</span>
              </div>
              <div className="h-2 rounded-full bg-[var(--line)]">
                <div className="h-2 rounded-full bg-[var(--lagoon)]" style={{ width: `${(v / max) * 100}%` }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
