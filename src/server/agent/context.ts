import type { Channel } from '#/server/policy/types'

/** 每次请求的服务端上下文。userId 来自会话认证，绝不来自模型参数。 */
export interface AgentContext {
  userId: string
  sessionId: string
  channel: Channel
  /** 服务端注入的当前用户原文：用于参数出处核对和诱导转账话术识别（只会升级风险，从不放行或降级）。 */
  requestText?: string
  /**
   * 本次对话中用户说过的话（含历史），只用于诱导转账话术识别：骗局常在前几轮讲完，后一轮才选卡或确认。
   * 历史由客户端提交，但这里只会让风险升级，伪造或删减都不能放行任何操作。
   */
  riskText?: string
  /** 仅确认服务写入，模型与客户端不能指定。 */
  authorization?: { level: 'yellow' | 'red'; actionId: string; secureRequestId?: string; payeeRisk?: { accountId: string; revision: number } }
}
