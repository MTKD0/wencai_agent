import { useContext, useEffect, useRef, useState } from 'react'
import { SensitiveVisibility } from './sensitive-visibility'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from './button'
import { useSecureOperation } from './SecureOperation'

/** Password entry lives only in the independent security document. */
export function CardNumber({ cardId, last4, active = true }: { cardId?: string; last4?: string; active?: boolean }) {
  const visible = useContext(SensitiveVisibility)
  const open = useSecureOperation()
  const [number, setNumber] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  const verifying = useRef(false)
  const hide = () => { generation.current++; setNumber('') }

  useEffect(() => { if (!active || !visible) hide() }, [active, visible])
  useEffect(() => {
    const blur = () => { if (!verifying.current) hide() }
    const visibility = () => { if (document.hidden) hide() }
    window.addEventListener('blur', blur)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      generation.current++
      window.removeEventListener('blur', blur)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [cardId])
  useEffect(() => { if (!number) return; const timer = setTimeout(hide, 30_000); return () => clearTimeout(timer) }, [number])

  return (
    <>
      <span className="bank-number-value">{number ? number.match(/.{1,4}/g)?.join(' ') : `•••• •••• •••• ${last4 ?? '••••'}`}</span>
      {cardId && (
        <Button
          type="button"
          variant="ghost"
          className="bank-card-eye size-[30px] rounded-full"
          disabled={busy}
          aria-label={number ? '隐藏卡号' : `显示尾号${last4}完整卡号`}
          onClick={async (event) => {
            event.stopPropagation()
            if (number) { hide(); return }
            const current = generation.current
            verifying.current = true
            setBusy(true)
            setError('')
            try {
              const result = await open({ purpose: 'view_card', cardId })
              if (generation.current !== current || result.cancelled) return
              if (!result.number || !/^\d{16}$/.test(result.number)) throw new Error(result.message ?? '卡号读取失败')
              setNumber(result.number)
            } catch (error) {
              if (generation.current === current) setError(error instanceof Error ? error.message : '验证失败')
            } finally {
              verifying.current = false
              setBusy(false)
            }
          }}
        >
          {number ? <EyeOff size={18} /> : <Eye size={18} />}
        </Button>
      )}
      {error && <span role="alert" className="bank-card-number-error">{error}</span>}
    </>
  )
}
