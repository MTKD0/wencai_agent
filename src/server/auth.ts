import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { phoneNumber } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { db, auth as authSchema } from '#/server/db/client'
import { env } from '#/server/env'

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
      // 演示环境不真的发短信：验证码写入服务端日志
      sendOTP: ({ phoneNumber: phone, code }) => {
        console.log(`[auth] 演示验证码 ${phone}: ${code}`)
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
    disableCSRFCheck: true,
    useSecureCookies: env.PUBLIC_BASE_URL.startsWith('https'),
  },
  rateLimit: {
    // 演示环境关闭全局限流，登录相关的失败计数由 failedAuthCount 自行控制
    enabled: false,
  },
})

export type Auth = typeof auth
