import { useState } from 'react'
import { Loader2, ShieldCheck, AlertCircle } from 'lucide-react'
import type { Action } from './actions'
import type { AdminCommand } from './client'
import { AdminApiError } from './client'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

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
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">{action.title}</DialogTitle>
          {action.description && <DialogDescription>{action.description}</DialogDescription>}
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-3.5 max-h-[60vh] overflow-y-auto px-1 py-1">
            {action.fields?.map((field) => (
              <div key={field.name} className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground flex items-center justify-between">
                  <span>{field.label}</span>
                  {field.hint && <span className="text-[11px] text-muted-foreground font-normal">{field.hint}</span>}
                </label>
                {field.type === 'select' ? (
                  <select
                    value={val(field.name)}
                    onChange={(e) => set(field.name, e.target.value)}
                    required={field.required !== false}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {!field.value && <option value="">请选择</option>}
                    {field.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : field.type === 'multi' ? (
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    {field.options?.map((o) => (
                      <label key={o.value} className="flex items-center gap-2 text-xs font-medium cursor-pointer border border-border/80 rounded-lg p-2 hover:bg-muted/50 transition">
                        <input
                          type="checkbox"
                          className="rounded border-input text-primary focus:ring-ring"
                          checked={(values[field.name] as string[]).includes(o.value)}
                          onChange={(e) =>
                            set(
                              field.name,
                              e.target.checked
                                ? [...(values[field.name] as string[]), o.value]
                                : (values[field.name] as string[]).filter((x) => x !== o.value)
                            )
                          }
                        />
                        {o.label}
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="relative">
                    {field.type === 'money' && (
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">
                        ¥
                      </span>
                    )}
                    <Input
                      name={field.name}
                      value={val(field.name)}
                      type={field.type === 'money' ? 'text' : (field.type ?? 'text')}
                      inputMode={field.type === 'money' ? 'decimal' : undefined}
                      min={field.min}
                      max={field.max}
                      required={field.required !== false}
                      className={field.type === 'money' ? 'pl-7 font-mono font-medium' : ''}
                      onChange={(e) => set(field.name, e.target.value)}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-2.5 text-xs text-destructive" role="alert">
              <AlertCircle size={15} className="shrink-0" />
              <div>{error}</div>
            </div>
          )}

          <DialogFooter className="flex-row items-center justify-between sm:justify-between pt-2 border-t border-border/60">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck size={14} className="text-muted-foreground/80" /> 仅操作模拟账户
            </span>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onClose}>
                取消
              </Button>
              <Button
                type="submit"
                variant={action.danger ? 'destructive' : 'default'}
                size="sm"
                disabled={busy}
              >
                {busy && <Loader2 size={14} className="animate-spin mr-1.5" />}
                {action.submitLabel ?? '确认执行'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
