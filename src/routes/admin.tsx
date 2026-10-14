import { createFileRoute } from '@tanstack/react-router'
import '../components/admin/admin.css'
import { AdminWorkspace, navigation } from '../components/admin/Workspace'
import { AdminHome } from '../components/admin/Home'
import type { Section } from '../components/admin/shared'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

// 以导航表为准，避免新增栏目后忘记同步白名单而被静默回退到 overview。
const sections: Section[] = navigation.map((item) => item.id)

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
  const [token, setToken] = useState(''), [showAccess, setShowAccess] = useState(false)
  const qc = useQueryClient()
  const { section, userId } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <>
    <div style={{ padding: '8px 20px', textAlign: 'right' }}><button className="button button-ghost button-sm" onClick={() => setShowAccess(!showAccess)}>后台访问验证</button>{showAccess && <form style={{ display: 'flex', justifyContent: 'end', gap: 8 }} onSubmit={(e) => { e.preventDefault(); sessionStorage.setItem('wencai_admin_token', token); setToken(''); setShowAccess(false); void qc.invalidateQueries() }}><input type="password" autoComplete="off" aria-label="后台访问凭据" value={token} onChange={(e) => setToken(e.target.value)} /><button className="button button-primary">验证</button></form>}</div>
    {!userId ? <AdminHome onSelect={(id) => navigate({ search: { userId: id, section: 'overview' } })} /> :
    <AdminWorkspace
      key={userId}
      userId={userId}
      section={section}
      go={(s) => navigate({ search: { userId, section: s } })}
      home={() => navigate({ search: { section: 'overview' } })}
    />}
    </>
  )
}
