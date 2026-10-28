import { useState } from 'react'
import { MapPin, Star, Trash2 } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import type { SavedAddress } from '#/lib/life-commerce'

type Draft = { label: string; recipient: string; phone: string; address: string; isDefault: boolean }
const empty: Draft = { label: '', recipient: '', phone: '', address: '', isDefault: false }

async function command(body: unknown): Promise<SavedAddress[]> {
  const res = await fetch('/api/addresses', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const result = await res.json() as { ok: boolean; message?: string; addresses?: SavedAddress[] }
  if (!res.ok || !result.ok) throw new Error(result.message ?? '保存失败，请重试')
  return result.addresses ?? []
}

/** 常用收货地址：最多 10 个，下单与问文财时都可以直接选用 */
export function LifeAddresses({ addresses, onChanged }: { addresses: SavedAddress[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<string | 'new' | null>(addresses.length ? null : 'new')
  const [draft, setDraft] = useState<Draft>(empty)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const run = async (body: unknown, after?: () => void) => {
    setBusy(true); setError('')
    try { await command(body); after?.(); onChanged() }
    catch (e) { setError(e instanceof Error ? e.message : '操作失败，请重试') }
    finally { setBusy(false) }
  }
  const edit = (a?: SavedAddress) => { setEditing(a?.id ?? 'new'); setDraft(a ? { label: a.label, recipient: a.recipient, phone: a.phone, address: a.address, isDefault: a.isDefault } : empty); setError('') }
  const set = (key: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, [key]: key === 'isDefault' ? e.target.checked : e.target.value })
  return <div className="bank-life-addresses">
    <p className="bank-life-detail-description">保存后，在商城下单或让文财代办送礼时可以直接选用，不用每次重新填写。最多保存 10 个。</p>
    {addresses.map((a) => <article key={a.id} className="bank-life-address">
      <MapPin size={18} aria-hidden="true" />
      <div><strong>{a.label}{a.isDefault && <span className="bank-life-address-default">默认</span>}</strong><p>{a.recipient} · {a.phone}</p><p>{a.address}</p></div>
      <div className="bank-life-address-actions">
        {!a.isDefault && <Button type="button" className="bank-life-link" disabled={busy} onClick={() => void run({ action: 'default', id: a.id })}><Star size={14} />设为默认</Button>}
        <Button type="button" className="bank-life-link" disabled={busy} onClick={() => edit(a)}>编辑</Button>
        <Button type="button" className="bank-life-link" disabled={busy} aria-label={`删除地址${a.label}`} onClick={() => void run({ action: 'delete', id: a.id }, () => editing === a.id && setEditing(null))}><Trash2 size={14} />删除</Button>
      </div>
    </article>)}
    {editing ? <form className="bank-life-checkout" onSubmit={(e) => { e.preventDefault(); void run({ action: 'save', ...(editing !== 'new' ? { id: editing } : {}), address: draft }, () => { setEditing(null); setDraft(empty) }) }}>
      <div className="bank-life-checkout-pair"><label>名称<Input required maxLength={20} value={draft.label} disabled={busy} onChange={set('label')} placeholder="家、公司、爸妈家" /></label><label>收件人<Input required maxLength={50} value={draft.recipient} disabled={busy} onChange={set('recipient')} /></label></div>
      <label>手机号<Input required type="tel" pattern="1[0-9]{10}" maxLength={11} value={draft.phone} disabled={busy} onChange={set('phone')} /></label>
      <label>收货地址<Input required minLength={5} maxLength={200} value={draft.address} disabled={busy} onChange={set('address')} placeholder="城市、街道、门牌等完整地址" /></label>
      <label className="bank-life-renew"><input type="checkbox" checked={draft.isDefault} disabled={busy} onChange={set('isDefault')} />设为默认地址</label>
      <Button type="submit" disabled={busy} className="bank-life-primary">{busy ? '正在保存…' : editing === 'new' ? '保存地址' : '保存修改'}</Button>
      {addresses.length > 0 && <Button type="button" className="bank-life-link" disabled={busy} onClick={() => setEditing(null)}>取消</Button>}
    </form> : addresses.length < 10 && <Button type="button" className="bank-life-primary" disabled={busy} onClick={() => edit()}>新增常用地址</Button>}
    {error && <p className="bank-error" role="alert">{error}</p>}
  </div>
}
