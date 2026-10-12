import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  ChevronRight,
  CreditCard,
  Droplets,
  Eye,
  EyeOff,
  Gift,
  Grid2X2,
  House,
  Loader2,
  LogOut,
  ReceiptText,
  ScanLine,
  Settings,
  ShieldCheck,
  ShoppingBag,
  UserRound,
  UsersRound,
  Wallet,
} from 'lucide-react'
import { authClient } from '#/lib/auth-client'
import { UnauthorizedError } from '#/lib/queries'
import type { DashboardData } from '#/lib/dashboard'
import { formatAmount } from '#/lib/dashboard'
import { AnimatedAmount, Reveal } from '#/components/ui/motion'
import { AnimatedBarChart, AnimatedDonutChart } from '#/components/ui/charts'
import { BankCardStack } from '#/components/ui/BankCard'
import { Sheet } from '#/components/ui/Sheet'
import { DraggableFloatingButton } from '#/components/ui/DraggableFloatingButton'
import ChatView from '#/components/chat/ChatView'
import { AgentAvatar } from './AgentAvatar'
import { FinancialReport } from './FinancialReport'
import PaymentCenter from './PaymentCenter'
import type { PaymentView } from './PaymentCenter'
import { AccountCarousel, accountSlides } from './AccountCarousel'
import { CardServices, type CardServiceMode } from './CardServices'
import { subscribeConfirmations } from '#/lib/confirmation-notices'
import './banking.css'

type Tab = 'home' | 'accounts' | 'life' | 'profile'
type Detail = 'assets' | 'bill' | 'transactions' | 'receive' | 'notifications' | null
const tabs = [
  { id: 'home', label: '首页', icon: House },
  { id: 'accounts', label: '账户', icon: CreditCard },
  { id: 'life', label: '生活', icon: ShoppingBag },
  { id: 'profile', label: '我的', icon: UserRound },
] as const

async function fetchDashboard(): Promise<DashboardData> {
  const response = await fetch('/api/dashboard', { credentials: 'same-origin' })
  if (response.status === 401) throw new UnauthorizedError()
  if (!response.ok) throw new Error('暂时无法读取账户数据，请稍后重试')
  return response.json()
}

export default function BankingHome({ user }: { user: { id: string; name: string } }) {
  const queryClient = useQueryClient()
  const pageScroll = useRef<HTMLDivElement>(null)
  const query = useQuery({
    queryKey: ['dashboard', user.id],
    queryFn: fetchDashboard,
    staleTime: 30_000,
    retry: (count, error) => !(error instanceof UnauthorizedError) && count < 2,
  })
  const [tab, setTab] = useState<Tab>('home')
  const [hidden, setHidden] = useState(false)
  const [agentOpen, setAgentOpen] = useState(false)
  const [paymentView, setPaymentView] = useState<PaymentView | null>(null)
  const [request, setRequest] = useState<{ id: number; text: string }>()
  const [detail, setDetail] = useState<Detail>(null)
  const [signingOut, setSigningOut] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [selectedCardId, setSelectedCardId] = useState<string>()
  const [paymentAccountId, setPaymentAccountId] = useState<string>()
  const [cardService, setCardService] = useState<{ id: string; mode: CardServiceMode } | null>(null)
  const data = query.data
  const selectedCard = data && (accountSlides(data).find((card) => card.id === selectedCardId) ?? accountSlides(data)[0])
  const selectedAccount = data?.accounts.find((account) => account.id === selectedCard?.accountId)
  const activity = selectedAccount && data?.accountActivity[selectedAccount.id]
  const openAgent = (text?: string) => {
    setCardService(null)
    setPaymentView(null)
    setDetail(null)
    if (text) setRequest((previous) => ({ id: (previous?.id ?? 0) + 1, text }))
    setAgentOpen(true)
  }
  useEffect(() => subscribeConfirmations((notice) => {
    if (notice.userId === user.id) { setPaymentView(null); setDetail(null); setCardService(null); setAgentOpen(true) }
  }), [user.id])
  const openPayment = (view: PaymentView, accountId?: string) => { setCardService(null); setPaymentAccountId(accountId); setDetail(null); setAgentOpen(false); setPaymentView(view) }
  const openCardService = (mode: CardServiceMode) => { if (selectedCard) { setAgentOpen(false); setPaymentView(null); setDetail(null); setCardService({ id: selectedCard.id, mode }) } }
  const closePayment = () => { setPaymentView(null); void queryClient.invalidateQueries({ queryKey: ['dashboard', user.id] }) }
  const closeAgent = () => {
    setAgentOpen(false)
    void queryClient.invalidateQueries({ queryKey: ['dashboard', user.id] })
  }
  const selectTab = (next: Tab) => {
    setTab(next)
    setDetail(null)
    pageScroll.current?.scrollTo({ top: 0, behavior: 'instant' })
  }
  const title =
    detail === 'assets'
      ? '资产详情'
      : detail === 'bill'
        ? '智能账单分析'
        : detail === 'transactions'
          ? '交易明细'
          : detail === 'receive'
            ? '我的收款账户'
            : '消息与提醒'
  const signOut = async () => {
    setSigningOut(true)
    setProfileError('')
    try {
      const result = await authClient.signOut()
      if (result.error) {
        setProfileError(result.error.message ?? '退出失败，请重试')
        return
      }
      queryClient.clear()
      window.location.assign('/login')
    } catch {
      setProfileError('退出失败，请检查网络后重试')
    } finally {
      setSigningOut(false)
    }
  }
  return (
    <div className="bank-stage">
      <div className="bank-shell">
        <div className="bank-home-scroll" ref={pageScroll} inert={agentOpen || !!detail || !!paymentView || !!cardService}>
          <header className="bank-home-header">
            <button
              className="bank-profile bank-lift"
              onClick={() => selectTab('profile')}
              aria-label="查看我的资料"
            >
              <span className="bank-user-avatar">{user.name.slice(0, 1)}</span>
              <span>
                <strong>{user.name}</strong>
                <small>你好，美好的一天</small>
              </span>
            </button>
            <div className="bank-header-actions">
              <button
                className="bank-icon-button bank-lift"
                onClick={() => openPayment('receive')}
                aria-label="查看收款账户"
              >
                <ScanLine size={18} />
              </button>
              <button
                className="bank-icon-button bank-lift bank-bell"
                onClick={() => setDetail('notifications')}
                aria-label="消息与提醒"
              >
                <Bell size={18} />
                {data?.subscriptions.some((item) => item.status === 'active') && <i />}
              </button>
            </div>
          </header>
          {query.isPending ? (
            <div className="bank-loading">
              <Loader2 className="bank-spin" size={26} />
              <p>正在读取你的账户</p>
            </div>
          ) : query.isError ? (
            <div className="bank-load-error" role="alert">
              <Wallet size={28} />
              <h2>暂时无法连接账户</h2>
              <p>{query.error.message}</p>
              {query.error instanceof UnauthorizedError ? (
                <a href="/login" className="bank-primary bank-lift">
                  重新登录
                </a>
              ) : (
                <button className="bank-primary bank-lift" onClick={() => void query.refetch()}>
                  重新加载
                </button>
              )}
            </div>
          ) : (
            data && (
              <main key={tab} className="bank-page-content">
                {tab === 'home' && (
                  <>
                    <section className="bank-assets">
                      <div className="bank-asset-label">
                        账户总资产（元）
                        <button
                          className="bank-icon-button bank-lift"
                          aria-label={hidden ? '显示资产金额' : '隐藏资产金额'}
                          onClick={() => setHidden(!hidden)}
                        >
                          {hidden ? <EyeOff size={17} /> : <Eye size={17} />}
                        </button>
                      </div>
                      <h1>{hidden ? '••••••' : <AnimatedAmount value={data.totalAssets} />}</h1>
                      <div className="bank-asset-bottom">
                        <p>
                          可用余额{' '}
                          <strong>
                            {hidden ? '••••••' : `¥ ${formatAmount(data.availableBalance)}`}
                          </strong>
                        </p>
                        <button
                          className="bank-text-button bank-lift"
                          onClick={() => setDetail('assets')}
                        >
                          资产详情
                          <ChevronRight size={15} />
                        </button>
                      </div>
                    </section>
                    <nav className="bank-quick-actions" aria-label="快捷业务">
                      {[
                        {
                          label: '转账',
                          icon: ArrowUpRight,
                          action: () => openPayment('transfer'),
                        },
                        { label: '收款', icon: ArrowDownLeft, action: () => openPayment('receive') },
                        { label: '银行卡', icon: CreditCard, action: () => selectTab('accounts') },
                        { label: '更多', icon: Grid2X2, action: () => selectTab('life') },
                      ].map(({ label, icon: Icon, action }) => (
                        <button key={label} className="bank-lift" onClick={action}>
                          <span>
                            <Icon size={28} strokeWidth={2.2} />
                          </span>
                          {label}
                        </button>
                      ))}
                    </nav>
                    <div className="bank-home-tiles">
                      <Reveal delay={60}>
                        <button
                          className="bank-home-tile bank-lift bank-account-tile"
                          onClick={() => selectTab('accounts')}
                        >
                          <strong>我的账户</strong>
                          <span>
                            {data.cards.length} 张银行卡
                            <ChevronRight size={13} />
                          </span>
                          <BankCardStack count={data.cards.length} />
                        </button>
                      </Reveal>
                      <Reveal delay={130}>
                        <button
                          className="bank-home-tile bank-lift bank-income-tile"
                          onClick={() => setDetail('bill')}
                        >
                          <strong>本月收支</strong>
                          <div className="bank-income-lines">
                            <p>
                              <span>收入</span>
                              <b>{hidden ? '••••' : `¥ ${formatAmount(data.monthly.income)}`}</b>
                            </p>
                            <p>
                              <span>支出</span>
                              <b>{hidden ? '••••' : `¥ ${formatAmount(data.monthly.expense)}`}</b>
                            </p>
                          </div>
                          <span className="bank-mini-bars" aria-hidden="true">
                            <AnimatedBarChart data={data.trend} compact />
                          </span>
                        </button>
                      </Reveal>
                    </div>
                    <Reveal delay={180}>
                      <button
                        className="bank-analysis-tile bank-lift"
                        onClick={() => setDetail('bill')}
                      >
                        <span>
                          <strong>智能账单分析</strong>
                          <small>看看钱都花在哪儿了</small>
                        </span>
                        <span className="bank-analysis-arrow">
                          <ChevronRight size={22} />
                        </span>
                        <span className="bank-mini-pie" aria-hidden="true">
                          <AnimatedDonutChart data={data.monthly.categories} compact pie />
                        </span>
                      </button>
                    </Reveal>
                    <Reveal delay={220}>
                      <section className="bank-recent">
                        <div className="bank-section-heading">
                          <h2>最近交易</h2>
                          <button
                            className="bank-text-button bank-lift"
                            onClick={() => setDetail('transactions')}
                          >
                            查看全部
                            <ChevronRight size={13} />
                          </button>
                        </div>
                        <TransactionList
                          transactions={data.transactions.slice(0, 3)}
                          hidden={hidden}
                        />
                      </section>
                    </Reveal>
                  </>
                )}
                {tab === 'accounts' && (
                  <>
                    <div className="bank-section-heading">
                      <h1>我的账户</h1>
                      <span>{data.cards.length} 张银行卡</span>
                    </div>
                    <p className="bank-page-note">每张卡独立记账，左右滑动查看对应账单。</p>
                    <AccountCarousel data={data} selectedId={selectedCard?.id} onSelect={setSelectedCardId} hidden={hidden} />
                    {selectedCard && <>
                      <div className="bank-card-actions">
                        {selectedCard.kind === 'debit' ? <>
                          <button className="bank-primary bank-lift" disabled={selectedCard.status !== 'active'} onClick={() => openPayment('transfer', selectedCard.accountId)}>转账</button>
                          <button className="bank-payment-secondary bank-lift" disabled={selectedCard.status !== 'active'} onClick={() => openPayment('receive', selectedCard.accountId)}>收款</button>
                        </> : <button className="bank-primary bank-lift" disabled={selectedCard.status !== 'active' || selectedCard.outstanding <= 0} onClick={() => openCardService('repay')}>信用卡还款</button>}
                        <button className="bank-payment-secondary bank-lift" onClick={() => openCardService('remark')}>修改备注</button>
                        <button className="bank-payment-secondary bank-lift" onClick={() => openCardService('manage')}>管理</button>
                      </div>
                      {selectedCard.kind === 'credit' && <Reveal key={selectedCard.id}><div className="bank-credit-summary">
                        <div><span>当前待还</span><strong>{hidden ? '••••••' : `¥ ${formatAmount(selectedCard.outstanding)}`}</strong></div>
                        <div><span>信用总额度</span><strong>{hidden ? '••••••' : `¥ ${formatAmount(selectedCard.creditLimit)}`}</strong></div>
                        <p>账单日每月 {selectedCard.billDay} 日 · 还款日每月 {selectedCard.dueDay} 日</p>
                      </div></Reveal>}
                    </>}
                    {selectedAccount && activity && (
                      <div key={selectedCard?.id} className="bank-account-activity" aria-label={`尾号${selectedCard?.last4}账单`}>
                        <Reveal>
                          <div className="bank-section-heading">
                            <h2>{selectedCard?.accountName} · {selectedCard?.last4} 账单</h2>
                            <span>{activity.monthly.period.replace('-', ' / ')}</span>
                          </div>
                          <div className="bank-account-summary">
                            <div><span>{selectedCard?.kind === 'credit' ? '本月还款' : '本月收入'}</span><strong className="is-income">{hidden ? '••••••' : `+${formatAmount(activity.monthly.income)}`}</strong></div>
                            <div><span>{selectedCard?.kind === 'credit' ? '本月消费' : '本月支出'}</span><strong>{hidden ? '••••••' : `−${formatAmount(activity.monthly.expense)}`}</strong></div>
                          </div>
                          <div className="bank-section-heading"><h3>交易明细</h3><span>最近 {activity.transactions.length} 笔</span></div>
                          <TransactionList transactions={activity.transactions} hidden={hidden} />
                        </Reveal>
                      </div>
                    )}
                    <div className="bank-section-heading">
                      <h2>其他资金账户</h2>
                      <button
                        className="bank-text-button bank-lift"
                        onClick={() => setDetail('assets')}
                      >
                        查看资产
                        <ChevronRight size={14} />
                      </button>
                    </div>
                    {data.accounts.filter((account) => !data.cards.some((card) => card.accountId === account.id)).map((account, index) => (
                      <Reveal key={account.id} delay={index * 70}>
                        <div className="bank-cash-account bank-lift">
                          <span className="bank-transaction-icon">
                            <Wallet size={20} />
                          </span>
                          <span>
                            {account.name}
                            <small>{account.currency} 活期账户</small>
                          </span>
                          <strong>
                            {hidden ? '••••••' : `¥ ${formatAmount(account.balance)}`}
                          </strong>
                        </div>
                      </Reveal>
                    ))}
                    {!data.accounts.length && <p className="bank-empty">你还没有银行账户</p>}
                    <div className="bank-payment-entry"><button className="bank-payment-secondary bank-lift" onClick={() => openPayment('payees')}><UsersRound size={16} />收款人</button><button className="bank-payment-secondary bank-lift" onClick={() => openPayment('transfer', selectedCard?.kind === 'debit' ? selectedCard.accountId : undefined)}>账户互转</button></div>
                  </>
                )}
                {tab === 'life' && (
                  <>
                    <h1 className="bank-page-title">生活服务</h1>
                    <p className="bank-page-note">照顾日常，也为重要的日子做好准备。</p>
                    <div className="bank-life-actions">
                      <button
                        className="bank-lift"
                        onClick={() => openAgent('帮我查看生日计划和联系人')}
                      >
                        <Gift size={26} />
                        <strong>生日计划</strong>
                        <span>
                          为重要的人用心安排
                          <ChevronRight size={14} />
                        </span>
                      </button>
                      <button
                        className="bank-lift"
                        onClick={() => openAgent('我想发起一笔AA收款，请先帮我查看联系人')}
                      >
                        <UsersRound size={26} />
                        <strong>AA 收款</strong>
                        <span>
                          和朋友轻松分账
                          <ChevronRight size={14} />
                        </span>
                      </button>
                    </div>
                    <div className="bank-section-heading">
                      <h2>订阅与代扣</h2>
                      <button
                        className="bank-text-button bank-lift"
                        onClick={() => openAgent('帮我查看所有订阅与自动扣费')}
                      >
                        管理
                        <ChevronRight size={14} />
                      </button>
                    </div>
                    <SubscriptionList subscriptions={data.subscriptions} hidden={hidden} />
                  </>
                )}
                {tab === 'profile' && (
                  <>
                    <div className="bank-profile-card">
                      <span className="bank-user-avatar">{user.name.slice(0, 1)}</span>
                      <h1>{user.name}</h1>
                      <span>
                        <ShieldCheck size={14} />
                        账户已安全登录
                      </span>
                    </div>
                    <div className="bank-profile-links">
                      <a className="bank-lift" href="/settings">
                        <Settings size={21} />
                        <span>
                          安全与设备管理<small>交易密码、Passkey 与登录设备</small>
                        </span>
                        <ChevronRight size={17} />
                      </a>
                      <button className="bank-lift" onClick={() => setDetail('assets')}>
                        <Wallet size={21} />
                        <span>
                          我的资产<small>查看账户余额与理财持仓</small>
                        </span>
                        <ChevronRight size={17} />
                      </button>
                      <button className="bank-lift" onClick={() => openAgent()}>
                        <AgentAvatar small />
                        <span>
                          文财 Agent<small>查账户、转账、看账单</small>
                        </span>
                        <ChevronRight size={17} />
                      </button>
                      <button
                        className="bank-lift"
                        disabled={signingOut}
                        onClick={() => void signOut()}
                      >
                        <LogOut size={21} />
                        <span>{signingOut ? '正在退出…' : '退出登录'}</span>
                        <ChevronRight size={17} />
                      </button>
                    </div>
                    {profileError && (
                      <p className="bank-error" role="alert">
                        {profileError}
                      </p>
                    )}
                  </>
                )}
              </main>
            )
          )}
          <p className="bank-service-note">文财银行 · 模拟银行服务</p>
        </div>
        <nav className="bank-bottom-nav" aria-label="底部导航" inert={agentOpen || !!detail || !!paymentView || !!cardService}>
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`bank-lift${tab === id ? ' is-active' : ''}`}
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => selectTab(id)}
            >
              <Icon size={19} strokeWidth={tab === id ? 2.4 : 1.8} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <DraggableFloatingButton
          hidden={agentOpen || !!detail || !!paymentView}
          expanded={agentOpen}
          onActivate={() => openAgent()}
          label="打开文财 Agent"
          controls="bank-agent-conversation"
        >
          <span className="bank-fab-label">问文财</span>
          <AgentAvatar small />
        </DraggableFloatingButton>
        <Sheet
          open={agentOpen}
          onClose={closeAgent}
          title="文财 Agent"
          className="bank-agent-sheet"
          header={
            <span className="bank-agent-heading">
              <AgentAvatar small />
              <strong>文财 Agent</strong>
              <small>
                <i />
                在线
              </small>
            </span>
          }
        >
          <div id="bank-agent-conversation" className="bank-agent-conversation">
            <ChatView request={request} active={agentOpen} userId={user.id} />
          </div>
        </Sheet>
        <Sheet open={!!paymentView} onClose={closePayment} title="转账与收款" className="bank-payment-sheet">
          {paymentView && <PaymentCenter userId={user.id} initialView={paymentView} initialAccountId={paymentAccountId} />}
        </Sheet>
        <Sheet open={!!cardService} onClose={() => setCardService(null)} title={cardService?.mode === 'remark' ? '卡片备注' : cardService?.mode === 'repay' ? '信用卡还款' : '卡片管理'} className="bank-payment-sheet">
          {cardService && data && <CardServices key={`${cardService.id}-${cardService.mode}`} data={data} cardId={cardService.id} mode={cardService.mode} userId={user.id} />}
        </Sheet>
        <Sheet
          open={!!detail}
          onClose={() => setDetail(null)}
          title={title}
          className="bank-detail-sheet"
        >
          <div className="bank-detail-scroll">
            {data && detail === 'bill' && (
              <>
                <p className="bank-page-note">
                  {data.monthly.period.replace('-', ' 年 ')} 月 · 账户真实收支
                </p>
                <FinancialReport data={data.monthly.categories} total={data.monthly.expense} />
                <div className="bank-trend-panel">
                  <AnimatedBarChart title="近六个月支出" data={data.trend} />
                </div>
                <button
                  className="bank-primary bank-lift bank-full-width"
                  onClick={() => openAgent('帮我分析本月的消费，按分类展示支出，并给一些建议')}
                >
                  让文财帮我分析
                  <ArrowUpRight size={17} />
                </button>
              </>
            )}
            {data && detail === 'assets' && (
              <>
                <div className="bank-detail-total">
                  <span>账户总资产</span>
                  <AnimatedAmount value={data.totalAssets} prefix="¥ " />
                </div>
                {[
                  { label: '可用余额', value: data.availableBalance },
                  { label: '理财持仓本金', value: data.investmentPrincipal },
                ].map((item) => (
                  <div key={item.label} className="bank-detail-row">
                    <span>{item.label}</span>
                    <strong>¥ {formatAmount(item.value)}</strong>
                  </div>
                ))}
                <p className="bank-page-note">理财按持仓本金统计，不包含预计收益。</p>
                {data.accounts.map((account) => (
                  <div key={account.id} className="bank-detail-row">
                    <span>{account.name}</span>
                    <strong>¥ {formatAmount(account.balance)}</strong>
                  </div>
                ))}
              </>
            )}
            {data && detail === 'receive' && (
              <>
                <div className="bank-receive-icon">
                  <ArrowDownLeft size={32} />
                </div>
                <h3 className="bank-receive-title">{user.name}的收款账户</h3>
                <p className="bank-page-note">AA 收款可以交给文财处理。</p>
                {data.accounts.map((account) => (
                  <div className="bank-detail-row" key={account.id}>
                    <span>
                      {account.name}
                      <small>{account.currency}</small>
                    </span>
                    <strong>¥ {formatAmount(account.balance)}</strong>
                  </div>
                ))}
                {!data.accounts.length && <p className="bank-empty">暂无可用收款账户</p>}
                <button
                  className="bank-primary bank-lift bank-full-width"
                  onClick={() => openAgent('我想发起一笔AA收款，请帮我准备')}
                >
                  发起 AA 收款
                  <ChevronRight size={17} />
                </button>
              </>
            )}
            {data && detail === 'transactions' && (
              <TransactionList transactions={data.transactions} hidden={hidden} />
            )}
            {data && detail === 'notifications' && (
              <>
                <div className="bank-notice">
                  <Bell size={20} />
                  <span>
                    订阅服务提醒<small>查看正在生效的订阅，提前安排支出。</small>
                  </span>
                </div>
                <SubscriptionList
                  subscriptions={data.subscriptions.filter((item) => item.status === 'active')}
                  hidden={hidden}
                />
                <button
                  className="bank-primary bank-lift bank-full-width"
                  onClick={() => openAgent('帮我查看订阅扣费时间和提醒设置')}
                >
                  管理订阅提醒
                  <ChevronRight size={17} />
                </button>
              </>
            )}
          </div>
        </Sheet>
      </div>
    </div>
  )
}

function TransactionList({
  transactions,
  hidden,
}: {
  transactions: DashboardData['transactions']
  hidden: boolean
}) {
  return (
    <div className="bank-transaction-list">
      {transactions.map((transaction, index) => {
        const Icon =
          transaction.amount > 0
            ? Wallet
            : transaction.category === '转账'
              ? UsersRound
              : transaction.category === '生活缴费'
                ? Droplets
                : ReceiptText
        return (
          <Reveal key={transaction.id} delay={Math.min(index, 8) * 50}>
            <article className="bank-transaction-row bank-lift" tabIndex={0}>
              <span
                className={`bank-transaction-icon${transaction.amount > 0 ? ' is-income' : ''}`}
              >
                <Icon size={20} />
              </span>
              <div>
                <strong>{transaction.counterparty}</strong>
                <small>
                  {new Intl.DateTimeFormat('zh-CN', {
                    timeZone: 'Asia/Shanghai',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                  }).format(new Date(transaction.occurredAt))}
                </small>
              </div>
              <b className={transaction.amount > 0 ? 'is-income' : ''}>
                {hidden
                  ? '••••••'
                  : `${transaction.amount > 0 ? '+' : '−'}${formatAmount(Math.abs(transaction.amount))}`}
              </b>
            </article>
          </Reveal>
        )
      })}
      {!transactions.length && <p className="bank-empty">暂无交易记录</p>}
    </div>
  )
}

function SubscriptionList({
  subscriptions,
  hidden,
}: {
  subscriptions: DashboardData['subscriptions']
  hidden: boolean
}) {
  return (
    <div className="bank-subscription-list">
      {subscriptions.map((item, i) => (
        <Reveal key={item.id} delay={i * 70}>
          <div className="bank-subscription bank-lift">
            <span className="bank-transaction-icon">
              <ShoppingBag size={20} />
            </span>
            <span>
              <strong>{item.merchant}</strong>
              <small>
                {item.status === 'active' ? '订阅生效中' : '已取消'} ·{' '}
                {item.cycle === 'monthly' ? '每月' : '每年'}
              </small>
            </span>
            <b>{hidden ? '••••' : `¥ ${formatAmount(item.amount)}`}</b>
          </div>
        </Reveal>
      ))}
      {!subscriptions.length && <p className="bank-empty">暂无订阅记录</p>}
    </div>
  )
}
