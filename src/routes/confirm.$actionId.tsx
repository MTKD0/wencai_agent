import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import ConfirmCard from '#/components/chat/ConfirmCard'
import type { ConfirmCardProps } from '#/components/chat/ConfirmCard'

/** IM 渠道红色操作的 H5 跳转页：在 App 内完成强验证 */
export const Route = createFileRoute('/confirm/$actionId')({ component: ConfirmPage })

function ConfirmPage() {
  const { actionId } = Route.useParams()
  const [pending, setPending] = useState<(ConfirmCardProps & { status: string }) | null | 'missing'>(null)

  useEffect(() => {
    fetch(`/api/confirm?actionId=${encodeURIComponent(actionId)}`)
      .then((r) => (r.ok ? r.json() : 'missing'))
      .then(setPending)
  }, [actionId])

  return (
    <div className="mx-auto max-w-md px-4 py-8">
      <h1 className="mb-4 text-lg font-semibold text-[var(--sea-ink)]">文财 · 安全验证</h1>
      {pending === null && <p>加载中…</p>}
      {pending === 'missing' && <p>该操作不存在或无权访问。</p>}
      {pending && pending !== 'missing' &&
        (pending.status === 'pending' ? <ConfirmCard {...pending} /> : <p>该操作已{pending.status === 'expired' ? '过期' : '处理'}。</p>)}
    </div>
  )
}
