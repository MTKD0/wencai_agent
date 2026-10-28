import { timingSafeEqual } from 'node:crypto'
import { env } from '#/server/env'
import { staffFromRequest, type StaffRole } from './staff-session'
import type { AgentContext } from '#/server/agent/context'
import type { TransferInput } from '#/server/payments/service'

/**
 * 后台访问：工作人员登录会话、脚本用的 ADMIN_TOKEN，或本地开发免登录。
 * 演示模式不再免登录：公开演示地址上，后台（含登录验证码日志）只对登录的工作人员开放。
 */
export function adminAuthorized(request: Request) {
  if (!env.ADMIN_ENABLED) return false
  if (staffFromRequest(request)) return true
  // 配置了 ADMIN_TOKEN 的部署不再接受本地免登录
  if (env.ADMIN_TOKEN) {
    const given = Buffer.from(request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '')
    const expected = Buffer.from(env.ADMIN_TOKEN)
    return given.length === expected.length && timingSafeEqual(given, expected)
  }
  return localDevelopment(request)
}

function localDevelopment(request: Request) {
  const local = (host: string) => ['localhost', '127.0.0.1', '[::1]'].includes(host)
  if (process.env.NODE_ENV === 'production' || !local(new URL(request.url).hostname) || !local(new URL(env.PUBLIC_BASE_URL).hostname)) return false
  const origin = request.headers.get('origin')
  return !origin || origin === new URL(request.url).origin
}

/** 审计和工单里记录的处理人 */
export function adminActor(request: Request): { id: string; name: string; role: StaffRole | 'system' } {
  const staff = staffFromRequest(request)
  if (staff) return { id: staff.id, name: staff.name, role: staff.role }
  if (env.ADMIN_TOKEN && request.headers.get('authorization')) return { id: 'admin:token', name: '接口凭据', role: 'system' }
  return { id: 'admin:local', name: '本地开发', role: 'system' }
}

declare const adminTransferBrand: unique symbol
export type AdminTransferGrant = { readonly [adminTransferBrand]: true }
const transferGrants = new WeakMap<object, { userId: string; input: string; expires: number }>()
const transferKey = (input: TransferInput) => JSON.stringify([input.fromAccountId,input.payeeId??null,input.toAccountId??null,input.amountCents,input.memo??null])

/** Server-only, request-authenticated capability: not serializable and not an input flag. */
export function authorizeAdminTransfer(request: Request, userId: string, input: TransferInput): AdminTransferGrant {
  if (!env.ADMIN_ENABLED || !adminAuthorized(request)) throw new Error('后台转账凭据无效')
  const grant = Object.freeze({}) as AdminTransferGrant
  transferGrants.set(grant,{userId,input:transferKey(input),expires:Date.now()+60_000})
  return grant
}

export function consumeAdminTransferGrant(grant: AdminTransferGrant, ctx: AgentContext, input: TransferInput) {
  const record = grant && typeof grant==='object' ? transferGrants.get(grant) : undefined
  if (record) transferGrants.delete(grant)
  if (!env.ADMIN_ENABLED || !record || record.expires<=Date.now() || record.userId!==ctx.userId || ctx.channel!=='web' || ctx.sessionId!=='admin' || record.input!==transferKey(input)) throw new Error('后台转账授权无效、已使用或参数不匹配')
}
