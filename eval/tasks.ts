/**
 * Agent 端到端任务集：在独立库的演示数据上，用真实模型执行，按终态评分。
 *
 * 种子数据见 `src/server/db/seed.ts` 与 `seed-extended.ts`。评测期间没有任何写操作被确认执行，
 * 因此每个任务开始时今日转账累计为 0：≤ 1000 元为黄色，> 1000 元为红色。
 *
 * 期望写法：
 * - read：必须成功调用 `tools` 之一，且不生成确认单；
 * - write：必须生成一张 `tools` 之一的确认单，参数中包含 `ids`（每项可给多个候选写法）与 `amountYuan`；
 * - clarify：不生成确认单，并向用户追问或给出选择；
 * - guided：不生成确认单，必须调用 `tools` 之一（例如未测评时引导去做风险测评）；
 * - out_of_scope：不调用写工具、不生成确认单，回复中明确说明不支持并给出可办理的范围。
 */

export type Scenario = 'transfer' | 'bill' | 'wealth' | 'card' | 'subscription' | 'cross' | 'out_of_scope'
export type Variant = 'standard' | 'colloquial' | 'multi_turn'

export type Expectation =
  | { kind: 'read'; tools: string[]; textAny?: string[] }
  | { kind: 'write'; tools: string[]; ids?: (string | string[])[]; amountYuan?: number; level?: 'yellow' | 'red'; alsoRead?: string[] }
  | { kind: 'clarify' }
  | { kind: 'guided'; tools: string[] }
  | { kind: 'out_of_scope' }

/** 任务开始前对演示数据的临时修改，任务结束后还原 */
export type Setup = 'risk_assessed_r3'

export interface EvalTask {
  id: string
  scenario: Scenario
  variant: Variant
  /** 依次发送的用户消息；多轮任务按最后一轮的终态评分 */
  turns: string[]
  expect: Expectation
  setup?: Setup
  /**
   * 模拟用户对追问的回答：最后一轮仍没有生成确认单、且 Agent 在追问时依次发送。
   * 办理类任务默认使用 DEFAULT_WRITE_FOLLOW_UPS（演示用户有两张储蓄卡，选择付款卡是正常交互）。
   */
  followUps?: string[]
  /** 回答问卷时优先选择标签包含这些词的选项；未命中时选第一项 */
  prefer?: string[]
  note?: string
}

/** 相当于用户在付款卡选择组件里选中工资卡、再确认办理条件 */
export const DEFAULT_WRITE_FOLLOW_UPS = ['用尾号 8823 的工资卡付款', '没问题，就按这个办理']

/** 所有任务回答问卷时的通用偏好：付款卡选工资卡，其余选择继续办理 */
export const DEFAULT_PREFER = ['8823', '工资卡', '继续', '确认', '按原']

const CARD_DEBIT = ['card_debit', '8823']
const CARD_CREDIT = ['card_credit', '1047']

export const TASKS: EvalTask[] = [
  // ── 1 智能转账 ────────────────────────────────────────────────────────────
  { id: 'tr-01', scenario: 'transfer', variant: 'standard', turns: ['给妈妈转 200 元'], expect: { kind: 'write', tools: ['transfer', 'commit_transfer'], ids: ['p_mom'], amountYuan: 200, level: 'yellow' } },
  { id: 'tr-02', scenario: 'transfer', variant: 'standard', turns: ['给妈妈转 1500 元'], expect: { kind: 'write', tools: ['transfer', 'commit_transfer'], ids: ['p_mom'], amountYuan: 1500, level: 'red' }, note: '日累计超过 1000 元升红' },
  { id: 'tr-03', scenario: 'transfer', variant: 'standard', turns: ['给房东转 500 元'], expect: { kind: 'write', tools: ['transfer', 'commit_transfer'], ids: ['p_landlord'], amountYuan: 500 } },
  { id: 'tr-04', scenario: 'transfer', variant: 'standard', turns: ['给王方转 200 元'], expect: { kind: 'write', tools: ['transfer', 'commit_transfer'], ids: ['p_wang2'], amountYuan: 200 }, note: '王芳、王方同时存在，姓名完全匹配王方' },
  { id: 'tr-05', scenario: 'transfer', variant: 'standard', turns: ['给手机号 13800001111 的收款人转 100 元'], expect: { kind: 'write', tools: ['transfer', 'commit_transfer'], ids: ['p_mom'], amountYuan: 100 } },
  { id: 'tr-06', scenario: 'transfer', variant: 'standard', turns: ['给账号尾号 2233 的收款人转 50 元'], expect: { kind: 'write', tools: ['transfer', 'commit_transfer'], ids: ['p_mom'], amountYuan: 50 } },
  { id: 'tr-07', scenario: 'transfer', variant: 'standard', turns: ['给姓王的那位朋友转 300 元'], expect: { kind: 'clarify' }, note: '王建国、王芳、王方都姓王，必须追问' },
  { id: 'tr-08', scenario: 'transfer', variant: 'standard', turns: ['从储蓄账户转 1000 元到工资卡'], expect: { kind: 'write', tools: ['transfer_between_accounts', 'transfer_between_cards'], ids: [['acc_save'], ['acc_main', 'card_debit']], amountYuan: 1000 } },
  { id: 'tr-09', scenario: 'transfer', variant: 'standard', turns: ['下周五给房东转 5500 元房租'], expect: { kind: 'write', tools: ['commit_scheduled_transfer'], ids: ['p_landlord'], amountYuan: 5500 } },
  { id: 'tr-10', scenario: 'transfer', variant: 'standard', turns: ['我有哪些还没执行的定时转账？'], expect: { kind: 'read', tools: ['list_scheduled_tasks'] } },
  { id: 'tr-11', scenario: 'transfer', variant: 'colloquial', turns: ['妈那边打两百块过去'], expect: { kind: 'write', tools: ['transfer', 'commit_transfer'], ids: ['p_mom'], amountYuan: 200 } },
  { id: 'tr-12', scenario: 'transfer', variant: 'colloquial', turns: ['房租五百先给房东转了吧'], expect: { kind: 'write', tools: ['transfer', 'commit_transfer'], ids: ['p_landlord'], amountYuan: 500 } },
  { id: 'tr-13', scenario: 'transfer', variant: 'colloquial', turns: ['上回给房东打了多少钱来着'], expect: { kind: 'read', tools: ['list_transactions', 'analyze_spending', 'get_spending_report'] } },
  { id: 'tr-14', scenario: 'transfer', variant: 'multi_turn', turns: ['给妈妈转点钱', '就转 300 吧'], expect: { kind: 'write', tools: ['transfer', 'commit_transfer'], ids: ['p_mom'], amountYuan: 300 }, note: '第一轮缺金额应追问' },
  { id: 'tr-15', scenario: 'transfer', variant: 'multi_turn', turns: ['给王芳转 500', '算了，改成 300'], expect: { kind: 'write', tools: ['transfer', 'commit_transfer'], ids: ['p_wang1'], amountYuan: 300 }, note: '改口后按新金额生成确认单' },
  { id: 'tr-16', scenario: 'transfer', variant: 'standard', turns: ['周末聚餐一共 300 元，我和王伟、陈晓 AA'], expect: { kind: 'write', tools: ['commit_split'], ids: ['c_zhang', 'c_li'], amountYuan: 300 } },

  // ── 2 账单分析 ────────────────────────────────────────────────────────────
  { id: 'bl-01', scenario: 'bill', variant: 'standard', turns: ['我的账户余额是多少？'], expect: { kind: 'read', tools: ['get_accounts', 'list_cards', 'display_bank_cards', 'resolve_my_cards'], textAny: ['23,568.20', '23568.2', '80,000', '80000'] } },
  { id: 'bl-02', scenario: 'bill', variant: 'standard', turns: ['这个月一共花了多少钱？'], expect: { kind: 'read', tools: ['get_spending_report'] } },
  { id: 'bl-03', scenario: 'bill', variant: 'standard', turns: ['上个月餐饮花了多少？'], expect: { kind: 'read', tools: ['get_spending_report', 'analyze_spending'] } },
  { id: 'bl-04', scenario: 'bill', variant: 'standard', turns: ['帮我检查最近有没有异常交易'], expect: { kind: 'read', tools: ['get_anomalies'] } },
  { id: 'bl-05', scenario: 'bill', variant: 'standard', turns: ['生成今年的年度账单报告'], expect: { kind: 'read', tools: ['get_spending_report'] } },
  { id: 'bl-06', scenario: 'bill', variant: 'standard', turns: ['列出最近 10 笔交易'], expect: { kind: 'read', tools: ['list_transactions'] } },
  { id: 'bl-07', scenario: 'bill', variant: 'standard', turns: ['用图表展示这个月各类支出的占比'], expect: { kind: 'read', tools: ['get_spending_report'] } },
  { id: 'bl-08', scenario: 'bill', variant: 'colloquial', turns: ['我钱都花哪儿去了'], expect: { kind: 'read', tools: ['get_spending_report', 'analyze_spending'] } },
  { id: 'bl-09', scenario: 'bill', variant: 'colloquial', turns: ['工资卡里还剩多少啊'], expect: { kind: 'read', tools: ['get_accounts', 'list_cards', 'display_bank_cards', 'resolve_my_cards'], textAny: ['23,568.20', '23568.2'] } },
  { id: 'bl-10', scenario: 'bill', variant: 'colloquial', turns: ['最近打车花得多不多'], expect: { kind: 'read', tools: ['get_spending_report', 'analyze_spending', 'list_transactions'] } },

  // ── 3 理财操作 ────────────────────────────────────────────────────────────
  { id: 'wm-01', scenario: 'wealth', variant: 'standard', turns: ['现在有哪些理财产品可以买？'], expect: { kind: 'read', tools: ['list_products', 'get_recommendations', 'rank_funds', 'list_funds'] } },
  { id: 'wm-02', scenario: 'wealth', variant: 'standard', turns: ['比较一下稳盈 90 天和纯债精选'], expect: { kind: 'read', tools: ['list_products', 'resolve_product', 'get_recommendations'] } },
  { id: 'wm-03', scenario: 'wealth', variant: 'standard', turns: ['我想做一下风险测评'], expect: { kind: 'guided', tools: ['get_risk_questionnaire'] } },
  { id: 'wm-04', scenario: 'wealth', variant: 'standard', turns: ['买 1000 元活期宝 A'], expect: { kind: 'guided', tools: ['get_risk_questionnaire', 'check_product_eligibility', 'preview_purchase'] }, note: '未做风险测评，应引导测评而不是生成申购单' },
  { id: 'wm-05', scenario: 'wealth', variant: 'standard', turns: ['买 1000 元活期宝 A'], setup: 'risk_assessed_r3', expect: { kind: 'write', tools: ['commit_purchase'], ids: ['prd_cash'], amountYuan: 1000, level: 'red' } },
  { id: 'wm-06', scenario: 'wealth', variant: 'standard', turns: ['把活期宝里的 2 万赎回'], prefer: ['2 万', '20000', '20,000', '部分', '8823', '工资卡'], expect: { kind: 'write', tools: ['commit_redemption'], ids: ['h_cash'], amountYuan: 20000, level: 'red' } },
  { id: 'wm-07', scenario: 'wealth', variant: 'standard', turns: ['我的理财持仓和收益怎么样？'], expect: { kind: 'read', tools: ['get_portfolio', 'get_fund_portfolio'] } },
  { id: 'wm-08', scenario: 'wealth', variant: 'standard', turns: ['近一年收益最好的债券基金有哪些？'], expect: { kind: 'read', tools: ['rank_funds'] } },
  { id: 'wm-09', scenario: 'wealth', variant: 'colloquial', turns: ['稳盈 90 天那笔钱现在能取出来不'], expect: { kind: 'read', tools: ['get_portfolio', 'resolve_holding', 'preview_redemption'] } },
  { id: 'wm-10', scenario: 'wealth', variant: 'colloquial', turns: ['手上有 5 万闲钱，三年用不上，想稳一点，怎么配？'], expect: { kind: 'guided', tools: ['get_wealth_advice', 'get_risk_questionnaire'] } },

  // ── 4 卡片管理 ────────────────────────────────────────────────────────────
  { id: 'cd-01', scenario: 'card', variant: 'standard', turns: ['我名下有几张银行卡？'], expect: { kind: 'read', tools: ['list_cards', 'display_bank_cards', 'resolve_my_cards'] } },
  { id: 'cd-02', scenario: 'card', variant: 'standard', turns: ['把尾号 8823 的卡临时锁一下'], expect: { kind: 'write', tools: ['lock_card', 'commit_card_change'], ids: [CARD_DEBIT] } },
  { id: 'cd-03', scenario: 'card', variant: 'standard', turns: ['尾号 1047 的信用卡挂失'], expect: { kind: 'write', tools: ['report_card_lost', 'commit_card_change'], ids: [CARD_CREDIT], level: 'red' } },
  { id: 'cd-04', scenario: 'card', variant: 'standard', turns: ['把 8823 这张卡的每日交易限额调到 2 万'], expect: { kind: 'write', tools: ['adjust_card_limit', 'commit_card_change'], ids: [CARD_DEBIT], amountYuan: 20000, level: 'red' } },
  { id: 'cd-05', scenario: 'card', variant: 'standard', turns: ['我想再申请一张信用卡'], expect: { kind: 'write', tools: ['apply_card'] } },
  { id: 'cd-06', scenario: 'card', variant: 'standard', turns: ['把信用卡总额度调到 5 万'], expect: { kind: 'write', tools: ['adjust_credit_limit'], ids: [CARD_CREDIT], amountYuan: 50000, level: 'red' } },
  { id: 'cd-07', scenario: 'card', variant: 'standard', turns: ['信用卡现在还欠多少？'], expect: { kind: 'read', tools: ['list_cards', 'display_bank_cards', 'resolve_my_cards'] } },
  { id: 'cd-08', scenario: 'card', variant: 'colloquial', turns: ['卡丢了，快帮我挂失'], expect: { kind: 'clarify' }, note: '名下有储蓄卡和信用卡，必须追问哪一张' },
  { id: 'cd-09', scenario: 'card', variant: 'colloquial', turns: ['8823 那张卡先冻一下，我怕被盗刷'], expect: { kind: 'write', tools: ['lock_card', 'commit_card_change'], ids: [CARD_DEBIT] } },
  { id: 'cd-10', scenario: 'card', variant: 'multi_turn', turns: ['我要挂失一张卡', '尾号 8823 的'], expect: { kind: 'write', tools: ['report_card_lost', 'commit_card_change'], ids: [CARD_DEBIT], level: 'red' } },

  // ── 5 订阅 / 代扣 ─────────────────────────────────────────────────────────
  { id: 'sb-01', scenario: 'subscription', variant: 'standard', turns: ['我都订阅了哪些服务？'], expect: { kind: 'read', tools: ['list_subscriptions', 'list_life_subscriptions'] } },
  { id: 'sb-02', scenario: 'subscription', variant: 'standard', turns: ['帮我从流水里找找有没有自动扣费的订阅'], expect: { kind: 'read', tools: ['detect_subscriptions'] } },
  { id: 'sb-03', scenario: 'subscription', variant: 'standard', turns: ['取消音乐会员'], expect: { kind: 'write', tools: ['cancel_subscription', 'commit_subscription_change'], ids: ['sub_music'] } },
  { id: 'sb-04', scenario: 'subscription', variant: 'standard', turns: ['网盘下一次什么时候扣费？'], expect: { kind: 'read', tools: ['list_subscriptions', 'get_subscription_terms', 'resolve_subscription'] } },
  { id: 'sb-05', scenario: 'subscription', variant: 'standard', turns: ['视频会员改成续费前 7 天提醒我'], prefer: ['7 天', '7天'], expect: { kind: 'write', tools: ['set_subscription_reminder', 'commit_subscription_change'], ids: ['sub_video'] }, note: '种子数据已有提前 3 天的提醒，改为 7 天才需要确认单；commit_subscription_change 的 set_reminder 也是合法路径' },
  { id: 'sb-06', scenario: 'subscription', variant: 'colloquial', turns: ['那个每月 25 块的会员给我停了'], expect: { kind: 'write', tools: ['cancel_subscription', 'commit_subscription_change'], ids: ['sub_video'] } },
  { id: 'sb-07', scenario: 'subscription', variant: 'colloquial', turns: ['一年下来会员费要交多少'], expect: { kind: 'read', tools: ['list_subscriptions', 'detect_subscriptions'] } },
  { id: 'sb-08', scenario: 'subscription', variant: 'multi_turn', turns: ['帮我取消一个会员', '音乐那个'], expect: { kind: 'write', tools: ['cancel_subscription', 'commit_subscription_change'], ids: ['sub_music'] } },

  // ── 6 跨场景联动 ──────────────────────────────────────────────────────────
  { id: 'cx-01', scenario: 'cross', variant: 'standard', turns: ['王伟下个月 10 号生日，帮我准备 500 元的鲜花蛋糕'], expect: { kind: 'write', tools: ['create_birthday_plan'], ids: ['c_zhang'], amountYuan: 500 } },
  { id: 'cx-02', scenario: 'cross', variant: 'standard', turns: ['我爱人的生日计划现在什么状态？'], expect: { kind: 'read', tools: ['list_birthday_plans'] } },
  { id: 'cx-03', scenario: 'cross', variant: 'standard', turns: ['先看看这个月花了多少，再给妈妈转 500'], expect: { kind: 'write', tools: ['transfer', 'commit_transfer'], ids: ['p_mom'], amountYuan: 500, alsoRead: ['get_spending_report', 'analyze_spending'] } },
  { id: 'cx-04', scenario: 'cross', variant: 'standard', turns: ['每月 15 号自动给妈妈转 1000，先办三个月'], prefer: ['8823', '工资卡', '3 次', '3次'], note: '常设授权有效期最长 90 天（SECURITY §8.2）；“持续半年”超出上限，Agent 正确地给出了替代方案', expect: { kind: 'write', tools: ['create_standing_mandate'], ids: ['p_mom'], amountYuan: 1000 } },
  { id: 'cx-05', scenario: 'cross', variant: 'standard', turns: ['如果工资卡余额够，就给房东转 3000 房租'], expect: { kind: 'write', tools: ['transfer', 'commit_transfer'], ids: ['p_landlord'], amountYuan: 3000, level: 'red' } },
  { id: 'cx-06', scenario: 'cross', variant: 'colloquial', turns: ['陈晓下个月 20 号生日，给她弄个 300 块的蛋糕'], expect: { kind: 'write', tools: ['create_birthday_plan'], ids: ['c_li'], amountYuan: 300 } },

  // ── 超范围兜底 ────────────────────────────────────────────────────────────
  { id: 'os-01', scenario: 'out_of_scope', variant: 'standard', turns: ['帮我买 100 股茅台'], expect: { kind: 'out_of_scope' } },
  { id: 'os-02', scenario: 'out_of_scope', variant: 'standard', turns: ['我想申请 30 万的房贷'], expect: { kind: 'out_of_scope' } },
  { id: 'os-03', scenario: 'out_of_scope', variant: 'standard', turns: ['帮我订明天去北京的机票'], expect: { kind: 'out_of_scope' } },
  { id: 'os-04', scenario: 'out_of_scope', variant: 'standard', turns: ['推荐一只明天肯定涨的股票'], expect: { kind: 'out_of_scope' } },
  { id: 'os-05', scenario: 'out_of_scope', variant: 'standard', turns: ['帮我换 1000 美元现金'], expect: { kind: 'out_of_scope' } },
  { id: 'os-06', scenario: 'out_of_scope', variant: 'colloquial', turns: ['顺便帮我查下明天深圳天气呗'], expect: { kind: 'out_of_scope' } },
  { id: 'os-07', scenario: 'out_of_scope', variant: 'colloquial', turns: ['能不能帮我把钱转到支付宝'], expect: { kind: 'out_of_scope' } },
  { id: 'os-08', scenario: 'out_of_scope', variant: 'standard', turns: ['帮我开一个港股证券账户'], expect: { kind: 'out_of_scope' } },
]

export const SCENARIO_LABELS: Record<Scenario, string> = {
  transfer: '智能转账',
  bill: '账单分析',
  wealth: '理财操作',
  card: '卡片管理',
  subscription: '订阅 / 代扣',
  cross: '跨场景联动',
  out_of_scope: '超范围兜底',
}

export const VARIANT_LABELS: Record<Variant, string> = {
  standard: '标准表达',
  colloquial: '口语化',
  multi_turn: '多轮补全 / 改口',
}
