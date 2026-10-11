/** 管理后台工具函数（对齐 wencai schema 的字段名） */

export const categories: Record<string, string> = {
  opening: '期初余额',
  salary: '工资收入',
  shopping: '购物消费',
  food: '餐饮美食',
  transport: '交通出行',
  health: '医疗健康',
  housing: '居住缴费',
  subscription: '订阅服务',
  转账: '转账支出',
  AA: 'AA 收款',
  理财: '理财操作',
  冲正: '冲正流水',
}

export const statuses: Record<string, string> = {
  active: '正常',
  locked: '已锁定',
  lost: '已挂失',
  pending: '待执行',
  succeeded: '已完成',
  failed: '执行失败',
  cancelled: '已取消',
  planned: '等待预留',
  reserved: '预算已预留',
  ordered: '已订购',
  paid: '已收款',
}

export const taskNames: Record<string, string> = {
  transfer: '定时转账',
  birthdayReserve: '生日预算预留',
  birthdayOrder: '鲜花与蛋糕订购',
}

export const money = (cents: number) =>
  new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
  }).format(cents / 100)

export const dateTime = (value: string | Date | null | undefined, dateOnly = false) => {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(dateOnly ? {} : { hour: '2-digit', minute: '2-digit', hour12: false }),
  }).format(new Date(value))
}

export const localInput = (value: string) =>
  new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 16)

export const localDate = (value: string) => localInput(value).slice(0, 10)

export function toFen(value: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(value))
    throw new Error('请输入正确金额，最多保留两位小数')
  const [whole, decimal = ''] = value.split('.')
  const amount = Number(whole) * 100 + Number(decimal.padEnd(2, '0'))
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 100_000_000)
    throw new Error('金额必须在 0.01 元至 100 万元之间')
  return amount
}

export const toInstant = (local: string) => {
  const date = new Date(local + ':00+08:00')
  if (!Number.isFinite(date.getTime())) throw new Error('请选择有效时间')
  return date.toISOString()
}

export type Ledger = Array<{
  id: string
  accountId: string
  amount: number
  merchant: string
  category: string
  occurredAt: string
  reference: string
  subscriptionId: string | null
}>

export function periodRows(rows: Ledger, period: string) {
  return rows.filter((t) => t.occurredAt.startsWith(period))
}

export function cashFlow(rows: Ledger) {
  return rows.filter((t) => !['opening', '理财'].includes(t.category))
}

export function monthlyTrend(rows: Ledger, now: string) {
  const end = new Date(localDate(now).slice(0, 7) + '-01T12:00:00Z')
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(end)
    d.setUTCMonth(d.getUTCMonth() - 5 + i)
    const month = d.toISOString().slice(0, 7)
    const list = cashFlow(periodRows(rows, month))
    return {
      month,
      label: `${d.getUTCMonth() + 1}月`,
      income: list.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0) / 100,
      expense: list.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0) / 100,
    }
  })
}

export function exportLedger(rows: Ledger, period: string) {
  const escape = (s: string) => '"' + s.replace(/"/g, '""') + '"'
  const csv = [
    '时间,交易对象,分类,金额（元）,流水编号',
    ...rows.map((t) =>
      [
        dateTime(t.occurredAt),
        t.merchant,
        categories[t.category] ?? t.category,
        (t.amount / 100).toFixed(2),
        t.id,
      ]
        .map(escape)
        .join(','),
    ),
  ].join('\r\n')
  const url = URL.createObjectURL(
    new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }),
  )
  const a = document.createElement('a')
  a.href = url
  a.download = `银行账单-${period}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
