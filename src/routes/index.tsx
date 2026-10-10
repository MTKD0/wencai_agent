import { createFileRoute } from '@tanstack/react-router'
import ChatView from '#/components/chat/ChatView'
import ThemeToggle from '#/components/ThemeToggle'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <div className="mx-auto flex h-dvh max-w-md flex-col bg-[var(--bg-base)]">
      <header className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--header-bg)] px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--lagoon-deep)] text-sm font-bold text-white">财</span>
          <div>
            <p className="m-0 text-sm font-semibold text-[var(--sea-ink)]">文财</p>
            <p className="m-0 text-xs text-[var(--sea-ink-soft)]">银行 AI 智能体</p>
          </div>
        </div>
        <ThemeToggle />
      </header>
      <ChatView />
    </div>
  )
}
