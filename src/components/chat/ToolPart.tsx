import { JSONUIProvider, Renderer } from '@json-render/react'
import { FollowUpContext, registry } from '#/genui/registry'
import { isRetryableConfirmError, useCancelAction, useConfirmAction } from '#/lib/queries'
import type { StepUpPayload } from '#/lib/queries'
import type { ToolOutcome } from '#/server/tools/define'
import type { PlanState } from '#/server/executor/executor'
import ConfirmCard from './ConfirmCard'
import { BankCard } from '#/components/ui/BankCard'
import { Reveal } from '#/components/ui/motion'
import { normalizeChartData } from '#/components/ui/charts'
import { FinancialReport } from '#/components/banking/FinancialReport'

export interface ToolUIPart {
  type: `tool-${string}`
  toolCallId: string
  state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error'
  output?: unknown
  errorText?: string
}

const TOOL_LABEL: Record<string, string> = {
  get_accounts: '查询账户',
  list_transactions: '查询交易',
  find_payee: '查找收款人',
  list_cards: '查询卡片',
  list_subscriptions: '识别订阅',
  list_products: '查询理财产品',
  analyze_spending: '账单分析',
  get_spending_report: '消费报表',
  transfer: '转账',
  search_bank_accounts: '查找银行收款账户',
  list_payees: '我的收款人',
  add_payee: '添加收款人',
  transfer_between_accounts: '本人账户互转',
  lock_card: '临时锁卡',
  unlock_card: '解锁卡片',
  report_card_lost: '挂失',
  adjust_card_limit: '调整限额',
  cancel_subscription: '取消订阅',
  plan_task: '任务规划',
  show_view: '生成视图',
}

/**
 * 工具结果渲染：按 status 分派到固定组件。
 * 安全关键内容（确认单、余额、回执）全部来自工具输出的结构化数据，不经模型转述。
 */
export default function ToolPart({
  part,
  onFollowUp,
  summarized = false,
}: {
  part: ToolUIPart
  onFollowUp: (text: string) => void
  summarized?: boolean
}) {
  const tool = part.type.slice('tool-'.length)
  const label = TOOL_LABEL[tool] ?? tool

  if (part.state === 'input-streaming' || part.state === 'input-available') {
    return <Chip>⏳ {label}…</Chip>
  }
  if (part.state === 'output-error') {
    return (
      <Chip>
        ⚠️ {label}失败：{part.errorText}
      </Chip>
    )
  }

  if (tool === 'show_view') {
    const out = part.output as
      | { status: 'view'; spec: never }
      | { status: 'invalid_view'; errors: string[] }
    if (out.status !== 'view') return <Chip>⚠️ 视图未通过校验</Chip>
    if (summarized) return <Chip>✓ 结果已整理</Chip>
    return (
      <FollowUpContext.Provider value={onFollowUp}>
        <JSONUIProvider
          registry={registry}
          initialState={(out.spec as { state?: Record<string, unknown> }).state}
        >
          <Renderer spec={out.spec} registry={registry} />
        </JSONUIProvider>
      </FollowUpContext.Provider>
    )
  }

  if (tool === 'plan_task') {
    const out = part.output as
      | { status: 'plan'; state: PlanState }
      | { status: 'invalid_plan'; errors: string[] }
    if (out.status !== 'plan') return <Chip>⚠️ 计划未通过校验：{out.errors.join('；')}</Chip>
    return <PlanView state={out.state} />
  }

  if (summarized && (part.output as ToolOutcome)?.status === 'done') return <Chip>✓ {label}</Chip>
  return <Outcome label={label} tool={tool} outcome={part.output as ToolOutcome} />
}

/**
 * 一条待确认操作。确认/取消走 Query mutation：自动管理提交态与错误态，
 * 服务端仍然做完整性、归属、一次性消费与强验证校验。
 */
function PendingControl({
  outcome,
}: {
  outcome: Extract<ToolOutcome, { status: 'needs_confirmation' }>
}) {
  const confirm = useConfirmAction(outcome.actionId)
  const cancel = useCancelAction(outcome.actionId)

  // 强验证输错（step_up_failed）允许重试；not_found / tampered / expired 等是终态，
  // 该操作已无法执行，卡片直接收起到结束态，不再给出按钮
  const failedForGood = confirm.error !== null && !isRetryableConfirmError(confirm.error)

  return (
    <ConfirmCard
      {...outcome}
      submitting={confirm.isPending || cancel.isPending}
      error={failedForGood ? undefined : (confirm.error ?? cancel.error)?.message}
      done={
        confirm.isSuccess
          ? '操作已完成'
          : cancel.isSuccess
            ? '已取消操作'
            : failedForGood
              ? confirm.error?.message
              : undefined
      }
      onConfirm={async (stepUp?: StepUpPayload) => {
        await confirm.mutateAsync(stepUp)
      }}
      onCancel={() => cancel.mutate()}
    />
  )
}

function Outcome({ label, tool, outcome }: { label: string; tool: string; outcome: ToolOutcome }) {
  switch (outcome.status) {
    case 'needs_confirmation':
      return (
        <Reveal>
          <PendingControl outcome={outcome} />
        </Reveal>
      )
    case 'needs_handoff':
      return (
        <div className="rounded-2xl border border-red-300 p-4 text-sm">
          <p className="m-0 font-semibold">{outcome.summary.title}</p>
          <p className="m-0 mt-1 text-[var(--sea-ink-soft)]">该操作需要在 App 内完成强验证：</p>
          <a
            href={outcome.url}
            className="mt-2 inline-block font-semibold text-[var(--lagoon-deep)]"
          >
            前往验证 →
          </a>
        </div>
      )
    case 'denied':
      return (
        <Chip>
          🚫 {label}被风控拒绝：{outcome.reasons.join('；')}
        </Chip>
      )
    case 'error':
      return (
        <Chip>
          ⚠️ {label}失败：{outcome.message}
        </Chip>
      )
    case 'done':
      return <CompletedResult label={label} tool={tool} data={outcome.data} />
  }
}

function Accounts({ data }: { data: { id: string; name: string; balance: number }[] }) {
  return (
    <div className="grid gap-3">
      {data.map((account, index) => (
        <BankCard
          key={account.id}
          name={account.name}
          kind="account"
          balance={account.balance}
          index={index}
        />
      ))}
      {!data.length && <Chip>暂无账户</Chip>}
    </div>
  )
}

function CompletedResult({ label, tool, data }: { label: string; tool: string; data: unknown }) {
  if (tool === 'get_accounts' && Array.isArray(data)) return <Accounts data={data} />
  if (tool === 'list_cards' && Array.isArray(data))
    return (
      <div className="grid gap-3">
        {data.map((card, index) => (
          <BankCard
            key={card.id}
            name="我的银行卡"
            last4={card.last4}
            kind={card.kind}
            status={card.status}
            index={index}
          />
        ))}
        {!data.length && <Chip>暂无银行卡</Chip>}
      </div>
    )
  if (tool === 'get_spending_report' && data && typeof data === 'object') {
    const report = data as { period: string; expense: number; categories: Record<string, number> }
    if (
      Number.isFinite(report.expense) &&
      report.categories &&
      typeof report.categories === 'object'
    ) {
      const categories = Object.entries(report.categories).map(([label, value]) => ({
        label,
        value,
      }))
      return (
        <FinancialReport
          title={`${report.period} 支出分类`}
          total={report.expense}
          data={normalizeChartData(categories, 'label', 'value')}
        />
      )
    }
  }
  if (tool === 'analyze_spending' && data && typeof data === 'object') {
    const report = data as { days: number; result?: { totalSpent?: number; byCategory?: unknown } }
    if (
      typeof report.result?.totalSpent === 'number' &&
      Number.isFinite(report.result.totalSpent) &&
      Array.isArray(report.result.byCategory)
    ) {
      return (
        <FinancialReport
          title={`近 ${report.days} 天支出分类`}
          total={report.result.totalSpent}
          data={normalizeChartData(report.result.byCategory, 'category', 'total')}
        />
      )
    }
  }
  return <Chip>✓ {label}</Chip>
}

const NODE_ICON: Record<string, string> = {
  pending: '○',
  done: '✓',
  suspended: '⏸',
  failed: '✗',
  compensated: '↺',
  skipped: '–',
  handoff: '👤',
}

function PlanView({ state }: { state: PlanState }) {
  return (
    <div className="space-y-2 rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-4">
      <p className="m-0 font-semibold text-[var(--sea-ink)]">📋 {state.plan.goal}</p>
      <ol className="m-0 list-none space-y-1 p-0 text-sm">
        {state.plan.nodes.map((n) => (
          <li key={n.id}>
            {NODE_ICON[state.nodes[n.id].status]} {n.note ?? n.tool ?? '转人工'}
          </li>
        ))}
      </ol>
      {/* TODO: 确认后用 /api/confirm 返回的新计划状态刷新本视图 */}
    </div>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return <p className="m-0 text-xs text-[var(--sea-ink-soft)]">{children}</p>
}
