import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import '../components/admin/admin.css'
import { AdminWorkspace, navigation } from '../components/admin/Workspace'
import { ConsoleApp, CONSOLE_SECTIONS, type ConsoleSearch } from '../components/admin/console/ConsoleApp'
import { consoleApi } from '../components/admin/console/api'
import type { Section } from '../components/admin/shared'

const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : undefined
const legacySections: Section[] = navigation.map((item) => item.id)

/** 银行工作人员的运营管理后台。旧版“以客户身份办理”工作台只在演示控制里打开（section=demo&userId=…） */
export const Route = createFileRoute('/admin')({
  validateSearch: (search: Record<string, unknown>): ConsoleSearch => ({
    section: CONSOLE_SECTIONS.includes(search.section as ConsoleSearch['section']) ? search.section as ConsoleSearch['section'] : 'dashboard',
    userId: text(search.userId), tab: text(search.tab), ticket: text(search.ticket), event: text(search.event),
  }),
  component: Admin,
})

function Admin() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const go = (next: ConsoleSearch) => void navigate({ search: next })
  const session = useQuery({ queryKey: ['admin', 'session'], queryFn: consoleApi.session, retry: false })
  if (search.section === 'demo' && search.userId && session.data?.authorized && session.data.demoMode) {
    const legacy = legacySections.includes(search.tab as Section) ? search.tab as Section : 'overview'
    return <AdminWorkspace key={search.userId} userId={search.userId} section={legacy}
      go={(s) => go({ section: 'demo', userId: search.userId, tab: s })} home={() => go({ section: 'demo' })} />
  }
  return <ConsoleApp search={search} go={go} />
}
