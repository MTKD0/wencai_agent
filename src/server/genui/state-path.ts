/** $state 引用的解析：生成式界面与选择模板共用 */

export function getByPointer(obj: unknown, pointer: string): unknown {
  let cur = obj
  for (const seg of pointer.split('/').slice(1)) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[seg.replace(/~1/g, '/').replace(/~0/g, '~')]
  }
  return cur
}

/**
 * 模型看到的工具结果包了一层 `{status, data}`，会话快照里只存 `data`，所以模型常写 `/get_accounts/data/...`。
 * 这种写法指向的是同一份服务端数据，按 `/get_accounts/...` 解析并改写引用，省掉一次被拒重试。
 * 只做这一种等价改写，不猜测其他字段名。
 */
export function resolveStatePath(state: unknown, path: string): { path: string; value: unknown } {
  const value = getByPointer(state, path)
  if (value !== undefined) return { path, value }
  const wrapped = /^\/([^/]+)\/data(\/.*)?$/.exec(path)
  if (wrapped) {
    const alternative = `/${wrapped[1]}${wrapped[2] ?? ''}`
    const resolved = getByPointer(state, alternative)
    if (resolved !== undefined) return { path: alternative, value: resolved }
  }
  return { path, value: undefined }
}

/** 路径不存在时告诉模型实际有哪些字段，让下一次重试一次就对 */
export function missingPathHint(state: Record<string, unknown>, path: string): string {
  let cur: unknown = state
  let found = ''
  for (const seg of path.split('/').slice(1)) {
    const next = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[seg] : undefined
    if (next === undefined) break
    cur = next
    found += `/${seg}`
  }
  if (!found) {
    const tools = Object.keys(state).filter((key) => !key.includes(':')).slice(0, 15)
    return tools.length ? `；当前可引用的工具结果：${tools.map((key) => `/${key}`).join('、')}` : '；当前没有可引用的工具结果，请先调用查询工具'
  }
  if (Array.isArray(cur)) {
    const first = cur[0]
    const keys = first && typeof first === 'object' ? Object.keys(first).slice(0, 10).join('、') : ''
    return `；${found} 是数组（${cur.length} 项），列表组件直接引用 ${found}${keys ? `，元素字段：${keys}` : ''}`
  }
  if (cur && typeof cur === 'object') return `；${found} 下可用字段：${Object.keys(cur).slice(0, 15).join('、')}`
  return `；${found} 已是具体值，不能再往下取字段`
}
