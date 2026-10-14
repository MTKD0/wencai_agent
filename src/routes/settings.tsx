import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { authClient, useSession } from '#/lib/auth-client'
import { UnauthorizedError, usePasskeyDelete, useSecurityAction, useSettings } from '#/lib/queries'
import ThemeToggle from '#/components/ThemeToggle'
import { useStrongVerification } from '#/components/ui/StrongVerification'
import { CardPasswordAction } from '#/components/ui/CardPasswordAction'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Laptop, KeyRound, AlertCircle, Loader2 } from 'lucide-react'

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
    if (sessionPending) return <Muted>正在加载安全配置…</Muted>
    if (!session) return <Muted>请先登录后再查看安全设置。</Muted>
    if (settings.isPending) return <Muted>正在加载安全配置…</Muted>
    if (settings.error) {
      if (settings.error instanceof UnauthorizedError) return <Muted>登录已过期，请重新登录。</Muted>
      return <Muted>加载失败：{settings.error.message}</Muted>
    }
    return (
      <SettingsBody
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
    )
  })()

  return (
    <Shell>
      {body}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive" role="alert">
          <AlertCircle className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
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
    <div className="space-y-6">
      {/* 账号信息 */}
      <Card className="border-border bg-card shadow-xs">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">账号与身份</CardTitle>
            <Badge variant="outline" className="text-xs">已认证</Badge>
          </div>
          <CardDescription className="text-xs">个人账户基本安全身份</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between pt-0">
          <div>
            <div className="font-semibold text-foreground text-sm">{data.user.name}</div>
            <div className="text-xs text-muted-foreground">用户唯一标识: {data.user.id}</div>
          </div>
          <Button variant="outline" size="sm" onClick={() => void onSignOut()} className="text-xs">
            退出登录
          </Button>
        </CardContent>
      </Card>

      {/* 登录设备 */}
      <Card className="border-border bg-card shadow-xs">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">登录设备管理</CardTitle>
          <CardDescription className="text-xs">移除未授权的设备，该设备上的登录会话将立即失效</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          {data.sessions.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/70 p-3 text-xs bg-muted/20">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Laptop className="size-3.5 text-muted-foreground" />
                  <span className="font-medium text-foreground truncate">
                    {s.id === currentSessionId ? '当前设备' : (s.userAgent ?? '未知设备')}
                  </span>
                  {s.id === currentSessionId && <Badge variant="secondary" className="text-[10px] py-0">本机</Badge>}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {s.ipAddress ?? '未知 IP'} · 到期 {new Date(s.expiresAt).toLocaleDateString('zh-CN')}
                </div>
              </div>
              {s.id !== currentSessionId && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => onAction({ action: 'revoke_session', sessionId: s.id })}
                  className="h-7 text-xs text-destructive hover:bg-destructive/10"
                >
                  下线
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 渠道绑定 */}
      <Card className="border-border bg-card shadow-xs">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">第三方渠道绑定</CardTitle>
          <CardDescription className="text-xs">绑定后可在外部协同办公渠道办理业务，高危操作仍需回到 App 进行二次强验证</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          {data.bindings.length === 0 && <p className="text-xs text-muted-foreground py-2">暂未绑定任何外部渠道。</p>}
          {data.bindings.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/70 p-3 text-xs bg-muted/20">
              <span className="font-medium text-foreground">{b.channel === 'lark' ? '飞书机器人' : b.channel}</span>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => onAction({ action: 'revoke_binding', bindingId: b.id })}
                className="h-7 text-xs text-destructive hover:bg-destructive/10"
              >
                解绑
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 每张银行卡独立交易密码 */}
      <Card className="border-border bg-card shadow-xs">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">银行卡交易密码</CardTitle>
          <CardDescription className="text-xs">
            每张卡单独设置密码，申请新卡时完成设置。密码仅在独立安全页面输入，不经过本页面。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          {data.cards.map((card) => (
            <div key={card.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/20 p-3 text-xs">
              <div className="min-w-0">
                <div className="font-medium text-foreground">{card.name}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  尾号 {card.last4} · {card.hasPassword ? '已设置密码' : '待设置密码'}
                </div>
              </div>
              <CardPasswordAction cardId={card.id} last4={card.last4} hasPassword={card.hasPassword} />
            </div>
          ))}
          {!data.cards.length && (
            <p className="text-xs text-muted-foreground">
              你还没有银行卡，申请第一张卡时再设置密码即可。
            </p>
          )}
        </CardContent>
      </Card>

      {/* 强验证与交易密码 */}
      <Card className="border-border bg-card shadow-xs">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">强验证与安全凭据</CardTitle>
          <CardDescription className="text-xs">
            当前支持：{methods.length ? methods.join(' · ') : '无'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault()
              try {
                const stepUp = await verification.getProof()
                onAction({ action: 'set_tx_password', password, stepUp })
                setPassword('')
              } catch (error) {
                setError(error instanceof Error ? error.message : '验证失败')
              }
            }}
          >
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">设置或修改 6 位交易密码</label>
              <Input
                inputMode="numeric"
                maxLength={6}
                placeholder="请输入 6 位数字密码"
                value={password}
                disabled={busy || verification.verifying}
                onChange={(e) => setPassword(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="font-mono tracking-widest text-center"
              />
            </div>
            {verification.controls}
            <Button className="w-full" type="submit" disabled={busy || password.length !== 6 || !verification.ready}>
              保存交易密码
            </Button>
          </form>

          {data.passkeys.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-border/50">
              <span className="text-xs font-semibold text-foreground">已注册的 Passkey</span>
              {data.passkeys.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/70 p-3 text-xs bg-muted/20">
                  <div className="flex items-center gap-2">
                    <KeyRound className="size-3.5 text-muted-foreground" />
                    <span className="font-medium text-foreground">Passkey 生物认证凭证{p.backedUp ? '（已云同步）' : ''}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => onDeletePasskey(p.id)}
                    className="h-7 text-xs text-destructive hover:bg-destructive/10"
                  >
                    删除
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="pt-2">
            <RegisterPasskeyButton />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

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
      <Button
        variant="outline"
        className="w-full gap-2"
        type="button"
        disabled={register.isPending}
        onClick={() => register.mutate()}
      >
        {register.isPending ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
        {register.isPending ? '正在调起系统认证…' : '添加新的 Passkey 凭据'}
      </Button>
      {register.error && (
        <p className="mt-2 text-xs text-destructive text-center">{register.error.message}</p>
      )}
    </>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-background text-foreground flex flex-col font-sans">
      <header className="sticky top-0 z-30 w-full border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 sm:px-6 h-14">
          <Button variant="ghost" size="sm" asChild className="gap-1.5 -ml-2 text-xs font-semibold">
            <a href="/">
              <ArrowLeft className="size-3.5" />
              返回文财首页
            </a>
          </Button>
          <ThemeToggle />
        </div>
      </header>
      <main className="flex-1 max-w-2xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">{children}</main>
    </div>
  )
}

function Muted({ children }: { children: React.ReactNode }) {
  return <div className="text-center py-16 text-sm text-muted-foreground">{children}</div>
}
