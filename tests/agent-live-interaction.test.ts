// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { UIProvider } from '#/components/ui/provider'
import {
  AgentInteractionContext,
  AgentInteractionGroup,
  AgentCardPicker,
  AgentChoiceList,
} from '#/components/chat/AgentInteraction'
import { AgentQuestionnaire } from '#/components/chat/AgentQuestionnaire'
import { choiceFromRow } from '#/components/chat/interaction-message'
import { PlanView } from '#/components/chat/ToolPart'
import type { PlanState } from '#/server/executor/executor'
import type { QuestionnaireData } from '#/lib/questionnaire'
const clients: QueryClient[] = []
beforeEach(() => {
  window.matchMedia = vi
    .fn()
    .mockImplementation((query) => ({
      matches: query.includes('reduced-motion'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.unstubAllGlobals()
})
function mount(child: ReturnType<typeof createElement>, extra: Record<string, unknown> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  clients.push(client)
  const send = vi.fn(() => true)
  return {
    send,
    ...render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(UIProvider, {
          children: createElement(
            AgentInteractionContext.Provider,
            {
              value: {
                send,
                enabled: true,
                busy: false,
                snapshot: { requests: ['给甲和小红转500'], selections: [] },
                ...extra,
              },
            },
            child,
          ),
        }),
      ),
    ),
  }
}
it('付款卡浏览排除信用卡和冻结卡，普通查询不受影响', async () => {
  const choices = [
    { id: 'debit', kind: 'debit', last4: '8823', status: 'active', remark: '工资卡' },
    { id: 'credit', kind: 'credit', last4: '1047', status: 'active', remark: '信用卡' },
    { id: 'locked', kind: 'debit', last4: '9999', status: 'locked', remark: '冻结卡' },
  ].map((row) => choiceFromRow(row, 'card')!)
  const result = mount(
    createElement(AgentInteractionGroup, { children: createElement(AgentCardPicker, { choices, role: 'source' }) }),
  )
  await waitFor(() => expect(result.container.querySelectorAll('.bank-card-slide')).toHaveLength(1))
  expect(result.container.textContent).not.toContain('1047')
  expect(result.container.textContent).not.toContain('9999')
  expect(result.container.textContent).toContain('8823')
})
it('问卷独占本轮提交；确认按钮不重复出现；答案以结构化选项编号发送', async () => {
  const form: QuestionnaireData = {
    id: 'allocation',
    title: '金额分配',
    purpose: 'general',
    questions: [
      {
        id: 'amount',
        title: '如何分配？',
        options: [
          { id: 'each', value: 'each_500', label: '每人各转500元' },
          { id: 'total', value: 'total_500', label: '两人合计500元' },
        ],
      },
    ],
  }
  const result = mount(
    createElement(AgentInteractionGroup, {
      selectionSuppressed: true,
      children: [
        createElement(AgentChoiceList, {
          key: 'payees',
          choices: [choiceFromRow({ id: 'a', name: '甲', bank: '银行', account: '****1111' }, 'recipient')!],
        }),
        createElement(AgentQuestionnaire, {
          key: 'form',
          data: form,
          submissionId: '826bfdd0-f5e3-4de2-8959-6309db1f1d7b',
        }),
      ],
    }),
  )
  fireEvent.click(screen.getByRole('radio', { name: '每人各转500元' }))
  fireEvent.click(screen.getByRole('button', { name: '提交答案' }))
  expect(result.send).toHaveBeenCalledWith(expect.any(String), {
    questionnaireSubmission: { submissionId: '826bfdd0-f5e3-4de2-8959-6309db1f1d7b', answers: { amount: 'each' } },
  })
  expect((screen.getByRole('button', { name: '已提交' }) as HTMLButtonElement).disabled).toBe(true)
  expect(result.container.querySelector('.bank-selection-confirm')).toBeNull()
})
it('历史计划保留状态，下一张确认单只出现在回执位置', async () => {
  const outcome = {
    status: 'needs_confirmation',
    actionId: 'next-action',
    level: 'yellow',
    reasons: [],
    expiresAt: Date.now() + 300000,
    summary: { title: '第二笔确认单', fields: [{ label: '金额', value: '¥500.00' }] },
  }
  const state: PlanState = {
    id: 'plan-latest',
    status: 'suspended',
    completed: ['one'],
    plan: {
      goal: '两笔转账',
      nodes: [
        { id: 'one', kind: 'tool', tool: 'transfer', args: {}, dependsOn: [] },
        { id: 'two', kind: 'tool', tool: 'transfer', args: {}, dependsOn: ['one'] },
      ],
    },
    nodes: { one: { status: 'done' }, two: { status: 'suspended', actionId: 'next-action', output: outcome } },
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url === '/api/plans' ? Response.json({ plans: [{ state }] }) : Response.json({ status: 'pending' }),
    ),
  )
  const result = mount(
    createElement(
      'div',
      {},
      createElement(PlanView, { state }),
      createElement(PlanView, { state, placement: 'receipt' }),
    ),
    { relocatedPlanIds: new Set([state.id]) },
  )
  await waitFor(() => expect(result.container.querySelectorAll('.bank-confirm-card')).toHaveLength(1))
  expect(screen.getByText('第二笔确认单')).toBeTruthy()
})
