/** 从输入文本精确解析到分；拒绝指数、负数和小数点后超过两位。 */
export function parsePaymentAmount(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null
  const [whole, fraction = ''] = value.trim().split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 100_000_000 ? cents : null
}
