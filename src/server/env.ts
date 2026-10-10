import { z } from 'zod'

const EnvSchema = z.object({
  DATABASE_URL: z.string().default('file:./data/bank.db'),
  // 待确认动作的 HMAC 密钥；生产环境必须配置
  CONFIRM_SECRET: z.string().min(16).default('dev-only-confirm-secret-change-me'),
  CONFIRM_TTL_SECONDS: z.coerce.number().default(300),

  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_MODEL: z.string().default('deepseek-v4-flash'),
  // 降级模型（OpenAI 兼容接口，如 Qwen3）
  FALLBACK_BASE_URL: z.string().optional(),
  FALLBACK_API_KEY: z.string().optional(),
  FALLBACK_MODEL: z.string().default('qwen3-32b'),

  // Qwen3Guard（vLLM 部署的 OpenAI 兼容接口）；未配置时仅用启发式规则
  GUARD_BASE_URL: z.string().optional(),
  GUARD_API_KEY: z.string().optional(),
  GUARD_MODEL: z.string().default('Qwen/Qwen3Guard-Gen-4B'),

  // 演示用交易密码；真实系统应走加密键盘 + 服务端哈希校验
  DEMO_TX_PASSWORD: z.string().default('123456'),
  PUBLIC_BASE_URL: z.string().default('http://localhost:3000'),
})

export const env = EnvSchema.parse(process.env)
