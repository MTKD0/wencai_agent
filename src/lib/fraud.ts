/** 确认单原因以此开头时，前端显示诱导转账劝阻提示并要求用户勾选已核实（服务端规则见 server/policy/fraud.ts） */
export const FRAUD_REASON_PREFIX = '疑似诈骗'

/** 行为画像异常（金额远超平时、首次收款人等）：前端显示较温和的提醒，同样要求勾选已核实 */
export const UNUSUAL_REASON_PREFIX = '交易异常'

/** 进入冷静期的转账：执行结果是这条登记而不是流水，补偿时要撤销登记而不是冲正 */
export interface HeldTransfer { status: 'held'; holdId: string; releaseAt: string; amountCents: number; payeeName: string }
export const isHeldTransfer = (output: unknown): output is HeldTransfer =>
  !!output && typeof output === 'object' && (output as { status?: unknown }).status === 'held' && typeof (output as { holdId?: unknown }).holdId === 'string'
