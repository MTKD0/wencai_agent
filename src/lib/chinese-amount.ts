const DIGITS: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000 }
const SECTIONS: Record<string, number> = { 万: 10_000, 亿: 100_000_000 }

/** 含中文数字的金额片段，如“五万二千”“3千”“一百零五”；纯阿拉伯数字加“万”由原有规则处理 */
const RUN = /[\d.零〇一二两三四五六七八九十百千万亿]+/g
const HAS_CHINESE = /[零〇一二两三四五六七八九十百千亿]/
/** “几十元”“上千元”“第一块”“一块儿”不是具体金额 */
const VAGUE_BEFORE = /[几数上多余来第点.]$/
const COUNT_AFTER = /^[笔次个张份下些点倍成号位天月年周项条家只件]/

/** 解析“两万五千”“一千零五”“3千”“三千五”（口语，即 3500）；格式不对返回 undefined */
export function parseChineseNumber(text: string): number | undefined {
  let total = 0, section = 0, number = 0, lastUnit = 0, bareDigitAfterUnit = false, sawZero = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (/[\d.]/.test(ch)) {
      const run = text.slice(i).match(/^\d+(?:\.\d+)?/)?.[0]
      if (!run) return undefined
      number = Number(run); i += run.length - 1; bareDigitAfterUnit = false
    } else if (ch in DIGITS) {
      if (ch === '零' || ch === '〇') { sawZero = true; continue }
      number = DIGITS[ch]; bareDigitAfterUnit = lastUnit > 0 && !sawZero && i > 0 && !(text[i - 1] in DIGITS)
    } else if (ch in UNITS) {
      section += (number || 1) * UNITS[ch]; number = 0; lastUnit = UNITS[ch]; sawZero = false; bareDigitAfterUnit = false
    } else if (ch in SECTIONS) {
      total += (section + number) * SECTIONS[ch]; section = 0; number = 0; lastUnit = SECTIONS[ch]; sawZero = false; bareDigitAfterUnit = false
    } else return undefined
  }
  // 口语“三千五”“两万五”省略了末位单位
  if (bareDigitAfterUnit && lastUnit >= 100) number *= lastUnit / 10
  const value = total + section + number
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : undefined
}

export interface ChineseAmount { index: number; end: number; raw: string; value: number }

/**
 * 找出带中文数字的金额。requireUnit 时只认后面紧跟“元/块”的（核对模型回复）；
 * 否则也接受金额动词之后、带十/百/千/万单位的说法，如用户说“给妈妈转五千”。
 */
export function chineseAmounts(text: string, opts: { requireUnit: boolean; moneyVerb?: RegExp }): ChineseAmount[] {
  const out: ChineseAmount[] = []
  for (const m of text.matchAll(RUN)) {
    const raw = m[0].replace(/\.+$/, '')
    if (!HAS_CHINESE.test(raw) || !/^[\d零〇一二两三四五六七八九十]/.test(raw)) continue
    const before = text.slice(0, m.index)
    if (VAGUE_BEFORE.test(before)) continue
    const rest = text.slice(m.index! + raw.length)
    // 回复里“两块”常指“两部分”，只认“元”和“块钱”；用户说“五千块”按金额理解
    const unit = rest.match(opts.requireUnit ? /^\s*(元|块(?=钱))/ : /^\s*(元|块)(?!儿)/)
    if (!unit) {
      if (opts.requireUnit || !opts.moneyVerb?.test(before.slice(-16)) || !/[十百千万亿]/.test(raw) || COUNT_AFTER.test(rest)) continue
    }
    const value = parseChineseNumber(raw)
    if (value !== undefined) out.push({ index: m.index!, end: m.index! + raw.length + (unit?.[0].length ?? 0), raw: raw + (unit?.[0].trim() ?? ''), value })
  }
  return out
}
