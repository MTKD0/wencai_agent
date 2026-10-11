import { useEffect, useRef, useState } from 'react'
import type { PointerEvent, ReactNode } from 'react'

type Position = { x: number; y: number }

/** A floating entry that keeps its position across panels and viewport changes. */
export function DraggableFloatingButton({
  children,
  hidden,
  expanded,
  controls,
  label,
  onActivate,
}: {
  children: ReactNode
  hidden: boolean
  expanded: boolean
  controls: string
  label: string
  onActivate: () => void
}) {
  const anchor = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<Position>()
  const [dragging, setDragging] = useState(false)
  const gesture = useRef<{
    pointerId: number
    startX: number
    startY: number
    origin: Position
    moved: boolean
  } | null>(null)
  const suppressClick = useRef(false)

  const clamp = (point: Position): Position => {
    const element = anchor.current
    const parent = element?.offsetParent as HTMLElement | null
    if (!element || !parent) return point
    // Leave space for the label above the button and a small edge margin.
    const minY = Math.min(32, Math.max(0, parent.clientHeight - element.offsetHeight))
    return {
      x: Math.max(8, Math.min(point.x, parent.clientWidth - element.offsetWidth - 8)),
      y: Math.max(minY, Math.min(point.y, parent.clientHeight - element.offsetHeight - 8)),
    }
  }

  useEffect(() => {
    const element = anchor.current
    const parent = element?.offsetParent as HTMLElement | null
    if (!element || !parent) return
    const observer = new ResizeObserver(() => {
      setPosition((previous) =>
        previous ? clamp(previous) : undefined,
      )
    })
    observer.observe(parent)
    return () => observer.disconnect()
  }, [])

  const finish = (event: PointerEvent<HTMLButtonElement>, cancelled = false) => {
    const current = gesture.current
    if (!current || current.pointerId !== event.pointerId) return
    suppressClick.current = current.moved || cancelled
    gesture.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <div
      ref={anchor}
      className={`bank-floating-anchor${hidden ? ' is-hidden' : ''}${dragging ? ' is-dragging' : ''}`}
      style={position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : undefined}
      inert={hidden}
    >
      <button
        className="bank-agent-fab bank-lift"
        aria-label={label}
        aria-expanded={expanded}
        aria-controls={controls}
        title="拖动调整位置，点击打开文财"
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return
          const element = anchor.current
          if (!element) return
          suppressClick.current = false
          gesture.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            origin: { x: element.offsetLeft, y: element.offsetTop },
            moved: false,
          }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const current = gesture.current
          if (!current || current.pointerId !== event.pointerId) return
          const dx = event.clientX - current.startX
          const dy = event.clientY - current.startY
          if (!current.moved && Math.hypot(dx, dy) < 5) return
          current.moved = true
          suppressClick.current = true
          setDragging(true)
          setPosition(clamp({ x: current.origin.x + dx, y: current.origin.y + dy }))
        }}
        onPointerUp={(event) => finish(event)}
        onPointerCancel={(event) => finish(event, true)}
        onLostPointerCapture={(event) => finish(event, true)}
        onClick={(event) => {
          // Keyboard activation still works immediately after a drag.
          if (suppressClick.current && event.detail !== 0) {
            event.preventDefault()
            return
          }
          onActivate()
        }}
      >
        {children}
      </button>
    </div>
  )
}
