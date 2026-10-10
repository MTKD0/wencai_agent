import { describe, expect, it } from 'vitest'
import { collectEvidence, verifyNumbers } from '#/server/verify/numbers'

describe('回复数字校验（防幻觉）', () => {
  const evidence = collectEvidence([
    [{ id: 'acc_main', name: '工资卡', balance: 23568.2 }],
    { cards: [{ last4: '8823' }] },
    { balanceCents: 10050 },
  ])

  it('有出处的金额通过', () => {
    expect(verifyNumbers('您的工资卡余额为 ¥23,568.20', evidence)).toEqual([])
    expect(verifyNumbers('另一个账户 100.5 元', evidence)).toEqual([])
    expect(verifyNumbers('尾号 8823 的卡', evidence)).toEqual([])
  })

  it('编造的金额与卡号被识别', () => {
    const v = verifyNumbers('您的余额为 ¥50,000.00，尾号 9999 的卡已锁定', evidence)
    expect(v.map((x) => x.kind).sort()).toEqual(['amount', 'card_tail'])
  })

  it('不带货币单位的数字（日期、笔数）不误报', () => {
    expect(verifyNumbers('最近 30 天共有 12 笔交易', evidence)).toEqual([])
  })
})
