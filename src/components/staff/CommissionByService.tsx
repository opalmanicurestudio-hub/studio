'use client';
// src/components/staff/CommissionByService.tsx — COMMISSION PER SERVICE for one person, on their details sheet (managers).
// Shows the rate they earn on each service that differs from their usual rate — their own rate for a service first,
// then a rate the service sets for everyone — and lets a manager give them their own rate for any service.
// Sales are stamped with the rate at checkout, so a change here applies to new sales, never to past pay.
import * as React from 'react';
import { getAuth } from 'firebase/auth';
import { doc, updateDoc, deleteField } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { logAuditClient } from '@/lib/audit-client';
import { earnsCommission, usualRate } from '@/lib/commission';

const pctOf = (v: any): number | null => { if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null; };

export function CommissionByService({ tenantId, staffMember, services = [] }: { tenantId: string; staffMember: any; services?: any[] }) {
  const { firestore } = useFirebase();
  const [own, setOwn] = React.useState<Record<string, number>>(() => ({ ...(staffMember?.serviceCommission || {}) }));
  const [draft, setDraft] = React.useState<Record<string, string>>({});
  const [adding, setAdding] = React.useState(''); const [busy, setBusy] = React.useState<string | null>(null); const [err, setErr] = React.useState('');
  React.useEffect(() => { setOwn({ ...(staffMember?.serviceCommission || {}) }); }, [staffMember?.serviceCommission]);
  if (!staffMember?.id || !earnsCommission(staffMember)) return null;

  const first = String(staffMember.name || 'This person').split(' ')[0];
  const usual = usualRate(staffMember, 0);
  const svc = (id: string) => services.find((s: any) => s.id === id);
  const save = async (serviceId: string, rate: number | null) => {
    if (!firestore) return; setErr('');
    if (rate != null && (!Number.isFinite(rate) || rate < 0 || rate > 100)) { setErr('Use a rate between 0 and 100%.'); return; }
    setBusy(serviceId);
    try {
      const v = rate == null ? null : Math.round(rate * 10) / 10;
      await updateDoc(doc(firestore, 'tenants', tenantId, 'staff', staffMember.id), { [`serviceCommission.${serviceId}`]: v == null ? deleteField() : v });
      setOwn((o) => { const n = { ...o }; if (v == null) delete n[serviceId]; else n[serviceId] = v; return n; });
      setDraft((x) => { const n = { ...x }; delete n[serviceId]; return n; });
      const name = String(svc(serviceId)?.name || 'a service');
      void logAuditClient(firestore, tenantId, { action: 'staff.service_commission', targetType: 'staff', targetId: staffMember.id, actor: { type: 'user', id: getAuth().currentUser?.uid },
        summary: v == null ? `${first} earns the usual rate on ${name} again` : `${first} now earns ${v}% on ${name}` } as any);
    } catch { setErr('Couldn’t save — check your connection and try again.'); }
    setBusy(null);
  };

  const ownIds = Object.keys(own).filter((id) => pctOf(own[id]) !== null);
  const serviceWide = services.filter((s: any) => s?.id && !ownIds.includes(s.id) && pctOf(s.commissionRate) !== null && pctOf(s.commissionRate) !== usual);
  const addable = services.filter((s: any) => s?.id && !ownIds.includes(s.id));
  const line = 'var(--line, #e7e2dc)'; const muted = { color: 'var(--muted, #78716c)' };

  return (
    <section className="space-y-3 rounded-2xl border p-4" style={{ borderColor: line }} aria-label="Commission by service">
      <div><p className="text-[15px] font-semibold">Commission by service</p>
        <p className="text-[13px]" style={muted}>{first} earns {usual}% on services unless a service below says otherwise. Changes apply to new sales.</p></div>
      {ownIds.length === 0 && serviceWide.length === 0 && <p className="text-[13px]" style={muted}>Every service pays {first}’s usual rate.</p>}
      {ownIds.map((id) => { const v = draft[id] ?? String(own[id]); const sw = pctOf(svc(id)?.commissionRate);
        return (
        <div key={id} className="flex flex-wrap items-center gap-2 text-[14px]">
          <span className="min-w-0 flex-1"><b className="font-[700]">{svc(id)?.name || 'A removed service'}</b> <span style={muted}>· {first}’s own rate{sw !== null ? ` (service is ${sw}%)` : ''}</span></span>
          <input aria-label={`${svc(id)?.name || 'Service'} commission for ${first}`} inputMode="decimal" value={v} onChange={(e) => setDraft((x) => ({ ...x, [id]: e.target.value.replace(/[^\d.]/g, '').slice(0, 5) }))}
            className="h-10 w-20 rounded-xl border px-3 text-right tabular-nums" style={{ borderColor: line }} />
          <span>%</span>
          {draft[id] != null && draft[id] !== String(own[id]) && <button type="button" disabled={busy === id} onClick={() => save(id, Number(draft[id]))} className="h-10 rounded-full bg-[#17181A] px-4 text-[13px] font-[700] text-white">Save</button>}
          <button type="button" disabled={busy === id} onClick={() => save(id, null)} className="h-10 rounded-full border px-3 text-[13px] font-[600]" style={{ borderColor: line }}>{sw !== null ? 'Use the service’s' : 'Use the usual rate'}</button>
        </div>); })}
      {serviceWide.map((s: any) => (
        <div key={s.id} className="flex flex-wrap items-center gap-2 text-[14px]">
          <span className="min-w-0 flex-1"><b className="font-[700]">{s.name}</b> <span style={muted}>· {pctOf(s.commissionRate)}% for everyone (set on the service)</span></span>
          <button type="button" disabled={busy === s.id} onClick={() => save(s.id, pctOf(s.commissionRate))} className="h-10 rounded-full border px-3 text-[13px] font-[600]" style={{ borderColor: line }}>Give {first} their own</button>
        </div>))}
      {addable.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Choose a service" value={adding} onChange={(e) => setAdding(e.target.value)} className="h-10 min-w-0 flex-1 rounded-xl border bg-white px-3 text-[14px]" style={{ borderColor: line }}>
            <option value="">Set {first}’s rate for a service…</option>
            {addable.map((s: any) => <option key={s.id} value={s.id}>{s.name}{pctOf(s.commissionRate) !== null ? ` (${pctOf(s.commissionRate)}% for everyone)` : ''}</option>)}
          </select>
          <button type="button" disabled={!adding || busy === adding} onClick={() => { const id = adding; setAdding(''); save(id, pctOf(svc(id)?.commissionRate) ?? usual); }} className="h-10 rounded-full border px-4 text-[13px] font-[600]" style={{ borderColor: line }}>Add</button>
        </div>)}
      {err && <p role="alert" className="text-[13px] font-[600] text-[#B42318]">{err}</p>}
    </section>);
}
