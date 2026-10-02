'use client';
// src/components/settings/KioskOptionsCard.tsx — FRONT DOOR (K1): what the kiosk's "What brings you in?" screen offers.
// Rename (title + the small line under it), move up / down, hide, and add your own (a custom option simply lets the
// team know who's arrived and why). Options for tools the business doesn't use never appear. Saved as kioskOptions.
import * as React from 'react';
import { doc, updateDoc, type Firestore } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { kioskOptionsAll, cleanKioskOptions, INTENT_LABEL, type KioskOption } from '@/lib/kiosk-options';

export function KioskOptionsCard({ tenantId, tenant, canEdit }: { tenantId: string; tenant: any; canEdit: boolean }) {
  const { firestore } = useFirebase() as any;
  const [list, setList] = React.useState<KioskOption[]>(() => kioskOptionsAll(tenant));
  const [dirty, setDirty] = React.useState(false); const [busy, setBusy] = React.useState(false); const [msg, setMsg] = React.useState(''); const [editing, setEditing] = React.useState<string | null>(null);
  React.useEffect(() => { if (!dirty) setList(kioskOptionsAll(tenant)); }, [tenant]); // eslint-disable-line react-hooks/exhaustive-deps
  const edit = (i: number, patch: Partial<KioskOption>) => { setList((l) => l.map((o, j) => (j === i ? { ...o, ...patch } : o))); setDirty(true); setMsg(''); };
  const move = (i: number, d: number) => { setList((l) => { const n = [...l]; const j = i + d; if (j < 0 || j >= n.length) return l; [n[i], n[j]] = [n[j], n[i]]; return n; }); setDirty(true); };
  const add = () => { setList((l) => [...l, { id: `custom-${Date.now().toString(36)}`, intent: 'custom', label: 'Something else', hint: 'We’ll let the team know you’re here' }]); setDirty(true); };
  const save = async () => { setBusy(true); try { await updateDoc(doc(firestore as Firestore, 'tenants', tenantId), { kioskOptions: cleanKioskOptions(list) }); setDirty(false); setMsg('Saved — the kiosk shows this now.'); } catch { setMsg('That didn’t save — only the owner can change this.'); } setBusy(false); };
  const shown = list.filter((o) => !o.hidden).length;
  return (
    <section className="space-y-4">
      <div><h2 className="text-[19px] font-semibold tracking-tight">Front door</h2>
        <p className="text-sm text-muted-foreground">What the kiosk asks first — “What brings you in?”. Use your own words; hide what you don’t offer. {shown <= 1 ? 'With one option showing, the kiosk skips this screen.' : ''}</p></div>
      <div className="cf-sheet">
        {list.map((o, i) => { const open = editing === o.id; return (
          <div key={o.id} className={`px-4 py-3 [&+&]:border-t ${o.hidden ? 'opacity-60' : ''}`} style={{ borderColor: 'var(--line)' }}>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setEditing(open ? null : o.id)} className="min-w-0 flex-1 text-left" aria-expanded={open}>
                <span className="block truncate text-[15px] font-medium">{o.label}{o.hidden ? ' (hidden)' : ''}</span>
                <span className="block truncate text-[13px] cf-muted">{o.hint || INTENT_LABEL[o.intent]}</span>
              </button>
              {canEdit && <span className="flex shrink-0 gap-1">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="h-8 w-8 rounded-lg border text-[13px] disabled:opacity-30" aria-label="Move up">↑</button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === list.length - 1} className="h-8 w-8 rounded-lg border text-[13px] disabled:opacity-30" aria-label="Move down">↓</button>
              </span>}
            </div>
            {open && canEdit && (
              <div className="mt-3 space-y-2">
                <input value={o.label} onChange={(e) => edit(i, { label: e.target.value.slice(0, 60) })} className="h-11 w-full rounded-xl border px-3 text-[15px]" style={{ borderColor: 'var(--line)', background: 'var(--card)' }} aria-label="Title" />
                <input value={o.hint || ''} onChange={(e) => edit(i, { hint: e.target.value.slice(0, 90) })} placeholder="Small line underneath (optional)" className="h-10 w-full rounded-xl border px-3 text-[14px]" style={{ borderColor: 'var(--line)', background: 'var(--card)' }} aria-label="Description" />
                <div className="flex flex-wrap gap-2 text-[13px]">
                  <button type="button" onClick={() => edit(i, { hidden: !o.hidden })} className="h-9 rounded-full border px-3">{o.hidden ? 'Show on the kiosk' : 'Hide from the kiosk'}</button>
                  {o.intent === 'custom' && <button type="button" onClick={() => { setList((l) => l.filter((_, j) => j !== i)); setDirty(true); setEditing(null); }} className="h-9 rounded-full border px-3 text-red-700">Remove</button>}
                  <button type="button" onClick={() => setEditing(null)} className="h-9 rounded-full px-3 cf-muted">Done</button>
                </div>
              </div>)}
          </div>); })}
      </div>
      {canEdit && <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={add} className="h-10 rounded-full border-2 px-4 text-sm font-semibold">+ Add your own</button>
        <button type="button" disabled={!dirty || busy} onClick={save} className="h-10 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-40">{busy ? 'Saving…' : 'Save'}</button>
        {msg && <span className="text-sm" role="status">{msg}</span>}
      </div>}
    </section>
  );
}
