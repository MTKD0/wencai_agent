const NUMBER = /(?:[¥￥]\s*)?(\d+(?:,\d{3})*)(?:\.(\d+))?(?![\d.])\s*(万)?\s*(?:元|块)?/g
const moneyVerb = /(?:转账|转|打款|汇款|支付|付款|付|申购|赎回|投资|购买)\s*$/
export const QUESTIONNAIRE_ANSWERS_MARKER = '\n【已选问卷答案】'

/** “1.5 万”按 15000 元计：带“万”最多四位小数，否则最多两位（到分）；不合规返回 undefined */
function yuanOf(integer: string, decimals: string | undefined, wan?: string): number | undefined {
  if ((decimals?.length ?? 0) > (wan ? 4 : 2)) return undefined
  return Math.round(Number(`${integer.replace(/,/g, '')}.${decimals ?? '0'}`) * (wan ? 10_000 : 1) * 100) / 100
}

/** Explicit distributive amounts own one occurrence per recipient, even when the money is written once. */
function sharedTransferClauses(text: string) {
  return [...text.matchAll(/(?:给|向)\s*([^，。；;\n]{1,160}?)\s*(?:各|每人)\s*(?:转账|转|打款|汇款|付款|支付)\s*(\d+(?:,\d{3})*)(?:\.(\d+))?(?![\d.])\s*(万)?/g)].flatMap((match) => {
    const names = match[1].split(/和|与|及|、/).map((name) => name.trim())
    const amount = yuanOf(match[2], match[3], match[4]) ?? 0
    if (names.length < 2 || names.some((name) => !name || name.length > 32 || /给|向|转|汇|付款|打款|尾号|卡号|账号|密码|验证码|日期/.test(name)) ||
      amount <= 0 || amount > 1_000_000) return []
    let cursor = match.index! + match[0].indexOf(match[1])
    const recipients = names.map((recipient) => {
      const position = text.indexOf(recipient, cursor)
      cursor = position + recipient.length
      return { position, recipient, amount }
    })
    return [{ start: match.index!, end: match.index! + match[0].length, recipients }]
  })
}

/** Only explicit money expressions, not arbitrary phone numbers, dates or card tails. */
export function requestedAmounts(text: string): number[] {
  return [...text.matchAll(NUMBER)].flatMap((match) => {
    const before = text.slice(Math.max(0, match.index! - 16), match.index)
    if (!/[¥￥元块万]/.test(match[0]) && !moneyVerb.test(before)) return []
    const amount = yuanOf(match[1], match[2], match[3])
    return amount !== undefined && amount > 0 && amount <= 1_000_000 ? [amount] : []
  })
}

/** Bind an amount to this named recipient, so two steps cannot silently swap amounts. */
export function requestedTransferMatches(text: string, query: string, amount: number): number[] {
  text = text.split(QUESTIONNAIRE_ANSWERS_MARKER)[0]
  if (!/(?:转|汇|付款|打款)/.test(text) || !query.trim()) return []
  const shared = sharedTransferClauses(text)
  const result: number[] = shared.flatMap((clause) => clause.recipients.filter((item) => item.recipient === query && item.amount === amount).map((item) => item.position))
  let index = text.indexOf(query)
  while (index >= 0) {
    if (shared.some((clause) => index >= clause.start && index < clause.end)) {
      index = text.indexOf(query, index + query.length)
      continue
    }
    const after = text.slice(index + query.length)
    // Tolerate short conversational connectors/typos, but never interpret account identifiers as money.
    const next = after.match(/^([^\d，。；;\n]{0,8})(\d+(?:,\d{3})*)(?:\.(\d+))?(?![\d.])\s*(万)?/)
    if (next && !/(?:尾号|卡号|账号|手机|电话|密码|验证码|日期|和|与|及|、)/.test(next[1]) && yuanOf(next[2], next[3], next[4]) === amount) result.push(index + query.length + next[1].length)
    // Also support “转400给妈妈”.
    const before = text.slice(0, index).match(/(?:转账|转|打款|汇款|支付|付款)\s*(\d+(?:,\d{3})*)(?:\.(\d{1,4}))?\s*(万)?\s*(?:元|块)?\s*(?:给|到|至|向)\s*$/)
    if (before && yuanOf(before[1], before[2], before[3]) === amount) result.push(before.index! + before[0].indexOf(before[1]))
    index = text.indexOf(query, index + query.length)
  }
  return [...new Set(result)]
}

/** Recognizable “给/向…转…” clauses must not silently disappear from a prepared batch. */
export function transferClauseAmounts(text: string): { position: number; recipient: string; amount: number }[] {
  text = text.split(QUESTIONNAIRE_ANSWERS_MARKER)[0]
  if (!/(?:转|汇|付款|打款)/.test(text)) return []
  const shared = sharedTransferClauses(text)
  return [...shared.flatMap((clause) => clause.recipients), ...[...text.matchAll(/(?:给|向)\s*([^给向，。；;\n\d]{1,32}?)(?:转账|转|打款|汇款|付款|支付|付|装)?\s*(\d+(?:,\d{3})*)(?:\.(\d+))?(?![\d.])\s*(万)?/g)].flatMap((match) => {
    if (shared.some((clause) => match.index! >= clause.start && match.index! < clause.end)) return []
    const amount = yuanOf(match[2], match[3], match[4])
    if (/尾号|卡号|账号|手机|电话|密码|验证码|日期/.test(match[1]) || amount === undefined) return []
    return [{ position: match.index! + match[0].lastIndexOf(match[2]), recipient: match[1].trim(), amount }]
  })]
}
