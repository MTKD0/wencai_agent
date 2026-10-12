export { cn } from "cn"

/**
 * 智能清洗并归一化中国大陆手机号：
 * 兼容浏览器自动填充的 +86、0086、前缀 86 以及空格、横杠
 */
export function normalizeChinesePhone(input: string): string {
  let cleaned = input.trim().replace(/[\s\-\(\)]/g, '')
  if (cleaned.startsWith('+86')) {
    cleaned = cleaned.slice(3)
  } else if (cleaned.startsWith('0086')) {
    cleaned = cleaned.slice(4)
  } else if (cleaned.startsWith('+')) {
    cleaned = cleaned.slice(1)
  }
  const digits = cleaned.replace(/\D/g, '')
  if (digits.length > 11 && digits.startsWith('86') && digits[2] === '1') {
    return digits.slice(2, 13)
  }
  return digits.slice(0, 11)
}
