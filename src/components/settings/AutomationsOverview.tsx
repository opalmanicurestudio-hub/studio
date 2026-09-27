'use client';
// src/components/settings/AutomationsOverview.tsx
//
// "EVERYTHING THAT RUNS AUTOMATICALLY" — one list, in plain sentences, grouped
// by who it affects, each with an honest status: ✓ Working · Off ·
// ⚠ Needs setup (and why) · ✕ Not going through. Switches where a message
// may be turned off (the same setting the Messages screen uses), counts for
// the last 7 days, and a link to change the wording or timing.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getAuth } from 'firebase/auth';
import { doc, updateDoc, type Firestore } from 'firebase/firestore';
import { deviceId } from '@/lib/device';

const GROUPS = ['Clients', 'Visitors & renters', 'Students & applicants', 'You & your team'] as const;
const CHIP: Record<string, [string, string]> = {
  working: ['✓ Working', 'bg-emerald-100 text-emerald-800'], off: ['Off', 'bg-muted text-muted-foreground'],
  needs_setup: ['⚠ Needs setup', 'bg-amber-100 text-amber-900'], failing: ['✕ Not going through', 'bg-red-100 text-red-800'],
};

async function load(tenantId: string) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch('/api/automations', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}`, 'x-cf-device': deviceId() }, body: JSON.stringify({ tenantId }) });
  return r.json().catch(() => ({ ok: false, error: 'No response' }));
}

export function AutomationsOverview({ tenantId, firestore }: { tenantId: string; firestore: Firestore | null }) {
  const [d, setD] = useState<any>(null); const [q, setQ] = useState(''); const [only, setOnly] = useState<'all' | 'attention'>('all'); const [busy, setBusy] = useState('');
  const refresh = useCallback(async () => { if (tenantId) setD(await load(tenantId)); }, [tenantId]);
  useEffect(() => { void refresh(); }, [refresh]);
  const items: any[] = useMemo(() => (d?.items || []).filter((a: any) => (only === 'all' || ['needs_setup', 'failing'].includes(a.status)) && (!q || `${a.when} ${a.then}`.toLowerCase().includes(q.toLowerCase()))), [d, q, only]);
  const attention = (d?.items || []).filter((a: any) => ['needs_setup', 'failing'].includes(a.status)).length;
  const flip = async (a: any, channel: 'email' | 'sms', on: boolean) => {
    if (!firestore || !a.canDisable) return; setBusy(`${a.id}-${channel}`);
    try { await updateDoc(doc(firestore, 'tenants', tenantId), { [`messagePolicy.${a.kinds[0]}.${channel}Enabled`]: on }); await refresh(); } finally { setBusy(''); }
  };
  if (!d) return <section className="rounded-2xl border-2 p-4 text-sm text-muted-foreground">Checking your automations…</section>;
  if (!d.ok) return <section className="rounded-2xl border-2 p-4 text-sm text-muted-foreground">{d.error || 'Couldn’t load automations.'}</section>;
  return (
    <section className="space-y-3 rounded-2xl border-2 p-4" aria-label="Everything that runs automatically">
      <div className="space-y-1"><p className="text-lg font-black">Everything that runs automatically</p>
        <p className="text-sm text-muted-foreground">Every message and action ClarityFlow sends or does for you — in one place, and whether it’s working.</p></div>
      <div className="flex flex-wrap gap-2 text-[12px]">
        <span className={`rounded-full px-2.5 py-1 font-bold ${d.ready.email ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>{d.ready.email ? '✓' : '⚠'} Email</span>
        <span className={`rounded-full px-2.5 py-1 font-bold ${d.ready.sms ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>{d.ready.sms ? '✓' : '⚠'} Texts</span>
        <span className={`rounded-full px-2.5 py-1 font-bold ${d.ready.stripe ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>{d.ready.stripe ? '✓' : '⚠'} Payments</span>
        {d.jobs.filter((j: any) => j.late).map((j: any) => <span key={j.name} className="rounded-full bg-amber-100 px-2.5 py-1 font-bold text-amber-900">⚠ {j.label} hasn’t run lately</span>)}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search — e.g. reminder, deposit, tour" aria-label="Search automations" className="h-10 min-w-0 flex-1 rounded-xl border-2 px-3 text-sm" />
        <div className="flex gap-1">{([['all', 'All'], ['attention', `Needs you${attention ? ` · ${attention}` : ''}`]] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setOnly(k)} aria-pressed={only === k} className={`h-10 rounded-xl px-3 text-[13px] font-bold ${only === k ? 'bg-foreground text-background' : 'border-2'}`}>{l}</button>)}</div>
      </div>
      {GROUPS.map((g) => { const list = items.filter((a) => a.who === g); if (!list.length) return null; return (
        <div key={g} className="space-y-1.5"><p className="pt-2 text-[12px] font-black uppercase tracking-widest text-muted-foreground">{g}</p>
          {list.map((a) => { const [label, cls] = CHIP[a.status]; return (
            <div key={a.id} className="rounded-xl bg-muted/40 p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 flex-1"><b>{a.when}</b> → {a.then}</p>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${cls}`}>{label}</span>
              </div>
              {a.reason && <p className={`mt-1 text-[12px] ${a.status === 'failing' ? 'text-red-800' : 'text-amber-900'}`}>{a.reason}</p>}
              <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[12px] text-muted-foreground">
                {a.kinds.length > 0 && <span>{a.sent7 ? `Sent ${a.sent7} this week` : 'None sent this week'}{a.failed7 ? ` · ${a.failed7} didn’t go through` : ''}</span>}
                {a.canDisable ? a.channels.map((c: 'email' | 'sms') => { const on = c === 'email' ? a.emailOn : a.smsOn; return (
                  <label key={c} className="flex items-center gap-1.5 font-bold text-foreground"><input type="checkbox" checked={on} disabled={!!busy} onChange={(e) => void flip(a, c, e.target.checked)} aria-label={`${c === 'email' ? 'Email' : 'Text'}: ${a.then}`} />{c === 'email' ? 'Email' : 'Text'}</label>
                ); }) : <span title="Clients have a right to this message, so it can’t be switched off">Always on</span>}
                <Link href={a.settingsHref} className="font-bold text-foreground underline underline-offset-2">Change</Link>
              </div>
            </div>
          ); })}
        </div>
      ); })}
      {items.length === 0 && <p className="text-sm text-muted-foreground">{only === 'attention' ? 'Nothing needs you — everything is working. ✓' : 'Nothing matches that search.'}</p>}
    </section>
  );
}
