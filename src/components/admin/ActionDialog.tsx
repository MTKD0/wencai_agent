import { useState } from 'react'
import { Loader2, ShieldCheck, AlertCircle } from 'lucide-react'
import type { Action } from './actions'
import type { AdminCommand } from './client'
import { AdminApiError } from './client'

export function ActionDialog({
  action,
  execute,
  onClose,
}: {
  action: Action
  execute: (command: AdminCommand) => Promise<unknown>
  onClose: () => void
}) {
  const [values, setValues] = useState<Record<string, string | string[]>>(() =>
    Object.fromEntries((action.fields ?? []).map((f) => [f.name, f.value ?? (f.type === 'multi' ? [] : '')])),
  )
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const command = action.build(values)
      await execute(command)
      onClose()
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : err instanceof Error ? err.message : '操作失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  const val = (name: string) => values[name] as string
  const set = (name: string, v: string | string[]) => setValues((x) => ({ ...x, [name]: v }))

  return (
    <div className="dialog-overlay" onClick={(e) => { if (!busy && e.target === e.currentTarget) onClose() }}>
      <div className="dialog-content" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
        <div className="dialog-head">
          <h2 id="dlg-title">{action.title}</h2>
          {action.description && <p>{action.description}</p>}
        </div>
        <form onSubmit={submit}>
          <div className="dialog-fields">
            {action.fields?.map((field) => (
              <label key={field.name} className="field">
                <span>{field.label}</span>
                {field.type === 'select' ? (
                  <select value={val(field.name)} onChange={(e) => set(field.name, e.target.value)} required={field.required !== false}>
                    {!field.value && <option value="">请选择</option>}
                    {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : field.type === 'multi' ? (
                  <div className="multi-options">
                    {field.options?.map((o) => (
                      <label className="check-option" key={o.value}>
                        <input
                          type="checkbox"
                          checked={(values[field.name] as string[]).includes(o.value)}
                          onChange={(e) =>
                            set(field.name, e.target.checked
                              ? [...(values[field.name] as string[]), o.value]
                              : (values[field.name] as string[]).filter((x) => x !== o.value))
                          }
                        />
                        {o.label}
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className={field.type === 'money' ? 'money-input' : ''}>
                    {field.type === 'money' && <b>¥</b>}
                    <input
                      name={field.name}
                      value={val(field.name)}
                      type={field.type === 'money' ? 'text' : (field.type ?? 'text')}
                      inputMode={field.type === 'money' ? 'decimal' : undefined}
                      min={field.min}
                      max={field.max}
                      required={field.required !== false}
                      onChange={(e) => set(field.name, e.target.value)}
                    />
                  </div>
                )}
                {field.hint && <small>{field.hint}</small>}
              </label>
            ))}
          </div>
          {error && (
            <div className="form-error" role="alert">
              <AlertCircle size={16} />
              <div>{error}</div>
            </div>
          )}
          <div className="dialog-foot">
            <span><ShieldCheck size={15} /> 仅操作模拟账户</span>
            <div>
              <button type="button" className="button button-ghost" disabled={busy} onClick={onClose}>取消</button>
              <button type="submit" className={`button ${action.danger ? 'button-danger' : 'button-primary'}`} disabled={busy}>
                {busy && <Loader2 size={15} className="spin" />}
                {action.submitLabel ?? '确认执行'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
