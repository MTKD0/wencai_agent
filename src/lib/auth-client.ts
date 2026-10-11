import { createAuthClient } from 'better-auth/react'
import { phoneNumberClient } from 'better-auth/client/plugins'

/**
 * 浏览器端认证客户端。basePath 指向 our catch-all 路由。
 * 手机号 + 验证码登录，未注册号码验证通过后自动创建账户（signUpOnVerification）。
 */
export const authClient = createAuthClient({
  basePath: '/api/auth',
  plugins: [phoneNumberClient()],
})

export const { useSession, signOut } = authClient

/** 当前会话查询（设置页、权限守卫用） */
export function useAuthSession() {
  return useSession()
}
