import { eq } from 'drizzle-orm'
import { db, schema } from '#/server/db/client'
import { audit } from '#/server/audit/log'
import { AGENT_PAUSED_PREFIX } from '#/lib/chat-rate'

/**
 * 智能助手紧急停用（指导意见第（十七）条：明确紧急停用条件，建立人工替代流程）。
 * 工作人员在后台暂停后，网页对话与飞书渠道不再调用模型，直接回固定提示；
 * 首页转账、卡片、任务中心与确认链路不依赖模型，照常办理。状态存数据库，网页与 worker 进程共用。
 */
export type AgentPause = { paused: boolean; reason?: string; by?: string; at?: string }

const KEY = 'agent_pause'
const CACHE_MS = 3_000
export const AGENT_PAUSED_MESSAGE = `${AGENT_PAUSED_PREFIX}：银行正在处理，请稍后再试。首页的转账、卡片和任务中心仍可正常办理。`

let cached: { value: AgentPause; at: number } | undefined

export async function agentPauseState(now = Date.now()): Promise<AgentPause> {
  if (cached && now - cached.at < CACHE_MS) return cached.value
  const [row] = await db.select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, KEY))
  let value: AgentPause = { paused: false }
  try { if (row) value = JSON.parse(row.value) as AgentPause } catch { /* 损坏的记录按未暂停处理 */ }
  cached = { value, at: now }
  return value
}

/** 停用必须填写原因；恢复也写审计。返回新状态 */
export async function setAgentPause(paused: boolean, reason: string, by: string): Promise<AgentPause> {
  const value: AgentPause = { paused, reason, by, at: new Date().toISOString() }
  await db.insert(schema.settings).values({ key: KEY, value: JSON.stringify(value) })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: JSON.stringify(value) } })
  cached = undefined
  await audit({ userId: 'system', sessionId: 'admin', channel: 'web' }, 'admin_command', { command: { type: paused ? 'pauseAgent' : 'resumeAgent', reason }, ok: true, actor: by })
  return value
}
