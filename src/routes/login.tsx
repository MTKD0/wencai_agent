import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { authClient } from '#/lib/auth-client'
import ThemeToggle from '#/components/ThemeToggle'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Landmark, ArrowLeft, Loader2, AlertCircle } from 'lucide-react'

/** 手机号 + 短信验证码登录（演示环境验证码打在控制台） */
export const Route = createFileRoute('/login')({ component: LoginPage })

type Step = 'phone' | 'code'

function LoginPage() {
  const navigate = useNavigate()
  const { refetch } = authClient.useSession()
  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const sendCode = async () => {
    setError('')
    setBusy(true)
    try {
      // 未注册手机号同样发码：服务端配了 signUpOnVerification，验证通过即自动开户
      const res = await authClient.phoneNumber.sendOtp({ phoneNumber: phone })
      if (res.error) {
        setError(res.error.message ?? '发送失败')
        return
      }
      setStep('code')
    } finally {
      setBusy(false)
    }
  }

  const verify = async () => {
    setError('')
    setBusy(true)
    try {
      const res = await authClient.phoneNumber.verify({ phoneNumber: phone, code }, {
        onError: (ctx) => setError(ctx.error.message),
      })
      if (res?.error) setError(res.error.message ?? '验证失败')
      else {
        // 等会话缓存更新后再进入首页，避免首页用旧的未登录状态跳回登录页。
        await refetch()
        await navigate({ to: '/' })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen w-full bg-background text-foreground flex flex-col items-center justify-center p-4 relative font-sans">
      <div className="absolute top-4 right-4 sm:top-6 sm:right-6">
        <ThemeToggle />
      </div>

      <Card className="w-full max-w-sm border-border bg-card shadow-sm">
        <CardHeader className="text-center pb-4">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground mb-3 shadow-xs">
            <Landmark className="size-6" />
          </div>
          <CardTitle className="text-xl font-bold tracking-tight">文财 AI 银行</CardTitle>
          <CardDescription className="text-xs">
            {step === 'phone' ? '登录后即可查询账户、办理业务与呼唤智能助理' : `验证码已发送至 ${phone}`}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {step === 'phone' ? (
            <form
              className="space-y-3.5"
              onSubmit={(e) => {
                e.preventDefault()
                if (!/^1\d{10}$/.test(phone)) {
                  setError('请输入 11 位手机号')
                  return
                }
                void sendCode()
              }}
            >
              <div className="space-y-1.5 text-left">
                <label className="text-xs font-semibold text-foreground" htmlFor="phone">
                  手机号码
                </label>
                <Input
                  id="phone"
                  inputMode="numeric"
                  autoComplete="tel"
                  placeholder="13800000000"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
                  className="font-mono text-sm tracking-wide"
                  disabled={busy}
                  autoFocus
                />
              </div>

              <Button className="w-full font-medium" type="submit" disabled={busy || phone.length !== 11}>
                {busy ? (
                  <>
                    <Loader2 className="size-4 animate-spin mr-1.5" />
                    正在发送验证码…
                  </>
                ) : (
                  '获取验证码'
                )}
              </Button>
            </form>
          ) : (
            <form
              className="space-y-3.5"
              onSubmit={(e) => {
                e.preventDefault()
                if (!/^\d{6}$/.test(code)) {
                  setError('请输入 6 位验证码')
                  return
                }
                void verify()
              }}
            >
              <div className="space-y-1.5 text-left">
                <label className="text-xs font-semibold text-foreground" htmlFor="code">
                  6 位短信验证码
                </label>
                <Input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  value={code}
                  maxLength={6}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="font-mono text-center text-lg tracking-widest"
                  disabled={busy}
                  autoFocus
                />
              </div>

              <Button className="w-full font-medium" type="submit" disabled={busy || code.length !== 6}>
                {busy ? (
                  <>
                    <Loader2 className="size-4 animate-spin mr-1.5" />
                    正在安全验证…
                  </>
                ) : (
                  '登录账户'
                )}
              </Button>

              <div className="text-center pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => {
                    setError('')
                    setCode('')
                    setStep('phone')
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground gap-1"
                >
                  <ArrowLeft className="size-3" />
                  更换手机号
                </Button>
              </div>
            </form>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-2.5 text-xs text-destructive text-left" role="alert">
              <AlertCircle className="size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </CardContent>

        <CardFooter className="justify-center border-t border-border/40 py-3 text-[11px] text-muted-foreground">
          身份由服务端安全会话认定 · 模拟银行环境
        </CardFooter>
      </Card>
    </div>
  )
}
