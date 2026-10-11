import { Wifi } from 'lucide-react'
import { motionStyle } from './motion'
import { formatAmount } from '#/lib/dashboard'
import './bank-card.css'

export function BankCardStack({ count = 3 }: { count?: number }) {
  return (
    <span className="bank-card-stack" aria-hidden="true">
      {Array.from({ length: Math.min(3, Math.max(0, count)) }, (_, index) => index)
        .reverse()
        .map((index) => (
          <span key={index} className={`bank-stack-card stack-${index}`}>
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
  index = 0,
}: {
  name: string
  last4?: string
  kind?: string
  status?: string
  balance?: number
  index?: number
}) {
  return (
    <article
      className="bank-physical-card bank-lift"
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
              : `${kind === 'credit' ? '信用卡' : '借记卡'} · ${status === 'active' ? '正常' : status === 'locked' ? '已锁定' : '已挂失'}`}
          </small>
        </span>
        {balance !== undefined && <strong>¥ {formatAmount(balance)}</strong>}
      </div>
    </article>
  )
}
