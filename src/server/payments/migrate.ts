import { db } from '#/server/db/client'

let ready: Promise<void> | undefined

/** 仅增加表和索引，不重置余额或历史记录。老数据库和直接 pnpm dev 均可使用。 */
export function ensurePaymentsSchema() {
  return (ready ??= (async () => {
    for (const sql of [
      'CREATE TABLE IF NOT EXISTS bank_account_addresses (account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE, account_no TEXT NOT NULL UNIQUE)',
      'CREATE TABLE IF NOT EXISTS bank_payee_links (payee_id TEXT PRIMARY KEY REFERENCES payees(id) ON DELETE CASCADE, user_id TEXT NOT NULL, target_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE)',
      'CREATE UNIQUE INDEX IF NOT EXISTS bank_payee_owner_target ON bank_payee_links(user_id, target_account_id)',
      'CREATE TABLE IF NOT EXISTS bank_transfer_links (debit_transaction_id TEXT PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE, target_account_id TEXT, credit_transaction_id TEXT UNIQUE, reversed_at INTEGER)',
    ])
      await db.$client.execute(sql)
  })().catch((error) => {
    ready = undefined
    throw error
  }))
}
