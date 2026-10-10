'use client';
// src/components/planner/AssistPicker.tsx — "ASSISTED BY" on a visit: someone else helped with the service (a blow-dry,
// a removal, prep), and gets a share of its credit — the provider keeps the rest (lib/commission → splitShare). Saved on
// the visit as `assist: { staffId, pct }` and carried onto the sale at checkout. The share starts at the business's
// usual one (Settings → Commission rules) and can be changed per visit.
import * as React from 'react';
import { doc, updateDoc, deleteField } from 'firebase/firestore';
import { useFirebase } from '@/firebase';

export function AssistPicker({ tenantId, appointment, staff = [], defaultPct = 20 }: { tenantId: string; appointment: any; staff?: any[]; defaultPct?: number }) {
  const { firestore } = useFirebase();
  const cur = appointment?.assist || null;
  const [open, setOpen] = React.useState(false); const [who, setWho] = React.useState<string>(cur?.staffId || ''); const [pct, setPct] = React.useState<string>(String(cur?.pct ?? defaultPct));
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  if (!appointment?.id || ['cancelled', 'declined', 'no_show'].includes(String(appointment.status))) return null;
  const done = String(appointment.status) === 'completed' && appointment.checkoutSessionId;
  const team = staff.filter((s: any) => s?.id && s.id !== appointment.staffId && s.isRenter !== true && s.role !== 'renter' && s.archived !== true);
  const name = (id: string) => String(staff.find((s: any) => s.id === id)?.name || 'Someone').split(' ')[0];
  // Only someone earning commission takes a share; an hourly-only assistant is already paid for the time.
  const shares = (id: string) => ['commission', 'hourly_plus_commission'].includes(String(staff.find((s: any) => s.id === id)?.payStructure || ''));
  const save = async (clear = false) => {
    if (!firestore) return; setErr('');
    const p = Math.round(Number(pct));
    if (!clear && !who) { setErr('Choose who helped.'); return; }
    if (!clear && shares(who) && !(p > 0 && p < 100)) { setErr('Choose a share between 1 and 99%.'); return; }
    setBusy(true);
    try { await updateDoc(doc(firestore, 'tenants', tenantId, 'appointments', appointment.id), { assist: clear ? deleteField() : { staffId: who, pct: shares(who) ? p : 0 } }); setOpen(false); }
    catch { setErr('Couldn’t save — try again.'); }
    setBusy(false);
  };
  const line = 'var(--line, #e7e2dc)';
  if (!open) return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border px-4 py-3 text-[14px]" style={{ borderColor: line }}>
      <span>{cur?.staffId ? <><b className="font-[700]">Assisted by {name(cur.staffId)}</b> · {shares(cur.staffId) ? `${cur.pct}% of the service’s commission` : 'paid by the hour — the provider keeps the full commission'}</> : <span className="text-muted-foreground">Did someone help with this service?</span>}</span>
      {!done && <button type="button" onClick={() => setOpen(true)} className="h-9 rounded-full border px-3 text-[13px] font-[600]" style={{ borderColor: line }}>{cur?.staffId ? 'Change' : 'Add an assistant'}</button>}
    </div>);
  return (
    <div className="space-y-2 rounded-2xl border p-4 text-[14px]" style={{ borderColor: line }}>
      <p className="font-[700]">Assisted by</p>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Who helped" value={who} onChange={(e) => setWho(e.target.value)} className="h-10 min-w-0 flex-1 rounded-xl border bg-white px-3" style={{ borderColor: line }}>
          <option value="">Choose…</option>{team.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {(!who || shares(who)) && <><input aria-label="Their share" inputMode="numeric" value={pct} onChange={(e) => setPct(e.target.value.replace(/[^\d]/g, '').slice(0, 2))} className="h-10 w-16 rounded-xl border px-3 text-right" style={{ borderColor: line }} /><span>%</span></>}
      </div>
      <p className="text-[12px] text-muted-foreground">{who && !shares(who) ? `${name(who)} is paid by the hour, so they’re already paid for this time — the provider keeps the full commission. It’s still noted that they helped.` : 'Their share of the service’s commission; the provider keeps the rest. Their hourly pay (if any) carries on as usual.'}</p>
      {err && <p role="alert" className="text-[13px] font-[600] text-[#B42318]">{err}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => save(false)} className="h-10 rounded-full bg-[#17181A] px-4 text-[13px] font-[700] text-white">Save</button>
        {cur?.staffId && <button type="button" disabled={busy} onClick={() => save(true)} className="h-10 rounded-full border px-4 text-[13px] font-[600]" style={{ borderColor: line }}>No assistant</button>}
        <button type="button" onClick={() => setOpen(false)} className="h-10 rounded-full px-4 text-[13px] font-[600]">Cancel</button>
      </div>
    </div>);
}
