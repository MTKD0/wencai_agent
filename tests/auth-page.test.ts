// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const { sendOtp, navigate, refetch } = vi.hoisted(() => ({ sendOtp: vi.fn(), navigate: vi.fn(), refetch: vi.fn() }))
vi.mock('#/lib/auth-client', () => ({ authClient: { useSession: () => ({ refetch }), phoneNumber: { sendOtp } } }))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  Link: ({ to, children, ...props }: any) => createElement('a', { href: to, ...props }, children),
}))
vi.mock('#/components/ui/motion', () => ({
  Reveal: ({ children, className }: any) => createElement('div', { className }, children),
}))
vi.mock('#/components/banking/AuthStory', () => ({
  AuthStory: ({ settled }: any) => createElement('div', { 'data-testid': 'story', 'data-settled': settled }),
}))
vi.mock('#/components/ui/button', () => ({ Button: (props: any) => createElement('button', props) }))
vi.mock('#/components/ui/input', () => ({ Input: (props: any) => createElement('input', props) }))
vi.mock('#/components/ui/phone-input', async () => {
  const { resolvePhoneNumber } = await import('#/lib/phone-number')
  return {
    resolvePhoneNumber,
    PhoneInput: ({ value, onChange, className, ...props }: any) =>
      createElement('input', {
        ...props,
        value,
        className,
        onChange: (event: any) => onChange(event.target.value, resolvePhoneNumber(event.target.value)),
      }),
  }
})
import { AuthPage } from '#/components/banking/AuthPage'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  sendOtp.mockReset()
  navigate.mockReset()
  refetch.mockReset()
})
function mount(register = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const page = (register: boolean) =>
    createElement(QueryClientProvider, { client }, createElement(AuthPage, { register }))
  const result = render(page(register))
  return {
    ...result,
    switchTab: (register: boolean) => result.rerender(page(register)),
    desktopSubmit: () => result.container.querySelector<HTMLButtonElement>('.auth-desktop-submit')!,
  }
}

it('keeps the story mounted and settled across auth tabs while resetting the separate forms', () => {
  const { switchTab } = mount()
  const story = screen.getByTestId('story')
  fireEvent.focus(screen.getByLabelText('手机号'))
  fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13800138000' } })
  switchTab(true)
  expect(screen.getByTestId('story')).toBe(story)
  expect(story.dataset.settled).toBe('true')
  expect(screen.getByLabelText('户名')).toBeTruthy()
  expect((screen.getByLabelText('手机号') as HTMLInputElement).value).toBe('')
  switchTab(false)
  expect(screen.getByTestId('story')).toBe(story)
  expect(story.dataset.settled).toBe('true')
  expect(screen.queryByLabelText('户名')).toBeNull()
})

it('settles the illustration on first input without automatically focusing the form', () => {
  mount()
  expect(document.activeElement?.tagName).toBe('BODY')
  expect(screen.getByTestId('story').dataset.settled).toBe('false')
  fireEvent.focus(screen.getByLabelText('手机号'))
  expect(screen.getByTestId('story').dataset.settled).toBe('true')
  fireEvent.blur(screen.getByLabelText('手机号'))
  expect(screen.getByTestId('story').dataset.settled).toBe('true')
})

it('requires sending and entering an OTP, preserves verification payload and lets the user correct the phone', async () => {
  sendOtp.mockResolvedValue({})
  const fetchMock = vi.fn(async (url: string) => url === '/api/demo-login-code' ? { ok: false, json: async () => ({}) } : { ok: true, json: async () => ({}) })
  vi.stubGlobal('fetch', fetchMock)
  const { container, desktopSubmit } = mount()
  const send = container.querySelector<HTMLButtonElement>('.auth-send-code')!
  expect(send.disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13800138000' } })
  expect(send.disabled).toBe(false)
  fireEvent.change(screen.getByLabelText('短信验证码'), { target: { value: '123456' } })
  expect(desktopSubmit().disabled).toBe(true)
  fireEvent.click(send)
  await waitFor(() => expect(desktopSubmit().disabled).toBe(false))
  expect(sendOtp).toHaveBeenCalledWith({ phoneNumber: '13800138000' })
  fireEvent.click(screen.getByRole('button', { name: '修改手机号' }))
  expect(desktopSubmit().disabled).toBe(true)
  expect((screen.getByLabelText('短信验证码') as HTMLInputElement).value).toBe('')
  // The cooldown remains in force when correcting the phone, as in the existing flow.
  expect(send.disabled).toBe(true)
  // 只查询过演示验证码，没有提交登录
  expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(['/api/demo-login-code'])
})

it('submits the six-digit code through the existing login endpoint and redirects after success', async () => {
  sendOtp.mockResolvedValue({})
  const fetchMock = vi.fn(async (url: string) => url === '/api/demo-login-code' ? { ok: false, json: async () => ({}) } : { ok: true, json: async () => ({}) })
  vi.stubGlobal('fetch', fetchMock)
  const { container, desktopSubmit } = mount()
  fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13800138000' } })
  fireEvent.click(container.querySelector('.auth-send-code')!)
  await waitFor(() => expect(screen.getByRole('button', { name: '修改手机号' })).toBeTruthy())
  fireEvent.change(screen.getByLabelText('短信验证码'), { target: { value: '12x34567' } })
  expect((screen.getByLabelText('短信验证码') as HTMLInputElement).value).toBe('123456')
  fireEvent.click(desktopSubmit())
  await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/' }))
  const login = fetchMock.mock.calls.find((call) => call[0] === '/api/auth/phone-number/verify') as unknown as [string, RequestInit]
  expect(JSON.parse(String(login[1].body))).toEqual({ phoneNumber: '13800138000', code: '123456' })
  expect(screen.queryByRole('status')).toBeNull()
})

it('演示环境：服务端给出验证码时自动填入并提示', async () => {
  sendOtp.mockResolvedValue({})
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ code: '654321' }) })))
  const { container, desktopSubmit } = mount()
  fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13800000000' } })
  fireEvent.click(container.querySelector('.auth-send-code')!)
  await waitFor(() => expect((screen.getByLabelText('短信验证码') as HTMLInputElement).value).toBe('654321'))
  expect(screen.getByRole('status').textContent).toContain('654321')
  expect(desktopSubmit().disabled).toBe(false)
})

it('keeps registration fields and surfaces OTP errors without losing the input', async () => {
  sendOtp.mockResolvedValue({ error: { message: '请稍后再试' } })
  const { container } = mount(true)
  fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13800138000' } })
  expect(container.querySelector<HTMLButtonElement>('.auth-send-code')!.disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('户名'), { target: { value: '测试用户' } })
  fireEvent.click(container.querySelector('.auth-send-code')!)
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('请稍后再试'))
  expect((screen.getByLabelText('手机号') as HTMLInputElement).value).toBe('13800138000')
})
