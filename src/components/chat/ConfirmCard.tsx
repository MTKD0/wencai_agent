import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ConfirmError } from '#/lib/queries'
import { useSecureOperation, type SecureResult } from '#/components/ui/SecureOperation'
import type { ConfirmSummary } from '#/server/tools/define'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import './confirm-card.css'

export interface ConfirmCardProps {
  actionId: string
  level: 'yellow' | 'red'
  reasons: string[]
  /** 服务端根据已校验参数生成的摘要；不渲染任何模型文字 */
  summary: ConfirmSummary
  expiresAt?: number
  /** 外部提交态（由 Query mutation 驱动） */
  submitting?: boolean
  /** 外部错误文案；step_up_failed 由调用方判断是否可重试 */
  error?: string
  /** 确认。安全验证在独立页面完成，这里不再需要 stepUp。 */
  onConfirm?: (stepUp?: StepUpPayload) => void | Promise<void>
  /** 取消。 */
  onCancel?: () => void
  /** 安全页面完成后回传的服务端结果 */
  onCompleted?: (result: SecureResult) => void | Promise<void>
  /** 已完成的展示态（外部在成功后置 true） */
  done?: string
  doneState?: 'success' | 'cancelled' | 'failed'
  /** Agent 交互区接管：确认/取消/重新办理都发完整消息，不走本地 mutation */
  onAgentAction?: (action: 'verify' | 'cancel' | 'repeat' | 'receipt') => boolean
  agentBusy?: boolean
}

export type StepUpPayload = import('#/server/auth/step-up').StrongStepUp

/**
 * 安全关键组件：内容全部来自服务端生成的 summary，不渲染任何模型文字。
 * 确认后打开独立安全页面；密码与强验证都不在主文档内发生。
 */
export default function ConfirmCard(props: ConfirmCardProps) {
  const [message, setMessage] = useState<string>()
  const confirming = useRef(false)
  const [completed, setCompleted] = useState(false)
  const openSecure = useSecureOperation()
  const queries = useQueryClient()
  const done = props.done ?? (completed ? '操作已完成' : undefined)
  const red = props.level === 'red'
  const submitting = props.submitting
  const state = done ? (props.doneState ?? 'success') : 'pending'
  const [latestReasons, setLatestReasons] = useState<string[]>()

  async function confirm() {
    if (confirming.current || submitting || done) return
    if (props.onAgentAction && !props.onAgentAction('verify')) return
    confirming.current = true
    setMessage(undefined)
    try {
      const result = await openSecure({ purpose: 'confirm_action', actionId: props.actionId })
      if (result.cancelled) return
      if (!result.ok) throw new Error(result.message ?? '本次操作未完成')
      setCompleted(true)
      await props.onCompleted?.(result)
    } catch (err) {
      if (err instanceof ConfirmError && err.data.reasons) setLatestReasons(err.data.reasons)
      // 错误由 props.error 展示；这里不再自行维护错误态
      setMessage(err instanceof Error ? err.message : '验证失败')
    } finally {
      confirming.current = false
      void queries.invalidateQueries({ queryKey: ['confirm', props.actionId] })
    }
  }

  return (
    <div className={`bank-confirm-card is-${state}${red ? ' is-strong' : ''}`}>
      <div className="mb-3 flex items-center justify-between">
        <p className="m-0 font-semibold text-[var(--sea-ink)]">{props.summary.title}</p>
        <Badge
          variant={
            done
              ? state === 'success'
                ? 'default'
                : 'secondary'
              : red
                ? 'destructive'
                : 'outline'
          }
          className="text-xs"
        >
          {done
            ? ({ success: '已完成', cancelled: '已取消', failed: '未完成' } as const)[state as 'success' | 'cancelled' | 'failed']
            : red
              ? '强验证'
              : '需确认'}
        </Badge>
      </div>
      <dl className="m-0 space-y-1.5 text-sm">
        {props.summary.fields.map((f) => (
          <div key={f.label} className="flex justify-between gap-4">
            <dt className="text-[var(--sea-ink-soft)]">{f.label}</dt>
            <dd className="m-0 text-right font-medium text-[var(--sea-ink)]">{f.value}</dd>
          </div>
        ))}
      </dl>
      {(latestReasons ?? props.reasons).length > 0 && (
        <ul className="mt-3 mb-0 list-none space-y-0.5 p-0 text-xs text-[var(--sea-ink-soft)]">
          {(latestReasons ?? props.reasons).map((r) => (
            <li key={r}>· {r}</li>
          ))}
        </ul>
      )}

      {done && <p className="bank-confirm-status" role="status">{state === 'success' ? '✓ ' : ''}{done}</p>}
      {(!done || props.onAgentAction) && (
        <div className="mt-4 space-y-2">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => (props.onAgentAction ? props.onAgentAction(done ? 'receipt' : 'cancel') : props.onCancel?.())}
              disabled={submitting || props.agentBusy}
              className="bank-confirm-cancel flex-1 rounded-full text-xs"
            >
              {done ? '核对结果' : '取消'}
            </Button>
            <Button
              type="button"
              variant={red ? 'destructive' : 'default'}
              size="sm"
              onClick={() => (done && props.onAgentAction ? props.onAgentAction('repeat') : void confirm())}
              disabled={submitting || props.agentBusy}
              className="bank-confirm-submit flex-1 rounded-full text-xs font-semibold"
            >
              {submitting ? '处理中…' : done ? '重新办理' : '确认'}
            </Button>
          </div>
          {(message ?? props.error) && <p className="m-0 text-center text-xs text-red-600">{message ?? props.error}</p>}
        </div>
      )}
    </div>
  )
}
