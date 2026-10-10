import { DEMO_USER_ID } from '#/server/db/constants'

/**
 * 从请求中解析当前用户。骨架阶段固定为演示用户；
 * TODO: 接入会话 Cookie / Passkey 登录。userId 只能来自这里，绝不来自模型参数。
 */
export function getUserId(_request: Request): string {
  return DEMO_USER_ID
}
