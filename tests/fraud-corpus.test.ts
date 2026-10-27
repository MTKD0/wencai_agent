import { describe, expect, it } from 'vitest'
import { FRAUD_CORPUS, fraudStats, runFraudCorpus } from '#/server/security/fraud-corpus'

describe('诱导转账留出评测集', () => {
  it('诈骗 35 条（含 5 条沉默型）、正常 20 条，编号唯一', () => {
    expect(FRAUD_CORPUS.filter((c) => c.kind === 'scam')).toHaveLength(35)
    expect(FRAUD_CORPUS.filter((c) => c.kind === 'benign')).toHaveLength(20)
    expect(new Set(FRAUD_CORPUS.map((c) => c.id)).size).toBe(FRAUD_CORPUS.length)
  })
  it('确定性的前两层不低于 2026-10-28 首次测得的水平（模型层见 pnpm fraud-eval）', async () => {
    const results = await runFraudCorpus()
    const keyword = fraudStats(results, 'keyword'), behavior = fraudStats(results, 'behavior')
    // 关键词对新说法几乎不泛化（0/35），保留它是为了零延迟、可解释的确定命中；误报不得增加
    expect(keyword.falsePositive.count).toBeLessThanOrEqual(1)
    expect(behavior.recall.count).toBeGreaterThanOrEqual(26)
    // 第二层在刻意编写的“难正常样本”上误报 8/20；调阈值时不得更高
    expect(behavior.falsePositive.count).toBeLessThanOrEqual(8)
  })
})
