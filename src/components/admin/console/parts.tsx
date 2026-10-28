import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { LAYER_TEXT, OUTCOME_TONE, type FraudEvent, type FraudLayer, type FraudOutcome } from './api'

export function Kpi({ label, value, note, icon: Icon, tone = 'default', onClick }: { label: string; value: ReactNode; note?: ReactNode; icon: LucideIcon; tone?: 'default' | 'danger' | 'warn' | 'good'; onClick?: () => void }) {
  const content = <>
    <span className="kpi-icon"><Icon size={18} /></span>
    <span className="kpi-label">{label}</span>
    <strong className="kpi-value">{value}</strong>
    {note && <small className="kpi-note">{note}</small>}
  </>
  return onClick
    ? <button type="button" className={`kpi kpi-${tone} kpi-link`} onClick={onClick}>{content}</button>
    : <div className={`kpi kpi-${tone}`}>{content}</div>
}

export function OutcomeBadge({ outcome, text }: { outcome: FraudOutcome; text: string }) {
  return <span className={`tone-badge tone-${OUTCOME_TONE[outcome]}`}>{text}</span>
}

export function LayerChips({ layers }: { layers: FraudLayer[] }) {
  return <span className="layer-chips">{layers.map((l) => <span key={l} className={`layer-chip layer-${l}`}>{LAYER_TEXT[l]}</span>)}</span>
}

/** 一句话说明识别依据：话术类别优先，其次行为信号 */
export function eventSummary(e: FraudEvent) {
  return [...e.signals.map((s) => s.text), ...e.behavior.map((b) => b.text)].slice(0, 3).join('、') || e.reasons[0] || '—'
}

export function Section({ title, subtitle, action, children, className = '' }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`panel console-section ${className}`}>
    <div className="panel-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>
    {children}
  </section>
}

export function LoadState({ pending, error, label, retry }: { pending: boolean; error: Error | null; label: string; retry?: () => void }) {
  if (error) return <div className="load-error" role="alert"><div><strong>无法读取{label}</strong><p>{error.message}</p></div>{retry && <button type="button" className="button button-outline button-sm" onClick={retry}>重试</button>}</div>
  if (pending) return <div className="loading-workspace" role="status"><span className="spin-dot" />正在读取{label}</div>
  return null
}
