import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { authClient } from '#/lib/auth-client'
import ThemeToggle from '#/components/ThemeToggle'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PhoneInput, resolvePhoneNumber, type PhoneInputValue } from '@/components/ui/phone-input'
import { Landmark, ArrowLeft, Loader2, AlertCircle } from 'lucide-react'
import { cn } from 'cn'

/** 手机号 + 短信验证码登录（演示环境验证码打在控制台） */
export const Route = createFileRoute('/login')({
  // 可选的注册入口：返回可选字段，避免破坏其他页面到 /login 的跳转。
  validateSearch: (s: Record<string, unknown>) => (s.register === '1' || s.register === true ? { register: true as const } : {}),
  component: LoginPage,
})

type Step = 'phone' | 'code'

function LoginPage() {
  const navigate = useNavigate()
  const { refetch } = authClient.useSession()
  const { register: wantRegister } = Route.useSearch()
  const [register, setRegister] = useState(!!wantRegister)
  const [step, setStep] = useState<Step>('phone')
  const [name, setName] = useState('')
  const [nationalPhone, setNationalPhone] = useState('')
  const [phoneMeta, setPhoneMeta] = useState<PhoneInputValue>(() => resolvePhoneNumber(''))
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const sendCode = async () => {
    setError('')
    setBusy(true)
    try {
      // 提交给服务端的号码（中国大陆为 11 位，国际号为 E.164 规范）
      const targetPhone = phoneMeta.submissionNumber || nationalPhone
      const res = await authClient.phoneNumber.sendOtp({ phoneNumber: targetPhone })
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
      const targetPhone = phoneMeta.submissionNumber || nationalPhone
      // 注册额外字段由手机号插件的服务端钩子校验，不接受客户端直接建号。
      if (register) {
        const response = await fetch('/api/auth/phone-number/verify', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ phoneNumber: targetPhone, code, registration: true, registrationName: name.trim() }),
        })
        const body = await response.json()
        if (!response.ok) throw new Error(body.message ?? '验证码验证失败')
      } else {
        const res = await authClient.phoneNumber.verify({ phoneNumber: targetPhone, code }, {
          onError: (ctx) => setError(ctx.error.message),
        })
        if (res?.error) { setError(res.error.message ?? '验证失败'); return }
      }
      // 等会话缓存更新后再进入首页，避免首页用旧的未登录状态跳回登录页。
      await refetch()
      await navigate({ to: '/' })
    } catch (err) {
      setError(err instanceof Error ? err.message : '验证失败')
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
            {step === 'code'
              ? `验证码已发送至 ${phoneMeta.formatted || nationalPhone}`
              : register
                ? '用一句话，开启更轻松的金融生活'
                : '支持中国大陆及全球国际手机号，智能识别区号'}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {step === 'phone' && (
            <div className="flex gap-2 rounded-xl bg-muted p-1">
              {([
                { label: '手机登录', value: false },
                { label: '注册账户', value: true },
              ] as const).map((option) => (
                <button
                  key={option.label}
                  type="button"
                  className={cn(
                    'flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                    register === option.value
                      ? 'bg-card text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  aria-pressed={register === option.value}
                  onClick={() => {
                    setRegister(option.value)
                    setError('')
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
          {step === 'phone' ? (
            <form
              className="space-y-3.5"
              onSubmit={(e) => {
                e.preventDefault()
                if (register && !name.trim()) {
                  setError('请填写真实户名')
                  return
                }
                if (!phoneMeta.isValid && nationalPhone.length < 5) {
                  setError('请输入有效的手机号码')
                  return
                }
                void sendCode()
              }}
            >
              {register && (
                <div className="space-y-1.5 text-left">
                  <label className="text-xs font-semibold text-foreground" htmlFor="name">
                    户名
                  </label>
                  <Input
                    id="name"
                    autoComplete="name"
                    placeholder="请输入真实户名"
                    value={name}
                    maxLength={60}
                    onChange={(e) => setName(e.target.value)}
                    disabled={busy}
                    autoFocus
                  />
                </div>
              )}
              <div className="space-y-1.5 text-left">
                <label className="text-xs font-semibold text-foreground" htmlFor="phone">
                  手机号码
                </label>
                <PhoneInput
                  id="phone"
                  value={nationalPhone}
                  onChange={(val, meta) => {
                    setError('')
                    setNationalPhone(val)
                    setPhoneMeta(meta)
                  }}
                  disabled={busy}
                  autoFocus
                />
              </div>

              <Button
                className="w-full font-medium"
                type="submit"
                disabled={busy || (!phoneMeta.isValid && nationalPhone.length < 5) || (register && !name.trim())}
              >
                {busy ? (
                  <>
                    <Loader2 className="size-4 animate-spin mr-1.5" />
                    正在发送验证码…
                  </>
                ) : register ? (
                  '注册账户'
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
                ) : register ? (
                  '验证并注册'
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

          {step === 'code' && register && (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => { setRegister(false); setStep('phone'); setCode(''); setError('') }}
              className="w-full text-xs text-muted-foreground hover:text-foreground"
            >
              已有账号？改用手机号登录
            </Button>
          )}

        <CardFooter className="justify-center border-t border-border/40 py-3 text-[11px] text-muted-foreground">
          {register
            ? '注册后即可使用，申请银行卡时设置该卡专属密码'
            : '智能兼容国际区号 · 身份由服务端安全会话认定'}
        </CardFooter></Card>
    </div>
  )
}
