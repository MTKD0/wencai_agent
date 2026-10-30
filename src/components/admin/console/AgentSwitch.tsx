import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, CirclePause, CirclePlay } from 'lucide-react'
import { Input } from '#/components/ui/input'
import { consoleApi } from './api'
import { Section } from './parts'
import { dateTime } from '../utils'

/** 智能助手紧急停用：停用后对话不再调用模型，首页业务照常；停用与恢复都须填写原因并写审计 */
export function AgentSwitch() {
  const client = useQueryClient()
  const state = useQuery({ queryKey: ['admin', 'agent'], queryFn: consoleApi.agent, refetchInterval: 15_000 })
  const [reason, setReason] = useState('')
  const toggle = useMutation({
    mutationFn: (paused: boolean) => consoleApi.setAgent(paused, reason.trim()),
    onSuccess: (data) => { client.setQueryData(['admin', 'agent'], data); setReason('') },
  })
  const s = state.data
  if (!s) return null
  const paused = s.paused
  return <Section className={`agent-switch${paused ? ' is-paused' : ''}`} title="智能助手运行状态"
    subtitle={paused ? '已暂停：客户对话不再调用模型，首页转账、卡片和任务中心照常办理' : '运行中。出现异常输出、可被利用的注入绕过、模型服务故障或安全事件时，可立即停用'}>
    <div className="agent-switch-body">
      <span className={`agent-switch-state${paused ? ' is-paused' : ''}`}><Bot size={16} />{paused ? '已暂停' : '运行中'}</span>
      {s.at && <small>{paused ? '停用' : '最近恢复'}：{dateTime(s.at)} · {s.by}{s.reason ? ` · ${s.reason}` : ''}</small>}
    </div>
    <div className="agent-switch-form">
      <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder={paused ? '恢复原因，例如：异常已排查' : '停用原因，例如：发现可绕过的注入话术'} aria-label={paused ? '恢复原因' : '停用原因'} />
      {paused
        ? <button type="button" className="button button-primary" disabled={toggle.isPending || reason.trim().length < 2} onClick={() => toggle.mutate(false)}><CirclePlay size={15} />恢复运行</button>
        : <button type="button" className="button button-danger" disabled={toggle.isPending || reason.trim().length < 2} onClick={() => toggle.mutate(true)}><CirclePause size={15} />紧急停用</button>}
    </div>
    {toggle.isError && <div className="resolve-hint is-danger" role="alert">{toggle.error.message}</div>}
  </Section>
}
