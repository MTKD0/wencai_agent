/** 已认证的会话。userId 是系统中唯一的身份标识。 */
export interface AuthSession {
  userId: string
  userName: string
  sessionId: string
}

/** 一次绑定的外部渠道（设置页展示用，不含外部账号标识） */
export interface BindingInfo {
  id: string
  channel: 'lark' | 'mcp'
  boundAt: Date
}

/** 一个登录设备 */
export interface SessionInfo {
  id: string
  createdAt: Date
  expiresAt: Date
  ipAddress: string | null
  userAgent: string | null
}

/** 一枚 Passkey 凭据 */
export interface PasskeyInfo {
  id: string
  deviceType: string | null
  backedUp: boolean
  createdAt: Date
  lastUsedAt: Date | null
}
