import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Clock3, FlaskConical, Play, UserRoundCog } from 'lucide-react'
import { Input } from '#/components/ui/input'
import { SelectControl, SelectOption } from '#/components/ui/select'
import { adminApi } from '../client'
import { consoleApi } from './api'
import { Section } from './parts'
import { dateTime, localInput } from '../utils'
import type { Go } from './ConsoleApp'

const DEMO_USER = 'u_demo'

/**
 * 演示控制：只在演示模式下出现，服务端同样只在演示模式下接受这些命令。
 * 「以客户身份办理」打开旧版单客户工作台，用于准备演示数据，正式环境的后台不能代客户办理业务。
 */
export function DemoControls({ go: _go }: { go: Go }) {
  const client = useQueryClient()
  const dashboard = useQuery({ queryKey: ['admin', 'console', 'dashboard'], queryFn: consoleApi.dashboard })
  const customers = useQuery({ queryKey: ['admin', 'console', 'customers'], queryFn: consoleApi.customers, staleTime: 30_000 })
  const [target, setTarget] = useState(''), [who, setWho] = useState(DEMO_USER), [notice, setNotice] = useState('')
  const run = useMutation({
    mutationFn: (cmd: Parameters<typeof adminApi.command>[1]) => adminApi.command(DEMO_USER, cmd),
    onSuccess: (_r, cmd) => { setNotice(cmd.type === 'advanceClock' ? '业务时钟已推进，到期任务已执行。' : '到期任务已执行。'); void client.invalidateQueries({ queryKey: ['admin'] }) },
  })
  const now = dashboard.data?.now
  const quick = (hours: number) => now && run.mutate({ type: 'advanceClock', to: new Date(Date.parse(now) + hours * 3_600_000).toISOString() })
  return <>
    <div className="demo-banner"><FlaskConical size={18} /><span>这里的操作只为演示准备数据。正式配置下这些入口不会出现，服务端也会拒绝。</span></div>
    {notice && <div className="resolve-hint is-good" role="status">{notice}</div>}
    {run.isError && <div className="resolve-hint is-danger" role="alert">{run.error.message}</div>}
    <div className="two-col">
      <Section title="业务时钟" subtitle={`当前模拟业务时间：${now ? dateTime(now) : '—'}（北京时间）`}>
        <div className="demo-actions">
          <button type="button" className="button button-outline" disabled={!now || run.isPending} onClick={() => quick(1)}><Clock3 size={15} />推进 1 小时</button>
          <button type="button" className="button button-outline" disabled={!now || run.isPending} onClick={() => quick(24)}><Clock3 size={15} />推进 24 小时（冷静期到期）</button>
          <button type="button" className="button button-outline" disabled={run.isPending} onClick={() => run.mutate({ type: 'runJobs' })}><Play size={15} />执行到期任务</button>
        </div>
        <form className="demo-form" onSubmit={(e) => { e.preventDefault(); if (target) run.mutate({ type: 'advanceClock', to: new Date(target).toISOString() }) }}>
          <label><span>推进到指定时间</span><Input type="datetime-local" min={now ? localInput(now) : undefined} value={target} onChange={(e) => setTarget(e.target.value)} /></label>
          <button type="submit" className="button button-primary" disabled={!target || run.isPending}>推进</button>
        </form>
      </Section>
      <Section title="以客户身份办理（演示）" subtitle="打开旧版单客户工作台，可代客户转账、申购等，用于准备演示数据">
        <form className="demo-form" onSubmit={(e) => { e.preventDefault(); window.location.assign(`/admin?section=demo&userId=${encodeURIComponent(who)}`) }}>
          <label><span>客户</span><SelectControl value={who} onValueChange={setWho}>
            {(customers.data?.customers ?? [{ id: DEMO_USER, name: '张小明' }]).map((c) => <SelectOption key={c.id} value={c.id}>{c.name}</SelectOption>)}
          </SelectControl></label>
          <button type="submit" className="button button-outline"><UserRoundCog size={15} />打开工作台</button>
        </form>
      </Section>
    </div>
  </>
}
