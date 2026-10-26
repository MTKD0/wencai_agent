import { env } from '#/server/env'
import { heuristicGuard } from './heuristic'
import { createQwen3Guard } from './qwen3guard'
import type { GuardProvider, GuardSource, GuardVerdict } from './types'

const RANK = { allow: 0, flag: 1, block: 2 } as const
const NONE: GuardVerdict = { verdict: 'allow', score: 0, categories: [], provider: 'none' }

/** 多个判定取最严：先比等级，同级比可疑度 */
export function strictest(...verdicts: (GuardVerdict | undefined)[]): GuardVerdict {
  return verdicts.reduce<GuardVerdict>(
    (worst, v) =>
      v && (RANK[v.verdict] > RANK[worst.verdict] || (RANK[v.verdict] === RANK[worst.verdict] && v.score > worst.score))
        ? v
        : worst,
    NONE,
  )
}

/**
 * 组合审核：启发式与模型并行，取最严结果。
 * 模型不可用时退化为启发式（fail-to-heuristic）——审核只是第一道防线，
 * 越权由策略引擎兜底，因此不因审核服务故障而阻断全部业务。
 */
export function composeGuards(providers: GuardProvider[]): GuardProvider {
  return {
    name: providers.map((p) => p.name).join('+'),
    async check(text, source) {
      const results = await Promise.allSettled(providers.map((p) => p.check(text, source)))
      return strictest(...results.map((r) => (r.status === 'fulfilled' ? r.value : undefined)))
    },
  }
}

export const guard: GuardProvider = composeGuards([
  heuristicGuard,
  ...(env.GUARD_BASE_URL
    ? [createQwen3Guard({ baseURL: env.GUARD_BASE_URL, apiKey: env.GUARD_API_KEY, model: env.GUARD_MODEL })]
    : []),
])

export type { GuardProvider, GuardSource, GuardVerdict }
