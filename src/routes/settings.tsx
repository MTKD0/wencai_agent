import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { authClient, useSession } from '#/lib/auth-client'
import ThemeToggle from '#/components/ThemeToggle'

type Settings = {
  user: { id: string; name: string }
  sessions: { id: string; createdAt: string; expiresAt: string; ipAddress: string | null; userAgent: string | null; current: boolean }[]
  bindings: { id: string; channel: string; boundAt: string }[]
  passkeys: { id: string; deviceType: string | null; backedUp: boolean; createdAt: string; lastUsedAt: string | null }[]
  stepUp: { password: boolean; passkey: boolean; larkBound: boolean }
}

export const Route = createFileRoute('/settings')({ component: SettingsPage })

function SettingsPage() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const [data, setData] = useState<Settings | null>(null)
  const [error, setError] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => {
    fetch('/api/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setError('加载失败'))
  }

  if (isPending) return <Shell>加载中…</Shell>
  if (!session) return <Shell>请先登录</Shell>
  if (!data)
    return (
      <Shell>
        <button
          className="demo-button"
          type="button"
          onClick={() => {
            load()
          }}
        >
          查看安全设置
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </Shell>
    )

  const act = async (body: unknown) => {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/security', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const out = await res.json()
      if (!res.ok || !out.ok) setError(out.message ?? '操作失败')
      load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell>
      <section className="space-y-2">
        <h2 className="m-0 text-sm font-semibold text-[var(--sea-ink)]">账号</h2>
        <p className="m-0 text-sm demo-muted">
          {data.user.name} · {data.user.id}
        </p>
        <button
          className="text-xs underline demo-muted"
          type="button"
          onClick={async () => {
            await authClient.signOut()
            navigate({ to: '/login' })
          }}
        >
          退出登录
        </button>
      </section>

      <section className="space-y-2">
        <h2 className="m-0 text-sm font-semibold text-[var(--sea-ink)]">登录设备</h2>
        {data.sessions.map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] p-3 text-xs">
            <div className="min-w-0">
              <p className="m-0 truncate text-[var(--sea-ink)]">{s.current ? '当前设备' : s.userAgent ?? '未知设备'}</p>
              <p className="m-0 demo-muted">
                {s.ipAddress ?? '未知 IP'} · 到期 {new Date(s.expiresAt).toLocaleString('zh-CN')}
              </p>
            </div>
            {!s.current && (
              <button className="shrink-0 text-red-600 underline" type="button" disabled={busy} onClick={() => act({ action: 'revoke_session', sessionId: s.id })}>
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
            <button className="shrink-0 text-red-600 underline" type="button" disabled={busy} onClick={() => act({ action: 'revoke_binding', bindingId: b.id })}>
              解绑
            </button>
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="m-0 text-sm font-semibold text-[var(--sea-ink)]">强验证方式</h2>
        <p className="m-0 text-xs demo-muted">
          当前可用：{data.stepUp.password ? '交易密码' : ''}
          {data.stepUp.password && data.stepUp.passkey ? ' + ' : ''}
          {data.stepUp.passkey ? 'Passkey' : ''}
        </p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void act({ action: 'set_tx_password', password })
            setPassword('')
          }}
        >
          <input
            className="demo-input"
            inputMode="numeric"
            maxLength={6}
            placeholder="设置 6 位交易密码"
            value={password}
            onChange={(e) => setPassword(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
          <button className="demo-button shrink-0" type="submit" disabled={busy || password.length !== 6}>
            保存
          </button>
        </form>
        {data.passkeys.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] p-3 text-xs">
            <span className="text-[var(--sea-ink)]">Passkey{p.backedUp ? '（已同步）' : ''}</span>
            <button
              className="shrink-0 text-red-600 underline"
              type="button"
              disabled={busy}
              onClick={async () => {
                await fetch('/api/passkey/delete', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ id: p.id }),
                })
                load()
              }}
            >
              删除
            </button>
          </div>
        ))}
        <button
          className="demo-button"
          type="button"
          disabled={busy}
          onClick={async () => {
            setError('')
            try {
              const { startRegistration } = await import('@simplewebauthn/browser')
              const res = await fetch('/api/passkey/register')
              const options = await res.json()
              const credential = await startRegistration({ optionsJSON: options })
              const done = await fetch('/api/passkey/register', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ credential }),
              })
              const body = await done.json()
              if (!done.ok || !body.ok) setError(body.message ?? '注册失败')
              load()
            } catch (err) {
              setError(err instanceof Error ? err.message : '注册失败')
            }
          }}
        >
          注册 Passkey
        </button>
      </section>

      {error && <p className="m-0 text-sm text-red-600">{error}</p>}
    </Shell>
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
