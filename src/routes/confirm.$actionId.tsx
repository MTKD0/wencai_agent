import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import ConfirmCard from '#/components/chat/ConfirmCard'
import type { ConfirmCardProps } from '#/components/chat/ConfirmCard'
import { UnauthorizedError, isRetryableConfirmError, useCancelAction, useConfirmAction } from '#/lib/queries'
import type { StepUpPayload } from '#/lib/queries'
import ToolPart from '#/components/chat/ToolPart'

/** IM 渠道红色操作的 H5 跳转页：在 App 内完成强验证 */
export const Route = createFileRoute('/confirm/$actionId')({ component: ConfirmPage })

type Pending = ConfirmCardProps & { status: string }

function ConfirmPage() {
  const { actionId } = Route.useParams()
  const pending = useQuery({
    queryKey: ['confirm', actionId],
    queryFn: async (): Promise<Pending> => {
      const res = await fetch(`/api/confirm?actionId=${encodeURIComponent(actionId)}`, { credentials: 'same-origin' })
      if (res.status === 401) throw new UnauthorizedError()
      if (!res.ok) throw new Error('missing')
      return (await res.json()) as Pending
    },
    staleTime: 30_000,
    retry: false,
  })
  const confirm = useConfirmAction(actionId)
  const cancel = useCancelAction(actionId)

  const ready = pending.data?.status === 'pending'
  // 一次性操作：服务端已经拒绝（终态错误码）或已执行成功时，不再允许重试
  const settled = confirm.isSuccess || (confirm.error !== null && !isRetryableConfirmError(confirm.error))

  return (
    <div className="mx-auto max-w-md px-4 py-8">
      <h1 className="mb-4 text-lg font-semibold text-[var(--sea-ink)]">文财 · 安全验证</h1>
      {pending.isPending && <p className="text-sm demo-muted">加载中…</p>}
      {pending.error instanceof UnauthorizedError && <p className="text-sm demo-muted">登录已过期，请重新登录后再操作。</p>}
      {!pending.isPending && !ready && <p className="text-sm demo-muted">该操作不存在、已处理或已过期。</p>}
      {ready && pending.data && (
        <ConfirmCard
          {...pending.data}
          submitting={confirm.isPending || cancel.isPending}
          error={settled ? undefined : confirm.error?.message}
          done={confirm.isSuccess ? '操作已完成' : cancel.isSuccess ? '已取消' : settled ? confirm.error?.message : undefined}
          doneState={confirm.isSuccess ? 'success' : cancel.isSuccess ? 'cancelled' : 'failed'}
          onConfirm={async (stepUp?: StepUpPayload) => {
            await confirm.mutateAsync(stepUp)
          }}
          onCancel={() => cancel.mutate()}
        />
      )}
      {confirm.data?.plan && <div className="mt-4"><ToolPart part={{ type: 'tool-plan_task', toolCallId: confirm.data.plan.id, state: 'output-available', output: { status: 'plan', state: confirm.data.plan } }} /></div>}
    </div>
  )
}
