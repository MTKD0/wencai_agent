import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import ConfirmCard from '#/components/chat/ConfirmCard'
import { authClient, useSession } from '#/lib/auth-client'
import ThemeToggle from '#/components/ThemeToggle'

/** 飞书账号绑定页。链接由飞书机器人生成，带 HMAC 签名且一次性。 */
export const Route = createFileRoute('/bind')({ component: BindPage, validateSearch: (s: Record<string, unknown>) => ({ code: typeof s.code === 'string' ? s.code : '' }) })

type Info =
  | { kind: 'loading' }
  | { kind: 'missing'; reason: string }
  | { kind: 'needLogin' }
  | { kind: 'ready'; alreadyBoundToMe: boolean; alreadyBoundToOther: boolean }
  | { kind: 'done' }

function BindPage() {
  const { code } = useSearch({ from: '/bind' })
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const [info, setInfo] = useState<Info>({ kind: 'loading' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!code) {
      setInfo({ kind: 'missing', reason: '缺少绑定参数' })
      return
    }
    fetch(`/api/bind?code=${encodeURIComponent(code)}`)
      .then(async (r) => {
        const body = await r.json()
        if (!r.ok) {
          setInfo({ kind: 'missing', reason: body.reason ?? body.error ?? '链接无效' })
          return
        }
        setInfo(
          body.needsLogin
            ? { kind: 'needLogin' }
            : { kind: 'ready', alreadyBoundToMe: !!body.alreadyBoundToMe, alreadyBoundToOther: !!body.alreadyBoundToOther },
        )
      })
      .catch(() => setInfo({ kind: 'missing', reason: '网络错误' }))
  }, [code])

  const doBind = async (stepUp: { method: 'password'; password: string } | { method: 'passkey'; response: unknown }) => {
    setError('')
    setBusy(true)
    try {
      const res = await fetch('/api/bind', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, stepUp }),
      })
      const body = await res.json()
      if (!res.ok || !body.ok) {
        setError(body.message ?? '绑定失败')
        return
      }
      setInfo({ kind: 'done' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex h-dvh max-w-md flex-col bg-[var(--bg-base)]">
      <header className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
        <span className="text-sm font-semibold text-[var(--sea-ink)]">文财 · 绑定飞书</span>
        <ThemeToggle />
      </header>
      <div className="flex flex-1 flex-col gap-4 px-4 py-6">
        {info.kind === 'loading' && <p className="demo-muted">加载中…</p>}
        {info.kind === 'missing' && <p className="text-sm text-red-600">{info.reason}。请在飞书重新获取绑定链接。</p>}
        {info.kind === 'needLogin' && (
          <div className="flex flex-col gap-3">
            <p className="text-sm demo-muted">请先登录文财，再完成绑定。</p>
            <button className="demo-button" type="button" onClick={() => navigate({ to: '/login' })}>
              去登录
            </button>
          </div>
        )}
        {info.kind === 'ready' && isPending && <p className="demo-muted">加载中…</p>}
        {info.kind === 'ready' && !isPending && !session && (
          <div className="flex flex-col gap-3">
            <p className="text-sm demo-muted">请先登录文财，再完成绑定。</p>
            <button className="demo-button" type="button" onClick={() => navigate({ to: '/login' })}>
              去登录
            </button>
          </div>
        )}
        {info.kind === 'ready' && !isPending && session && (
          <>
            {info.alreadyBoundToOther && (
              <p className="text-sm text-red-600">该飞书账号已绑定到其他用户，请联系客服处理。</p>
            )}
            {info.alreadyBoundToMe && !info.alreadyBoundToOther && <p className="text-sm demo-muted">当前飞书账号已绑定到你名下。</p>}
            {!info.alreadyBoundToOther && (
              <ConfirmCard
                level="red"
                actionId={`bind:${code}`}
                reasons={['绑定需要完成一次强验证']}
                summary={{
                  title: '确认绑定飞书账号',
                  fields: [
                    { label: '银行用户', value: session.user.name },
                    { label: '绑定后', value: '可在飞书内办理业务（红色操作仍需跳转 App）' },
                  ],
                }}
                busy={busy}
                error={error}
                onConfirm={doBind}
              />
            )}
          </>
        )}
        {info.kind === 'done' && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[var(--sea-ink)]">✅ 绑定成功，现在可以在飞书中使用文财了。</p>
            <button className="demo-button" type="button" onClick={() => navigate({ to: '/' })}>
              返回首页
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

void authClient
