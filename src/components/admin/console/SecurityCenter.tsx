import { useQuery } from '@tanstack/react-query'
import { adminApi } from '../client'
import { AdminSecurity } from '../views/Security'
import { LoadState } from './parts'
import { localDate } from '../utils'

/** 安全内核是全行视图；审计篡改演示沿用演示客户的审计链 */
export function SecurityCenter() {
  const snapshot = useQuery({ queryKey: ['admin', 'u_demo', 'snapshot'], queryFn: () => adminApi.snapshot('u_demo'), refetchInterval: 15_000 })
  if (!snapshot.data) return <LoadState pending={snapshot.isPending} error={snapshot.error} label="安全内核" retry={() => void snapshot.refetch()} />
  const s = snapshot.data
  return <AdminSecurity s={s} ledger={s.transactions} report={undefined} period={localDate(s.now).slice(0, 7)} anomalies={[]} audit={[]} go={() => {}} />
}
