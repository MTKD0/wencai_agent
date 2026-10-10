import type { GuardProvider, GuardVerdict } from './types'

/**
 * Qwen3Guard-Gen（vLLM 部署，OpenAI 兼容接口）。
 * 输出格式形如：
 *   Safety: Unsafe
 *   Categories: Jailbreak
 */
export function createQwen3Guard(opts: {
  baseURL: string
  apiKey?: string
  model: string
  timeoutMs?: number
}): GuardProvider {
  return {
    name: 'qwen3guard',
    async check(text): Promise<GuardVerdict> {
      const res = await fetch(`${opts.baseURL.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: opts.model,
          messages: [{ role: 'user', content: text }],
          max_tokens: 64,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 1500),
      })
      if (!res.ok) throw new Error(`qwen3guard http ${res.status}`)
      const data = (await res.json()) as { choices: { message: { content: string } }[] }
      return parseQwen3GuardOutput(data.choices[0]?.message.content ?? '')
    },
  }
}

export function parseQwen3GuardOutput(content: string): GuardVerdict {
  const safety = /Safety:\s*(Safe|Unsafe|Controversial)/i.exec(content)?.[1]?.toLowerCase()
  const categories = (/Categories:\s*(.+)/i.exec(content)?.[1] ?? '')
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter((s) => s && s.toLowerCase() !== 'none')
  const verdict = safety === 'unsafe' ? 'block' : safety === 'controversial' ? 'flag' : 'allow'
  const score = verdict === 'block' ? 0.95 : verdict === 'flag' ? 0.6 : 0
  return { verdict, score, categories, provider: 'qwen3guard' }
}
