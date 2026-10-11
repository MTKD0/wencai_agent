import type { Client, Transaction } from '@libsql/client'

/**
 * 本地 SQLite 同一时刻只有一个写事务。将客户端请求排队，避免连接池在
 * JavaScript 事务 await 期间同步争锁；事务内必须使用 tx，不能使用外层 db。
 * 金额条件更新、唯一约束仍在数据库中强制校验。
 */
export function serializeLocalClient(client: Client): Client {
  let tail = Promise.resolve()
  async function acquire() {
    const previous = tail
    let release!: () => void
    tail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    return release
  }
  const operations = new Set(['execute', 'batch', 'migrate', 'executeMultiple', 'sync'])
  return new Proxy(client, {
    get(target, property) {
      if (property === 'transaction')
        return async (...args: Parameters<Client['transaction']>) => {
          const release = await acquire()
          let settled = false
          const unlock = () => {
            if (!settled) {
              settled = true
              release()
            }
          }
          let tx: Transaction
          try {
            tx = await target.transaction(...args)
          } catch (e) {
            unlock()
            throw e
          }
          return new Proxy(tx, {
            get(transaction, key) {
              const value = Reflect.get(transaction, key, transaction)
              if (['commit', 'rollback', 'close'].includes(String(key)))
                return (...params: unknown[]) => {
                  try {
                    const result = Reflect.apply(value, transaction, params)
                    if (result instanceof Promise) return result.finally(unlock)
                    unlock()
                    return result
                  } catch (e) {
                    unlock()
                    throw e
                  }
                }
              return typeof value === 'function' ? value.bind(transaction) : value
            },
          })
        }
      const value = Reflect.get(target, property, target)
      if (operations.has(String(property)))
        return async (...args: unknown[]) => {
          const release = await acquire()
          try {
            return await Reflect.apply(value, target, args)
          } finally {
            release()
          }
        }
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
