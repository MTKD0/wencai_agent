import { Button } from '#/components/ui/button'
import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ConfirmError } from '#/lib/queries'
import { useSecureOperation, type SecureResult } from '#/components/ui/SecureOperation'
import type { ConfirmSummary } from '#/server/tools/define'
import { FRAUD_REASON_PREFIX, UNUSUAL_REASON_PREFIX } from '#/lib/fraud'
import { FraudAdvice } from './FraudAdvice'
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
  /** 确认。stepUp 仅红色操作会传。 */
  onConfirm?: (stepUp?: StepUpPayload) => void | Promise<void>
  /** 取消。 */
  onCompleted?: (result: SecureResult) => void | Promise<void>
  onCancel?: () => void
  /** 已完成的展示态（外部在成功后置 true） */
  done?: string
  doneState?: 'success' | 'cancelled' | 'failed'
  onAgentAction?: (action: 'verify' | 'cancel' | 'repeat' | 'receipt') => boolean
  agentBusy?: boolean
  /** 服务端返回的冷静期记录（见 server/payments/holds.ts） */
  hold?: HoldInfo
}

export type HoldInfo = { holdId: string; status: string; releaseAt: string }
const beijingTime = (iso: string) => new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString().replace('T', ' ').slice(5, 16)

export type StepUpPayload = import('#/server/auth/step-up').StrongStepUp

/**
 * 安全关键组件：内容全部来自服务端生成的 summary，不渲染任何模型文字。
 * 在独立页面完成验证；常规转账任选一种，异常转账须密码加指纹/人脸演示验证。
 */
export default function ConfirmCard(props: ConfirmCardProps) {
  const [message, setMessage] = useState<string>()
  const [completed, setCompleted] = useState(false)
  const [heldNow, setHeldNow] = useState<HoldInfo>()
  const [holdCancelled, setHoldCancelled] = useState(false)
  const [cancellingHold, setCancellingHold] = useState(false)
  const hold = heldNow ?? props.hold
  const held = !holdCancelled && (hold?.status === 'held' || hold?.status === 'releasing')
  const openSecure = useSecureOperation()
  const queries = useQueryClient()
  // A successful secure-page receipt takes precedence over stale parent query/error state.
  const done = holdCancelled || hold?.status === 'cancelled' ? '已在冷静期内撤销，资金未转出'
    : held ? `已进入冷静期：${beijingTime(hold!.releaseAt)}（北京时间）后执行，期间可随时撤销`
    : completed ? '操作已完成' : props.done
  const confirming = useRef(false)
  const [verifying, setVerifying] = useState(false)
  const [escalated, setEscalated] = useState(false)
  const [latestReasons, setLatestReasons] = useState<string[]>()
  // 合并而不是替换：确认失败返回的新原因不能让创建时的诈骗提示消失
  const reasons = [...new Set([...props.reasons, ...(latestReasons ?? [])])]
  const scamWarning = reasons.some((r) => r.startsWith(FRAUD_REASON_PREFIX))
  // 话术提示与行为异常都要求先停下核实；两者同时出现时显示更强的诈骗提示
  const fraudWarning = scamWarning || reasons.some((r) => r.startsWith(UNUSUAL_REASON_PREFIX))
  const [acknowledged, setAcknowledged] = useState(false)
  const red = props.level === 'red' || escalated
  const submitting = props.submitting || verifying
  const state = held ? 'held' : holdCancelled || hold?.status === 'cancelled' ? 'cancelled' : completed ? 'success' : done ? (props.doneState ?? 'success') : 'pending'

  async function cancelHold() {
    if (!hold || cancellingHold) return
    setCancellingHold(true)
    setMessage(undefined)
    try {
      const response = await fetch('/api/holds', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ holdId: hold.holdId }) })
      const body = await response.json() as { ok: boolean; message?: string }
      if (!body.ok) throw new Error(body.message ?? '撤销失败')
      setHoldCancelled(true)
      void queries.invalidateQueries({ queryKey: ['confirm', props.actionId] })
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '撤销失败')
    } finally {
      setCancellingHold(false)
    }
  }

  async function confirm() {
    if (confirming.current || submitting || done) return
    if (fraudWarning && !acknowledged) return
    if (props.onAgentAction && !props.onAgentAction('verify')) return
    confirming.current = true
    setVerifying(true)
    setMessage(undefined)
    try {
      const result = await openSecure({ purpose: 'confirm_action', actionId: props.actionId })
      if (result.cancelled) return
      if (!result.ok) throw new Error(result.message ?? '本次操作未完成')
      const output = result.output as { status?: string; holdId?: string; releaseAt?: string } | undefined
      if (output?.status === 'held' && output.holdId && output.releaseAt) {
        // 冷静期不是“已完成”：不通知外层标记成功，只刷新状态
        setHeldNow({ holdId: output.holdId, status: 'held', releaseAt: output.releaseAt })
        void queries.invalidateQueries({ queryKey: ['confirm', props.actionId] })
        return
      }
      setCompleted(true)
      await props.onCompleted?.(result)
    } catch (err) {
      if (err instanceof ConfirmError && err.data.requiredLevel === 'red') setEscalated(true)
      if (err instanceof ConfirmError && err.data.reasons) setLatestReasons(err.data.reasons)
      // 错误由 props.error 展示；这里不再自行维护错误态
      setMessage(err instanceof Error ? err.message : '验证失败')
      void queries.invalidateQueries({ queryKey: ['confirm', props.actionId] })
    } finally {
      confirming.current = false
      setVerifying(false)
    }
  }

  return (
    <div className={`bank-confirm-card is-${state}${red ? ' is-strong' : ''}`}>
      <div className="mb-3 flex items-center justify-between">
        <p className="m-0 font-semibold text-[var(--sea-ink)]">{props.summary.title}</p>
        <span className="bank-confirm-badge">
          {held ? '冷静期' : done ? ({ success: '已完成', cancelled: '已取消', failed: '未完成' }[state as 'success' | 'cancelled' | 'failed']) : red ? '强验证' : '需确认'}
        </span>
      </div>
      <dl className="m-0 space-y-1.5 text-sm">
        {props.summary.fields.map((f) => (
          <div key={f.label} className="flex justify-between gap-4">
            <dt className="text-[var(--sea-ink-soft)]">{f.label}</dt>
            <dd className="m-0 text-right font-medium text-[var(--sea-ink)]">{f.value}</dd>
          </div>
        ))}
      </dl>
      {reasons.length > 0 && (
        <ul className="mt-3 mb-0 list-none space-y-0.5 p-0 text-xs text-[var(--sea-ink-soft)]">
          {reasons.map((r) => (
            <li key={r}>· {r}</li>
          ))}
        </ul>
      )}
      {fraudWarning && !done && (
        // 劝阻文案固定写在前端，不使用模型文字；勾选只是提醒用户停下来核实，验证仍由独立安全页面完成
        <FraudAdvice variant={scamWarning ? 'scam' : 'unusual'}>
          <label className="bank-fraud-ack">
            <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
            <span>我已核实收款人身份，没有人指挥我转账</span>
          </label>
        </FraudAdvice>
      )}

      {done && (
        <p className="bank-confirm-status" role="status">{state === 'success' ? '✓ ' : ''}{done}</p>
      )}
      {held && (
        // 冷静期：钱还没有转出。撤销只作用于这一笔，不需要再次验证
        <div className="bank-hold-notice">
          <p>这笔转账识别到疑似诈骗话术，已为您保留 24 小时冷静期。银行工作人员可能会联系您核实；如有疑虑，请立即撤销。</p>
          <Button type="button" onClick={() => void cancelHold()} disabled={cancellingHold} className="bank-hold-cancel bank-lift w-full rounded-full py-2 text-sm font-semibold">
            {cancellingHold ? '正在撤销…' : '撤销这笔转账'}
          </Button>
          {message && <p className="m-0 text-center text-xs text-red-600">{message}</p>}
        </div>
      )}
      {!held && (!done || props.onAgentAction) && (
        <div className="mt-4 space-y-2">
          <div className="flex gap-2">
            <Button type="button" onClick={() => props.onAgentAction ? props.onAgentAction(done ? 'receipt' : 'cancel') : props.onCancel?.()} disabled={submitting || props.agentBusy} className="bank-confirm-cancel bank-lift flex-1 rounded-full border border-[var(--line)] py-2 text-sm">
              {done ? '核对结果' : '取消'}
            </Button>
            <Button
              onClick={() => done && props.onAgentAction ? props.onAgentAction('repeat') : void confirm()}
              type="button"
              disabled={submitting || props.agentBusy || (fraudWarning && !acknowledged && !done)}
              className="bank-confirm-submit bank-lift flex-1 rounded-full py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {submitting ? '处理中…' : done ? '重新办理' : '确认'}
            </Button>
          </div>
          {state !== 'success' && (message ?? props.error) && <p className="m-0 text-center text-xs text-red-600">{message ?? props.error}</p>}
        </div>
      )}
    </div>
  )
}
