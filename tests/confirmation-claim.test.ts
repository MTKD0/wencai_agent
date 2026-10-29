import { describe, expect, it } from 'vitest'
import { checkedResponse, NO_CONFIRMATION_NOTE } from '#/server/verify/response'
import { collectEvidence, verifyNumbers } from '#/server/verify/numbers'

const evidence = [{ candidates: [{ cardId: 'card_debit', last4: '8823' }] }]

describe('没有确认单却声称已生成', () => {
  it.each([
    '已找到尾号 8823 的储蓄卡，并生成了临时锁卡确认单。请在确认卡片上核对并完成验证。',
    '锁卡确认单已生成，请核对。',
    '请在上方确认卡片上核对后完成验证。',
  ])('只调了预览工具：%s', (text) => {
    const result = checkedResponse(text, evidence, false, false)
    expect(result).toMatchObject({ blocked: true, text: NO_CONFIRMATION_NOTE })
  })

  it('本轮确实生成了确认单时照常显示', () => {
    const text = '已为你生成临时锁卡确认单，请在确认卡片上核对并完成验证。'
    expect(checkedResponse(text, evidence, false, true)).toMatchObject({ blocked: false, text })
  })

  it.each([
    '确认单还没有生成，需要先选择要锁的卡。',
    '刚才的锁卡确认单还没完成验证，付款可能会失败。',
    '尾号 8823 的卡当前状态正常。',
  ])('否定说法和普通回复不拦：%s', (text) => {
    expect(checkedResponse(text, evidence, false, false).blocked).toBe(false)
  })
})

describe('本人卡片尾号', () => {
  it('服务端给出的本人卡尾号可以复述，别人的尾号仍被拦', () => {
    const own = [{ ownCardTails: ['8823', '6601'] }]
    expect(verifyNumbers('用尾号 8823 的卡付款', collectEvidence(own), own)).toEqual([])
    expect(verifyNumbers('用尾号 1234 的卡付款', collectEvidence(own), own).map((v) => v.text)).toEqual(['尾号 1234'])
  })
})
