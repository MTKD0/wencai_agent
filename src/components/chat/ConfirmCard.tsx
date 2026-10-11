import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { UnauthorizedError } from '#/lib/queries'
import type { ConfirmSummary } from '#/server/tools/define'

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
  onCancel?: () => void
  /** 已完成的展示态（外部在成功后置 true） */
  done?: string
}

export type StepUpPayload = { method: 'password'; password: string } | { method: 'passkey'; response: unknown }

type Method = 'password' | 'passkey'

/**
 * 安全关键组件：内容全部来自服务端生成的 summary，不渲染任何模型文字。
 * 黄色：一键确认；红色：交易密码或 Passkey，二选一。
 */
export default function ConfirmCard(props: ConfirmCardProps) {
  const [password, setPassword] = useState('')
  const [method, setMethod] = useState<Method>('password')
  const [message, setMessage] = useState<string>()
  const red = props.level === 'red'

  // 已注册 Passkey 时默认走 Passkey，否则退回交易密码。
  // Query 未命中就说明没有可用 Passkey，保持密码方式即可，无需再发一次请求。
  const passkeyReady = useQuery({
    queryKey: ['passkey', 'options'],
    queryFn: async () => {
      const res = await fetch('/api/passkey/options', { credentials: 'same-origin' })
      if (res.status === 401) throw new UnauthorizedError()
      if (!res.ok) return null
      return (await res.json()) as { challenge?: string } | null
    },
    staleTime: 5 * 60_000,
    enabled: red,
    retry: false,
  })

  // 探测完成后：有 challenge 说明已注册 Passkey，默认选它
  useEffect(() => {
    if (red && passkeyReady.data?.challenge) setMethod('passkey')
  }, [red, passkeyReady.data])

  const passkeyAssert = async (): Promise<unknown | null> => {
    // challenge 是一次性的：每次签名前重新取，不用 mount 时的缓存
    const res = await fetch('/api/passkey/options', { credentials: 'same-origin' })
    if (res.status === 401) throw new Error('登录已过期，请重新登录')
    const options = await res.json()
    if (!res.ok || !options?.challenge) throw new Error(options?.message ?? 'Passkey 不可用')
    const { startAuthentication } = await import('@simplewebauthn/browser')
    return startAuthentication({ optionsJSON: options })
  }

  async function confirm() {
    setMessage(undefined)
    try {
      // 强验证的 stepUp 只在红色操作时构造；Passkey 用浏览器 API 现取 challenge
      const stepUp: StepUpPayload | undefined =
        !red
          ? undefined
          : method === 'passkey'
            ? { method: 'passkey', response: await passkeyAssert() }
            : { method: 'password', password }
      await props.onConfirm?.(stepUp)
    } catch (err) {
      // 错误由 props.error 展示；这里不再自行维护错误态
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

      {props.done ? (
        <p className="mt-3 mb-0 text-center text-sm font-semibold text-[var(--palm)]">✓ {props.done}</p>
      ) : (
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
            <button onClick={() => props.onCancel?.()} disabled={props.submitting} className="flex-1 rounded-full border border-[var(--line)] py-2 text-sm">
              取消
            </button>
            <button
              onClick={() => void confirm()}
              disabled={props.submitting || !props.onConfirm || (red && method === 'password' && password.length !== 6)}
              className="flex-1 rounded-full bg-[var(--lagoon-deep)] py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {props.submitting ? '处理中…' : '确认'}
            </button>
          </div>
          {(message ?? props.error) && <p className="m-0 text-center text-xs text-red-600">{message ?? props.error}</p>}
        </div>
      )}
    </div>
  )
}
