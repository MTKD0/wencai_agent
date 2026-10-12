import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { useSession } from '#/lib/auth-client'
import { UnauthorizedError, useBindCode } from '#/lib/queries'
import type { StepUpPayload } from '#/lib/queries'
import ConfirmCard from '#/components/chat/ConfirmCard'
import ThemeToggle from '#/components/ThemeToggle'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ArrowLeft, Loader2, Link2, CheckCircle2 } from 'lucide-react'

export const Route = createFileRoute('/bind')({
  component: BindPage,
  validateSearch: (s: Record<string, unknown>) => ({ code: typeof s.code === 'string' ? s.code : '' }),
})

function BindPage() {
  const { code } = useSearch({ from: '/bind' })
  const { data: session, isPending: sessionPending } = useSession()
  const bindCode = useBindCode(code)
  const navigate = useNavigate()

  return (
    <div className="min-h-screen w-full bg-background text-foreground flex flex-col font-sans">
      <header className="sticky top-0 z-30 w-full border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-md items-center justify-between px-4 h-14">
          <Button variant="ghost" size="sm" asChild className="gap-1.5 -ml-2 text-xs font-semibold">
            <a href="/">
              <ArrowLeft className="size-3.5" />
              返回首页
            </a>
          </Button>
          <span className="text-sm font-semibold">绑定外部渠道</span>
          <ThemeToggle />
        </div>
      </header>
      <main className="flex-1 max-w-md w-full mx-auto px-4 py-8 flex flex-col items-center justify-center">
        <Body code={code} bindCode={bindCode} sessionPending={sessionPending} hasSession={!!session} navigate={navigate} />
      </main>
    </div>
  )
}

type Nav = ReturnType<typeof useNavigate>

function Body({
  code,
  bindCode,
  sessionPending,
  hasSession,
  navigate,
}: {
  code: string
  bindCode: ReturnType<typeof useBindCode>
  sessionPending: boolean
  hasSession: boolean
  navigate: Nav
}) {
  if (code.length === 0) {
    return (
      <Card className="w-full p-6 text-center space-y-3 border-border bg-card">
        <p className="text-sm text-destructive font-medium">缺少绑定参数，请在飞书中重新发起绑定。</p>
        <Button variant="outline" size="sm" onClick={() => navigate({ to: '/' })}>返回首页</Button>
      </Card>
    )
  }
  if (sessionPending || bindCode.isPending) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-3 text-muted-foreground">
        <Loader2 className="size-6 animate-spin text-primary" />
        <p className="text-xs">正在校验绑定授权…</p>
      </div>
    )
  }

  if (bindCode.error) {
    if (bindCode.error instanceof UnauthorizedError) return <LoginFirst navigate={navigate} />
    return (
      <Card className="w-full p-6 text-center space-y-3 border-border bg-card">
        <p className="text-sm text-destructive font-medium">{bindCode.error.message}</p>
        <p className="text-xs text-muted-foreground">请在飞书应用中重新获取授权链接。</p>
        <Button variant="outline" size="sm" onClick={() => navigate({ to: '/' })}>返回首页</Button>
      </Card>
    )
  }

  const info = bindCode.data
  if (info?.needsLogin && !hasSession) return <LoginFirst navigate={navigate} />

  if (info?.alreadyBoundToOther) {
    return (
      <Card className="w-full p-6 text-center space-y-3 border-border bg-card">
        <p className="text-sm text-destructive font-medium">该飞书账号已绑定到其他用户，请联系客服处理。</p>
        <Button variant="outline" size="sm" onClick={() => navigate({ to: '/' })}>返回首页</Button>
      </Card>
    )
  }

  if (!hasSession) return <LoginFirst navigate={navigate} />
  if (!info) return null

  return (
    <div className="w-full space-y-4">
      {info.alreadyBoundToMe && (
        <p className="text-xs text-center text-muted-foreground">当前飞书账号已绑定到你名下。</p>
      )}
      <BindConfirmCard code={code} navigate={navigate} />
    </div>
  )
}

function BindConfirmCard({ code, navigate }: { code: string; navigate: Nav }) {
  const bind = useMutation({
    mutationFn: async (stepUp: StepUpPayload) => {
      const res = await fetch('/api/bind', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, stepUp }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.ok) throw new Error(body.message ?? '绑定失败')
    },
  })

  if (bind.isSuccess) {
    return (
      <Card className="w-full p-6 text-center space-y-4 border-border bg-card">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
          <CheckCircle2 className="size-6" />
        </div>
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-foreground">绑定成功</h2>
          <p className="text-xs text-muted-foreground">现在可以在飞书机器人中快捷办理文财业务了。</p>
        </div>
        <Button className="w-full" onClick={() => navigate({ to: '/' })}>
          返回首页
        </Button>
      </Card>
    )
  }

  return (
    <ConfirmCard
      level="red"
      actionId={`bind:${code}`}
      reasons={['绑定需要完成一次强验证']}
      summary={{
        title: '确认绑定飞书账号',
        fields: [
          { label: '绑定后', value: '可在飞书内办理业务' },
          { label: '限制', value: '高危操作仍需跳转 App 完成强验证' },
        ],
      }}
      error={bind.error?.message}
      onConfirm={(stepUp) => {
        if (!stepUp) return
        bind.mutate(stepUp)
      }}
    />
  )
}

function LoginFirst({ navigate }: { navigate: Nav }) {
  return (
    <Card className="w-full p-6 text-center space-y-4 border-border bg-card">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-secondary text-foreground">
        <Link2 className="size-6" />
      </div>
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-foreground">请先登录</h2>
        <p className="text-xs text-muted-foreground">登录文财账户后，即可完成与外部渠道的授权绑定。</p>
      </div>
      <Button className="w-full" onClick={() => navigate({ to: '/login' })}>
        前往登录
      </Button>
    </Card>
  )
}
