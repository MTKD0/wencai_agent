import { createFileRoute } from '@tanstack/react-router'
import '../components/admin/admin.css'
import { AdminWorkspace } from '../components/admin/Workspace'
import { AdminHome } from '../components/admin/Home'
import type { Section } from '../components/admin/shared'

const sections: Section[] = [
  'overview', 'transactions', 'transfers', 'investments',
  'cards', 'subscriptions', 'plans', 'audit',
]

export const Route = createFileRoute('/admin')({
  validateSearch: (search: Record<string, unknown>): { section: Section; userId?: string } => ({
    section: sections.includes(search.section as Section)
      ? (search.section as Section)
      : 'overview',
    userId: typeof search.userId === 'string' && search.userId.trim() ? search.userId.trim() : undefined,
  }),
  component: Admin,
})

function Admin() {
  const { section, userId } = Route.useSearch()
  const navigate = Route.useNavigate()
  if (!userId) {
    return <AdminHome onSelect={(id) => navigate({ search: { userId: id, section: 'overview' } })} />
  }
  return (
    <AdminWorkspace
      key={userId}
      userId={userId}
      section={section}
      go={(s) => navigate({ search: { userId, section: s } })}
      home={() => navigate({ search: { section: 'overview' } })}
    />
  )
}
