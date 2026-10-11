import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'

/** 保留对话子树；关闭时 inert，打开时约束焦点并支持 Escape。 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  className = '',
  header,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  className?: string
  header?: ReactNode
}) {
  const ref = useRef<HTMLElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const id = useId()
  const focusInitial = () => {
    const panel = ref.current
    ;(
      panel?.querySelector<HTMLElement>('[data-autofocus]') ??
      panel?.querySelector<HTMLElement>('button:not(:disabled)') ??
      panel
    )?.focus({ preventScroll: true })
  }
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const panel = ref.current
    const focusable = () =>
      [
        ...(panel?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
        ) ?? []),
      ].filter((element) => element.getClientRects().length > 0)
    const frame = requestAnimationFrame(() =>
      (panel?.querySelector<HTMLElement>('[data-autofocus]') ?? focusable()[0] ?? panel)?.focus({
        preventScroll: true,
      }),
    )
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
      }
      if (event.key !== 'Tab') return
      const elements = focusable()
      const first = elements[0]
      const last = elements.at(-1)
      if (!first) {
        event.preventDefault()
        panel?.focus({ preventScroll: true })
        return
      }
      if (!panel?.contains(document.activeElement)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first)?.focus({ preventScroll: true })
        return
      }
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === panel)
      ) {
        event.preventDefault()
        last?.focus({ preventScroll: true })
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus({ preventScroll: true })
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKey)
      previous?.focus({ preventScroll: true })
    }
  }, [open])
  return (
    <>
      <button
        className={`bank-sheet-backdrop${open ? ' is-open' : ''}`}
        aria-label={`关闭${title}`}
        onClick={onClose}
        tabIndex={-1}
        aria-hidden="true"
      />
      <section
        ref={ref}
        className={`bank-sheet ${className}${open ? ' is-open' : ''}`}
        role={open ? 'dialog' : undefined}
        aria-modal={open ? true : undefined}
        aria-labelledby={id}
        aria-hidden={!open}
        inert={!open}
        tabIndex={-1}
        onTransitionEnd={(event) => {
          if (
            open &&
            event.target === ref.current &&
            event.propertyName === 'transform' &&
            !ref.current?.contains(document.activeElement)
          )
            focusInitial()
        }}
      >
        <span className="bank-sheet-handle" />
        <header className="bank-sheet-heading">
          <div id={id}>{header ?? <h2>{title}</h2>}</div>
          <button
            className="bank-icon-button bank-lift"
            aria-label={`关闭${title}`}
            onClick={onClose}
          >
            <X size={21} />
          </button>
        </header>
        {children}
      </section>
    </>
  )
}
