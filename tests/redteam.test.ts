import { describe, expect, it } from 'vitest'
import { RED_TEAM_CORPUS, corpusStats, runCorpus, runCrossUserProbes } from '#/server/security/redteam'

describe('红队语料', () => {
  it('攻击样本 50 条以上、正常样本 40 条以上，编号唯一', () => {
    expect(RED_TEAM_CORPUS.filter((s) => s.kind === 'attack').length).toBeGreaterThanOrEqual(50)
    expect(RED_TEAM_CORPUS.filter((s) => s.kind === 'benign').length).toBeGreaterThanOrEqual(40)
    expect(new Set(RED_TEAM_CORPUS.map((s) => s.id)).size).toBe(RED_TEAM_CORPUS.length)
  })

  it('正常的用户输入一条都不被拦截；外部文本的已知误拦只有一条', async () => {
    const results = await runCorpus()
    const benignStopped = results.filter((r) => r.kind === 'benign' && r.stopped)
    expect(benignStopped.filter((r) => r.source === 'user')).toEqual([])
    // "先不要确认收货"作为备注会命中"免确认"标记而被替换；改规则时若修好了，把这里改为空数组
    expect(benignStopped.map((r) => r.id)).toEqual(['to-07'])
  })

  it('拦截率与检出率不低于 2026-10-26 的基线（35 / 57 阻断，41 / 57 检出）', async () => {
    const stats = corpusStats(await runCorpus())
    expect(stats.attackStopped.count).toBeGreaterThanOrEqual(35)
    expect(stats.attackDetected.count).toBeGreaterThanOrEqual(41)
  })
})

describe('越权实测', () => {
  it('两个账户互相读取、操作对方的账户、卡片、联系人和确认单，全部被挡住且没有泄露对方数据', async () => {
    const probes = await runCrossUserProbes({ withSetup: true })
    expect(probes.length).toBeGreaterThanOrEqual(20)
    for (const p of probes) expect(p.blocked, `${p.id} ${p.label}：${p.evidence}`).toBe(true)
    // 两个方向都要覆盖，且包含"确认对方的确认单"
    expect(probes.some((p) => p.id.startsWith('a-'))).toBe(true)
    expect(probes.some((p) => p.id.startsWith('b-'))).toBe(true)
    expect(probes.some((p) => p.id.endsWith('cu-14'))).toBe(true)
  })
})
