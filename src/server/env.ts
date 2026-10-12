import { z } from 'zod'

const EnvSchema = z.object({
  DATABASE_URL: z.string().default('file:./data/bank.db'),
  // 待确认动作的 HMAC 密钥；生产环境必须配置
  CONFIRM_SECRET: z.string().min(16).default('dev-only-confirm-secret-change-me'),
  CONFIRM_TTL_SECONDS: z.coerce.number().default(300),

  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_MODEL: z.string().default('deepseek-flash'),
  // 降级模型（OpenAI 兼容接口，如 Qwen3）
  FALLBACK_BASE_URL: z.string().optional(),
  FALLBACK_API_KEY: z.string().optional(),
  FALLBACK_MODEL: z.string().default('qwen3-32b'),

  // Qwen3Guard（vLLM 部署的 OpenAI 兼容接口）；未配置时仅用启发式规则
  GUARD_BASE_URL: z.string().optional(),
  GUARD_API_KEY: z.string().optional(),
  GUARD_MODEL: z.string().default('Qwen/Qwen3Guard-Gen-4B'),

  // 仅种子数据的旧交易密码初始化；不能代替红色强验证。
  DEMO_TX_PASSWORD: z.string().default('123456'),
  SMS_DELIVERY_URL: z.preprocess((v) => v === '' ? undefined : v, z.url().optional()),
  SMS_DELIVERY_TOKEN: z.string().optional(),
  AUTH_DEMO_MODE: z.enum(['true', 'false']).default(process.env.NODE_ENV === 'production' ? 'false' : 'true').transform((v) => v === 'true'),
  PUBLIC_BASE_URL: z.string().default('http://localhost:3000'),

  // 银行演示管理后台；非本地开发环境必须另配 ADMIN_TOKEN。
  ADMIN_ENABLED: z
    .enum(['true', 'false'])
    .default(process.env.NODE_ENV === 'production' ? 'false' : 'true')
    .transform((v) => v === 'true'),
  ADMIN_TOKEN: z.string().min(24).optional(),
})

export const env = EnvSchema.parse(process.env)
if (process.env.NODE_ENV === 'production' && (env.CONFIRM_SECRET === 'dev-only-confirm-secret-change-me' || env.CONFIRM_SECRET.length < 32)) {
  throw new Error('生产环境必须配置至少32位的独立随机 CONFIRM_SECRET')
}
