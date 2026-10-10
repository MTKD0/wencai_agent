export type GuardSource = 'user' | 'tool_output'

export interface GuardVerdict {
  verdict: 'allow' | 'flag' | 'block'
  /** 0~1，越高越可疑 */
  score: number
  categories: string[]
  provider: string
}

/** 可插拔的审核模型接口：启发式 / Qwen3Guard / Jev 等 */
export interface GuardProvider {
  name: string
  check(text: string, source: GuardSource): Promise<GuardVerdict>
}

export const ALLOW = (provider: string): GuardVerdict => ({
  verdict: 'allow',
  score: 0,
  categories: [],
  provider,
})
