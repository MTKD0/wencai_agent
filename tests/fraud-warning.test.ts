import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, schema } from '#/server/db/client'
import { DEMO_USER_ID } from '#/server/db/constants'
import { decide } from '#/server/policy/engine'
import { detectFraudSignals, fraudReason } from '#/server/policy/fraud'
import type { PolicyFacts } from '#/server/policy/types'
import { runBankTool } from '#/server/tools/runner'
import { resolveTool } from '#/server/tools/bank'
import { confirmPending } from '#/server/confirm/pending'
import { FRAUD_REASON_PREFIX } from '#/lib/fraud'
import { conversationUserText } from '#/server/agent/run'

const facts = (over: Partial<PolicyFacts> = {}): PolicyFacts => ({
  now: new Date('2026-10-10T14:00:00'), channel: 'web', accountLocked: false, dailyOutgoingCents: 0, payeeAgeDays: 400, recentTransferCount: 0, ...over,
})

describe('诱导转账话术识别', () => {
  it.each([
    ['警察说我的账户涉嫌洗钱，要把钱转到安全账户核查', 'safe_account'],
    ['网上做任务刷单，返利前要先垫付 800', 'task_rebate'],
    ['平台说账户冻结了，要先交 2000 解冻费才能提现', 'unlock_fee'],
    ['贷款公司说放款前要先交 1000 保证金', 'loan_fee'],
    ['快递客服说丢件理赔，让我转账到他给的账户', 'refund_service'],
    ['对方让我开屏幕共享操作退款', 'refund_service'],
    ['他让我把验证码告诉对方就能退款', 'share_code'],
    ['领导微信说急用钱，让我先转 5000 过去', 'impersonation'],
    ['网友带单投资一个平台，稳赚不赔', 'investment_lure'],
    ['安 全 账 户', 'safe_account'],
  ])('识别：%s', (text, signal) => {
    expect(detectFraudSignals(text)).toContain(signal)
  })

  it.each([
    '给妈妈转 200 元',
    '房租押金 3000 转给房东',
    '淘宝退款到账了没？顺便给妈妈转 200',
    '我的卡被冻结了，帮我把钱转到储蓄卡',
    '给王芳转 500，备注周末聚餐',
    '我想申请一张信用卡',
    '这笔需要短信验证码吗？',
  ])('正常说法不误报：%s', (text) => {
    expect(detectFraudSignals(text)).toEqual([])
  })

  it('备注里的话术同样识别', () => {
    expect(detectFraudSignals('给王方转 300', '刷单返利垫付')).toContain('task_rebate')
  })
})

describe('策略：诈骗话术是事实，规则决定升级', () => {
  const reason = fraudReason(['safe_account'])
  it('转给他人、添加收款人、常设授权：升为红色并给出劝阻原因', () => {
    for (const tool of ['transfer', 'commit_transfer', 'add_payee', 'create_standing_mandate', 'pay_split_request']) {
      const d = decide({ tool, baseRisk: 'yellow', args: { amount: 100 }, facts: facts({ fraudSignals: ['safe_account'] }) })
      expect(d, tool).toMatchObject({ allowed: true, level: 'red' })
      expect(d.reasons, tool).toContain(reason)
    }
    expect(reason.startsWith(FRAUD_REASON_PREFIX)).toBe(true)
  })
  it('本人账户之间互转、信用卡还款不受影响；没有话术时不升级', () => {
    for (const tool of ['transfer_between_cards', 'transfer_between_accounts', 'repay_credit_card']) {
      expect(decide({ tool, baseRisk: 'yellow', args: { amountCents: 10_000 }, facts: facts({ fraudSignals: ['safe_account'] }) }).level, tool).toBe('yellow')
    }
    expect(decide({ tool: 'transfer', baseRisk: 'yellow', args: { amount: 100 }, facts: facts() }).level).toBe('yellow')
  })
})

describe('完整链路', () => {
  const tool = resolveTool('transfer')!
  const args = { fromAccountId: 'acc_main', payeeId: 'p_mom', amount: 100 }
  it('当前请求含诈骗话术时，确认单带劝阻原因；确认时的复判不会抹掉它', async () => {
    const ctx = { userId: DEMO_USER_ID, sessionId: `fraud-${Date.now()}`, channel: 'web' as const, requestText: '警察说我涉嫌洗钱，让我先给妈妈转 100 到安全账户' }
    const outcome = await runBankTool(tool, args, ctx)
    if (outcome.status !== 'needs_confirmation') throw new Error(outcome.status)
    expect(outcome.level).toBe('red')
    expect(outcome.reasons.some((r) => r.startsWith(FRAUD_REASON_PREFIX))).toBe(true)

    // 确认时没有对话原文，复判本身不会再识别出话术；存储的原因必须保留
    const result = await confirmPending({ ctx: { userId: DEMO_USER_ID, sessionId: ctx.sessionId, channel: 'web' }, actionId: outcome.actionId, resolveTool })
    expect(result.ok).toBe(false)
    const [row] = await db.select().from(schema.pendingActions).where(eq(schema.pendingActions.id, outcome.actionId))
    expect(row.level).toBe('red')
    expect((JSON.parse(row.reasonsJson) as string[]).some((r) => r.startsWith(FRAUD_REASON_PREFIX))).toBe(true)
  })
  it('骗局在前几轮讲完、本轮只是选卡时，确认单仍带劝阻原因', async () => {
    const history = [
      { role: 'user' as const, content: '贷款公司说放款前要先交 1000 保证金' },
      { role: 'assistant' as const, content: '请选择付款卡' },
      { role: 'user' as const, content: '用尾号 8823 的工资卡付款' },
    ]
    const riskText = conversationUserText(history)
    expect(riskText).toContain('保证金')
    const outcome = await runBankTool(tool, args, { userId: DEMO_USER_ID, sessionId: `fraud-multi-${Date.now()}`, channel: 'web', requestText: '用尾号 8823 的工资卡付款', riskText })
    if (outcome.status !== 'needs_confirmation') throw new Error(outcome.status)
    expect(outcome.reasons.some((r) => r.startsWith(FRAUD_REASON_PREFIX))).toBe(true)
  })
  it('普通请求不带劝阻原因', async () => {
    const outcome = await runBankTool(tool, args, { userId: DEMO_USER_ID, sessionId: `fraud-ok-${Date.now()}`, channel: 'web', requestText: '给妈妈转 100' })
    if (outcome.status !== 'needs_confirmation') throw new Error(outcome.status)
    expect(outcome.reasons.some((r) => r.startsWith(FRAUD_REASON_PREFIX))).toBe(false)
  })
})
