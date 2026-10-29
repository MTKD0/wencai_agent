import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { auth, db } from '#/server/db/client'
import { env } from '#/server/env'
import { demoLoginCode, rememberDemoLoginCode } from '#/server/auth/demo-login'
import { Route } from '#/routes/api/demo-login-code'

const registered = '13900000071', fresh = '13900000072', userId = 'demo_login_code_user'
const post = (phoneNumber: string, origin = env.PUBLIC_BASE_URL) => (Route.options.server!.handlers as { POST: (ctx: { request: Request }) => Promise<Response> })
  .POST({ request: new Request('http://localhost/api/demo-login-code', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ phoneNumber }) }) })

beforeAll(async () => {
  await db.insert(auth.baUser).values({ id: userId, name: '已注册成员', email: `${registered}@wencai.local`, phoneNumber: registered, phoneNumberVerified: true, emailVerified: false, createdAt: new Date(), updatedAt: new Date() }).onConflictDoNothing()
})
afterAll(async () => { await db.delete(auth.baUser).where(eq(auth.baUser.id, userId)) })

describe('演示模式登录页验证码', () => {
  it('演示账号与未注册号码可在登录页取回验证码', async () => {
    expect(env.AUTH_DEMO_MODE).toBe(true)
    await rememberDemoLoginCode('13800000000', '246810')
    await rememberDemoLoginCode(fresh, '135790')
    expect(demoLoginCode('13800000000')?.code).toBe('246810')
    const res = await post(fresh)
    expect(res.status).toBe(200)
    expect((await res.json()).code).toBe('135790')
  })

  it('其他已注册号码不显示，只能从后台日志查看', async () => {
    await rememberDemoLoginCode(registered, '112233')
    expect(demoLoginCode(registered)).toBeUndefined()
    expect((await post(registered)).status).toBe(404)
  })

  it('5 分钟后过期', async () => {
    const now = Date.now()
    await rememberDemoLoginCode('13800000001', '998877', now)
    expect(demoLoginCode('13800000001', now + 299_000)?.code).toBe('998877')
    expect(demoLoginCode('13800000001', now + 300_000)).toBeUndefined()
  })

  it('跨站请求被拒绝', async () => {
    expect((await post('13800000000', 'https://evil.example')).status).toBe(403)
  })
})
