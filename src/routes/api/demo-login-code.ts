import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { demoLoginCode } from '#/server/auth/demo-login'
import { validRequestOrigin } from '#/server/security/request-origin'

const noStore = { 'cache-control': 'no-store' }

/** 演示模式下，登录页取回刚发送的验证码；只对演示账号和未注册号码有值（见 server/auth/demo-login.ts） */
export const Route = createFileRoute('/api/demo-login-code')({ server: { handlers: {
  POST: async ({ request }) => {
    if (!validRequestOrigin(request)) return Response.json({ message: '请求来源无效' }, { status: 403, headers: noStore })
    const body = z.object({ phoneNumber: z.string().regex(/^\+?\d{7,15}$/) }).safeParse(await request.json().catch(() => null))
    if (!body.success) return Response.json({ message: '手机号无效' }, { status: 400, headers: noStore })
    const found = demoLoginCode(body.data.phoneNumber)
    return found ? Response.json(found, { headers: noStore }) : Response.json({ message: '没有可显示的验证码' }, { status: 404, headers: noStore })
  },
} } })
