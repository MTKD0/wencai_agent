import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { phoneNumber } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { db, auth as authSchema } from '#/server/db/client'
import { env } from '#/server/env'
import { sendVerificationSMS } from '#/server/auth/step-up'

/**
 * 认证实例。仅负责「你是谁」，不涉及任何银行业务授权。
 *
 * 关键约定：
 * - userId 只由服务端从这里解析，绝不来自模型参数。
 * - 会话存库（stateful），登出/踢人立即生效。
 * - 交易密码等本地凭据存在 account.password，不用 better-auth 的邮箱密码体系。
 */
export const auth = betterAuth({
  baseURL: env.PUBLIC_BASE_URL,
  secret: env.CONFIRM_SECRET,
  trustedOrigins: [env.PUBLIC_BASE_URL, ...(['localhost', '127.0.0.1'].includes(new URL(env.PUBLIC_BASE_URL).hostname) ? ['localhost', '127.0.0.1'].map((host) => { const url = new URL(env.PUBLIC_BASE_URL); url.hostname = host; return url.origin }) : [])],
  database: drizzleAdapter(db, {
    provider: 'sqlite',
    schema: {
      ...authSchema,
      // better-auth 以小写 modelName 查找表；这里显式对齐
      user: authSchema.baUser,
      session: authSchema.baSession,
      account: authSchema.baAccount,
      verification: authSchema.baVerification,
    },
  }),
  user: {
    modelName: 'user',
    additionalFields: {},
  },
  session: {
    modelName: 'session',
    // 空闲 15 分钟未活动即过期（银行惯例）
    updateAge: 15 * 60,
    // 绝对有效期 12 小时
    expiresIn: 12 * 60 * 60,
  },
  account: {
    modelName: 'account',
    accountLinking: { enabled: false },
  },
  verification: { modelName: 'verification' },
  plugins: [
    phoneNumber({
      otpLength: 6,
      expiresIn: 300,
      // 生产必须配置短信通道；仅本地开发的登录验证码允许演示日志。
      sendOTP: async ({ phoneNumber: phone, code }) => {
        if (env.SMS_DELIVERY_URL) await sendVerificationSMS(phone, code)
        else if (env.AUTH_DEMO_MODE && process.env.NODE_ENV !== 'production') console.log(`[auth] 演示登录验证码 ${phone}: ${code}`)
        else throw new Error('登录短信通道尚未配置')
      },
      // 演示环境允许任意未注册手机号直接注册登录（自动生成占位邮箱）
      signUpOnVerification: {
        getTempEmail: (phone: string) => `${phone}@wencai.local`,
      },
    }),
    tanstackStartCookies(),
  ],
  advanced: {
    // 演示环境同时跑飞书（WebSocket 回调用不同来源）与 Web，这里信任自身来源
    disableCSRFCheck: false,
    useSecureCookies: env.PUBLIC_BASE_URL.startsWith('https'),
  },
  rateLimit: {
    // 认证端点开启限流，交易验证另有尝试计数及账户熔断。
    enabled: true,
  },
})

export type Auth = typeof auth
