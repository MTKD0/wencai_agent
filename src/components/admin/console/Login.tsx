import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Landmark, Loader2, LockKeyhole } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { consoleApi } from './api'

/** 工作人员登录：账号由部署方预置，后台不提供注册 */
export function StaffLogin({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState(''), [password, setPassword] = useState('')
  const login = useMutation({ mutationFn: () => consoleApi.login(username.trim(), password), onSuccess: () => { setPassword(''); onDone() } })
  return (
    <div className="app-shell console-login">
      <form className="console-login-card" onSubmit={(e) => { e.preventDefault(); if (username.trim() && password) login.mutate() }}>
        <span className="brand-mark"><Landmark size={22} /></span>
        <h1>文财银行运营管理后台</h1>
        <p>仅限银行工作人员使用。登录后的回访结论、卡片冻结等操作都会记录处理人。</p>
        <label><span>工号</span><Input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="请输入工号" /></label>
        <label><span>密码</span><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="请输入密码" /></label>
        {login.isError && <div className="console-login-error" role="alert">{login.error.message}</div>}
        <Button className="button button-primary" type="submit" disabled={login.isPending || !username.trim() || !password}>
          {login.isPending ? <Loader2 className="spin" size={16} /> : <LockKeyhole size={16} />}登录
        </Button>
        <small>演示账号见提交材料中的《演示说明》。</small>
      </form>
    </div>
  )
}
