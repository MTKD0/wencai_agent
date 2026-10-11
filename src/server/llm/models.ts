import { createDeepSeek } from '@ai-sdk/deepseek'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import { env } from '#/server/env'

/**
 * 主模型 DeepSeek V4.1 Flash，降级模型为 OpenAI 兼容接口（如 Qwen3）。
 * 官方模型 ID 为 deepseek-flash，可通过 DEEPSEEK_MODEL 配置覆盖。
 */
export function primaryModel(): LanguageModel {
  if (env.DEEPSEEK_API_KEY) {
    return createDeepSeek({ apiKey: env.DEEPSEEK_API_KEY })(env.DEEPSEEK_MODEL)
  }
  return fallbackModel()
}

export function fallbackModel(): LanguageModel {
  if (!env.FALLBACK_BASE_URL) {
    throw new Error('未配置模型：请设置 DEEPSEEK_API_KEY 或 FALLBACK_BASE_URL')
  }
  return createOpenAICompatible({
    name: 'fallback',
    baseURL: env.FALLBACK_BASE_URL,
    apiKey: env.FALLBACK_API_KEY,
  })(env.FALLBACK_MODEL)
}
