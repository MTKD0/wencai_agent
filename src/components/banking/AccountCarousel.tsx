import { useLayoutEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { BankCard } from '#/components/ui/BankCard'
import type { DashboardData } from '#/lib/dashboard'

export function accountSlides(data: Pick<DashboardData, 'cards' | 'accounts'>) {
  return data.cards.filter((card) => data.accounts.some((account) => account.id === card.accountId))
}

/** 原生触屏滚动与吸附；鼠标拖动、方向键和按钮使用同一个选择状态。 */
export function AccountCarousel({ data, selectedId, onSelect, hidden }: {
  data: DashboardData
  selectedId?: string
  onSelect: (id: string) => void
  hidden: boolean
}) {
  const slides = accountSlides(data)
  const index = Math.max(0, slides.findIndex((card) => card.id === selectedId))
  const viewport = useRef<HTMLDivElement>(null)
  const indexRef = useRef(index)
  indexRef.current = index
  const mouse = useRef<{ id: number; x: number; left: number; moved: boolean } | null>(null)
  const move = (next: number) => {
    const card = slides[next]
    if (!card) return
    onSelect(card.id)
    viewport.current?.scrollTo({ left: next * viewport.current.clientWidth, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
  }
  // 切换栏目 / 数据刷新时按卡片身份复位，不因 DOM 重建显示错卡。
  useLayoutEffect(() => {
    const el = viewport.current
    if (!el) return
    const sync = () => el.scrollTo({ left: indexRef.current * el.clientWidth, behavior: 'instant' })
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(el)
    return () => observer.disconnect()
    // 平滑切换期间由 scroll 事件更新 index，不能在每一帧强行复位。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides.map((card) => card.id).join('|')])
  if (!slides.length) return <p className="bank-empty">你还没有银行账户</p>
  return (
    <section className="bank-account-carousel" aria-label="我的银行卡" aria-roledescription="轮播">
      <div ref={viewport} className="bank-card-viewport" tabIndex={0}
        aria-label="左右滑动切换银行卡，也可使用左右方向键"
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault()
            move(index + (event.key === 'ArrowLeft' ? -1 : 1))
          }
        }}
        onScroll={(event) => {
          const el = event.currentTarget
          const current = slides[Math.round(el.scrollLeft / el.clientWidth)]
          if (current && current.id !== selectedId) onSelect(current.id)
        }}
        onPointerDown={(event) => {
          if (event.pointerType !== 'mouse' || event.button !== 0) return
          const el = event.currentTarget
          mouse.current = { id: event.pointerId, x: event.clientX, left: el.scrollLeft, moved: false }
        }}
        onPointerMove={(event) => {
          const drag = mouse.current
          if (!drag || drag.id !== event.pointerId) return
          const distance = event.clientX - drag.x
          if (!drag.moved && Math.abs(distance) < 6) return
          drag.moved = true
          event.currentTarget.setPointerCapture(event.pointerId)
          event.currentTarget.classList.add('is-dragging')
          event.currentTarget.scrollLeft = drag.left - distance
        }}
        onPointerUp={(event) => {
          const drag = mouse.current
          if (!drag || drag.id !== event.pointerId) return
          mouse.current = null
          const el = event.currentTarget
          el.classList.remove('is-dragging')
          if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId)
          if (drag.moved) move(Math.max(0, Math.min(slides.length - 1, Math.round(el.scrollLeft / el.clientWidth))))
        }}
        onPointerCancel={(event) => {
          mouse.current = null
          event.currentTarget.classList.remove('is-dragging')
          move(index)
        }}
      >
        {slides.map((card, i) => (
          <div key={card.id} className="bank-card-slide" role="group" aria-roledescription="卡片"
            aria-label={`${i + 1} / ${slides.length} ${card.accountName}`} inert={i !== index}>
            <BankCard name={card.accountName} last4={card.last4} kind={card.kind} status={card.status}
              balance={card.kind === 'credit' ? card.availableCredit : data.accounts.find((account) => account.id === card.accountId)?.balance} hidden={hidden} />
          </div>
        ))}
      </div>
      <div className="bank-card-controls">
        <button className="bank-icon-button bank-lift" aria-label="上一张银行卡" disabled={index === 0} onClick={() => move(index - 1)}><ChevronLeft size={18} /></button>
        <div className="bank-card-dots">
          {slides.map((card, i) => <button key={card.id} aria-label={`切换到${card.accountName}${card.last4 ? `尾号${card.last4}` : ''}`} aria-current={i === index ? 'true' : undefined} onClick={() => move(i)}><span /></button>)}
        </div>
        <span className="bank-card-count" aria-live="polite">{index + 1} / {slides.length}</span>
        <button className="bank-icon-button bank-lift" aria-label="下一张银行卡" disabled={index === slides.length - 1} onClick={() => move(index + 1)}><ChevronRight size={18} /></button>
      </div>
    </section>
  )
}
