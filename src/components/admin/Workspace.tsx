import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  LayoutDashboard,
  ArrowLeftRight,
  ChartNoAxesCombined,
  Landmark,
  CreditCard,
  Repeat2,
  Gift,
  ScrollText,
  ShieldCheck,
  ShieldAlert,
  UserRoundSearch,
  Clock3,
  ArrowUpRight,
  RefreshCw,
  ChevronRight,
  Menu,
  X,
  Bell,
  CheckCircle2,
  CircleAlert,
  Download,
  Loader2,
  Plus,
  UsersRound,
} from 'lucide-react'
import { ActionDialog } from './ActionDialog'
import type { Action } from './actions'
import { adminApi } from './client'
import { createActions } from './actions'
import { dateTime, localDate, exportLedger, periodRows } from './utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AdminOverview } from './views/Overview'
import { AdminTransactions } from './views/Transactions'
import { AdminTransfers } from './views/Transfers'
import { AdminInvestments } from './views/Investments'
import { AdminCards } from './views/Cards'
import { AdminSubscriptions } from './views/Subscriptions'
import { AdminPlans } from './views/Plans'
import { AdminAudit } from './views/Audit'
import { AdminSecurity } from './views/Security'
import { AdminRiskReview } from './views/RiskReview'
import { AdminProfile } from './views/Profile'
import type { Section } from './shared'

export const navigation = [
  { id: 'overview', name: '账户总览', icon: LayoutDashboard },
  { id: 'transactions', name: '流水与账单', icon: ChartNoAxesCombined },
  { id: 'transfers', name: '转账与收款', icon: ArrowLeftRight },
  { id: 'investments', name: '理财管理', icon: Landmark },
  { id: 'cards', name: '卡片管理', icon: CreditCard },
  { id: 'subscriptions', name: '订阅与代扣', icon: Repeat2 },
  { id: 'plans', name: '生日计划', icon: Gift },
  { id: 'security', name: '安全内核', icon: ShieldCheck },
  { id: 'risk-review', name: '收款风险复核', icon: ShieldAlert },
  { id: 'profile', name: '用户画像', icon: UserRoundSearch },
  { id: 'audit', name: '操作审计', icon: ScrollText },
] as const

const descriptions: Record<Section, string> = {
  overview: '掌握账户动态，安排每一笔资金。',
  transactions: '从每一笔交易，了解你的资金流向。',
  transfers: '日常转账、定时付款与朋友间的轻松分账。',
  investments: '了解风险偏好，让每一笔投资更清晰。',
  cards: '管理卡片状态、交易限制与信用额度。',
  subscriptions: '看清周期支出，让每次续费都有准备。',
  plans: '把预算、时间与礼物，安排在同一条计划里。',
  security: '风险等级由代码判定，确认只能来自用户，每一步都留痕。',
  'risk-review': '核对收款账户风险线索，人工确认高危或解除标记。',
  profile: '用数据看清每位用户的收支、资产与风险偏好。',
  audit: '每次业务操作，都有迹可循。',
}

async function loadData(userId: string) {
  const [snapshot, anomalies] = await Promise.all([
    adminApi.snapshot(userId),
    adminApi.anomalies(userId),
  ])
  return { s: snapshot, anomalies }
}

export function AdminWorkspace({
  userId,
  section,
  go,
  home,
}: {
  userId: string
  section: Section
  go: (s: Section) => void
  home: () => void
}) {
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['admin', userId, 'workspace'],
    queryFn: () => loadData(userId),
    refetchInterval: 5000,
  })
  const [action, setAction] = useState<Action | null>(null)
  const [periodValue, setPeriod] = useState('')
  const [annual, setAnnual] = useState(false)
  const [toast, setToast] = useState('')
  const [navOpen, setNavOpen] = useState(false)

  const s = query.data?.s
  const period = periodValue || (s ? localDate(s.now).slice(0, 7) : '')
  const reportPeriod = annual ? period.slice(0, 4) : period

  const report = useQuery({
    queryKey: ['admin', userId, 'report', reportPeriod],
    queryFn: () => adminApi.report(userId, reportPeriod),
    enabled: !!reportPeriod,
    refetchInterval: 5000,
  })

  const mutation = useMutation({
    mutationFn: (command: Parameters<typeof adminApi.command>[1]) => adminApi.command(userId, command),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['admin'] })
      setToast('操作成功，账户与业务状态已更新')
    },
  })

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(''), 5500)
      return () => clearTimeout(t)
    }
  }, [toast])

  const navigate = (value: Section) => {
    go(value)
    setNavOpen(false)
  }

  const actions = s ? createActions(s, setAction) : null
  const ledger = s?.transactions ?? []
  const view =
    s && query.data && actions
      ? {
          s,
          ledger,
          report: report.data,
          period: reportPeriod,
          anomalies: query.data.anomalies,
          audit: [] as any[],
          actions,
          go: navigate,
        }
      : undefined

  const nav = navigation.find((n) => n.id === section)!
  const unread = query.data?.anomalies.length ?? 0

  async function refresh() {
    await client.invalidateQueries({ queryKey: ['admin'] })
    setToast('数据已刷新')
  }

  return (
    <div className="app-shell">
      {navOpen && (
        <button className="nav-scrim" aria-label="关闭导航" onClick={() => setNavOpen(false)} />
      )}
      <aside className={`sidebar ${navOpen ? 'open' : ''}`}>
        <a href="/admin" className="brand">
          <span className="brand-mark">
            <Landmark size={21} />
          </span>
          <span>
            文财银行<small>管理后台</small>
          </span>
        </a>
        <div className="sidebar-label">ADMIN</div>
        <nav aria-label="主导航">
          <button onClick={home}>
            <UsersRound size={18} strokeWidth={1.7} />
            <span>首页 · 切换账户</span>
          </button>
          {navigation.map((n) => (
            <button
              key={n.id}
              aria-label={n.name}
              aria-current={section === n.id ? 'page' : undefined}
              className={section === n.id ? 'active' : ''}
              onClick={() => navigate(n.id)}
            >
              <n.icon size={18} strokeWidth={1.7} />
              <span>{n.name}</span>
              {n.id === 'transactions' && !!query.data?.anomalies.length && (
                <b>{query.data.anomalies.length}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="simulation-card">
            <div>
              <span className="live-dot" />
              模拟环境运行中
            </div>
            <p>
              独立演示数据
              <br />
              所有操作均为模拟业务
            </p>
          </div>
          <div className="sidebar-user">
            <span className="avatar">{s?.user.name.slice(0, 1) ?? '用'}</span>
            <div>
              <strong>{s?.user.name ?? '演示用户'}</strong>
              <small>当前管理账户</small>
            </div>
          </div>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div>
            <button
              className="mobile-menu button button-ghost button-icon"
              aria-label="打开导航"
              onClick={() => setNavOpen(true)}
            >
              <Menu size={20} />
            </button>
            <span className="breadcrumb">
              管理后台
              <ChevronRight size={13} />
              <b>{nav.name}</b>
            </span>
          </div>
          <div className="topbar-right">
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={home}>
              <UsersRound size={14} />
              <span>{s?.user.name ?? '切换账户'}</span>
            </Button>
            <Badge variant="secondary" className="text-[11px] font-mono px-2 py-0.5">
              ADMIN
            </Badge>
            <button
              className="notification"
              aria-label={`异常交易 ${unread} 笔`}
              onClick={() => navigate('transactions')}
            >
              <Bell size={18} />
              {unread > 0 && <i />}
            </button>
          </div>
        </header>

        <main className="main-content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">银行管理后台</span>
              <h1>{nav.name}</h1>
              <p>{descriptions[section]}</p>
            </div>
            <div className="heading-actions flex items-center gap-2">
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="刷新数据"
                onClick={refresh}
                disabled={query.isFetching}
              >
                <RefreshCw size={15} className={query.isFetching ? 'spin' : ''} />
              </Button>
              {section === 'overview' ? (
                <Button size="sm" onClick={() => actions?.transfer()} disabled={!actions} className="gap-1.5">
                  <Plus size={15} />
                  新建转账
                </Button>
              ) : section === 'transactions' ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() =>
                    query.data &&
                    exportLedger(periodRows(query.data.s.transactions, reportPeriod), reportPeriod)
                  }
                >
                  <Download size={15} />
                  导出本期流水
                </Button>
              ) : null}
            </div>
          </div>

          <div className="context-bar">
            <div>
              <span className="simulation-dot" />
              模拟业务日期
              <span className="context-date">{s ? dateTime(s.now) : '正在读取…'}</span>
              <span className="timezone">UTC+8</span>
            </div>
            <div>
              {['overview', 'transactions'].includes(section) && (
                <>
                  <div className="segmented period-switch">
                    <button className={!annual ? 'selected' : ''} onClick={() => setAnnual(false)}>
                      月度
                    </button>
                    <button className={annual ? 'selected' : ''} onClick={() => setAnnual(true)}>
                      年度
                    </button>
                  </div>
                  <input
                    className="period-input"
                    type={annual ? 'number' : 'month'}
                    min={annual ? '2025' : '2025-01'}
                    max={annual ? '2100' : '2100-12'}
                    aria-label="账单周期"
                    value={annual ? period.slice(0, 4) : period}
                    onChange={(e) => {
                      if (annual) {
                        if (/^\d{4}$/.test(e.target.value)) setPeriod(e.target.value + '-01')
                      } else if (e.target.value) setPeriod(e.target.value)
                    }}
                  />
                </>
              )}
              <button className="clock-link" onClick={() => actions?.clock()} disabled={!actions}>
                <Clock3 size={14} />
                推进时间
                <ChevronRight size={13} />
              </button>
            </div>
          </div>

          {(query.isError || report.isError) && (
            <div className="load-error" role="alert">
              <CircleAlert size={18} />
              <div>
                <strong>无法读取银行数据</strong>
                <p>{(query.error ?? report.error)?.message}</p>
              </div>
              <Button variant="outline" size="sm" onClick={refresh}>
                重新加载
              </Button>
            </div>
          )}

          {!view && !query.isError ? (
            <div className="loading-workspace">
              <Loader2 size={28} className="spin" />
              <strong>正在连接模拟银行</strong>
              <span>读取账户、流水与业务状态</span>
            </div>
          ) : view ? (
            <>
              <div className="view-content" key={section}>
                {section === 'overview' ? (
                  <AdminOverview {...view} />
                ) : section === 'transactions' ? (
                  <AdminTransactions {...view} />
                ) : section === 'transfers' ? (
                  <AdminTransfers {...view} />
                ) : section === 'investments' ? (
                  <AdminInvestments {...view} />
                ) : section === 'cards' ? (
                  <AdminCards {...view} />
                ) : section === 'subscriptions' ? (
                  <AdminSubscriptions {...view} />
                ) : section === 'plans' ? (
                  <AdminPlans {...view} />
                ) : section === 'security' ? (
                  <AdminSecurity {...view} />
                ) : section === 'risk-review' ? (
                  <AdminRiskReview />
                ) : section === 'profile' ? (
                  <AdminProfile />
                ) : (
                  <AdminAudit {...view} />
                )}
              </div>
              <footer className="workspace-footer">
                <span>文财银行管理后台 <i /> 模拟银行服务</span>
                <a href="/" className="text-sm">
                  返回 AI 对话
                  <ArrowUpRight size={12} />
                </a>
              </footer>
            </>
          ) : null}
        </main>
      </div>

      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          <span>{toast}</span>
          <button aria-label="关闭提示" onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
      )}

      {action && (
        <ActionDialog
          action={action}
          execute={(command) => mutation.mutateAsync(command)}
          onClose={() => setAction(null)}
        />
      )}
    </div>
  )
}
