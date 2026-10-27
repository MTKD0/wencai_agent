import { normalizeGuardText } from '#/server/guard/heuristic'
import { FRAUD_REASON_PREFIX } from '#/lib/fraud'

/**
 * 诱导转账话术识别：确定性规则，只产生"事实"（命中了哪类话术），是否升级由 rules.ts 决定。
 *
 * 识别对象是本人的当前请求与转账备注。命中只会把转账升为红色并强制展示劝阻提示，
 * 不会拒绝交易、不下"您被骗了"的结论——误报的代价是多看一次提示、多验证一次。
 */
export type FraudSignal =
  | 'safe_account'
  | 'task_rebate'
  | 'unlock_fee'
  | 'loan_fee'
  | 'refund_service'
  | 'share_code'
  | 'impersonation'
  | 'investment_lure'
  // 以下类型只由第三层模型判断产生（policy/fraud-model.ts），关键词规则不覆盖
  | 'romance'
  | 'prize_fee'
  | 'credit_repair'
  | 'pressure'

/** 模型判断可以输出的全部类型 */
export const MODEL_FRAUD_SIGNALS = ['safe_account', 'task_rebate', 'unlock_fee', 'loan_fee', 'refund_service', 'share_code', 'impersonation', 'investment_lure', 'romance', 'prize_fee', 'credit_repair', 'pressure'] as const satisfies readonly FraudSignal[]

export const FRAUD_SIGNAL_TEXT: Record<FraudSignal, string> = {
  safe_account: '公检法或"安全账户"',
  task_rebate: '刷单返利、做任务垫付',
  unlock_fee: '解冻费、提现手续费',
  loan_fee: '贷款前先交保证金或手续费',
  refund_service: '冒充客服退款或屏幕共享',
  share_code: '把验证码告诉他人',
  impersonation: '冒充领导、熟人借钱',
  investment_lure: '带单投资、内幕高收益',
  romance: '网恋对象要钱',
  prize_fee: '中奖或补贴前先交税费',
  credit_repair: '征信修复、注销校园贷',
  pressure: '有人催促、要求保密或分笔转账',
}

/** 规则在去掉空白与不可见字符、统一全半角后的文本上匹配（与输入审核相同的规范化） */
const RULES: [FraudSignal, RegExp][] = [
  ['safe_account', /安全账户|资金核查|清查资金|(?:公安|警察|警官|检察院|法院|公检法).{0,20}(?:转账|汇款|转到|打到|转入|转钱)|涉嫌(?:洗钱|犯罪|案件).{0,20}(?:转|汇|冻结)/],
  ['task_rebate', /刷单|做任务.{0,10}(?:垫付|返现|返佣|返利)|先垫付.{0,10}(?:返|佣金)|返利.{0,8}(?:先转|垫付)/],
  ['unlock_fee', /解冻(?:费|金)|冻结.{0,10}(?:交|缴)(?:费|钱|保证金)|流水不足|激活费|(?:提现|出金).{0,10}(?:先交|先转|先付|手续费|保证金)/],
  ['loan_fee', /(?:贷款|放款|借款|额度|下款).{0,12}(?:先交|先转|先付|保证金|手续费|验资|解冻|工本费)/],
  // 必须是"有人指挥我"转账或提供验证码；单纯提到退款到账不算
  ['refund_service', /(?:客服|快递员|商家|平台)(?:人员)?.{0,6}(?:说|让|要求|叫|指导|教).{0,20}(?:转账|转钱|转到|转给|汇款|验证码|备用金|借呗|网贷|贷款)|共享屏幕|屏幕共享|开启会议.{0,6}共享/],
  ['share_code', /(?:验证码|动态码|短信码).{0,8}(?:告诉|发给|报给|给)(?:对方|他|她|客服|警察|那个人)/],
  ['impersonation', /(?:领导|老板|老师|校长|经理).{0,12}(?:急用钱|让我(?:先)?转|帮忙转|垫付)|(?:换了|新的?)(?:手机)?号码.{0,12}(?:借钱|转账|急用)|冒充/],
  ['investment_lure', /带单|内幕消息|稳赚不赔|保本高收益|网友.{0,12}(?:投资|平台|理财)|导师.{0,8}(?:带|推荐).{0,6}(?:投资|平台)/],
]

export function detectFraudSignals(...texts: (string | undefined)[]): FraudSignal[] {
  const text = normalizeGuardText(texts.filter(Boolean).join('\n'))
  if (!text) return []
  return RULES.filter(([, re]) => re.test(text)).map(([signal]) => signal)
}

/** 确认单上展示的原因。以 FRAUD_REASON_PREFIX 开头，前端据此显示劝阻提示并要求用户勾选已核实。 */
export function fraudReason(signals: FraudSignal[]) {
  return `${FRAUD_REASON_PREFIX}：识别到${signals.map((s) => `“${FRAUD_SIGNAL_TEXT[s]}”`).join('、')}等典型话术，已升级为强验证`
}

