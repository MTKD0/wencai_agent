// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { UIProvider } from '#/components/ui/provider'
import { PlanView } from '#/components/chat/ToolPart'
import type { PlanState } from '#/server/executor/executor'

const clients: QueryClient[] = []
afterEach(() => {
  cleanup()
  clients.forEach((client) => client.clear())
  clients.length = 0
  vi.unstubAllGlobals()
})
it('计划轮询后自动将第一笔确认单换为第二笔，不发送继续消息', async () => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  window.matchMedia = vi
    .fn()
    .mockImplementation((query) => ({
      matches: query.includes('reduced-motion'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  const pending = (id: string, amount: string) => ({
    status: 'needs_confirmation',
    actionId: id,
    level: 'yellow',
    reasons: [],
    summary: { title: `确认转账 ${amount} 元`, fields: [{ label: '金额', value: `¥${amount}` }] },
    expiresAt: Date.now() + 300000,
  })
  const original: PlanState = {
    id: 'plan-ui-next',
    status: 'suspended',
    completed: [],
    plan: {
      goal: '依次办理2笔转账',
      nodes: [
        { id: 'one', kind: 'tool', tool: 'transfer', args: {}, dependsOn: [] },
        { id: 'two', kind: 'tool', tool: 'transfer', args: {}, dependsOn: ['one'] },
      ],
    },
    nodes: {
      one: { status: 'suspended', actionId: 'first-action', output: pending('first-action', '1.00') },
      two: { status: 'pending' },
    },
  }
  let latest = original
  const fetcher = vi.fn(async (_url: RequestInfo | URL) => Response.json({ plans: [{ state: latest }] }))
  vi.stubGlobal('fetch', fetcher)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  clients.push(client)
  render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(UIProvider, { children: createElement(PlanView, { state: original }) }),
    ),
  )
  await waitFor(() => expect(screen.getByText('确认转账 1.00 元')).toBeTruthy())
  latest = {
    ...original,
    completed: ['one'],
    nodes: {
      one: { status: 'done' },
      two: { status: 'suspended', actionId: 'second-action', output: pending('second-action', '2.00') },
    },
  }
  await waitFor(() => expect(screen.getByText('确认转账 2.00 元')).toBeTruthy(), { timeout: 4000 })
  expect(screen.queryByText('确认转账 1.00 元')).toBeNull()
  expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(2)
  expect(fetcher.mock.calls.every(([url]) => url === '/api/plans')).toBe(true)
})
