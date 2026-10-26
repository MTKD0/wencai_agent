import { useId, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { bankEase } from '#/components/ui/motion'
import { useDesktopLayout } from '#/lib/use-desktop-layout'

/** Decorative, one-shot narrative. Input settles every layer at its readable final position. */
export function AuthStory({ settled }: { settled: boolean }) {
  const id = useId().replace(/:/g, '')
  const reduced = useReducedMotion()
  const desktop = useDesktopLayout()
  const still = settled || !!reduced || !desktop
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const timing = (delay: number, duration = 0.7) => ({
    delay: still ? 0 : delay,
    duration: still ? 0 : duration,
    ease: bankEase,
  })
  return (
    <div
      className="auth-story"
      aria-hidden="true"
      data-settled={still}
      data-ready={desktop}
      onPointerMove={(event) => {
        if (still || event.pointerType !== 'mouse') return
        const box = event.currentTarget.getBoundingClientRect()
        setOffset({
          x: ((event.clientX - box.left) / box.width - 0.5) * 5,
          y: ((event.clientY - box.top) / box.height - 0.5) * 4,
        })
      }}
      onPointerLeave={() => setOffset({ x: 0, y: 0 })}
    >
      <motion.svg
        key={still ? 'settled' : 'playing'}
        viewBox="0 0 760 490"
        fill="none"
        focusable="false"
        animate={still ? { x: 0, y: 0 } : offset}
        transition={{ duration: 0.65, ease: bankEase }}
      >
        <defs>
          <linearGradient id={`${id}-panel`} x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#252637" />
            <stop offset=".5" stopColor="#191a24" />
            <stop offset="1" stopColor="#121319" />
          </linearGradient>
          <linearGradient id={`${id}-accent`} x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#9b9dff" />
            <stop offset="1" stopColor="#6265ff" />
          </linearGradient>
          <linearGradient id={`${id}-line`}>
            <stop stopColor="#a6a8ff" />
            <stop offset="1" stopColor="#6265ff" stopOpacity=".4" />
          </linearGradient>
          <filter id={`${id}-shadow`} x="-30%" y="-30%" width="160%" height="180%">
            <feDropShadow dy="18" stdDeviation="16" floodColor="#000" floodOpacity=".35" />
          </filter>
          <filter id={`${id}-glow`} x="-150%" y="-150%" width="400%" height="400%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>
        {/* 0–1s: a single request; 1–2.5s: the task connects to the result. */}
        <motion.g
          initial={still ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={timing(0.15, 0.8)}
        >
          <rect x="67" y="20" width="304" height="62" rx="22" fill="#191a2a" stroke="#777aff" strokeWidth="1.5" />
          <path d="m203 82 12 13 12-13" fill="#191a2a" stroke="#777aff" strokeWidth="1.5" />
          <text x="219" y="58" textAnchor="middle" className="auth-story-request">
            帮我安排这个月的开支
          </text>
        </motion.g>
        <motion.path
          d="M215 96V146M371 51C446 51 446 120 477 120M596 255C734 255 731 349 666 349"
          stroke={`url(#${id}-line)`}
          strokeWidth="1.6"
          initial={still ? false : { pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={timing(1, 1.5)}
        />
        {/* Background plan remains mostly frontal and partially behind the result. */}
        <motion.g
          initial={still ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={timing(1.8)}
        >
          <g transform="rotate(4 560 192)" filter={`url(#${id}-shadow)`}>
            <rect x="434" y="99" width="270" height="190" rx="20" fill={`url(#${id}-panel)`} stroke="#505174" />
            <circle cx="467" cy="133" r="11" fill="#777aff" />
            <path d="M467 121V133H479" stroke="#191a24" strokeWidth="2" />
            <text x="489" y="140" className="auth-story-card-title">
              预算计划
            </text>
            {['日常开支', '固定支出', '预留安排'].map((label, index) => (
              <motion.g
                key={label}
                initial={still ? false : { opacity: 0, x: -5 }}
                animate={{ opacity: 1, x: 0 }}
                transition={timing(2.8 + index * 0.22, 0.5)}
              >
                <text x="498" y={184 + index * 35} className="auth-story-small">
                  {label}
                </text>
                <rect x="578" y={174 + index * 35} width="98" height="8" rx="4" fill="#303143" />
                <motion.rect
                  x="578"
                  y={174 + index * 35}
                  height="8"
                  rx="4"
                  fill={`url(#${id}-accent)`}
                  initial={still ? false : { width: 0 }}
                  animate={{ width: [72, 48, 33][index] }}
                  transition={timing(3 + index * 0.2, 0.65)}
                />
              </motion.g>
            ))}
          </g>
        </motion.g>
        {/* Main result card, the largest and clearest layer. */}
        <motion.g
          initial={still ? false : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={timing(1.6, 0.85)}
        >
          <g transform="rotate(-2 278 299)" filter={`url(#${id}-shadow)`}>
            <rect x="54" y="150" width="432" height="292" rx="24" fill={`url(#${id}-panel)`} stroke="#646694" />
            <rect x="82" y="180" width="7" height="12" rx="2" fill="#777aff" />
            <rect x="94" y="173" width="7" height="19" rx="2" fill="#9294ff" />
            <rect x="106" y="166" width="7" height="26" rx="2" fill="#b1b3ff" />
            <text x="133" y="192" className="auth-story-main-title">
              收支分析
            </text>
            <text x="83" y="220" className="auth-story-muted">
              本月开支，清楚有序
            </text>
            <rect x="78" y="243" width="195" height="170" rx="12" fill="#12131c" fillOpacity=".45" stroke="#38394e" />
            {[275, 317, 359, 395].map((y) => (
              <path key={y} d={`M94 ${y}H257`} stroke="#45465a" strokeOpacity=".3" strokeDasharray="3 5" />
            ))}
            {[47, 80, 101, 132].map((height, index) => (
              <motion.rect
                key={index}
                x={98 + index * 39}
                width="25"
                rx="4"
                fill={`url(#${id}-accent)`}
                initial={still ? false : { y: 395, height: 0 }}
                animate={{ y: 395 - height, height }}
                transition={timing(2.5 + index * 0.23, 0.85)}
              />
            ))}
            {['日常消费', '固定支出', '其他安排'].map((label, index) => (
              <motion.g
                key={label}
                initial={still ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={timing(2.7 + index * 0.25, 0.6)}
              >
                <circle cx="305" cy={268 + index * 51} r="6" fill={['#777aff', '#a6a8ff', '#6467c0'][index]} />
                <text x="322" y={274 + index * 51} className="auth-story-small">
                  {label}
                </text>
                <rect x="322" y={286 + index * 51} width={[121, 99, 71][index]} height="7" rx="3.5" fill="#3c3d53" />
              </motion.g>
            ))}
          </g>
        </motion.g>
        {/* 4–5.5s: the story ends with the user, never with an automatic transaction. */}
        <motion.g
          initial={still ? false : { opacity: 0, y: 22, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={timing(4, 1)}
          style={{ transformOrigin: '590px 381px' }}
        >
          <g transform="rotate(3 590 381)" filter={`url(#${id}-shadow)`}>
            <rect
              x="479"
              y="319"
              width="249"
              height="148"
              rx="20"
              fill={`url(#${id}-panel)`}
              stroke="#777aff"
              strokeOpacity=".8"
            />
            <rect x="501" y="340" width="20" height="24" rx="4" fill="#8a8cff" />
            <path d="M506 347H516M506 353H514M506 359H511" stroke="#242539" strokeWidth="2" strokeLinecap="round" />
            <text x="534" y="359" className="auth-story-card-title">
              核对信息
            </text>
            <rect x="502" y="380" width="9" height="9" rx="2" stroke="#9698ac" />
            <path d="M523 384H684M523 399H629" stroke="#3b3d52" strokeWidth="6" strokeLinecap="round" />
            <motion.g initial={still ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={timing(4.8, 0.7)}>
              <rect
                x="500"
                y="416"
                width="207"
                height="33"
                rx="16.5"
                fill="#6265ff"
                fillOpacity=".22"
                stroke="#777aff"
                strokeOpacity=".4"
              />
              <circle cx="526" cy="432.5" r="3" fill="#a6a8ff" />
              <text x="614" y="438" textAnchor="middle" className="auth-story-wait">
                等待本人确认
              </text>
            </motion.g>
          </g>
        </motion.g>
        <motion.g
          initial={still ? false : { opacity: 0 }}
          animate={{ opacity: still ? 0.65 : [0, 0.8, 0.45] }}
          transition={timing(5.5, 2.5)}
        >
          {[
            { x: 215, y: 143 },
            { x: 702, y: 317 },
          ].map((point) => (
            <g key={point.x}>
              <circle cx={point.x} cy={point.y} r="7" fill="#777aff" filter={`url(#${id}-glow)`} />
              <circle cx={point.x} cy={point.y} r="3" fill="#b5b7ff" />
            </g>
          ))}
        </motion.g>
      </motion.svg>
    </div>
  )
}
