import { afterEach, describe, expect, it, vi } from 'vitest'
import { adminApi } from '#/components/admin/client'

afterEach(() => vi.unstubAllGlobals())

describe('后台 API 客户端账户上下文', () => {
  it('所有业务查询携带所选用户，切换后不沿用上一个用户', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {} })))
    // 每次返回独立响应，模拟真实请求的单次 body 读取。
    fetcher.mockImplementation(async () => Response.json({ data: {} }))
    vi.stubGlobal('fetch', fetcher)
    for (const id of ['user_a', 'user_b']) {
      await adminApi.snapshot(id)
      await adminApi.report(id, '2026-10')
      await adminApi.anomalies(id)
    }
    expect(fetcher.mock.calls.map(([url]) => new URL(url as string, 'http://localhost').searchParams.get('userId')))
      .toEqual(['user_a', 'user_a', 'user_a', 'user_b', 'user_b', 'user_b'])
  })

  it('写命令使用所选用户请求头，不依赖默认演示账户', async () => {
    const fetcher = vi.fn(async () => Response.json({ data: { ok: true } }))
    vi.stubGlobal('fetch', fetcher)
    await adminApi.command('user_b', { type: 'runJobs' })
    expect(fetcher).toHaveBeenCalledWith('/api/admin', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ 'x-admin-user': 'user_b' }),
      body: JSON.stringify({ type: 'runJobs' }),
    }))
  })
})
