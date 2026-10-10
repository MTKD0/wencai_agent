/**
 * 会话级数据快照：绿色工具的最新结果按 /工具名 存放，供生成式 UI 以 $state 引用。
 * 骨架阶段使用进程内存；多实例部署需换成 Redis 等共享存储。
 */
const store = new Map<string, Record<string, unknown>>()

export function getSessionData(sessionId: string): Record<string, unknown> {
  let data = store.get(sessionId)
  if (!data) {
    data = {}
    store.set(sessionId, data)
  }
  return data
}

export function putSessionData(sessionId: string, tool: string, value: unknown) {
  getSessionData(sessionId)[tool] = value
}
