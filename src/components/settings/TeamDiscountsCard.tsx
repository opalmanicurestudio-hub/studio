'use client';
// src/components/settings/TeamDiscountsCard.tsx — TEAM and FAMILY & FRIENDS discounts (Settings → Payments).
// Programme settings save as you go; who's on the list changes through the server (managers only, logged).
import * as React from 'react';
import { collection, doc, query, updateDoc, where, type Firestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { teamDiscountSettingsOf } from '@/lib/team-discount';

async function post(body: any) {
  const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  return fetch('/api/team-discounts', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'We couldn’t reach the server.' }));
}
export function TeamDiscountsCard({ tenantId, tenant, canEdit }: { tenantId: string; tenant: any; canEdit: boolean }) {
  const { firestore } = useFirebase() as any;
  const [s, setS] = React.useState(teamDiscountSettingsOf(tenant)); const [msg, setMsg] = React.useState<string | null>(null);
  const sq = useMemoFirebase(() => (firestore && tenantId ? collection(firestore, `tenants/${tenantId}/staff`) : null), [firestore, tenantId]);
  const lq = useMemoFirebase(() => (firestore && tenantId ? query(collection(firestore, `tenants/${tenantId}/clients`), where('discountGroup.type', 'in', ['team', 'family'])) : null), [firestore, tenantId]);
  const cq = useMemoFirebase(() => (firestore && tenantId ? collection(firestore, `tenants/${tenantId}/clients`) : null), [firestore, tenantId]);
  const { data: staff } = useCollection<any>(sq); const { data: linked } = useCollection<any>(lq); const { data: clients } = useCollection<any>(cq);
  const [q, setQ] = React.useState(''); const [pick, setPick] = React.useState<any>(null); const [type, setType] = React.useState<'team' | 'family'>('family'); const [staffId, setStaffId] = React.useState('');
  const timer = React.useRef<any>(null);
  const save = (next: any) => {   // update at once on screen; write once you pause typing
    setS(next); setMsg(null); clearTimeout(timer.current);
    timer.current = setTimeout(async () => { try { await updateDoc(doc(firestore as Firestore, 'tenants', tenantId), { teamDiscounts: next }); setMsg('Saved.'); } catch (e: any) { setMsg(e?.message || 'Couldn’t save.'); } }, 600);
  };
  React.useEffect(() => () => clearTimeout(timer.current), []);
  const matches = React.useMemo(() => { const t = q.trim().toLowerCase(); if (t.length < 2) return []; return (clients || []).filter((c: any) => String(c.name || '').toLowerCase().includes(t) || String(c.phone || '').replace(/\D/g, '').includes(t.replace(/\D/g, '') || '~')).slice(0, 6); }, [q, clients]);
  const team = (staff || []).filter((m: any) => m.isActive !== false);
  const num = (v: number, on: (n: number) => void) => <input type="number" inputMode="numeric" min={0} max={100} value={v} disabled={!canEdit} onChange={(e) => on(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} className="h-10 w-20 rounded-xl border px-3 text-right" />;
  const programme = (k: 'team' | 'family', title: string, note: string) => {
    const p: any = (s as any)[k];
    return <div className="space-y-2 rounded-2xl bg-slate-50 p-4 text-sm">
      <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={p.on} disabled={!canEdit} onChange={(e) => save({ ...s, [k]: { ...p, on: e.target.checked } })} /> {title}</label>
      <p className="text-xs text-muted-foreground">{note}</p>
      {p.on && <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-2">Services {num(p.servicesPct, (n) => save({ ...s, [k]: { ...p, servicesPct: n } }))}%</span>
        <span className="flex items-center gap-2">Products {num(p.productsPct, (n) => save({ ...s, [k]: { ...p, productsPct: n } }))}%</span>
        {k === 'family' && <span className="flex items-center gap-2">Up to {num(p.perStaffLimit, (n) => save({ ...s, family: { ...p, perStaffLimit: n } }))} people each <span className="text-xs text-muted-foreground">(0 = no limit)</span></span>}
      </div>}
    </div>;
  };
  const link = async () => { if (!pick || !staffId) return; const r = await post({ tenantId, action: 'link', clientId: pick.id, type, staffId }); setMsg(r?.ok ? `${pick.name} added.` : r?.error || 'That didn’t save.'); if (r?.ok) { setPick(null); setQ(''); } };
  return (
    <div className="space-y-4 rounded-[2rem] border-2 bg-white p-6">
      <div><p className="text-lg font-semibold">Team and family discounts</p>
        <p className="text-sm text-muted-foreground">Applied automatically at checkout for people on the list — never on memberships, packages, deposits, rentals, fees or tips. Staff can skip it for a sale.</p></div>
      {programme('team', 'Team members', 'When someone on the team is the client.')}
      {programme('family', 'Family and friends', 'People a team member adds (a manager adds them here).')}
      {(s.team.on || s.family.on) && <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">Monthly limit per person</span> $<input type="number" inputMode="decimal" min={0} value={s.monthlyCap} disabled={!canEdit} onChange={(e) => save({ ...s, monthlyCap: Math.max(0, Number(e.target.value) || 0) })} className="h-10 w-24 rounded-xl border px-3 text-right" /><span className="text-xs text-muted-foreground">(0 = no limit)</span></div>
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={s.stackWithCodes} disabled={!canEdit} onChange={(e) => save({ ...s, stackWithCodes: e.target.checked })} /><span>Combine with discount codes <span className="text-muted-foreground">— off: they get whichever is bigger, never both.</span></span></label>
      </div>}
      <div className="space-y-2 text-sm">
        <p className="font-semibold">Who’s on the list ({(linked || []).length})</p>
        {(linked || []).map((c: any) => <div key={c.id} className="flex items-center justify-between gap-2 rounded-xl border p-2.5">
          <span><b>{c.name}</b> <span className="text-muted-foreground">— {c.discountGroup?.type === 'team' ? 'team member' : `family & friends of ${String(c.discountGroup?.staffName || 'a team member').split(' ')[0]}`}</span></span>
          {canEdit && <button type="button" onClick={async () => { const r = await post({ tenantId, action: 'unlink', clientId: c.id }); setMsg(r?.ok ? `${c.name} removed.` : r?.error || 'That didn’t save.'); }} className="text-xs font-semibold underline">Remove</button>}
        </div>)}
        {canEdit && <div className="space-y-2 rounded-2xl bg-slate-50 p-3">
          {pick ? <p>Adding <b>{pick.name}</b> <button type="button" className="text-xs underline" onClick={() => setPick(null)}>change</button></p>
            : <><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a client to add" aria-label="Find a client to add" className="h-10 w-full rounded-xl border px-3" />
              {matches.map((c: any) => <button key={c.id} type="button" onClick={() => setPick(c)} className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-white">{c.name} <span className="text-muted-foreground">{c.phone || c.email || ''}</span></button>)}</>}
          {pick && <div className="flex flex-wrap items-center gap-2">
            <select value={type} onChange={(e) => setType(e.target.value as any)} className="h-10 rounded-xl border px-2" aria-label="Programme"><option value="family">Family & friends of</option><option value="team">Team member —</option></select>
            <select value={staffId} onChange={(e) => setStaffId(e.target.value)} className="h-10 rounded-xl border px-2" aria-label="Team member"><option value="">Choose…</option>{team.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
            <button type="button" disabled={!staffId} onClick={link} className="h-10 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">Add</button>
          </div>}
        </div>}
      </div>
      {msg && <p className="text-sm font-semibold">{msg}</p>}
    </div>
  );
}
