import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// 金额统一以「分」为单位存储，避免浮点误差

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  // 账户级锁定（强验证连续失败、异常交易触发熔断）
  lockedUntil: integer('locked_until', { mode: 'timestamp_ms' }),
  failedAuthCount: integer('failed_auth_count').notNull().default(0),
})

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  balanceCents: integer('balance_cents').notNull(),
  currency: text('currency').notNull().default('CNY'),
})

export const payees = sqliteTable('payees', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  alias: text('alias'), // 如「妈妈」「房东」
  accountNo: text('account_no').notNull(),
  bank: text('bank').notNull(),
  phone: text('phone'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export const transactions = sqliteTable('transactions', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  amountCents: integer('amount_cents').notNull(), // 负数为支出
  counterparty: text('counterparty').notNull(), // 外部可控文本
  memo: text('memo'), // 外部可控文本：间接注入的主要来源
  category: text('category').notNull(),
  occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
  // 冲正关联：补偿动作生成的流水指向原流水
  reversalOf: text('reversal_of'),
})

export const cards = sqliteTable('cards', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  accountId: text('account_id').notNull(),
  last4: text('last4').notNull(),
  kind: text('kind', { enum: ['debit', 'credit'] }).notNull(),
  status: text('status', { enum: ['active', 'locked', 'lost'] }).notNull(),
  dailyLimitCents: integer('daily_limit_cents').notNull(),
})

export const subscriptions = sqliteTable('subscriptions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  merchant: text('merchant').notNull(),
  amountCents: integer('amount_cents').notNull(),
  cycle: text('cycle', { enum: ['monthly', 'yearly'] }).notNull(),
  status: text('status', { enum: ['active', 'cancelled'] }).notNull(),
  lastChargedAt: integer('last_charged_at', { mode: 'timestamp_ms' }),
})

export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  riskRating: text('risk_rating', { enum: ['R1', 'R2', 'R3', 'R4', 'R5'] }).notNull(),
  expectedYield: real('expected_yield').notNull(), // 年化，如 0.025
  minAmountCents: integer('min_amount_cents').notNull(),
  termDays: integer('term_days').notNull(),
})

export const pendingActions = sqliteTable('pending_actions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  sessionId: text('session_id').notNull(),
  tool: text('tool').notNull(),
  argsJson: text('args_json').notNull(),
  paramsHash: text('params_hash').notNull(),
  level: text('level', { enum: ['yellow', 'red'] }).notNull(),
  reasonsJson: text('reasons_json').notNull(),
  summaryJson: text('summary_json').notNull(),
  integrity: text('integrity').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  status: text('status', {
    enum: ['pending', 'consumed', 'cancelled', 'expired'],
  }).notNull(),
  // 若来自 DAG，则确认后需恢复对应计划
  planId: text('plan_id'),
  nodeId: text('node_id'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export const plans = sqliteTable('plans', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  sessionId: text('session_id').notNull(),
  stateJson: text('state_json').notNull(),
  status: text('status', {
    enum: ['running', 'suspended', 'completed', 'failed', 'compensated', 'handoff'],
  }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

export const auditLogs = sqliteTable('audit_logs', {
  seq: integer('seq').primaryKey({ autoIncrement: true }),
  at: integer('at', { mode: 'timestamp_ms' }).notNull(),
  userId: text('user_id').notNull(),
  sessionId: text('session_id').notNull(),
  channel: text('channel').notNull(),
  type: text('type').notNull(),
  payloadJson: text('payload_json').notNull(),
  prevHash: text('prev_hash').notNull(),
  hash: text('hash').notNull(),
})
