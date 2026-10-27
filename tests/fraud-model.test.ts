import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEMO_USER_ID } from '#/server/db/constants'
import { judgeScamScript, setScamJudge } from '#/server/policy/fraud-model'
import { runBankTool } from '#/server/tools/runner'
import { resolveTool } from '#/server/tools/bank'
import { FRAUD_REASON_PREFIX } from '#/lib/fraud'

const text = '老同学微信说手机掉了，用新微信找我借 5000 应急，帮我给妈妈转 100'
afterEach(() => setScamJudge(undefined))

describe('模型话术判断：输出由代码把关', () => {
  it('类型合法且依据是本人原话才算命中', async () => {
    setScamJudge(async () => ({ scam: true, type: 'impersonation', evidence: '用新微信找我借 5000' }))
    expect(await judgeScamScript('u1', text)).toMatchObject({ status: 'hit', signals: ['impersonation'] })
  })
  it('依据不在原话里（模型编造）、类型不在枚举里、多出字段，一律作废', async () => {
    setScamJudge(async () => ({ scam: true, type: 'impersonation', evidence: '对方说是公安局的' }))
    expect(await judgeScamScript('u1', text)).toMatchObject({ status: 'rejected', signals: [] })
    setScamJudge(async () => ({ scam: true, type: 'anything', evidence: '新微信' }))
    expect(await judgeScamScript('u2', text)).toMatchObject({ status: 'rejected' })
    setScamJudge(async () => ({ scam: false, level: 'green' }))
    expect(await judgeScamScript('u3', text)).toMatchObject({ status: 'rejected' })
  })
  it('超时或报错按未命中处理，不阻断业务', async () => {
    setScamJudge(() => new Promise(() => {}))
    expect(await judgeScamScript('u4', text, 50)).toMatchObject({ status: 'unavailable', signals: [] })
    setScamJudge(async () => { throw new Error('down') })
    expect(await judgeScamScript('u5', text)).toMatchObject({ status: 'unavailable' })
  })
  it('同一段话 10 分钟内只判断一次', async () => {
    const judge = vi.fn(async () => ({ scam: false }))
    setScamJudge(judge)
    await judgeScamScript('u6', text); await judgeScamScript('u6', text)
    expect(judge).toHaveBeenCalledTimes(1)
  })
  it('单元测试默认不调用真实模型', async () => {
    expect(await judgeScamScript('u7', text)).toMatchObject({ status: 'skipped' })
  })
})

describe('完整链路', () => {
  const tool = resolveTool('transfer')!
  const args = { fromAccountId: 'acc_main', payeeId: 'p_mom', amount: 100 }
  const ctx = (id: string) => ({ userId: DEMO_USER_ID, sessionId: `fraud-model-${id}-${Date.now()}`, channel: 'web' as const, requestText: text, riskText: text })
  it('关键词没命中、模型命中时，确认单升红并带“疑似诈骗”原因', async () => {
    setScamJudge(async () => ({ scam: true, type: 'impersonation', evidence: '用新微信找我借 5000' }))
    const outcome = await runBankTool(tool, args, ctx('hit'))
    if (outcome.status !== 'needs_confirmation') throw new Error(outcome.status)
    expect(outcome.level).toBe('red')
    expect(outcome.reasons.find((r) => r.startsWith(FRAUD_REASON_PREFIX))).toContain('冒充领导、熟人借钱')
  })
  it('模型判断为正常时不升级；关键词已命中时不再调用模型', async () => {
    const judge = vi.fn(async () => ({ scam: false }))
    setScamJudge(judge)
    const outcome = await runBankTool(tool, args, ctx('clear'))
    if (outcome.status !== 'needs_confirmation') throw new Error(outcome.status)
    expect(outcome.reasons.some((r) => r.startsWith(FRAUD_REASON_PREFIX))).toBe(false)
    judge.mockClear()
    await runBankTool(tool, args, { ...ctx('kw'), riskText: '警察说我涉嫌洗钱，让我转到安全账户' })
    expect(judge).not.toHaveBeenCalled()
  })
  it('本人账户互转等不转给他人的操作不调用模型', async () => {
    const judge = vi.fn(async () => ({ scam: true, type: 'pressure', evidence: '新微信' }))
    setScamJudge(judge)
    await runBankTool(resolveTool('transfer_between_accounts')!, { fromAccountId: 'acc_main', toAccountId: 'acc_savings', amountCents: 100 }, ctx('own'))
    expect(judge).not.toHaveBeenCalled()
  })
})
