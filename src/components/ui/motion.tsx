import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { formatAmount } from '#/lib/dashboard'
import './motion.css'

export const motionStyle = (values: Record<`--${string}`, string | number>) =>
  values as CSSProperties

/** 每次挂载在首次进入可视区域时播放；数据变化由调用方以稳定 key 触发重播。 */
export function useReveal<T extends Element>() {
  const ref = useRef<T>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    if (!('IntersectionObserver' in window)) {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.12 },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return { ref, 'data-visible': visible }
}

export function Reveal({
  children,
  delay = 0,
  className = '',
}: {
  children: ReactNode
  delay?: number
  className?: string
}) {
  return (
    <div
      {...useReveal<HTMLDivElement>()}
      className={`bank-reveal ${className}`}
      style={motionStyle({ '--reveal-delay': `${delay}ms` })}
    >
      {children}
    </div>
  )
}

export function AnimatedAmount({
  value,
  prefix = '',
  className = '',
}: {
  value: number
  prefix?: string
  className?: string
}) {
  const [display, setDisplay] = useState(value)
  const previous = useRef(0)
  useEffect(() => {
    const from = previous.current
    previous.current = value
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    if (preference.matches) {
      setDisplay(value)
      return
    }
    const start = performance.now()
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / 850)
      setDisplay(from + (value - from) * (1 - Math.pow(1 - progress, 3)))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    const stop = () => {
      if (preference.matches) {
        cancelAnimationFrame(frame)
        setDisplay(value)
      }
    }
    preference.addEventListener('change', stop)
    return () => {
      cancelAnimationFrame(frame)
      preference.removeEventListener('change', stop)
    }
  }, [value])
  return (
    <span className={className} aria-label={`${prefix}${formatAmount(value)}`}>
      <span aria-hidden="true">
        {prefix}
        {formatAmount(display)}
      </span>
    </span>
  )
}
