import { useId, useState } from 'react'
import { formatAmount } from '#/lib/dashboard'
import { motionStyle, useReveal } from './motion'
import './charts.css'

export interface ChartDatum {
  label: string
  value: number
}
export const CHART_COLORS = ['#146bff', '#4195ff', '#73baff', '#a5d5ff', '#5d83e7', '#a3b3ec']

export function normalizeChartData(
  data: unknown,
  labelKey: string,
  valueKey: string,
): ChartDatum[] {
  if (!Array.isArray(data)) return []
  return data.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    const raw = row[valueKey]
    if (typeof raw !== 'number' && (typeof raw !== 'string' || !raw.trim())) return []
    const value = Number(raw)
    const label = row[labelKey]
    return Number.isFinite(value) &&
      Number(value) >= 0 &&
      (typeof label === 'string' || typeof label === 'number')
      ? [{ label: String(label), value: Number(value) }]
      : []
  })
}

/** 共享纵向柱图：每根柱从底部依次生长，键盘聚焦和悬停显示同一份真实数值。 */
export function AnimatedBarChart({
  data,
  title,
  compact = false,
}: {
  data: ChartDatum[]
  title?: string
  compact?: boolean
}) {
  const safe = normalizeChartData(data, 'label', 'value')
  return <BarSeries key={JSON.stringify(safe)} data={safe} title={title} compact={compact} />
}

function BarSeries({
  data,
  title,
  compact,
}: {
  data: ChartDatum[]
  title?: string
  compact: boolean
}) {
  const reveal = useReveal<HTMLDivElement>()
  const id = useId().replace(/:/g, '')
  const [active, setActive] = useState<number | null>(null)
  const max = Math.max(1, ...data.map((point) => point.value))
  const width = Math.max(280, data.length * 48)
  const gap = width / Math.max(data.length, 1)
  return (
    <div {...reveal} className={`bank-chart bank-bars${compact ? ' is-compact' : ''}`}>
      {title && <h3>{title}</h3>}
      {!data.some((point) => point.value > 0) ? (
        <p className="bank-chart-empty">暂无支出数据</p>
      ) : (
        <>
          <div className="bank-chart-scroll">
            <svg
              viewBox={`0 0 ${width} 170`}
              style={!compact && data.length > 7 ? { minWidth: data.length * 40 } : undefined}
              role="img"
              aria-label={title ?? '支出柱状图'}
            >
              <defs>
                <linearGradient id={`bar-${id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop stopColor="#1572ff" />
                  <stop offset="1" stopColor="#94d4ff" />
                </linearGradient>
              </defs>
              {!compact &&
                [35, 85, 135].map((y) => (
                  <line
                    key={y}
                    x1="0"
                    x2={width}
                    y1={y}
                    y2={y}
                    stroke="#eaf1fc"
                    strokeDasharray="3 5"
                  />
                ))}
              {data.map((point, i) => {
                const height = (point.value / max) * 125
                return (
                  <g
                    key={`${point.label}-${i}`}
                    tabIndex={compact ? undefined : 0}
                    role={compact ? undefined : 'img'}
                    aria-label={`${point.label}：${formatAmount(point.value)}元`}
                    onMouseEnter={() => setActive(i)}
                    onMouseLeave={() => setActive(null)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                  >
                    <title>
                      {point.label}：¥{formatAmount(point.value)}
                    </title>
                    <rect
                      x={i * gap + gap * 0.23}
                      y="5"
                      width={gap * 0.54}
                      height="140"
                      fill="transparent"
                    />
                    <g transform={`translate(${i * gap + gap * 0.3}, 140)`}>
                      <rect
                        data-bar
                        x="0"
                        y={-height}
                        width={gap * 0.4}
                        height={height}
                        rx="4"
                        fill={`url(#bar-${id})`}
                        opacity={active === null || active === i ? 1 : 0.45}
                        style={motionStyle({ '--bar-delay': `${i * 95}ms` })}
                      />
                    </g>
                    {!compact && (
                      <text
                        x={i * gap + gap / 2}
                        y="162"
                        textAnchor="middle"
                        fill="#7b8ba8"
                        fontSize="11"
                      >
                        {point.label.length > 6 ? `${point.label.slice(0, 5)}…` : point.label}
                      </text>
                    )}
                  </g>
                )
              })}
            </svg>
          </div>
          {!compact && (
            <p className="bank-chart-caption" aria-live="polite">
              {active === null
                ? '悬停或聚焦柱形，查看金额'
                : `${data[active].label} · ¥${formatAmount(data[active].value)}`}
            </p>
          )}
        </>
      )}
    </div>
  )
}

/** 环图/饼图共用弧线动画：从十二点开始，按真实比例逐段顺时针绘制。 */
export function AnimatedDonutChart({
  data,
  title,
  compact = false,
  pie = false,
}: {
  data: ChartDatum[]
  title?: string
  compact?: boolean
  pie?: boolean
}) {
  const safe = normalizeChartData(data, 'label', 'value').filter((point) => point.value > 0)
  return (
    <DonutSeries key={JSON.stringify(safe)} data={safe} title={title} compact={compact} pie={pie} />
  )
}

function DonutSeries({
  data,
  title,
  compact,
  pie,
}: {
  data: ChartDatum[]
  title?: string
  compact: boolean
  pie: boolean
}) {
  const reveal = useReveal<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const total = data.reduce((sum, point) => sum + point.value, 0)
  const radius = pie ? 34 : 51
  const circumference = 2 * Math.PI * radius
  let offset = 0
  return (
    <div
      {...reveal}
      className={`bank-chart bank-donut${compact ? ' is-compact' : ''}${pie ? ' is-pie' : ''}`}
    >
      {title && <h3>{title}</h3>}
      {!total ? (
        <p className="bank-chart-empty">暂无分类数据</p>
      ) : (
        <div className="bank-donut-body">
          <svg viewBox="0 0 160 160" role="img" aria-label={title ?? '支出分类占比'}>
            {!pie && (
              <circle cx="80" cy="80" r={radius} fill="none" stroke="#edf4ff" strokeWidth="25" />
            )}
            {data.map((point, i) => {
              const start = offset
              offset += point.value / total
              return (
                <g key={`${point.label}-${i}`} transform={`rotate(${-90 + start * 360} 80 80)`}>
                  <circle
                    data-arc
                    cx="80"
                    cy="80"
                    r={radius}
                    fill="none"
                    stroke={CHART_COLORS[i % CHART_COLORS.length]}
                    strokeWidth={pie ? 68 : active === i ? 29 : 25}
                    tabIndex={compact ? undefined : 0}
                    role={compact ? undefined : 'img'}
                    aria-label={`${point.label}：${((point.value / total) * 100).toFixed(1)}%，${formatAmount(point.value)}元`}
                    onMouseEnter={() => setActive(i)}
                    onMouseLeave={() => setActive(null)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                    opacity={active === null || active === i ? 1 : 0.4}
                    style={motionStyle({
                      '--circumference': circumference,
                      '--arc-length': Math.max(
                        0,
                        (point.value / total) * circumference - (data.length > 1 ? 2 : 0),
                      ),
                      '--arc-delay': `${start * 1050}ms`,
                      '--arc-duration': `${Math.max(120, (point.value / total) * 1050)}ms`,
                    })}
                  >
                    <title>
                      {point.label}：¥{formatAmount(point.value)}（
                      {((point.value / total) * 100).toFixed(1)}%）
                    </title>
                  </circle>
                </g>
              )
            })}
            {!compact && !pie && (
              <text x="80" y="84" textAnchor="middle" fill="#647b9e" fontSize="12">
                {active === null
                  ? '支出分类'
                  : `${((data[active].value / total) * 100).toFixed(1)}%`}
              </text>
            )}
          </svg>
          {!compact && (
            <ul className="bank-chart-legend">
              {data.map((point, i) => (
                <li key={`${point.label}-${i}`} data-active={active === i}>
                  <span
                    className="bank-legend-dot"
                    style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                  />
                  <span>{point.label}</span>
                  <strong>{((point.value / total) * 100).toFixed(1)}%</strong>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
