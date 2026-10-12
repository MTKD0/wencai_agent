import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import ConfirmCard from '#/components/chat/ConfirmCard'
import type { ConfirmCardProps } from '#/components/chat/ConfirmCard'
import { UnauthorizedError, isRetryableConfirmError, useCancelAction, useConfirmAction } from '#/lib/queries'
import type { StepUpPayload } from '#/lib/queries'
import { PlanView } from '#/components/chat/ToolPart'

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
    <div className="min-h-screen w-full bg-background text-foreground flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center">
          <h1 className="text-xl font-bold tracking-tight text-foreground">文财 · 安全二次核验</h1>
          <p className="text-xs text-muted-foreground mt-1">关键金融与高危业务需要你在此完成授权确认</p>
        </div>
        {pending.isPending && <p className="text-sm text-center text-muted-foreground py-8">正在读取操作详情…</p>}
        {pending.error instanceof UnauthorizedError && (
          <p className="text-sm text-center text-muted-foreground py-8">登录凭证已过期，请重新登录后再操作。</p>
        )}
        {!pending.isPending && !ready && (
          <p className="text-sm text-center text-muted-foreground py-8">该操作不存在、已由其他会话处理或已过期。</p>
        )}
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
        {confirm.data?.plan && <div className="mt-4"><PlanView state={confirm.data.plan} /></div>}
      </div>
    </div>
  )
}
