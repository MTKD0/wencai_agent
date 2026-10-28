import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronRight, FlaskConical, Landmark, LayoutDashboard, Loader2, LogOut, Menu, PhoneCall, ScrollText, Search, ShieldAlert,
  ShieldCheck, Siren, UsersRound, type LucideIcon,
} from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { consoleApi, type StaffSession } from './api'
import { StaffLogin } from './Login'
import { ConsoleDashboard } from './Dashboard'
import { FraudEvents } from './FraudEvents'
import { CallbackDesk } from './CallbackDesk'
import { CustomerList } from './Customers'
import { CustomerDetail } from './CustomerDetail'
import { DemoControls } from './DemoControls'
import { SecurityCenter } from './SecurityCenter'
import { AdminRiskReview } from '../views/RiskReview'
import { AdminRuntimeLogs } from '../views/RuntimeLogs'
import { dateTime } from '../utils'
import './console.css'

export type ConsoleSection = 'dashboard' | 'fraud' | 'callbacks' | 'risk' | 'customers' | 'customer' | 'security' | 'logs' | 'demo'
export const CONSOLE_SECTIONS: ConsoleSection[] = ['dashboard', 'fraud', 'callbacks', 'risk', 'customers', 'customer', 'security', 'logs', 'demo']
export type ConsoleSearch = { section: ConsoleSection; userId?: string; tab?: string; ticket?: string; event?: string }
export type Go = (search: ConsoleSearch) => void

const NAV: { group: string; items: { id: ConsoleSection; name: string; icon: LucideIcon; demo?: boolean }[] }[] = [
  { group: '运营', items: [{ id: 'dashboard', name: '工作台', icon: LayoutDashboard }] },
  { group: '反诈中心', items: [
    { id: 'callbacks', name: '回访工作台', icon: PhoneCall },
    { id: 'fraud', name: '识别事件', icon: ShieldAlert },
    { id: 'risk', name: '可疑收款账户', icon: Siren },
  ] },
  { group: '客户', items: [{ id: 'customers', name: '客户列表', icon: UsersRound }] },
  { group: '安全与审计', items: [
    { id: 'security', name: '安全内核', icon: ShieldCheck },
    { id: 'logs', name: '运行日志', icon: ScrollText },
  ] },
  { group: '演示环境', items: [{ id: 'demo', name: '演示控制', icon: FlaskConical, demo: true }] },
]

const TITLES: Record<ConsoleSection, { title: string; subtitle: string }> = {
  dashboard: { title: '工作台', subtitle: '今天需要处理的反诈回访、识别动态与全行概况。' },
  fraud: { title: '识别事件', subtitle: '每一笔命中诈骗话术或行为异常的转账，以及识别依据和处理结果。' },
  callbacks: { title: '回访工作台', subtitle: '冷静期中的转账须在到期前联系客户核实：确认诈骗即撤销，确认安全可提前放行。' },
  risk: { title: '可疑收款账户', subtitle: '收款特征异常的本行账户，人工确认高危后对其转账一律拦截。' },
  customers: { title: '客户列表', subtitle: '全部客户的资产、画像标签与反诈状态。' },
  customer: { title: '客户详情', subtitle: '' },
  security: { title: '安全内核', subtitle: '风险等级由代码判定，确认只能来自客户本人，每一步都留痕。' },
  logs: { title: '运行日志', subtitle: '登录认证、接口状态与运行错误。' },
  demo: { title: '演示控制', subtitle: '仅演示环境可用：调整业务时钟、执行到期任务、审计篡改演示等。正式环境不提供这些操作。' },
}

export function ConsoleApp({ search, go }: { search: ConsoleSearch; go: Go }) {
  const client = useQueryClient()
  const session = useQuery({ queryKey: ['admin', 'session'], queryFn: consoleApi.session, retry: false })
  const logout = useMutation({ mutationFn: consoleApi.logout, onSuccess: () => client.resetQueries({ queryKey: ['admin'] }) })

  if (session.isPending) return <div className="app-shell console-boot"><Loader2 className="spin" size={26} /><span>正在连接管理后台</span></div>
  if (session.isError) return <div className="app-shell console-boot"><span>{session.error.message}</span><Button className="button button-outline" type="button" onClick={() => void session.refetch()}>重试</Button></div>
  if (!session.data.authorized) return <StaffLogin onDone={() => void client.invalidateQueries({ queryKey: ['admin'] })} />
  return <ConsoleShell session={session.data} search={search} go={go} onLogout={() => logout.mutate()} />
}

function ConsoleShell({ session, search, go, onLogout }: { session: StaffSession; search: ConsoleSearch; go: Go; onLogout: () => void }) {
  const [navOpen, setNavOpen] = useState(false)
  const clock = useQuery({ queryKey: ['admin', 'console', 'dashboard'], queryFn: consoleApi.dashboard, refetchInterval: 15_000 })
  const openTickets = clock.data?.callbacks.open ?? 0
  const section = search.section === 'demo' && !session.demoMode ? 'dashboard' : search.section
  const heading = TITLES[section]
  const navigate: Go = (next) => { go(next); setNavOpen(false) }

  let body: ReactNode
  switch (section) {
    case 'dashboard': body = <ConsoleDashboard go={navigate} />; break
    case 'fraud': body = <FraudEvents go={navigate} selected={search.event} />; break
    case 'callbacks': body = <CallbackDesk go={navigate} selected={search.ticket} />; break
    case 'risk': body = <AdminRiskReview />; break
    case 'customers': body = <CustomerList go={navigate} />; break
    case 'customer': body = search.userId ? <CustomerDetail userId={search.userId} tab={search.tab} go={navigate} /> : <CustomerList go={navigate} />; break
    case 'security': body = <SecurityCenter />; break
    case 'logs': body = <AdminRuntimeLogs back={() => navigate({ section: 'dashboard' })} />; break
    case 'demo': body = <DemoControls go={navigate} />; break
  }

  return (
    <div className="app-shell console-shell">
      {navOpen && <Button className="nav-scrim" aria-label="关闭导航" onClick={() => setNavOpen(false)} type="button" />}
      <aside className={`sidebar ${navOpen ? 'open' : ''}`}>
        <a href="/admin" className="brand">
          <span className="brand-mark"><Landmark size={21} /></span>
          <span>文财银行<small>运营管理后台</small></span>
        </a>
        <nav aria-label="主导航" className="console-nav">
          {NAV.map((group) => {
            const items = group.items.filter((item) => !item.demo || session.demoMode)
            if (!items.length) return null
            return <div key={group.group} className="console-nav-group">
              <div className="sidebar-label">{group.group}</div>
              {items.map((item) => {
                const active = section === item.id || (item.id === 'customers' && section === 'customer')
                return <Button key={item.id} aria-current={active ? 'page' : undefined} className={active ? 'active' : ''} onClick={() => navigate({ section: item.id })} type="button">
                  <item.icon size={18} strokeWidth={1.7} />
                  <span>{item.name}</span>
                  {item.id === 'callbacks' && openTickets > 0 && <b>{openTickets}</b>}
                </Button>
              })}
            </div>
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-user">
            <span className="avatar">{session.staff?.name.slice(0, 1) ?? '员'}</span>
            <div>
              <strong>{session.staff?.name ?? '工作人员'}</strong>
              <small>{session.staff?.role === 'supervisor' ? '风控主管' : session.staff?.role === 'agent' ? '回访坐席' : '本地开发访问'}</small>
            </div>
            {session.staff?.role !== 'system' && <Button className="button button-ghost button-icon console-logout" aria-label="退出登录" title="退出登录" onClick={onLogout} type="button"><LogOut size={16} /></Button>}
          </div>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar console-topbar">
          <div>
            <Button className="mobile-menu button button-ghost button-icon" aria-label="打开导航" onClick={() => setNavOpen(true)} type="button"><Menu size={20} /></Button>
            <span className="breadcrumb">运营管理后台<ChevronRight size={13} /><b>{section === 'customer' ? '客户详情' : heading.title}</b></span>
          </div>
          <div className="topbar-right">
            <CustomerSearch go={navigate} />
            <span className="console-clock" title="模拟业务时间（北京时间）"><i className="live-dot" />{clock.data ? dateTime(clock.data.now) : '—'}</span>
            {session.demoMode && <span className="env-badge"><i />演示环境</span>}
          </div>
        </header>
        <main className="main-content">
          {section !== 'customer' && section !== 'logs' && <div className="page-heading"><div><span className="eyebrow">{NAV.find((g) => g.items.some((i) => i.id === section))?.group}</span><h1>{heading.title}</h1><p>{heading.subtitle}</p></div></div>}
          <div className="view-content" key={`${section}:${search.userId ?? ''}`}>{body}</div>
          <footer className="workspace-footer"><span>文财银行运营管理后台 <i /> 模拟银行服务 · 全部为演示数据</span></footer>
        </main>
      </div>
    </div>
  )
}

/** 顶栏客户搜索：姓名、手机号后四位或客户号 */
function CustomerSearch({ go }: { go: Go }) {
  const [term, setTerm] = useState(''), [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const customers = useQuery({ queryKey: ['admin', 'console', 'customers'], queryFn: consoleApi.customers, enabled: open, staleTime: 30_000 })
  const matches = useMemo(() => {
    const q = term.trim().toLowerCase()
    if (!q) return []
    return (customers.data?.customers ?? []).filter((c) => [c.name, c.id, c.phoneMasked?.slice(-4) ?? ''].some((v) => v.toLowerCase().includes(q))).slice(0, 6)
  }, [term, customers.data])
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  const pick = (id: string) => { go({ section: 'customer', userId: id }); setTerm(''); setOpen(false) }
  return (
    <div className="console-search" ref={box}>
      <Search size={15} />
      <Input aria-label="搜索客户" placeholder="搜索客户姓名 / 手机尾号" value={term} onFocus={() => setOpen(true)}
        onChange={(e) => { setTerm(e.target.value); setOpen(true) }} onKeyDown={(e) => { if (e.key === 'Enter' && matches[0]) pick(matches[0].id); if (e.key === 'Escape') setOpen(false) }} />
      {open && term.trim() && <div className="console-search-results" role="listbox">
        {customers.isPending ? <span className="console-search-empty">正在读取客户…</span> : matches.length ? matches.map((c) => (
          <button key={c.id} role="option" aria-selected={false} type="button" onClick={() => pick(c.id)}>
            <strong>{c.name}</strong><small>{c.phoneMasked ?? '未绑定手机'} · {c.riskLevel}</small>
            {c.fraud.openTickets > 0 && <em>待回访</em>}
          </button>
        )) : <span className="console-search-empty">没有匹配的客户</span>}
      </div>}
    </div>
  )
}
