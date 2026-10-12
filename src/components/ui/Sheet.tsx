import { useEffect, useId, useRef, useState } from 'react'
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
  const gesture = useRef<{ pointer: number; start: number; at: number; distance: number } | null>(null)
  const [drag, setDrag] = useState(0)
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    if (!open) {
      gesture.current = null
      setDrag(0)
      setDragging(false)
    }
  }, [open])
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
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
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
        className={`bank-sheet ${className}${open ? ' is-open' : ''}${dragging ? ' is-dragging' : ''}`}
        style={open && drag > 0 ? { transform: `translateY(${drag}px)` } : undefined}
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
        <button type="button" className="bank-sheet-grip" aria-label={`下拉收起${title}`}
          onClick={(event) => {
            // 键盘和辅助技术仍可直接激活；鼠标轻触白条不会意外关闭。
            if (event.detail === 0) closeRef.current()
          }}
          onPointerDown={(event) => {
            if (!open || (event.pointerType === 'mouse' && event.button !== 0)) return
            event.currentTarget.setPointerCapture(event.pointerId)
            gesture.current = { pointer: event.pointerId, start: event.clientY, at: event.timeStamp, distance: 0 }
            setDragging(true)
          }}
          onPointerMove={(event) => {
            const current = gesture.current
            if (!current || current.pointer !== event.pointerId) return
            current.distance = Math.max(0, event.clientY - current.start)
            setDrag(current.distance)
          }}
          onPointerUp={(event) => {
            const current = gesture.current
            if (!current || current.pointer !== event.pointerId) return
            const distance = Math.max(0, event.clientY - current.start)
            const velocity = distance / Math.max(1, event.timeStamp - current.at)
            const threshold = Math.min(110, (ref.current?.clientHeight ?? 500) * 0.2)
            gesture.current = null
            setDragging(false)
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
            if (distance >= threshold || (distance >= 32 && velocity > 0.65)) closeRef.current()
            setDrag(0)
          }}
          onPointerCancel={() => { gesture.current = null; setDragging(false); setDrag(0) }}
          onLostPointerCapture={() => {
            if (gesture.current) { gesture.current = null; setDragging(false); setDrag(0) }
          }}
        ><span className="bank-sheet-handle" /></button>
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
