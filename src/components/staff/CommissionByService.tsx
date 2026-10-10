'use client';
// src/components/staff/CommissionByService.tsx — PAY BY SERVICE for one person, on their details sheet (managers).
//   • On commission (or hourly + commission): the rate they earn on each service that differs from their usual rate —
//     their own rate first, then a rate the service sets for everyone.
//   • Paid per service: the amount each service pays them — their own amount first, then the service's amount, else
//     their rate per hour of service × the service's length.
// A manager can give them their own rate / amount for any service. Sales are stamped at checkout, so a change here
// applies to new sales, never to past pay.
import * as React from 'react';
import { getAuth } from 'firebase/auth';
import { doc, updateDoc, deleteField } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { logAuditClient } from '@/lib/audit-client';
import { earnsCommission, usualRate, paidPerService, payForService } from '@/lib/commission';

const numOf = (v: any, max: number): number | null => { if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= max ? n : null; };

export function CommissionByService({ tenantId, staffMember, services = [] }: { tenantId: string; staffMember: any; services?: any[] }) {
  const { firestore } = useFirebase();
  const perService = paidPerService(staffMember);
  const field = perService ? 'servicePay' : 'serviceCommission';
  const [own, setOwn] = React.useState<Record<string, number>>(() => ({ ...(staffMember?.[field] || {}) }));
  const [draft, setDraft] = React.useState<Record<string, string>>({});
  const [adding, setAdding] = React.useState(''); const [busy, setBusy] = React.useState<string | null>(null); const [err, setErr] = React.useState('');
  React.useEffect(() => { setOwn({ ...(staffMember?.[field] || {}) }); }, [staffMember?.[field], field]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!staffMember?.id || !(earnsCommission(staffMember) || perService)) return null;

  const first = String(staffMember.name || 'This person').split(' ')[0];
  const max = perService ? 100000 : 100;
  const usual = usualRate(staffMember, 0); const hourRate = Number(staffMember.serviceHourRate) || 0;
  const svc = (id: string) => services.find((s: any) => s.id === id);
  const wideOf = (s: any) => numOf(perService ? s?.providerPay : s?.commissionRate, max);
  const show = (v: number) => (perService ? `$${v.toFixed(2)}` : `${v}%`);
  const save = async (serviceId: string, value: number | null) => {
    if (!firestore) return; setErr('');
    if (value != null && (!Number.isFinite(value) || value < 0 || value > max)) { setErr(perService ? 'Use an amount of $0 or more.' : 'Use a rate between 0 and 100%.'); return; }
    setBusy(serviceId);
    try {
      const v = value == null ? null : perService ? Math.round(value * 100) / 100 : Math.round(value * 10) / 10;
      await updateDoc(doc(firestore, 'tenants', tenantId, 'staff', staffMember.id), { [`${field}.${serviceId}`]: v == null ? deleteField() : v });
      setOwn((o) => { const n = { ...o }; if (v == null) delete n[serviceId]; else n[serviceId] = v; return n; });
      setDraft((x) => { const n = { ...x }; delete n[serviceId]; return n; });
      const name = String(svc(serviceId)?.name || 'a service');
      void logAuditClient(firestore, tenantId, { action: perService ? 'staff.service_pay' : 'staff.service_commission', targetType: 'staff', targetId: staffMember.id, actor: { type: 'user', id: getAuth().currentUser?.uid },
        summary: v == null ? `${first} is paid the usual way for ${name} again` : `${first} now earns ${show(v)} on ${name}` } as any);
    } catch { setErr('Couldn’t save — check your connection and try again.'); }
    setBusy(null);
  };

  const ownIds = Object.keys(own).filter((id) => numOf(own[id], max) !== null);
  const serviceWide = services.filter((s: any) => s?.id && !ownIds.includes(s.id) && wideOf(s) !== null && (perService || wideOf(s) !== usual));
  const addable = services.filter((s: any) => s?.id && !ownIds.includes(s.id));
  const line = 'var(--line, #e7e2dc)'; const muted = { color: 'var(--muted, #78716c)' };
  const title = perService ? 'Pay by service' : 'Commission by service';
  const intro = perService
    ? `${first} is paid $${hourRate.toFixed(2)} for each hour of service — so a 60-minute service pays $${hourRate.toFixed(2)} — unless a service below says otherwise. The same for members’ visits. Changes apply to new sales.`
    : `${first} earns ${usual}% on services unless a service below says otherwise. Members’ visits count at the service’s normal price. Changes apply to new sales.`;

  return (
    <section className="space-y-3 rounded-2xl border p-4" style={{ borderColor: line }} aria-label={title}>
      <div><p className="text-[15px] font-semibold">{title}</p><p className="text-[13px]" style={muted}>{intro}</p></div>
      {ownIds.length === 0 && serviceWide.length === 0 && <p className="text-[13px]" style={muted}>{perService ? `Every service pays ${first} by the hour.` : `Every service pays ${first}’s usual rate.`}</p>}
      {ownIds.map((id) => { const v = draft[id] ?? String(own[id]); const sw = wideOf(svc(id));
        return (
        <div key={id} className="flex flex-wrap items-center gap-2 text-[14px]">
          <span className="min-w-0 basis-full sm:basis-auto sm:flex-1"><b className="font-[700]">{svc(id)?.name || 'A removed service'}</b> <span style={muted}>· {first}’s own {perService ? 'amount' : 'rate'}{sw !== null ? ` (service is ${show(sw)})` : ''}</span></span>
          {perService && <span>$</span>}
          <input aria-label={`${svc(id)?.name || 'Service'} ${perService ? 'pay' : 'commission'} for ${first}`} inputMode="decimal" value={v} onChange={(e) => setDraft((x) => ({ ...x, [id]: e.target.value.replace(/[^\d.]/g, '').slice(0, 8) }))}
            className="h-10 w-24 rounded-xl border px-3 text-right tabular-nums" style={{ borderColor: line }} />
          {!perService && <span>%</span>}
          {draft[id] != null && draft[id] !== String(own[id]) && <button type="button" disabled={busy === id} onClick={() => save(id, Number(draft[id]))} className="h-10 rounded-full bg-[#17181A] px-4 text-[13px] font-[700] text-white">Save</button>}
          <button type="button" disabled={busy === id} onClick={() => save(id, null)} className="h-10 rounded-full border px-3 text-[13px] font-[600]" style={{ borderColor: line }}>{sw !== null ? 'Use the service’s' : perService ? 'Pay by the hour' : 'Use the usual rate'}</button>
        </div>); })}
      {serviceWide.map((s: any) => (
        <div key={s.id} className="flex flex-wrap items-center gap-2 text-[14px]">
          <span className="min-w-0 basis-full sm:basis-auto sm:flex-1"><b className="font-[700]">{s.name}</b> <span style={muted}>· {show(wideOf(s)!)} for everyone (set on the service)</span></span>
          <button type="button" disabled={busy === s.id} onClick={() => save(s.id, wideOf(s))} className="h-10 rounded-full border px-3 text-[13px] font-[600]" style={{ borderColor: line }}>Give {first} their own</button>
        </div>))}
      {addable.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Choose a service" value={adding} onChange={(e) => setAdding(e.target.value)} className="h-10 min-w-0 flex-1 rounded-xl border bg-white px-3 text-[14px]" style={{ borderColor: line }}>
            <option value="">Set {first}’s {perService ? 'amount' : 'rate'} for a service…</option>
            {addable.map((s: any) => <option key={s.id} value={s.id}>{s.name}{wideOf(s) !== null ? ` (${show(wideOf(s)!)} for everyone)` : perService ? ` (${show(payForService(staffMember, s))} by the hour)` : ''}</option>)}
          </select>
          <button type="button" disabled={!adding || busy === adding} onClick={() => { const id = adding; setAdding(''); save(id, wideOf(svc(id)) ?? (perService ? payForService(staffMember, svc(id)) : usual)); }} className="h-10 rounded-full border px-4 text-[13px] font-[600]" style={{ borderColor: line }}>Add</button>
        </div>)}
      {!perService && <TierEditor tenantId={tenantId} staffMember={staffMember} usual={usual} first={first} />}
      {err && <p role="alert" className="text-[13px] font-[600] text-[#B42318]">{err}</p>}
    </section>);
}

/** Sales tiers: a higher rate on the part of a pay period's services above a level (e.g. 45% over $3,000). */
function TierEditor({ tenantId, staffMember, usual, first }: { tenantId: string; staffMember: any; usual: number; first: string }) {
  const { firestore } = useFirebase();
  const [rows, setRows] = React.useState<{ over: string; rate: string }[]>(() => (Array.isArray(staffMember?.commissionTiers) ? staffMember.commissionTiers : []).map((t: any) => ({ over: String(t.over ?? ''), rate: String(t.rate ?? '') })));
  const [saved, setSaved] = React.useState(''); const line = 'var(--line, #e7e2dc)'; const muted = { color: 'var(--muted, #78716c)' };
  const save = async () => {
    if (!firestore) return;
    const tiers = rows.map((r) => ({ over: Math.round(Number(r.over) || 0), rate: Math.round((Number(r.rate) || 0) * 10) / 10 })).filter((r) => r.over > 0 && r.rate > 0 && r.rate <= 100).sort((a, b) => a.over - b.over);
    try { await updateDoc(doc(firestore, 'tenants', tenantId, 'staff', staffMember.id), { commissionTiers: tiers });
      void logAuditClient(firestore, tenantId, { action: 'staff.commission_tiers', targetType: 'staff', targetId: staffMember.id, actor: { type: 'user', id: getAuth().currentUser?.uid }, summary: tiers.length ? `${first}'s sales tiers: ${tiers.map((t) => `${t.rate}% over $${t.over}`).join(', ')}` : `${first}'s sales tiers removed` } as any);
      setSaved('Saved'); setTimeout(() => setSaved(''), 2000); } catch { setSaved('Couldn’t save'); }
  };
  return (
    <div className="space-y-2 border-t pt-3" style={{ borderColor: line }}>
      <p className="text-[14px] font-[700]">Sales tiers</p>
      <p className="text-[12px]" style={muted}>A higher rate on the part of each pay period’s services above a level. Services with their own rate aren’t counted.</p>
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 text-[14px]">
          <span>Over $</span><input inputMode="numeric" value={r.over} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, over: e.target.value.replace(/[^\d]/g, '') } : y)))} aria-label="Sales level" className="h-10 w-24 rounded-xl border px-3 text-right" style={{ borderColor: line }} />
          <span>earns</span><input inputMode="decimal" value={r.rate} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, rate: e.target.value.replace(/[^\d.]/g, '') } : y)))} aria-label="Rate" className="h-10 w-16 rounded-xl border px-3 text-right" style={{ borderColor: line }} /><span>%</span>
          <button type="button" onClick={() => setRows((x) => x.filter((_, j) => j !== i))} className="h-9 rounded-full border px-3 text-[13px]" style={{ borderColor: line }}>Remove</button>
        </div>))}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setRows((x) => [...x, { over: x.length ? String((Number(x[x.length - 1].over) || 0) + 2000) : '3000', rate: String(Math.min(100, (x.length ? Number(x[x.length - 1].rate) || usual : usual) + 5)) }])} className="h-10 rounded-full border px-4 text-[13px] font-[600]" style={{ borderColor: line }}>Add a tier</button>
        <button type="button" onClick={save} className="h-10 rounded-full bg-[#17181A] px-4 text-[13px] font-[700] text-white">Save tiers</button>
        {saved && <span className="self-center text-[13px]" style={muted}>{saved}</span>}
      </div>
    </div>);
}
