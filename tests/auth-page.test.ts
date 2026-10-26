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
  const result = render(createElement(QueryClientProvider, { client }, createElement(AuthPage, { register })))
  return { ...result, desktopSubmit: () => result.container.querySelector<HTMLButtonElement>('.auth-desktop-submit')! }
}

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
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
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
  expect(fetchMock).not.toHaveBeenCalled()
})

it('submits the six-digit code through the existing login endpoint and redirects after success', async () => {
  sendOtp.mockResolvedValue({})
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
  vi.stubGlobal('fetch', fetchMock)
  const { container, desktopSubmit } = mount()
  fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13800138000' } })
  fireEvent.click(container.querySelector('.auth-send-code')!)
  await waitFor(() => expect(screen.getByRole('button', { name: '修改手机号' })).toBeTruthy())
  fireEvent.change(screen.getByLabelText('短信验证码'), { target: { value: '12x34567' } })
  expect((screen.getByLabelText('短信验证码') as HTMLInputElement).value).toBe('123456')
  fireEvent.click(desktopSubmit())
  await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/' }))
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ phoneNumber: '13800138000', code: '123456' })
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
