import * as React from 'react'
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js'
import { Input } from '@/components/ui/input'
import { cn } from 'cn'

export interface CountryOption {
  code: CountryCode
  name: string
  dialCode: string
  flag: string
}

export const SUPPORTED_COUNTRIES: CountryOption[] = [
  { code: 'CN', name: '中国', dialCode: '+86', flag: '🇨🇳' },
  { code: 'HK', name: '中国香港', dialCode: '+852', flag: '🇭🇰' },
  { code: 'MO', name: '中国澳门', dialCode: '+853', flag: '🇲🇴' },
  { code: 'TW', name: '中国台湾', dialCode: '+886', flag: '🇹🇼' },
  { code: 'US', name: '美国', dialCode: '+1', flag: '🇺🇸' },
  { code: 'CA', name: '加拿大', dialCode: '+1', flag: '🇨🇦' },
  { code: 'GB', name: '英国', dialCode: '+44', flag: '🇬🇧' },
  { code: 'JP', name: '日本', dialCode: '+81', flag: '🇯🇵' },
  { code: 'KR', name: '韩国', dialCode: '+82', flag: '🇰🇷' },
  { code: 'SG', name: '新加坡', dialCode: '+65', flag: '🇸🇬' },
  { code: 'AU', name: '澳大利亚', dialCode: '+61', flag: '🇦🇺' },
  { code: 'DE', name: '德国', dialCode: '+49', flag: '🇩🇪' },
  { code: 'FR', name: '法国', dialCode: '+33', flag: '🇫🇷' },
]

export interface PhoneInputValue {
  /** 本地号码（不含区号） */
  nationalNumber: string
  /** 完整国际 E.164 格式，如 +8613800000000 或 +15551234567 */
  e164: string
  /** 所属国家代码，如 'CN', 'US' */
  country: CountryCode
  /** 是否通过 libphonenumber 国际规范合法校验 */
  isValid: boolean
  /** 格式化后的可读国际号码，如 +86 138 0000 0000 */
  formatted: string
  /** 供后端账户体系兼容使用的号码（中国大陆存 11 位，国际号存 E.164） */
  submissionNumber: string
}

/** 通用国际电话号码解析辅助函数 */
export function resolvePhoneNumber(
  input: string,
  defaultCountry: CountryCode = 'CN'
): PhoneInputValue {
  const trimmed = input.trim()

  // 1. 尝试作为完整国际号码（带 + 或以国家码开头）解析
  let parsed = parsePhoneNumberFromString(trimmed)

  // 2. 如果未能直接解析（例如未带 + 号），结合当前默认国家重试
  if (!parsed) {
    // 兼容用户直接粘贴带有 86 的 13 位数字
    if (defaultCountry === 'CN' && trimmed.startsWith('86') && trimmed.length === 13) {
      parsed = parsePhoneNumberFromString(`+${trimmed}`)
    } else {
      parsed = parsePhoneNumberFromString(trimmed, defaultCountry)
    }
  }

  if (parsed) {
    const country = parsed.country ?? defaultCountry
    const nationalNumber = parsed.nationalNumber
    const e164 = parsed.format('E.164')
    const formatted = parsed.formatInternational()
    const isValid = parsed.isValid()
    // 兼容演示账户数据：CN 号码返回 11 位国内格式，国际号码返回 E.164
    const submissionNumber = country === 'CN' ? nationalNumber : e164

    return {
      nationalNumber,
      e164,
      country,
      isValid,
      formatted,
      submissionNumber,
    }
  }

  // 降级兜底处理（针对正在输入的未完整数字）
  const cleanDigits = trimmed.replace(/\D/g, '')
  return {
    nationalNumber: cleanDigits,
    e164: cleanDigits ? `+86${cleanDigits}` : '',
    country: defaultCountry,
    isValid: cleanDigits.length === 11 && cleanDigits.startsWith('1'),
    formatted: cleanDigits,
    submissionNumber: cleanDigits,
  }
}

export interface PhoneInputProps {
  value: string
  onChange: (value: string, meta: PhoneInputValue) => void
  defaultCountry?: CountryCode
  disabled?: boolean
  autoFocus?: boolean
  id?: string
  placeholder?: string
  className?: string
}

export function PhoneInput({
  value,
  onChange,
  defaultCountry = 'CN',
  disabled = false,
  autoFocus = false,
  id = 'phone',
  placeholder = '输入手机号码',
  className = '',
}: PhoneInputProps) {
  const [selectedCountry, setSelectedCountry] = React.useState<CountryCode>(defaultCountry)

  const activeCountry =
    SUPPORTED_COUNTRIES.find((c) => c.code === selectedCountry) ?? SUPPORTED_COUNTRIES[0]

  // 处理输入变化
  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const rawInput = event.target.value

    // 智能检测：如果输入包含 '+' 或者浏览器自动填充了带有区号的完整国际串
    if (rawInput.includes('+') || (rawInput.startsWith('86') && rawInput.length > 11)) {
      const detected = resolvePhoneNumber(rawInput, selectedCountry)
      if (detected.country && detected.country !== selectedCountry) {
        setSelectedCountry(detected.country)
      }
      onChange(detected.nationalNumber, detected)
      return
    }

    // 针对正在输入的纯数字，按当前选中国家解析
    const resolved = resolvePhoneNumber(rawInput, selectedCountry)
    onChange(resolved.nationalNumber, resolved)
  }

  return (
    <div className={cn('relative flex items-center rounded-lg border border-input bg-transparent shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/40 transition-[color,box-shadow]', className)}>
      {/* 国家/地区选择器 */}
      <div className="relative flex items-center shrink-0 pl-2.5 pr-1 border-r border-border/80">
        <span className="text-sm select-none mr-1.5" aria-hidden="true">
          {activeCountry.flag}
        </span>
        <select
          value={selectedCountry}
          disabled={disabled}
          onChange={(e) => {
            const nextCountry = e.target.value as CountryCode
            setSelectedCountry(nextCountry)
            if (value) {
              const reParsed = resolvePhoneNumber(value, nextCountry)
              onChange(reParsed.nationalNumber, reParsed)
            }
          }}
          className="appearance-none bg-transparent pr-5 text-xs font-semibold text-foreground outline-none cursor-pointer disabled:cursor-not-allowed"
          aria-label="选择国家或地区国际区号"
        >
          {SUPPORTED_COUNTRIES.map((c) => (
            <option key={c.code} value={c.code} className="bg-popover text-popover-foreground">
              {c.flag} {c.name} ({c.dialCode})
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-1.5 text-[10px] text-muted-foreground">
          ▼
        </span>
      </div>

      {/* 电话号码主输入框 */}
      <Input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={handleInputChange}
        className="flex-1 border-0 shadow-none font-mono text-sm tracking-wide focus-visible:ring-0 focus-visible:border-0 pl-3"
      />
    </div>
  )
}
