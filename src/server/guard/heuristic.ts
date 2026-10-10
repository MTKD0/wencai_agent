import { ALLOW } from './types'
import type { GuardProvider, GuardVerdict } from './types'

const PATTERNS: { category: string; re: RegExp; weight: number }[] = [
  { category: 'override', re: /(忽略|无视|忘记|跳过).{0,8}(之前|以上|前面|所有|系统).{0,6}(规则|指令|提示|设定|限制)/, weight: 0.9 },
  { category: 'override', re: /ignore (all )?(previous|prior|above) (instructions|rules)/i, weight: 0.9 },
  { category: 'role_hijack', re: /(你现在是|假装你是|扮演).{0,6}(管理员|开发者|系统|DAN|无限制)/, weight: 0.8 },
  { category: 'role_hijack', re: /you are now (an? )?(admin|developer|dan|unrestricted)/i, weight: 0.8 },
  { category: 'prompt_leak', re: /(输出|显示|告诉我|打印).{0,6}(系统提示|system prompt|初始指令)/i, weight: 0.7 },
  { category: 'privilege', re: /(无需|不用|跳过|绕过).{0,4}(确认|验证|密码|人脸|风控)/, weight: 0.85 },
  { category: 'fake_system', re: /(\[|【)\s*(system|系统|SYSTEM)\s*(\]|】)/, weight: 0.6 },
]

/** 规则启发式：零依赖、零延迟，作为兜底与第一道筛查 */
export const heuristicGuard: GuardProvider = {
  name: 'heuristic',
  async check(text): Promise<GuardVerdict> {
    let score = 0
    const categories = new Set<string>()
    for (const p of PATTERNS) {
      if (p.re.test(text)) {
        score = Math.max(score, p.weight)
        categories.add(p.category)
      }
    }
    if (score === 0) return ALLOW('heuristic')
    return {
      verdict: score >= 0.8 ? 'block' : 'flag',
      score,
      categories: [...categories],
      provider: 'heuristic',
    }
  },
}
