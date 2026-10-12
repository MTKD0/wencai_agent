import { z } from 'zod'
import { defineBankTool } from './define'
import { issuePasswordChangeGrant, GRANT_TTL_MS } from '#/server/auth/password-change'
import { hasTxPassword } from '#/server/auth/tx-password'

/**
 * 交易密码修改。**这是唯一一个不接收敏感参数的资金安全工具。**
 *
 * 设计约束（改动前必读）：新密码绝不能作为工具参数传入。
 * 一旦形如 `request_password_change({ newPassword: '123456' })`，密码就会同时落到
 * 模型上下文、`pending_actions.args_json` 参数快照和 `audit_logs` 载荷里，
 * 直接违反 ARCHITECTURE.md §0「关键数据不经模型转述」。
 *
 * 因此拆成两步，模型只参与第一步：
 *   1. 本工具（无密码参数）→ 红色确认单 → 用户在确认卡上完成 Passkey / 短信强验证
 *   2. 确认成功签发一次性凭证 → 用户在 `/settings?pwTicket=…` 亲自输入新密码
 *
 * 模型能做的只有"发起"，它既看不到旧密码，也看不到、不接触新密码。
 */
export const requestPasswordChange = defineBankTool({
  name: 'request_password_change',
  kind: 'write',
  baseRisk: 'red',
  description:
    '发起交易密码修改。需要用户强验证（Passkey 或绑定手机短信）。' +
    '本工具不接受也不传递任何密码：确认通过后会给出一个一次性链接，用户在安全设置页亲自输入新密码。' +
    '绝对不要询问或记录用户的新密码。',
  inputSchema: z.object({}),
  summarize: async (_args, ctx) => {
    const existing = await hasTxPassword(ctx.userId)
    return {
      title: '确认修改交易密码',
      fields: [
        { label: '操作', value: existing ? '重设 6 位交易密码' : '设置 6 位交易密码' },
        { label: '验证方式', value: 'Passkey 或绑定手机短信' },
        {
          label: '新密码输入位置',
          value: '安全设置页（不经过 AI，也不写入对话与日志）',
        },
        { label: '凭证有效期', value: `${GRANT_TTL_MS / 60_000} 分钟，一次有效` },
      ],
    }
  },
  // 走到这里说明红色强验证已经通过（见 confirm/pending.ts 的 verifyStrongStepUp）。
  // 只签发凭证，不接触密码本身。
  execute: async (_args, ctx) => {
    const actionId = ctx.authorization?.actionId
    if (!actionId) throw new Error('缺少确认上下文，请重新发起')
    const { ticket, expiresAt } = await issuePasswordChangeGrant(ctx.userId, actionId)
    return {
      status: 'password_change_authorized' as const,
      /** 一次性凭证：只用于跳转，本身不是密码 */
      ticket,
      /** 用户在安全设置页完成输入 */
      url: `/settings?pwTicket=${ticket}`,
      expiresAt,
      message: `请在 ${GRANT_TTL_MS / 60_000} 分钟内到安全设置页设置新密码。出于安全考虑，请不要把新密码告诉我。`,
    }
  },
})

export const SECURITY_TOOLS = [requestPasswordChange]
