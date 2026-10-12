import { Wifi } from 'lucide-react'
import { motionStyle } from './motion'
import { formatAmount } from '#/lib/dashboard'
import './bank-card.css'

export function BankCardStack({ count = 3 }: { count?: number }) {
  return (
    <span className="bank-card-stack" aria-hidden="true">
      {Array.from({ length: Math.max(0, count) }, (_, index) => index)
        .reverse()
        .map((index) => (
          <span key={index} className={`bank-stack-card stack-${index}`} style={{
            left: `${count > 1 ? index * 28 / (count - 1) : 0}px`,
            top: `${30 - (count > 1 ? index * 26 / (count - 1) : 0)}px`,
            opacity: `${1 - (count > 1 ? index * .45 / (count - 1) : 0)}`,
            ...motionStyle({ '--stack-rest': `rotate(${index === 0 ? -6 : 2 + index}deg)`, '--stack-delay': `${(count - index - 1) * 70}ms` }),
          }}>
            <span className="bank-chip" />
            <span className="bank-stack-lines" />
          </span>
        ))}
    </span>
  )
}

export function BankCard({
  name,
  last4,
  kind = 'debit',
  status = 'active',
  balance,
  hidden = false,
  index = 0,
}: {
  name: string
  last4?: string
  kind?: string
  status?: string
  balance?: number
  hidden?: boolean
  index?: number
}) {
  return (
    <article
      className={`bank-physical-card bank-lift${kind === 'credit' ? ' is-credit' : ''}`}
      tabIndex={0}
      style={motionStyle({ '--card-delay': `${index * 110}ms` })}
    >
      <div className="bank-card-top">
        <strong>
          文财银行<span>WENCAI BANK</span>
        </strong>
        <Wifi size={22} />
      </div>
      <span className="bank-chip" />
      <p className="bank-card-number">
        {kind === 'account' ? (
          '人民币 · 资金账户'
        ) : (
          <>•••• &nbsp; •••• &nbsp; •••• &nbsp; {last4 ?? '••••'}</>
        )}
      </p>
      <div className="bank-card-bottom">
        <span>
          {name}
          <small>
            {kind === 'account'
              ? '可用余额'
              : `${kind === 'credit' ? '信用卡' : '储蓄卡'} · ${status === 'active' ? '正常' : status === 'locked' ? '已锁定' : '已挂失'}`}
          </small>
        </span>
        {balance !== undefined && <span className="bank-card-value"><small>{kind === 'credit' ? '可用额度' : '可用余额'}</small><strong>{hidden ? '••••••' : `¥ ${formatAmount(balance)}`}</strong></span>}
      </div>
    </article>
  )
}
