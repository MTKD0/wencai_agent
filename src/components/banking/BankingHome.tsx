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
import { AdaptiveDrawer as Drawer } from '#/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from 'cn'
import { DraggableFloatingButton } from '#/components/ui/DraggableFloatingButton'
import ChatView from '#/components/chat/ChatView'
import { AgentAvatar } from './AgentAvatar'
import { FinancialReport } from './FinancialReport'
import PaymentCenter from './PaymentCenter'
import type { PaymentView } from './PaymentCenter'
import { AccountCarousel, accountSlides } from './AccountCarousel'
import { CardApplication, CardServices, type CardServiceMode } from './CardServices'
import { subscribeConfirmations } from '#/lib/confirmation-notices'
import { TaskCenter } from './TaskCenter'

type Tab = 'home' | 'accounts' | 'life' | 'profile'
type Detail = 'assets' | 'bill' | 'transactions' | 'receive' | 'notifications' | 'tasks' | null
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
    refetchInterval: 15_000,
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
    if (notice.userId === user.id) {
      setPaymentView(null)
      setDetail(null)
      setCardService(null)
      setAgentOpen(true)
    }
  }), [user.id])

  const openPayment = (view: PaymentView, accountId?: string) => {
    setCardService(null)
    setPaymentAccountId(accountId)
    setDetail(null)
    setAgentOpen(false)
    setPaymentView(view)
  }

  const openCardService = (mode: CardServiceMode) => {
    if (selectedCard) {
      setAgentOpen(false)
      setPaymentView(null)
      setDetail(null)
      setCardService({ id: selectedCard.id, mode })
    }
  }

  const closePayment = () => {
    setPaymentView(null)
    void queryClient.invalidateQueries({ queryKey: ['dashboard', user.id] })
  }

  const closeAgent = () => {
    setAgentOpen(false)
    void queryClient.invalidateQueries({ queryKey: ['dashboard', user.id] })
  }

  const selectTab = (next: Tab) => {
    setTab(next)
    setDetail(null)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }

  const title =
    detail === 'tasks' ? '任务与人工处理' : detail === 'assets'
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
    <div className="min-h-screen w-full bg-background text-foreground flex flex-col font-sans">
      {/* 顶部全宽 Sticky Header */}
      <header className="sticky top-0 z-30 w-full border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8 h-16">
          {/* 用户信息 */}
          <button
            onClick={() => selectTab('profile')}
            className="flex items-center gap-3 text-left rounded-lg p-1 hover:bg-muted/50 transition-colors"
          >
            <div className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground font-semibold text-sm">
              {user.name.slice(0, 1)}
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold leading-tight text-foreground">{user.name}</span>
              <span className="text-xs text-muted-foreground leading-tight">你好，美好的一天</span>
            </div>
          </button>

          {/* 桌面端导航 Tabs (基于 shadcn Segmented) */}
          <nav className="hidden md:flex items-center gap-1 bg-muted p-1 rounded-full border border-border">
            {tabs.map(({ id, label, icon: Icon }) => (
              <Button
                key={id}
                variant={tab === id ? 'default' : 'ghost'}
                size="sm"
                onClick={() => selectTab(id)}
                className="rounded-full px-4 h-8 text-xs font-medium gap-1.5"
              >
                <Icon className="size-3.5" />
                <span>{label}</span>
              </Button>
            ))}
          </nav>

          {/* 顶部操作区 */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => openAgent()}
              className="hidden sm:inline-flex rounded-full gap-2 text-xs font-medium border-border hover:bg-muted"
            >
              <AgentAvatar small />
              <span>智能助理</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => openPayment('receive')}
              aria-label="查看收款账户"
              className="size-9 rounded-full text-muted-foreground hover:text-foreground"
            >
              <ScanLine className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setDetail('notifications')}
              aria-label="消息与提醒"
              className="relative size-9 rounded-full text-muted-foreground hover:text-foreground"
            >
              <Bell className="size-4" />
              {data?.subscriptions.some((item) => item.status === 'active') && (
                <span className="absolute top-2 right-2 size-2 rounded-full bg-destructive ring-2 ring-background" />
              )}
            </Button>
          </div>
        </div>
      </header>

      {/* 主内容区域：居中、最大宽度约束、铺满全屏背景 */}
      <div className="flex-1 w-full mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8" ref={pageScroll}>
        {query.isPending ? (
          <div className="flex flex-col items-center justify-center py-28 space-y-4 text-muted-foreground">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="text-sm">正在安全连接文财银行…</p>
          </div>
        ) : query.isError ? (
          <Card className="mx-auto max-w-md p-8 text-center space-y-4 border-border bg-card shadow-sm my-16">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Wallet className="size-6" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-lg font-semibold text-foreground">暂时无法连接账户</h2>
              <p className="text-xs text-muted-foreground max-w-xs mx-auto">{query.error.message}</p>
            </div>
            <div>
              {query.error instanceof UnauthorizedError ? (
                <Button asChild className="w-full">
                  <a href="/login">重新登录</a>
                </Button>
              ) : (
                <Button onClick={() => void query.refetch()} className="w-full">
                  重新加载
                </Button>
              )}
            </div>
          </Card>
        ) : data ? (
          <main key={tab} className="w-full pb-20 md:pb-8">
            {tab === 'home' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* 左列：资产概览、快捷业务、卡片与收支 */}
                <div className="lg:col-span-7 space-y-6">
                  {/* 资产大卡片 */}
                  <Card className="border-border bg-card shadow-xs overflow-hidden">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <span>账户总资产（元）</span>
                          <button
                            onClick={() => setHidden(!hidden)}
                            className="text-muted-foreground hover:text-foreground transition-colors p-1"
                            aria-label={hidden ? '显示资产' : '隐藏资产'}
                          >
                            {hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                          </button>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDetail('assets')}
                          className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1 px-2"
                        >
                          资产详情
                          <ChevronRight className="size-3" />
                        </Button>
                      </div>
                      <div className="text-3xl sm:text-4xl font-extrabold tracking-tight font-mono text-foreground mt-2">
                        {hidden ? '••••••' : <AnimatedAmount value={data.totalAssets} />}
                      </div>
                    </CardHeader>
                    <CardContent className="pt-2 border-t border-border/50 text-xs text-muted-foreground flex items-center justify-between">
                      <span>可用余额: <strong className="text-foreground font-mono">{hidden ? '••••' : `¥ ${formatAmount(data.availableBalance)}`}</strong></span>
                      <span>借记卡 {data.cards.filter((c) => c.kind === 'debit').length} 张 · 信用卡 {data.cards.filter((c) => c.kind === 'credit').length} 张</span>
                    </CardContent>
                  </Card>

                  {/* 快捷业务入口 */}
                  <Card className="border-border bg-card shadow-xs p-4 sm:p-5">
                    <nav className="grid grid-cols-4 gap-3 sm:gap-4 text-center">
                      {[
                        { label: '转账', icon: ArrowUpRight, action: () => openPayment('transfer') },
                        { label: '收款', icon: ArrowDownLeft, action: () => openPayment('receive') },
                        { label: '银行卡', icon: CreditCard, action: () => selectTab('accounts') },
                        { label: '生活服务', icon: Grid2X2, action: () => selectTab('life') },
                      ].map(({ label, icon: Icon, action }) => (
                        <button
                          key={label}
                          onClick={action}
                          className="group flex flex-col items-center gap-2 p-2 rounded-xl hover:bg-muted/50 transition-colors"
                        >
                          <div className="flex size-13 items-center justify-center rounded-full bg-secondary group-hover:bg-muted border border-border/80 text-foreground transition-all group-hover:scale-105 shadow-xs">
                            <Icon className="size-5" />
                          </div>
                          <span className="text-xs font-medium text-foreground">{label}</span>
                        </button>
                      ))}
                    </nav>
                  </Card>

                  {/* 双格卡片：我的账户 & 本月收支 */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Card
                      onClick={() => selectTab('accounts')}
                      className="cursor-pointer border-border bg-card shadow-xs hover:border-foreground/20 transition-all p-5 flex flex-col justify-between h-36"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sm text-foreground">我的账户</span>
                        <Badge variant="secondary" className="text-xs font-normal gap-1">
                          {data.cards.length} 张卡
                          <ChevronRight className="size-3" />
                        </Badge>
                      </div>
                      <div className="mt-auto flex justify-end">
                        <BankCardStack count={data.cards.length} />
                      </div>
                    </Card>

                    <Card
                      onClick={() => setDetail('bill')}
                      className="cursor-pointer border-border bg-card shadow-xs hover:border-foreground/20 transition-all p-5 flex flex-col justify-between h-36"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sm text-foreground">本月收支</span>
                        <ChevronRight className="size-4 text-muted-foreground" />
                      </div>
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between text-muted-foreground">
                          <span>收入</span>
                          <span className="font-mono text-emerald-600 dark:text-emerald-400 font-semibold">{hidden ? '••••' : `+¥ ${formatAmount(data.monthly.income)}`}</span>
                        </div>
                        <div className="flex justify-between text-muted-foreground">
                          <span>支出</span>
                          <span className="font-mono text-foreground font-semibold">{hidden ? '••••' : `−¥ ${formatAmount(data.monthly.expense)}`}</span>
                        </div>
                      </div>
                    </Card>
                  </div>
                </div>

                {/* 右列：智能账单分析 & 最近流水 */}
                <div className="lg:col-span-5 space-y-6">
                  {/* 智能账单分析卡片 */}
                  <Card
                    onClick={() => setDetail('bill')}
                    className="cursor-pointer border-border bg-card shadow-xs hover:border-foreground/20 transition-all p-5 flex items-center justify-between"
                  >
                    <div className="space-y-1">
                      <div className="font-semibold text-sm text-foreground">智能账单分析</div>
                      <div className="text-xs text-muted-foreground">清晰掌握每笔消费与资金归属</div>
                    </div>
                    <div className="size-16 shrink-0 flex items-center justify-center">
                      <AnimatedDonutChart data={data.monthly.categories} compact pie />
                    </div>
                  </Card>

                  {/* 最近交易流水 */}
                  <Card className="border-border bg-card shadow-xs">
                    <CardHeader className="flex flex-row items-center justify-between pb-3 px-5 pt-5">
                      <CardTitle className="text-sm font-semibold">最近交易</CardTitle>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDetail('transactions')}
                        className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1 px-2"
                      >
                        查看全部
                        <ChevronRight className="size-3" />
                      </Button>
                    </CardHeader>
                    <CardContent className="px-5 pb-5 pt-0">
                      <TransactionList transactions={data.transactions.slice(0, 4)} hidden={hidden} />
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}

            {tab === 'accounts' && (
              <div className="space-y-6 max-w-4xl mx-auto">
                <div className="flex items-center justify-between">
                  <div>
                    <h1 className="text-xl font-bold tracking-tight text-foreground">我的账户</h1>
                    <p className="text-xs text-muted-foreground mt-0.5">每张卡独立记账，左右切换查看明细。</p>
                  </div>
                  <Button size="sm" onClick={() => setCardService({ id: 'new', mode: 'apply' })}>
                    申请新卡
                  </Button>
                </div>

                <AccountCarousel data={data} selectedId={selectedCard?.id} onSelect={setSelectedCardId} hidden={hidden} />

                {selectedCard && (
                  <Card className="border-border bg-card shadow-xs p-5 space-y-4">
                    <div className="flex flex-wrap gap-2">
                      {selectedCard.kind === 'debit' ? (
                        <>
                          <Button size="sm" disabled={selectedCard.status !== 'active'} onClick={() => openPayment('transfer', selectedCard.accountId)}>转账</Button>
                          <Button variant="secondary" size="sm" disabled={selectedCard.status !== 'active'} onClick={() => openPayment('receive', selectedCard.accountId)}>收款</Button>
                        </>
                      ) : (
                        <Button size="sm" disabled={selectedCard.status !== 'active' || selectedCard.outstanding <= 0} onClick={() => openCardService('repay')}>信用卡还款</Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => openCardService('remark')}>修改备注</Button>
                      <Button variant="outline" size="sm" onClick={() => openCardService('manage')}>管理</Button>
                    </div>

                    {selectedCard.kind === 'credit' && (
                      <div className="grid grid-cols-2 gap-4 p-4 rounded-xl bg-muted/30 border border-border/60 text-xs">
                        <div>
                          <span className="text-muted-foreground">当前待还</span>
                          <div className="text-lg font-bold font-mono text-foreground mt-0.5">{hidden ? '••••••' : `¥ ${formatAmount(selectedCard.outstanding)}`}</div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">信用总额度</span>
                          <div className="text-lg font-bold font-mono text-foreground mt-0.5">{hidden ? '••••••' : `¥ ${formatAmount(selectedCard.creditLimit)}`}</div>
                        </div>
                        <div className="col-span-2 text-muted-foreground text-[11px]">
                          账单日每月 {selectedCard.billDay} 日 · 还款日每月 {selectedCard.dueDay} 日
                        </div>
                      </div>
                    )}
                  </Card>
                )}

                {selectedAccount && activity && (
                  <Card className="border-border bg-card shadow-xs p-5 space-y-4">
                    <div className="flex items-center justify-between border-b border-border/60 pb-3">
                      <div>
                        <h2 className="text-sm font-semibold text-foreground">{selectedCard?.accountName} · 尾号 {selectedCard?.last4}</h2>
                        <span className="text-xs text-muted-foreground">{activity.monthly.period}</span>
                      </div>
                      <AccountMonthlyTotals monthly={activity.monthly} hidden={hidden} />
                    </div>
                    <TransactionList transactions={activity.transactions} hidden={hidden} />
                  </Card>
                )}
              </div>
            )}

            {tab === 'life' && (
              <div className="space-y-6 max-w-4xl mx-auto">
                <div className="flex items-center justify-between">
                  <div>
                    <h1 className="text-xl font-bold tracking-tight text-foreground">生活服务</h1>
                    <p className="text-xs text-muted-foreground mt-0.5">照顾日常生活，也为重要日程做好资金安排。</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setDetail('tasks')}>
                    任务中心
                  </Button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Card
                    onClick={() => openAgent('帮我查看生日计划和联系人')}
                    className="cursor-pointer border-border bg-card shadow-xs hover:border-foreground/20 p-5 flex items-center gap-4 transition-all"
                  >
                    <div className="flex size-12 items-center justify-center rounded-full bg-secondary border border-border">
                      <Gift className="size-6 text-foreground" />
                    </div>
                    <div>
                      <div className="font-semibold text-sm text-foreground">生日计划</div>
                      <div className="text-xs text-muted-foreground">为重要的人用心安排心愿与礼金</div>
                    </div>
                  </Card>

                  <Card
                    onClick={() => openAgent('我想发起一笔AA收款，请先帮我查看联系人')}
                    className="cursor-pointer border-border bg-card shadow-xs hover:border-foreground/20 p-5 flex items-center gap-4 transition-all"
                  >
                    <div className="flex size-12 items-center justify-center rounded-full bg-secondary border border-border">
                      <UsersRound className="size-6 text-foreground" />
                    </div>
                    <div>
                      <div className="font-semibold text-sm text-foreground">AA 收款</div>
                      <div className="text-xs text-muted-foreground">和朋友聚餐出行，轻松一键分账</div>
                    </div>
                  </Card>
                </div>

                {/* 订阅与代扣 */}
                <Card className="border-border bg-card shadow-xs p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm text-foreground">订阅与自动代扣</span>
                    <Button variant="ghost" size="sm" onClick={() => openAgent('帮我查看所有订阅与自动扣费')} className="h-7 text-xs">
                      管理 <ChevronRight className="size-3" />
                    </Button>
                  </div>
                  <SubscriptionList subscriptions={data.subscriptions} hidden={hidden} />
                </Card>
              </div>
            )}

            {tab === 'profile' && (
              <div className="space-y-6 max-w-2xl mx-auto">
                <Card className="border-border bg-card shadow-xs p-6 flex items-center gap-4">
                  <div className="flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold text-xl">
                    {user.name.slice(0, 1)}
                  </div>
                  <div className="space-y-1">
                    <h2 className="text-lg font-bold text-foreground">{user.name}</h2>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>用户 ID: {user.id}</span>
                      <Badge variant="outline" className="text-[10px]">个人尊享账户</Badge>
                    </div>
                  </div>
                </Card>

                <Card className="border-border bg-card shadow-xs divide-y divide-border/60">
                  <a href="/settings" className="flex items-center justify-between p-4 text-sm font-medium hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-3">
                      <Settings className="size-4 text-muted-foreground" />
                      <span>安全与设置</span>
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </a>
                  <button onClick={() => setDetail('assets')} className="w-full flex items-center justify-between p-4 text-sm font-medium hover:bg-muted/30 transition-colors text-left">
                    <div className="flex items-center gap-3">
                      <Wallet className="size-4 text-muted-foreground" />
                      <span>资产详情</span>
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </button>
                  <button onClick={() => openAgent()} className="w-full flex items-center justify-between p-4 text-sm font-medium hover:bg-muted/30 transition-colors text-left">
                    <div className="flex items-center gap-3">
                      <AgentAvatar small />
                      <span>问文财 Agent</span>
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </button>
                </Card>

                <Button
                  variant="destructive"
                  className="w-full"
                  disabled={signingOut}
                  onClick={() => void signOut()}
                >
                  <LogOut className="size-4 mr-2" />
                  {signingOut ? '正在安全退出…' : '退出登录'}
                </Button>

                {profileError && <p className="text-xs text-destructive text-center" role="alert">{profileError}</p>}
              </div>
            )}
          </main>
        ) : null}
      </div>

      {/* 移动端底部导航栏 */}
      <nav className="md:hidden fixed bottom-4 inset-x-4 z-40 flex items-center justify-around p-1.5 rounded-full border border-border bg-background/90 backdrop-blur-lg shadow-lg">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => selectTab(id)}
            className={cn(
              "flex-1 flex flex-col items-center justify-center py-1.5 rounded-full text-xs transition-colors",
              tab === id ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="size-4" />
            <span className="text-[10px] mt-0.5">{label}</span>
          </button>
        ))}
      </nav>

      {/* 右下角悬浮智能助手球 */}
      <DraggableFloatingButton
        hidden={agentOpen || !!detail || !!paymentView}
        expanded={agentOpen}
        onActivate={() => openAgent()}
        label="打开文财 Agent"
        controls="bank-agent-conversation"
      >
        <AgentAvatar small />
      </DraggableFloatingButton>

      {/* 底部升起的 Base UI Drawer 抽屉组 */}
      <Drawer open={agentOpen} onClose={closeAgent} title="文财 Agent">
        <div id="bank-agent-conversation" className="h-[75vh] flex flex-col">
          <ChatView request={request} active={agentOpen} userId={user.id} />
        </div>
      </Drawer>

      <Drawer open={!!paymentView} onClose={closePayment} title="转账与收款">
        {paymentView && <PaymentCenter userId={user.id} initialView={paymentView} initialAccountId={paymentAccountId} />}
      </Drawer>

      <Drawer
        open={!!cardService}
        onClose={() => setCardService(null)}
        title={cardService?.mode === 'apply' ? '申请新卡' : cardService?.mode === 'remark' ? '卡片备注' : cardService?.mode === 'repay' ? '信用卡还款' : '卡片管理'}
      >
        {cardService?.mode === 'apply' ? (
          <CardApplication />
        ) : (
          cardService && data && <CardServices key={`${cardService.id}-${cardService.mode}`} data={data} cardId={cardService.id} mode={cardService.mode} userId={user.id} />
        )}
      </Drawer>

      <Drawer open={!!detail} onClose={() => setDetail(null)} title={title}>
        <div className="space-y-4">
          {data && detail === 'bill' && (
            <>
              <p className="text-xs text-muted-foreground">
                {data.monthly.period} · 账户真实收支明细
              </p>
              <FinancialReport data={data.monthly.categories} total={data.monthly.expense} />
              <Card className="p-4 border-border bg-card">
                <AnimatedBarChart title="近六个月支出趋势" data={data.trend} />
              </Card>
              <Button
                className="w-full"
                onClick={() => openAgent('帮我分析本月的消费，按分类展示支出，并给一些建议')}
              >
                让文财 Agent 深度分析
              </Button>
            </>
          )}

          {data && detail === 'assets' && <AssetDetails data={data} hidden={hidden} />}

          {data && detail === 'notifications' && (
            <NotificationDetails
              notifications={data.notifications}
              subscriptions={data.subscriptions}
              hidden={hidden}
              onManage={() => openAgent('帮我查看订阅扣费时间和提醒设置')}
            />
          )}

          {data && detail === 'transactions' && (
            <div className="space-y-2">
              <TransactionList transactions={data.transactions} hidden={hidden} />
            </div>
          )}

          {data && detail === 'tasks' && <TaskCenter onFollowUp={(text) => openAgent(text)} />}
        </div>
      </Drawer>
    </div>
  )
}

export function AccountMonthlyTotals({ monthly, hidden }: { monthly: DashboardData['monthly']; hidden: boolean }) {
  return (
    <div className="flex flex-wrap gap-4 text-xs font-mono">
      <span>收入: <strong className="text-emerald-600 dark:text-emerald-400">{hidden ? '••••' : `+${formatAmount(monthly.income)}`}</strong></span>
      <span>支出: <strong>{hidden ? '••••' : `−${formatAmount(monthly.expense)}`}</strong></span>
    </div>
  )
}

export function SubscriptionList({ subscriptions, hidden }: { subscriptions: DashboardData['subscriptions']; hidden: boolean }) {
  return (
    <div className="divide-y divide-border/60">
      {subscriptions.map((item) => (
        <div key={item.id} className="py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="min-w-0">
            <div className="font-medium text-foreground break-words">{item.merchant}</div>
            <div className="text-muted-foreground">{item.cycle === 'monthly' ? '每月' : '每年'}</div>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono">{hidden ? '••••' : `¥ ${formatAmount(item.amount)}`}</span>
            <Badge variant={item.status === 'active' ? 'default' : 'secondary'} className="text-[10px]">
              {item.status === 'active' ? '生效中' : '已暂停'}
            </Badge>
          </div>
        </div>
      ))}
      {!subscriptions.length && <p className="py-3 text-xs text-muted-foreground">暂无订阅记录</p>}
    </div>
  )
}

export function AssetDetails({ data, hidden }: { data: DashboardData; hidden: boolean }) {
  return (
    <div className="space-y-4">
      <Card className="p-4 border-border bg-card">
        <span className="text-xs text-muted-foreground">总资产</span>
        <div className="text-2xl font-bold font-mono mt-1">{hidden ? '••••' : `¥ ${formatAmount(data.totalAssets)}`}</div>
      </Card>
      <dl className="divide-y divide-border/60">
        {[
          { label: '可用余额', value: data.availableBalance },
          { label: '理财持仓本金', value: data.investmentPrincipal },
          { label: '生日计划预留资金', value: data.reservedBalance ?? 0 },
        ].map((item) => (
          <div key={item.label} className="py-3 flex justify-between gap-3 text-xs">
            <dt>{item.label}</dt>
            <dd className="font-mono font-medium">{hidden ? '••••' : `¥ ${formatAmount(item.value)}`}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">理财按持仓本金统计，不包含预计收益。</p>
      <div className="divide-y divide-border/60">
        {data.accounts.map((account) => (
          <div key={account.id} className="py-3 flex justify-between gap-3 text-xs">
            <div className="min-w-0">
              <div className="font-semibold break-words">{account.name}</div>
              <div className="text-[11px] text-muted-foreground">{account.currency} 活期</div>
            </div>
            <span className="font-mono font-medium">{hidden ? '••••' : `¥ ${formatAmount(account.balance)}`}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function NotificationDetails({ notifications, subscriptions, hidden, onManage }: {
  notifications: DashboardData['notifications']
  subscriptions: DashboardData['subscriptions']
  hidden: boolean
  onManage: () => void
}) {
  return (
    <div className="space-y-4">
      {notifications?.map((notice) => (
        <article key={notice.id} className="space-y-2 rounded-xl border border-border p-4">
          <h3 className="text-sm font-semibold break-words">{notice.title}</h3>
          <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words">{notice.body}</p>
          {notice.actionId && (
            <a className="inline-block text-xs font-medium underline underline-offset-4 rounded-sm focus-visible:outline-2 focus-visible:outline-ring" href={`/confirm/${encodeURIComponent(notice.actionId)}`}>
              核对并确认
            </a>
          )}
        </article>
      ))}
      {!notifications?.length && <p className="text-xs text-muted-foreground">暂无消息通知</p>}
      <div className="flex items-start gap-3">
        <Bell className="size-4 shrink-0 mt-0.5" />
        <div>
          <h3 className="text-sm font-semibold">订阅服务提醒</h3>
          <p className="text-xs text-muted-foreground">查看正在生效的订阅，提前安排支出。</p>
        </div>
      </div>
      <SubscriptionList subscriptions={subscriptions.filter((item) => item.status === 'active')} hidden={hidden} />
      <Button className="w-full" onClick={onManage} type="button">
        管理订阅提醒 <ChevronRight className="size-4" />
      </Button>
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
  if (transactions.length === 0) {
    return <div className="text-center py-6 text-xs text-muted-foreground">暂无交易记录</div>
  }
  return (
    <div className="divide-y divide-border/60">
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
            <div className="flex items-center justify-between py-3 hover:bg-muted/40 px-2 rounded-lg transition-colors">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "flex size-9 items-center justify-center rounded-full text-xs font-medium",
                    transaction.amount > 0 ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"
                  )}
                >
                  <Icon className="size-4" />
                </div>
                <div>
                  <div className="text-sm font-medium text-foreground">{transaction.counterparty}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {new Intl.DateTimeFormat('zh-CN', {
                      timeZone: 'Asia/Shanghai',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    }).format(new Date(transaction.occurredAt))}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <span
                  className={cn(
                    "font-mono font-medium text-sm",
                    transaction.amount > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"
                  )}
                >
                  {hidden
                    ? '••••••'
                    : `${transaction.amount > 0 ? '+' : '−'}${formatAmount(Math.abs(transaction.amount))}`}
                </span>
              </div>
            </div>
          </Reveal>
        )
      })}
    </div>
  )
}
