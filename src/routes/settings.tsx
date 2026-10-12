import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { authClient, useSession } from '#/lib/auth-client'
import { UnauthorizedError, usePasskeyDelete, useSecurityAction, useSettings } from '#/lib/queries'
import ThemeToggle from '#/components/ThemeToggle'
import { useStrongVerification } from '#/components/ui/StrongVerification'

export const Route = createFileRoute('/settings')({ component: SettingsPage })

function SettingsPage() {
  const { data: session, isPending: sessionPending } = useSession()
  const navigate = useNavigate()
  const settings = useSettings()
  const securityAction = useSecurityAction()
  const deletePasskey = usePasskeyDelete()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const body = (() => {
    if (sessionPending) return <Muted>加载中…</Muted>
    if (!session) return <Muted>请先登录后再查看安全设置。</Muted>
    if (settings.isPending) return <Muted>加载中…</Muted>
    if (settings.error) {
      if (settings.error instanceof UnauthorizedError) return <Muted>登录已过期，请重新登录。</Muted>
      return <Muted>加载失败：{settings.error.message}</Muted>
    }
    return <SettingsBody
      data={settings.data}
      currentSessionId={session.session.id}
      password={password}
      setPassword={setPassword}
      error={error}
      setError={setError}
      busy={securityAction.isPending || deletePasskey.isPending}
      onAction={(body) => {
        setError('')
        securityAction.mutate(body, { onError: (e) => setError(e.message) })
      }}
      onDeletePasskey={(id) => {
        setError('')
        deletePasskey.mutate(id, { onError: (e) => setError(e.message) })
      }}
      onSignOut={async () => {
        await authClient.signOut()
        navigate({ to: '/login' })
      }}
    />
  })()

  return (
    <Shell>
      {body}
      {error && <p className="m-0 text-sm text-red-600">{error}</p>}
    </Shell>
  )
}

interface BodyProps {
  data: ReturnType<typeof useSettings>['data']
  currentSessionId: string
  password: string
  setPassword: (v: string) => void
  error: string
  setError: (v: string) => void
  busy: boolean
  onAction: (body: unknown) => void
  onDeletePasskey: (id: string) => void
  onSignOut: () => Promise<void>
}

function SettingsBody({ data, currentSessionId, password, setPassword, setError, busy, onAction, onDeletePasskey, onSignOut }: BodyProps) {
  const verification = useStrongVerification({ purpose: 'set_tx_password', password }, busy)
  if (!data) return null
  const { stepUp } = data
  const methods = [stepUp.passkey ? 'Passkey' : null, '绑定手机号短信（需短信通道）'].filter(Boolean)

  return (
    <>
      <section className="space-y-2">
        <h2 className="m-0 text-sm font-semibold text-[var(--sea-ink)]">账号</h2>
        <p className="m-0 text-sm demo-muted">{data.user.name}</p>
        <button className="text-xs underline demo-muted" type="button" onClick={() => void onSignOut()}>
          退出登录
        </button>
      </section>

      <section className="space-y-2">
        <h2 className="m-0 text-sm font-semibold text-[var(--sea-ink)]">登录设备</h2>
        <p className="m-0 text-xs demo-muted">踢掉其他设备后，那些设备上的会话立即失效。</p>
        {data.sessions.map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] p-3 text-xs">
            <div className="min-w-0">
              <p className="m-0 truncate text-[var(--sea-ink)]">{s.id === currentSessionId ? '当前设备' : (s.userAgent ?? '未知设备')}</p>
              <p className="m-0 demo-muted">
                {s.ipAddress ?? '未知 IP'} · 到期 {new Date(s.expiresAt).toLocaleString('zh-CN')}
              </p>
            </div>
            {s.id !== currentSessionId && (
              <button className="shrink-0 text-red-600 underline" type="button" disabled={busy} onClick={() => onAction({ action: 'revoke_session', sessionId: s.id })}>
                踢掉
              </button>
            )}
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="m-0 text-sm font-semibold text-[var(--sea-ink)]">渠道绑定</h2>
        <p className="m-0 text-xs demo-muted">绑定后可在该渠道代办业务；红色操作仍需回到 App 强验证。</p>
        {data.bindings.length === 0 && <p className="m-0 text-xs demo-muted">未绑定任何渠道。</p>}
        {data.bindings.map((b) => (
          <div key={b.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] p-3 text-xs">
            <span className="text-[var(--sea-ink)]">{b.channel === 'lark' ? '飞书' : b.channel}</span>
            <button className="shrink-0 text-red-600 underline" type="button" disabled={busy} onClick={() => onAction({ action: 'revoke_binding', bindingId: b.id })}>
              解绑
            </button>
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="m-0 text-sm font-semibold text-[var(--sea-ink)]">强验证方式</h2>
        <p className="m-0 text-xs demo-muted">当前可用：{methods.length ? methods.join(' + ') : '无（请联系客服）'}</p>
        <form
          className="grid gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            try {
              const stepUp = await verification.getProof()
              onAction({ action: 'set_tx_password', password, stepUp })
              setPassword('')
            } catch (error) { setError(error instanceof Error ? error.message : '验证失败') }
          }}
        >
          <input
            className="demo-input"
            inputMode="numeric"
            maxLength={6}
            placeholder="设置 6 位交易密码"
            value={password}
            disabled={busy || verification.verifying}
            onChange={(e) => setPassword(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
          {verification.controls}
          <button className="demo-button shrink-0" type="submit" disabled={busy || password.length !== 6 || !verification.ready}>
            保存
          </button>
        </form>
        {data.passkeys.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] p-3 text-xs">
            <span className="text-[var(--sea-ink)]">Passkey{p.backedUp ? '（已同步）' : ''}</span>
            <button className="shrink-0 text-red-600 underline" type="button" disabled={busy} onClick={() => onDeletePasskey(p.id)}>
              删除
            </button>
          </div>
        ))}
        <RegisterPasskeyButton />
      </section>
    </>
  )
}

/** Passkey 注册需要浏览器 API，用 mutation 而非缓存查询 */
function RegisterPasskeyButton() {
  const register = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/passkey/register')
      if (res.status === 401) throw new UnauthorizedError()
      const options = await res.json()
      if (!res.ok) throw new Error(options.message ?? '获取注册选项失败')
      const { startRegistration } = await import('@simplewebauthn/browser')
      const credential = await startRegistration({ optionsJSON: options })
      const done = await fetch('/api/passkey/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ credential }),
      })
      const body = await done.json()
      if (!done.ok || !body.ok) throw new Error(body.message ?? '注册失败')
    },
  })
  return (
    <>
      <button className="demo-button" type="button" disabled={register.isPending} onClick={() => register.mutate()}>
        {register.isPending ? '注册中…' : '注册 Passkey'}
      </button>
      {register.error && <p className="m-0 text-xs text-red-600">{register.error.message}</p>}
    </>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex h-dvh max-w-md flex-col bg-[var(--bg-base)]">
      <header className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
        <a className="text-sm font-semibold text-[var(--sea-ink)]" href="/">
          ← 文财
        </a>
        <ThemeToggle />
      </header>
      <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 py-6">{children}</div>
    </div>
  )
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="m-0 text-sm demo-muted">{children}</p>
}
