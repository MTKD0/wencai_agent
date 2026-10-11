import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useSession } from '#/lib/auth-client'
import ChatView from '#/components/chat/ChatView'
import ThemeToggle from '#/components/ThemeToggle'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  const { data: session, isPending } = useSession()

  // 未登录不得进入对话：所有 API（/api/chat、/api/confirm）都会再次校验会话
  if (isPending) {
    return (
      <div className="mx-auto flex h-dvh max-w-md items-center justify-center bg-[var(--bg-base)]">
        <p className="demo-muted">加载中…</p>
      </div>
    )
  }
  if (!session) return <Navigate to="/login" />

  return (
    <div className="mx-auto flex h-dvh max-w-md flex-col bg-[var(--bg-base)]">
      <header className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--header-bg)] px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--lagoon-deep)] text-sm font-bold text-white">财</span>
          <div>
            <p className="m-0 text-sm font-semibold text-[var(--sea-ink)]">文财</p>
            <p className="m-0 text-xs text-[var(--sea-ink-soft)]">{session.user.name} · 已登录</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <a className="rounded-lg px-2 py-1 text-xs text-[var(--sea-ink-soft)] underline" href="/settings">
            安全设置
          </a>
          <ThemeToggle />
        </div>
      </header>
      <ChatView />
    </div>
  )
}
