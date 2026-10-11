/** 已认证的会话。userId 是系统中唯一的身份标识。 */
export interface AuthSession {
  userId: string
  userName: string
  sessionId: string
}

/** 一次会话绑定的渠道（设置页展示用，不含外部账号） */
export interface BindingInfo {
  id: string
  channel: 'lark' | 'mcp'
  boundAt: Date
}

export interface SessionInfo {
  id: string
  createdAt: Date
  expiresAt: Date
  ipAddress: string | null
  userAgent: string | null
  current: boolean
}
