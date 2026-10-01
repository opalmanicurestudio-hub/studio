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
  const [dirty, setDirty] = React.useState(false); const [busy, setBusy] = React.useState(false); const [msg, setMsg] = React.useState('');
  React.useEffect(() => { if (!dirty) setList(kioskOptionsAll(tenant)); }, [tenant]); // eslint-disable-line react-hooks/exhaustive-deps
  const edit = (i: number, patch: Partial<KioskOption>) => { setList((l) => l.map((o, j) => (j === i ? { ...o, ...patch } : o))); setDirty(true); setMsg(''); };
  const move = (i: number, d: number) => { setList((l) => { const n = [...l]; const j = i + d; if (j < 0 || j >= n.length) return l; [n[i], n[j]] = [n[j], n[i]]; return n; }); setDirty(true); };
  const add = () => { setList((l) => [...l, { id: `custom-${Date.now().toString(36)}`, intent: 'custom', label: 'Something else', hint: 'We’ll let the team know you’re here' }]); setDirty(true); };
  const save = async () => { setBusy(true); try { await updateDoc(doc(firestore as Firestore, 'tenants', tenantId), { kioskOptions: cleanKioskOptions(list) }); setDirty(false); setMsg('Saved — the kiosk shows this now.'); } catch { setMsg('That didn’t save — only the owner can change this.'); } setBusy(false); };
  const shown = list.filter((o) => !o.hidden).length;
  return (
    <section className="space-y-4 rounded-[2rem] border-2 bg-white p-6">
      <div><p className="text-lg font-semibold">Front door</p>
        <p className="text-sm text-muted-foreground">What the kiosk asks first — “What brings you in?”. Use your own words; hide what you don’t offer. {shown <= 1 ? 'With one option showing, the kiosk skips this screen.' : ''}</p></div>
      <div className="space-y-2">
        {list.map((o, i) => (
          <div key={o.id} className={`space-y-2 rounded-2xl border-2 p-3 ${o.hidden ? 'opacity-50' : ''}`}>
            <div className="flex flex-wrap items-center gap-2">
              <input value={o.label} disabled={!canEdit} onChange={(e) => edit(i, { label: e.target.value.slice(0, 60) })} className="h-10 min-w-[10rem] flex-1 rounded-xl border-2 px-3 text-[15px] font-semibold" aria-label="Title" />
              <span className="rounded-full bg-muted px-2 py-1 text-[11px]">{INTENT_LABEL[o.intent]}</span>
            </div>
            <input value={o.hint || ''} disabled={!canEdit} onChange={(e) => edit(i, { hint: e.target.value.slice(0, 90) })} placeholder="Small line underneath (optional)" className="h-9 w-full rounded-xl border px-3 text-[13px]" aria-label="Description" />
            {canEdit && <div className="flex flex-wrap gap-2 text-[12px]">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="h-8 w-8 rounded-lg border disabled:opacity-30" aria-label="Move up">↑</button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === list.length - 1} className="h-8 w-8 rounded-lg border disabled:opacity-30" aria-label="Move down">↓</button>
              <button type="button" onClick={() => edit(i, { hidden: !o.hidden })} className="h-8 rounded-lg border px-3">{o.hidden ? 'Show' : 'Hide'}</button>
              {o.intent === 'custom' && <button type="button" onClick={() => { setList((l) => l.filter((_, j) => j !== i)); setDirty(true); }} className="h-8 rounded-lg border px-3 text-red-700">Remove</button>}
            </div>}
          </div>))}
      </div>
      {canEdit && <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={add} className="h-10 rounded-full border-2 px-4 text-sm font-semibold">+ Add your own</button>
        <button type="button" disabled={!dirty || busy} onClick={save} className="h-10 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-40">{busy ? 'Saving…' : 'Save'}</button>
        {msg && <span className="text-sm" role="status">{msg}</span>}
      </div>}
    </section>
  );
}
