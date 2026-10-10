import { useState } from 'react'
import type { ConfirmSummary } from '#/server/tools/define'

export interface ConfirmCardProps {
  actionId: string
  level: 'yellow' | 'red'
  reasons: string[]
  summary: ConfirmSummary
  expiresAt?: number
  onSettled?: (result: ConfirmResponse) => void
}

export interface ConfirmResponse {
  ok: boolean
  cancelled?: boolean
  code?: string
  message?: string
  output?: unknown
  plan?: unknown
}

type Phase = 'idle' | 'submitting' | 'done' | 'cancelled' | 'error'

/**
 * 安全关键组件：内容全部来自服务端生成的 summary，不渲染任何模型文字。
 * 黄色：一键确认；红色：需交易密码（TODO: Passkey 人脸/指纹）。
 */
export default function ConfirmCard(props: ConfirmCardProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState<string>()
  const red = props.level === 'red'

  async function submit(decision: 'confirm' | 'cancel') {
    setPhase('submitting')
    const res = await fetch('/api/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        actionId: props.actionId,
        decision,
        stepUp: red && decision === 'confirm' ? { method: 'password', password } : undefined,
      }),
    })
    const data = (await res.json()) as ConfirmResponse
    if (data.ok) {
      setPhase(data.cancelled ? 'cancelled' : 'done')
      setMessage(data.cancelled ? '已取消' : '操作已完成')
    } else {
      // 强验证失败可重试，其余错误为终态
      setPhase(data.code === 'step_up_failed' ? 'idle' : 'error')
      setMessage(data.message)
    }
    props.onSettled?.(data)
  }

  return (
    <div className={`rounded-2xl border p-4 ${red ? 'border-red-300 bg-red-50/80 dark:bg-red-950/30' : 'border-amber-300 bg-amber-50/80 dark:bg-amber-950/30'}`}>
      <div className="mb-3 flex items-center justify-between">
        <p className="m-0 font-semibold text-[var(--sea-ink)]">{props.summary.title}</p>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${red ? 'bg-red-600 text-white' : 'bg-amber-500 text-white'}`}>
          {red ? '强验证' : '需确认'}
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
      {props.reasons.length > 0 && (
        <ul className="mt-3 mb-0 list-none space-y-0.5 p-0 text-xs text-[var(--sea-ink-soft)]">
          {props.reasons.map((r) => (
            <li key={r}>· {r}</li>
          ))}
        </ul>
      )}

      {phase === 'idle' || phase === 'submitting' ? (
        <div className="mt-4 space-y-2">
          {red && (
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入 6 位交易密码"
              className="w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-center tracking-[0.5em] dark:bg-black/30"
            />
          )}
          <div className="flex gap-2">
            <button onClick={() => submit('cancel')} disabled={phase === 'submitting'} className="flex-1 rounded-full border border-[var(--line)] py-2 text-sm">
              取消
            </button>
            <button
              onClick={() => submit('confirm')}
              disabled={phase === 'submitting' || (red && password.length !== 6)}
              className="flex-1 rounded-full bg-[var(--lagoon-deep)] py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {phase === 'submitting' ? '处理中…' : '确认'}
            </button>
          </div>
          {message && <p className="m-0 text-center text-xs text-red-600">{message}</p>}
        </div>
      ) : (
        <p className={`mt-3 mb-0 text-center text-sm font-semibold ${phase === 'done' ? 'text-[var(--palm)]' : 'text-[var(--sea-ink-soft)]'}`}>
          {phase === 'done' ? '✓ ' : ''}
          {message}
        </p>
      )}
    </div>
  )
}
