'use client';
// src/components/staff/TypicalTimes.tsx — a provider's TYPICAL TIMES on their details sheet (owners / managers), from the
// nightly numbers: per service, typical vs booked, the usual range, on-time rate, why visits ran over, and the trend.
// Students are shown against the team's typical time (progress). Renters never appear here.
// Below that, THEIR OWN BOOKING LENGTHS: "Book Jo's gel manicure at 70 min" — online booking, the desk and the planner then
// hold that long for this provider only (the service's own length stays for everyone else). One tap from a typical time,
// or type any length; "Use the service's" clears it.
import * as React from 'react';
import { getAuth } from 'firebase/auth';
import { doc, updateDoc, deleteField } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { logAuditClient } from '@/lib/audit-client';

const round5 = (n: number) => Math.max(5, Math.ceil(n / 5) * 5);

export function TypicalTimes({ tenantId, staffId, staffMember, services = [] }: { tenantId: string; staffId: string; staffMember?: any; services?: any[] }) {
  const { firestore } = useFirebase();
  const [d, setD] = React.useState<any>(null);
  const [own, setOwn] = React.useState<Record<string, number>>({});
  const [draft, setDraft] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState<string | null>(null); const [err, setErr] = React.useState('');
  const [adding, setAdding] = React.useState('');
  React.useEffect(() => { setOwn({ ...(staffMember?.serviceMinutes || {}) }); }, [staffMember?.serviceMinutes]);
  React.useEffect(() => { if (!tenantId || !staffId) return; let on = true;
    (async () => { const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
      const r = await fetch('/api/timing', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ tenantId, action: 'staff', staffId }) }).then((x) => x.json()).catch(() => null);
      if (on) setD(r?.ok ? r : { rows: [] }); })(); return () => { on = false; }; }, [tenantId, staffId]);
  if (!d || d.renter) return null;

  const svcName = (id: string) => String(services.find((s: any) => s.id === id)?.name || 'Service');
  const svcLen = (id: string) => Number(services.find((s: any) => s.id === id)?.duration) || 60;
  const first = String(staffMember?.name || staffMember?.firstName || 'This provider').split(' ')[0];
  const save = async (serviceId: string, minutes: number | null) => {
    if (!firestore) return; setErr('');
    if (minutes != null && (!Number.isFinite(minutes) || minutes < 5 || minutes > 600)) { setErr('Use a length between 5 and 600 minutes.'); return; }
    setBusy(serviceId);
    try {
      await updateDoc(doc(firestore, 'tenants', tenantId, 'staff', staffId), { [`serviceMinutes.${serviceId}`]: minutes == null ? deleteField() : Math.round(minutes) });
      setOwn((o) => { const n = { ...o }; if (minutes == null) delete n[serviceId]; else n[serviceId] = Math.round(minutes); return n; });
      setDraft((x) => { const n = { ...x }; delete n[serviceId]; return n; });
      void logAuditClient(firestore, tenantId, { action: 'staff.booking_length', targetType: 'staff', targetId: staffId, actor: { type: 'user', id: getAuth().currentUser?.uid }, summary: minutes == null ? `${first} books ${svcName(serviceId)} at the service’s length again` : `${first} now books ${svcName(serviceId)} at ${Math.round(minutes)} min` } as any);
    } catch { setErr('Couldn’t save — check your connection and try again.'); }
    setBusy(null);
  };
  const ownIds = Object.keys(own).filter((id) => Number(own[id]) > 0);
  const addable = services.filter((s: any) => s?.id && !ownIds.includes(s.id));

  return (
    <section className="space-y-3 rounded-3xl p-5" style={{ background: 'var(--card, #fff)', border: '1px solid var(--line, #e7e2dc)' }} aria-label="Typical times">
      <p className="text-[15px] font-semibold">Typical times</p>
      {!d.rows.length ? <p className="text-[14px]" style={{ color: 'var(--muted, #78716c)' }}>Not enough timed visits yet — numbers appear after 5 counted visits of a service.</p>
        : d.rows.slice(0, 10).map((r: any) => { const sug = round5(Number(r.typical) || 0); const set = r.serviceId ? own[r.serviceId] : undefined;
          return (
          <div key={r.label} className="text-[14px]">
            <p><b>{r.label}</b> · typically <b>{r.typical} min</b> <span style={{ color: 'var(--muted, #78716c)' }}>(booked {r.booked} · usually {r.low}–{r.high})</span></p>
            <p style={{ color: 'var(--muted, #78716c)' }}>On time {Math.round(r.onTime * 100)}% of {r.count}{r.clientCaused || r.ranBehind ? ` · ran over: ${r.clientCaused} client-caused, ${r.ranBehind} ran behind` : ''}{r.trend !== null ? ` · ${r.trend < 0 ? `${Math.abs(r.trend)} min faster` : r.trend > 0 ? `${r.trend} min slower` : 'steady'} lately` : ''}{r.team !== null && d.isStudent ? ` · team typically ${r.team}` : ''}</p>
            {r.serviceId && sug !== (set ?? Number(r.booked)) && (
              <button type="button" disabled={busy === r.serviceId} onClick={() => save(r.serviceId, sug)} className="mt-1 h-9 rounded-full border px-3 text-[13px] font-[600]" style={{ borderColor: 'var(--line, #e7e2dc)' }}>
                Book {first}’s at {sug} min
              </button>)}
          </div>); })}

      <div className="space-y-2 border-t pt-3" style={{ borderColor: 'var(--line, #e7e2dc)' }}>
        <p className="text-[14px] font-[700]">{first}’s own booking lengths</p>
        <p className="text-[13px]" style={{ color: 'var(--muted, #78716c)' }}>Online booking, the desk and the planner hold this long when {first} does the service. Everyone else keeps the service’s length.</p>
        {ownIds.length === 0 && <p className="text-[13px]" style={{ color: 'var(--muted, #78716c)' }}>None yet — {first} books at each service’s own length.</p>}
        {ownIds.map((id) => { const v = draft[id] ?? String(own[id]); const diff = Number(own[id]) - svcLen(id);
          return (
          <div key={id} className="flex flex-wrap items-center gap-2 text-[14px]">
            <span className="min-w-0 flex-1"><b className="font-[700]">{svcName(id)}</b> <span style={{ color: 'var(--muted, #78716c)' }}>· service is {svcLen(id)} min{diff ? ` · ${diff > 0 ? '+' : ''}${diff}` : ''}</span></span>
            <input aria-label={`${svcName(id)} minutes for ${first}`} inputMode="numeric" value={v} onChange={(e) => setDraft((x) => ({ ...x, [id]: e.target.value.replace(/\D/g, '').slice(0, 3) }))}
              className="h-10 w-20 rounded-xl border px-3 text-right tabular-nums" style={{ borderColor: 'var(--line, #e7e2dc)' }} />
            <span>min</span>
            {draft[id] != null && draft[id] !== String(own[id]) && <button type="button" disabled={busy === id} onClick={() => save(id, Number(draft[id]))} className="h-10 rounded-full bg-[#17181A] px-4 text-[13px] font-[700] text-white">Save</button>}
            <button type="button" disabled={busy === id} onClick={() => save(id, null)} className="h-10 rounded-full border px-3 text-[13px] font-[600]" style={{ borderColor: 'var(--line, #e7e2dc)' }}>Use the service’s</button>
          </div>); })}
        {addable.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Add a service" value={adding} onChange={(e) => setAdding(e.target.value)} className="h-10 min-w-0 flex-1 rounded-xl border bg-white px-3 text-[14px]" style={{ borderColor: 'var(--line, #e7e2dc)' }}>
              <option value="">Set a length for another service…</option>
              {addable.map((s: any) => <option key={s.id} value={s.id}>{s.name} ({Number(s.duration) || 60} min)</option>)}
            </select>
            <button type="button" disabled={!adding || busy === adding} onClick={() => { const id = adding; setAdding(''); save(id, svcLen(id)); }} className="h-10 rounded-full border px-4 text-[13px] font-[600]" style={{ borderColor: 'var(--line, #e7e2dc)' }}>Add</button>
          </div>)}
        {err && <p role="alert" className="text-[13px] font-[600] text-[#B42318]">{err}</p>}
      </div>
      <p className="text-[12px]" style={{ color: 'var(--muted, #78716c)' }}>For coaching and booking lengths — the provider sees the same numbers in their portal.</p>
    </section>);
}
