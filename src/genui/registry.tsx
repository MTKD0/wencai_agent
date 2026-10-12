import { defineRegistry } from '@json-render/react'
import { createContext, useContext } from 'react'
import { AnimatedBarChart, AnimatedDonutChart, normalizeChartData } from '#/components/ui/charts'
import { AnimatedAmount, Reveal } from '#/components/ui/motion'
import {
  Table as ShadcnTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { catalog } from './catalog'

/** FollowUp 点击后以用户身份发送消息。数值仍只能由已验证的 state 引用传入。 */
export const FollowUpContext = createContext<(prompt: string) => void>(() => {})
type Row = Record<string, unknown>
const asRows = (value: unknown): Row[] =>
  Array.isArray(value) ? value.filter((row) => row !== null && typeof row === 'object') : []
const num = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0)

/** 首页、固定工具回执与生成式视图使用同一套图表和入场组件。 */
export const { registry } = defineRegistry(catalog, {
  components: {
    Panel: ({ props, children }) => (
      <Reveal>
        <section className="bank-gen-panel">
          <h3>{props.title}</h3>
          {props.subtitle && <p>{props.subtitle}</p>}
          <div className="bank-gen-children">{children}</div>
        </section>
      </Reveal>
    ),
    Metric: ({ props }) => (
      <div className="bank-gen-metric">
        <span>{props.label}</span>
        {props.unit === '元' ? (
          <AnimatedAmount value={num(props.value)} prefix="¥ " />
        ) : (
          <span>
            {num(props.value)}
            {props.unit ?? ''}
          </span>
        )}
      </div>
    ),
    BarChart: ({ props }) => (
      <AnimatedBarChart
        title={props.title}
        data={normalizeChartData(props.data, props.labelKey, props.valueKey)}
      />
    ),
    PieChart: ({ props }) => (
      <AnimatedDonutChart
        title={props.title}
        data={normalizeChartData(props.data, props.labelKey, props.valueKey)}
      />
    ),
    Table: ({ props }) => (
      <div className="bank-gen-table rounded-xl border border-border/80 overflow-hidden bg-background/80">
        <ShadcnTable>
          <TableHeader>
            <TableRow>
              {props.columns.map((column) => (
                <TableHead key={column.key} className="text-xs font-semibold">{column.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {asRows(props.rows).map((row, index) => (
              <TableRow key={index} style={{ animationDelay: `${Math.min(index, 10) * 50}ms` }}>
                {props.columns.map((column) => (
                  <TableCell key={column.key} className="text-xs">{String(row[column.key] ?? '')}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </ShadcnTable>
      </div>
    ),
    Note: ({ props }) => <p className="bank-gen-note">{props.text}</p>,
    FollowUp: ({ props }) => <FollowUpButton label={props.label} prompt={props.prompt} />,
  },
})

function FollowUpButton({ label, prompt }: { label: string; prompt: string }) {
  const send = useContext(FollowUpContext)
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => send(prompt)}
      className="bank-follow-up rounded-full text-xs font-medium"
    >
      {label}
    </Button>
  )
}
