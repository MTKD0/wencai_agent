import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { motion, useDragControls, useReducedMotion } from 'motion/react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { cn } from 'cn'

/**
 * Bottom sheet that anchors itself over `.bank-shell` so the independent security
 * document lines up with the app frame instead of the raw viewport.
 *
 * The parent owns the drag gesture; the iframe owns every secret input. Secret
 * values never cross the document boundary — only layout size and results do.
 */
export function SecureSheet({ open, height, frame, onCancel, children }: {
  open: boolean
  height: number
  frame: RefObject<HTMLIFrameElement | null>
  onCancel: () => void
  children: ReactNode
}) {
  const reduce = useReducedMotion()
  const controls = useDragControls()
  const panel = useRef<HTMLDivElement>(null)
  const [anchor, setAnchor] = useState({ left: '50%', width: 460, bottom: 0, maxHeight: 900 })

  useEffect(() => {
    if (open) frame.current?.focus()
  }, [open, frame])

  useEffect(() => {
    if (!open) return
    const shell = document.querySelector('.bank-shell')
    const update = () => {
      const rect = shell?.getBoundingClientRect()
      const viewport = window.visualViewport
      const screenHeight = viewport?.height ?? window.innerHeight
      const bottom = rect ? Math.max(0, screenHeight - rect.bottom) : 0
      setAnchor({
        left: rect ? `${rect.left + rect.width / 2}px` : '50%',
        width: Math.min(rect?.width ?? 460, window.innerWidth),
        bottom,
        maxHeight: Math.max(180, Math.min((rect?.height ?? screenHeight) - 12, screenHeight - bottom - 12)),
      })
    }
    update()
    const observer = new ResizeObserver(update)
    if (shell) observer.observe(shell)
    window.addEventListener('resize', update)
    window.visualViewport?.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('resize', update)
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel() }}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className={cn(
          'bank-secure-frame is-open gap-0 border-b-0 p-0',
          'top-auto bottom-auto translate-y-0 rounded-t-[25px] rounded-b-none',
          reduce ? '' : 'data-[state=open]:slide-in-from-bottom-full data-[state=closed]:slide-out-to-bottom-full',
        )}
        initialFocus={() => frame.current}
        // DialogContent already supplies translateX(-50%); no second centering offset.
        style={{ left: anchor.left, width: anchor.width, maxWidth: 'none', bottom: anchor.bottom, maxHeight: anchor.maxHeight, height: Math.min(height + 24, anchor.maxHeight) }}
        render={<motion.div
          ref={panel}
          drag="y"
          dragListener={false}
          dragControls={controls}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: reduce ? 0 : .8 }}
          dragMomentum={false}
          onDragEnd={(_, info) => {
            if (info.offset.y > Math.min(100, (panel.current?.clientHeight ?? 500) * .2) || (info.offset.y > 30 && info.velocity.y > 650)) onCancel()
          }}
        />}
      >
        <DialogTitle className="sr-only">银行卡安全验证独立页面</DialogTitle>
        <button
          type="button"
          className="bank-secure-grip"
          aria-label="下拉收起安全验证"
          onPointerDown={(event) => {
            if (open && event.isPrimary && event.button === 0) {
              // Continue the gesture when the pointer moves over the separate document.
              event.currentTarget.setPointerCapture(event.pointerId)
              controls.start(event)
            }
          }}
          onClick={(event) => { if (event.detail === 0) onCancel() }}
        >
          <span />
        </button>
        {children}
      </DialogContent>
    </Dialog>
  )
}
