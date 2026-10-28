import { afterEach, expect, it, vi } from 'vitest'
const { config } = vi.hoisted(() => ({ config: { ADMIN_ENABLED: true, AUTH_DEMO_MODE: true, ADMIN_TOKEN: 'admin-test-credential-at-least-24' as string | undefined, PUBLIC_BASE_URL: 'https://demo.bank.test', CONFIRM_SECRET: 'test-confirm-secret-at-least-32-characters' } }))
vi.mock('#/server/env', () => ({ env: config }))
import { adminActor, adminAuthorized } from '#/server/admin/access'
import { readStaffSession, signSession, STAFF_COOKIE } from '#/server/admin/staff-session'
const staff = { id: 'staff_1', username: 'agent01', name: '演示坐席', role: 'agent' as const }
const request = (headers: Record<string, string> = {}, url = 'https://demo.bank.test/api/admin') => new Request(url, { headers })
afterEach(() => { config.ADMIN_ENABLED = true; config.AUTH_DEMO_MODE = true; config.ADMIN_TOKEN = 'admin-test-credential-at-least-24'; config.PUBLIC_BASE_URL = 'https://demo.bank.test' })

it('演示模式不再免登录：公开地址上没有会话或凭据一律拒绝', () => {
  expect(adminAuthorized(request())).toBe(false)
  config.ADMIN_TOKEN = undefined
  expect(adminAuthorized(request())).toBe(false)
})
it('工作人员会话通过，处理人取会话里的姓名', () => {
  const cookie = `${STAFF_COOKIE}=${signSession(staff, Date.now())}`
  expect(adminAuthorized(request({ cookie }))).toBe(true)
  expect(adminActor(request({ cookie }))).toMatchObject({ id: 'staff_1', name: '演示坐席', role: 'agent' })
})
it('篡改或过期的会话无效', () => {
  const value = signSession(staff, Date.now())
  const [payload, signature] = value.split('.')
  const forged = Buffer.from(JSON.stringify({ ...staff, role: 'supervisor', exp: Date.now() + 3_600_000 })).toString('base64url')
  expect(readStaffSession(`${forged}.${signature}`)).toBeUndefined()
  expect(readStaffSession(`${payload}.${signature}`, Date.now() + 9 * 3_600_000)).toBeUndefined()
  expect(readStaffSession(value)).toMatchObject({ name: '演示坐席' })
})
it('脚本凭据仍可用；配置了凭据时本地地址也不能免登录', () => {
  expect(adminAuthorized(request({ authorization: `Bearer ${config.ADMIN_TOKEN}` }))).toBe(true)
  expect(adminAuthorized(request({ authorization: 'Bearer wrong' }))).toBe(false)
  config.PUBLIC_BASE_URL = 'http://localhost:3000'
  expect(adminAuthorized(request({}, 'http://localhost:3000/api/admin'))).toBe(false)
})
it('本地开发且未配置凭据时可免登录；后台禁用时一律拒绝', () => {
  config.ADMIN_TOKEN = undefined; config.PUBLIC_BASE_URL = 'http://localhost:3000'
  expect(adminAuthorized(request({}, 'http://localhost:3000/api/admin'))).toBe(true)
  config.ADMIN_ENABLED = false
  expect(adminAuthorized(request({ cookie: `${STAFF_COOKIE}=${signSession(staff, Date.now())}` }))).toBe(false)
})
