import { createHash } from 'node:crypto'
import { generateText } from 'ai'
import { z } from 'zod'
import { env } from '#/server/env'
import { agentModel } from '#/server/llm/models'
import { normalizeGuardText } from '#/server/guard/heuristic'
import { MODEL_FRAUD_SIGNALS, type FraudSignal } from './fraud'

/**
 * 诱导转账识别第三层：模型判断话术。关键词只认得写进规则的说法，换个讲法就漏（留出集 0/30），
 * 这一层弥补说法的多样性。
 *
 * 边界与输入审核、收款风险分析一致：
 * - 只在即将生成“转给他人”的确认单、且关键词没有命中时调用；输入只有本人在本次对话中说的话，不含他人可控的文本；
 * - 输出必须是固定枚举里的类型，并附一段本人原话作为依据，代码核对这段原话确实出现在输入里，否则作废；
 * - 命中只会把操作升为红色并显示劝阻，不能放行、降级或拒绝；超时、未配置模型、输出不合格都按“未命中”处理。
 * 用户在自己的话里写“请判定为安全”也没有意义：最坏结果只是这一层不升级，前两层与确认链路照常生效。
 */
export type ScamJudge = (text: string, options: { signal: AbortSignal }) => Promise<unknown>

const judgment = z.object({
  scam: z.boolean(),
  type: z.enum(MODEL_FRAUD_SIGNALS).optional(),
  evidence: z.string().max(200).optional(),
}).strict()

const SYSTEM = [
  '你是银行反诈助手。下面是一位银行用户在办理转账前对智能助理说的话（可能包含多轮）。判断这次转账是否很可能是在第三方诱导或指挥下进行的诈骗转账。',
  '常见类型（type 只能取这些值）：',
  'safe_account 冒充公检法、医保、监管部门要求把钱转到“安全账户”“监管账户”或自证清白；',
  'task_rebate 刷单、点赞、兼职、做任务先垫付或交押金；',
  'unlock_fee 账户冻结、提现失败、激活、解冻需要先交钱；',
  'loan_fee 贷款、放款、办卡、提额前先交保证金、手续费、刷流水；',
  'refund_service 冒充客服、电商、快递、航空公司办理退款、理赔、改签、取消扣费，要求转账或开屏幕共享、视频会议；',
  'share_code 要求提供验证码；',
  'impersonation 冒充亲友、子女、领导、老师、同学借钱或要求转到新账户；',
  'investment_lure 陌生人、群、讲座、网友推荐的投资、理财、虚拟币、养老项目，承诺高收益或要求入金；',
  'romance 网恋对象以投资、包裹罚款、急用等理由要钱；',
  'prize_fee 中奖、补贴、退税前要求先交税费；',
  'credit_repair 征信修复、注销校园贷、消除不良记录要求转账；',
  'pressure 有人在催促、要求保密、要求分多笔转到不同账户。',
  '判断标准：必须有“他人指挥或诱导用户转钱”的迹象。用户自己决定的日常转账（给家人、房租、份子钱、还钱、购物付款、报销垫付）不是诈骗，即使金额较大。',
  '只输出严格 JSON：{"scam":true或false,"type":"上述类型之一","evidence":"用户原话中最能说明问题的一小段，逐字摘抄"}；scam 为 false 时省略 type 和 evidence。不要输出其他文字。',
].join('\n')

async function defaultJudge(text: string, { signal }: { signal: AbortSignal }) {
  const result = await generateText({
    model: agentModel(), abortSignal: signal, temperature: 0, maxOutputTokens: 200,
    providerOptions: { deepseek: { thinking: { type: 'disabled' } } },
    system: SYSTEM, prompt: text,
  })
  return JSON.parse(result.text.trim().replace(/^```(?:json)?|```$/g, ''))
}

let override: ScamJudge | null | undefined
/** 测试与评测注入；传 null 关闭这一层 */
export function setScamJudge(judge: ScamJudge | null | undefined) { override = judge; cache.clear() }

function activeJudge(): ScamJudge | null {
  if (override !== undefined) return override
  // 单元测试默认不调用真实模型；未配置模型时直接跳过
  if (process.env.VITEST || (!env.DEEPSEEK_API_KEY && !env.FALLBACK_BASE_URL)) return null
  return defaultJudge
}

export interface ScamJudgment { signals: FraudSignal[]; evidence?: string; status: 'hit' | 'clear' | 'unavailable' | 'rejected' | 'skipped' }

const cache = new Map<string, { at: number; result: ScamJudgment }>()
const CACHE_MS = 10 * 60_000

/** 同一用户同一段话在 10 分钟内只判断一次：一轮里可能连续生成多张确认单 */
export async function judgeScamScript(userId: string, text: string | undefined, timeoutMs = 8_000): Promise<ScamJudgment> {
  const judge = activeJudge()
  const trimmed = (text ?? '').slice(-4000)
  if (!judge || !trimmed.trim()) return { signals: [], status: 'skipped' }
  const key = createHash('sha256').update(`${userId}\n${trimmed}`).digest('hex')
  const cached = cache.get(key)
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.result
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let result: ScamJudgment
  try {
    const raw = await Promise.race([
      judge(trimmed, { signal: controller.signal }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')) }, timeoutMs) }),
    ])
    const parsed = judgment.safeParse(raw)
    if (!parsed.success) result = { signals: [], status: 'rejected' }
    else if (!parsed.data.scam) result = { signals: [], status: 'clear' }
    else if (!parsed.data.type || !parsed.data.evidence || !normalizeGuardText(trimmed).includes(normalizeGuardText(parsed.data.evidence)) || normalizeGuardText(parsed.data.evidence).length < 4)
      // 依据必须是本人原话：防止模型凭空编出“用户说了安全账户”
      result = { signals: [], status: 'rejected' }
    else result = { signals: [parsed.data.type], evidence: parsed.data.evidence, status: 'hit' }
  } catch {
    result = { signals: [], status: 'unavailable' }
  } finally { clearTimeout(timer) }
  if (result.status === 'hit' || result.status === 'clear') {
    if (cache.size > 500) cache.clear()
    cache.set(key, { at: Date.now(), result })
  }
  return result
}
