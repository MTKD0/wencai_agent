import { describe, expect, it } from 'vitest'
import { chineseAmounts, parseChineseNumber } from '#/lib/chinese-amount'
import { requestedAmounts } from '#/lib/requested-amounts'
import { collectEvidence, verifyNumbers } from '#/server/verify/numbers'

describe('中文数字金额', () => {
  it('解析常见写法', () => {
    expect(['五万二千', '两万五千', '一千零五', '十二', '一百二十三', '3千', '1万2千', '三千五', '两万五', '一亿'].map(parseChineseNumber))
      .toEqual([52_000, 25_000, 1005, 12, 123, 3000, 12_000, 3500, 25_000, 100_000_000])
  })
  it('含糊说法、序数和量词不算金额', () => {
    expect(chineseAmounts('几十元、上千元、第一块、一块儿去、三点五万元', { requireUnit: true })).toEqual([])
    expect(requestedAmounts('帮我转一笔钱，再转五次')).toEqual([])
  })
  it('用户说的中文金额算作出处', () => {
    expect(requestedAmounts('给妈妈转五千')).toEqual([5000])
    expect(requestedAmounts('转两万五千元给房东')).toEqual([25_000])
    expect(requestedAmounts('给妈妈转 5000')).toEqual([5000])
  })
})

describe('数字核验覆盖中文数字', () => {
  const evidence = collectEvidence([{ balance: 52_000 }])
  it('有出处的中文金额放行，编造的拦下', () => {
    expect(verifyNumbers('您的余额为五万二千元。', evidence)).toEqual([])
    expect(verifyNumbers('您的余额为九万九千元。', evidence)).toEqual([{ text: '九万九千元', kind: 'amount' }])
    expect(verifyNumbers('余额 5万2千元。', evidence)).toEqual([])
  })
  it('日常用语不误拦', () => {
    expect(verifyNumbers('一起去看看吧，几十元的小额支出不用担心。餐饮和娱乐是最值得先看的两块。', evidence)).toEqual([])
    expect(verifyNumbers('只花了两块钱', evidence)).toEqual([{ text: '两块', kind: 'amount' }])
  })
})
