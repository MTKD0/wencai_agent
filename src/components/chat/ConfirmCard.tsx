import { useEffect, useState } from 'react'
import type { ConfirmSummary } from '#/server/tools/define'

export interface ConfirmCardProps {
  actionId: string
  level: 'yellow' | 'red'
  reasons: string[]
  summary: ConfirmSummary
  expiresAt?: number
  /** 提交地址，默认 /api/confirm；绑定页传 /api/bind */
  endpoint?: string
  /** 成功后不显示「操作已完成」而是自定义文案 */
  doneText?: string
  busy?: boolean
  error?: string
  onSettled?: (result: ConfirmResponse) => void
  onConfirm?: (stepUp: StepUpPayload) => void | Promise<void>
}

export interface ConfirmResponse {
  ok: boolean
  cancelled?: boolean
  code?: string
  message?: string
  output?: unknown
  plan?: unknown
}

export type StepUpPayload =
  | { method: 'password'; password: string }
  | { method: 'passkey'; response: unknown }

type Phase = 'idle' | 'submitting' | 'done' | 'cancelled' | 'error'
type Method = 'password' | 'passkey'

/**
 * 安全关键组件：内容全部来自服务端生成的 summary，不渲染任何模型文字。
 * 黄色：一键确认；红色：交易密码或 Passkey，二选一。
 */
export default function ConfirmCard(props: ConfirmCardProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [password, setPassword] = useState('')
  const [method, setMethod] = useState<Method>('password')
  const [message, setMessage] = useState<string>()
  const red = props.level === 'red'

  // 已注册 Passkey 时默认走 Passkey，否则退回交易密码
  useEffect(() => {
    let alive = true
    if (!red) return
    fetch('/api/passkey/options')
      .then((r) => (r.ok ? r.json() : null))
      .then((options) => {
        if (alive && options?.challenge) setMethod('passkey')
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [red])

  const passkeyAssert = async (): Promise<unknown | null> => {
    const res = await fetch('/api/passkey/options')
    const options = await res.json()
    if (!res.ok || !options?.challenge) throw new Error(options?.message ?? 'Passkey 不可用')
    const { startAuthentication } = await import('@simplewebauthn/browser')
    return startAuthentication({ optionsJSON: options })
  }

  async function submit(decision: 'confirm' | 'cancel') {
    if (!props.onConfirm) {
      setMessage('该入口不支持直接确认')
      return
    }
    setPhase('submitting')
    setMessage(undefined)
    try {
      const stepUp: StepUpPayload | undefined =
        decision === 'cancel'
          ? undefined
          : !red
            ? undefined
            : method === 'passkey'
              ? { method: 'passkey', response: await passkeyAssert() }
              : { method: 'password', password }
      await props.onConfirm(stepUp as StepUpPayload)
    } catch (err) {
      setPhase('idle')
      setMessage(err instanceof Error ? err.message : '验证失败')
    }
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
            <>
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setMethod('password')}
                  className={`flex-1 rounded-full border py-1 ${method === 'password' ? 'border-[var(--lagoon-deep)] text-[var(--sea-ink)]' : 'border-[var(--line)] text-[var(--sea-ink-soft)]'}`}
                >
                  交易密码
                </button>
                <button
                  type="button"
                  onClick={() => setMethod('passkey')}
                  className={`flex-1 rounded-full border py-1 ${method === 'passkey' ? 'border-[var(--lagoon-deep)] text-[var(--sea-ink)]' : 'border-[var(--line)] text-[var(--sea-ink-soft)]'}`}
                >
                  Passkey
                </button>
              </div>
              {method === 'password' && (
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
            </>
          )}
          <div className="flex gap-2">
            <button onClick={() => props.onSettled?.({ ok: true, cancelled: true })} disabled={phase === 'submitting'} className="flex-1 rounded-full border border-[var(--line)] py-2 text-sm">
              取消
            </button>
            <button
              onClick={() => submit('confirm')}
              disabled={phase === 'submitting' || props.busy || (red && method === 'password' && password.length !== 6)}
              className="flex-1 rounded-full bg-[var(--lagoon-deep)] py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {phase === 'submitting' ? '处理中…' : '确认'}
            </button>
          </div>
          {(message ?? props.error) && <p className="m-0 text-center text-xs text-red-600">{message ?? props.error}</p>}
        </div>
      ) : (
        <p className="mt-3 mb-0 text-center text-sm font-semibold text-[var(--sea-ink-soft)]">
          {phase === 'done' ? '✓ ' : ''}
          {message ?? (phase === 'done' ? props.doneText ?? '操作已完成' : '已取消')}
        </p>
      )}
    </div>
  )
}
