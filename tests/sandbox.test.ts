import { describe, expect, it } from 'vitest'
import { runInSandbox } from '#/server/sandbox/quickjs'

describe('QuickJS 沙箱', () => {
  it('执行正常的分析代码', async () => {
    const r = await runInSandbox('return input.xs.reduce((a, b) => a + b, 0)', { xs: [1, 2, 3] })
    expect(r).toMatchObject({ ok: true, value: 6 })
  })

  it.each([
    ['访问 process', 'return process.env'],
    ['访问 require', 'return require("fs")'],
    ['发起网络请求', 'return fetch("https://example.com")'],
    ['修改只读输入', 'input.xs = []; return 1'],
  ])('隔离：%s 失败', async (_n, code) => {
    expect((await runInSandbox(code, { xs: [] })).ok).toBe(false)
  })

  it('死循环被超时中断', async () => {
    const r = await runInSandbox('while (true) {}', {}, { timeoutMs: 100 })
    expect(r.ok).toBe(false)
    expect(r.durationMs).toBeLessThan(2000)
  })

  it('内存超限被中断', async () => {
    const r = await runInSandbox('const a = []; while (true) a.push(new Array(1e5).fill(1))', {}, { memoryBytes: 8 * 1024 * 1024, timeoutMs: 3000 })
    expect(r.ok).toBe(false)
    // 分配到 8MB 上限前要先触发多次 GC，本机耗时 5.0–5.6 秒，会超过 Vitest 默认的 5 秒
  }, 20_000)
})
