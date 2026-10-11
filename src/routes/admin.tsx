import { createFileRoute } from '@tanstack/react-router'
import '../components/admin/admin.css'
import { AdminWorkspace } from '../components/admin/Workspace'
import type { Section } from '../components/admin/shared'

const sections: Section[] = [
  'overview', 'transactions', 'transfers', 'investments',
  'cards', 'subscriptions', 'plans', 'audit',
]

export const Route = createFileRoute('/admin')({
  validateSearch: (search: Record<string, unknown>): { section: Section } => ({
    section: sections.includes(search.section as Section)
      ? (search.section as Section)
      : 'overview',
  }),
  component: Admin,
})

function Admin() {
  const { section } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <AdminWorkspace
      section={section}
      go={(s) => navigate({ search: { section: s } })}
    />
  )
}
