'use client';
// src/components/ops/OverrunPanel.tsx — A SERVICE IS RUNNING OVER (the timer).
// Shows how far over, asks how much longer, lists exactly which later guests
// are affected (and their new estimated start), previews the message, and
// sends it — through the provider-late flow, so guests choose keep /
// reschedule / cancel with no fee (and get the thank-you credit if set).
// Who may send it follows Booking policies ("Running-over messages").
import React, { useMemo, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { overrunImpact, canSendOverrun, overrunMode } from '@/lib/appointment-ops';

const hm = (d: any) => { const x = d instanceof Date ? d : new Date(d); return isNaN(x.getTime()) ? '' : x.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); };

export function OverrunPanel({ tenant, tenantId, role, inService, today, overMin, plannedEnd, providerName }: { tenant: any; tenantId: string; role: string; inService: any; today: any[]; overMin: number; plannedEnd: Date | null; providerName?: string | null }) {
  const [extra, setExtra] = useState(10); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  const impact = useMemo(() => overrunImpact(today, inService, extra), [today, inService, extra]);
  const can = canSendOverrun(tenant, role);
  const pFirst = String(providerName || 'Your provider').split(' ')[0];
  const credit = Number(tenant?.bookingPolicies?.providerDelayCredit) || 0;
  const sample = impact[0];
  const preview = sample ? `Hi ${String(sample.appt.clientName || '').split(' ')[0] || 'there'} — ${pFirst} is running about ${sample.delayMin} minutes behind today, so your appointment would start around ${hm(sample.newStart)}. Choose what works for you: keep it, reschedule, or cancel with no fee.${credit > 0 ? ` If you’re happy to wait, we’ll add $${credit.toFixed(2)} credit to your account as a thank-you.` : ''}` : null;
  const send = async () => {
    setBusy(true); setMsg(null);
    const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
    const r = await fetch('/api/appointments/provider-late', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
      body: JSON.stringify({ tenantId, staffId: inService.staffId, minutes: extra, reason: 'overrun', inServiceId: inService.id }) }).then((x) => x.json()).catch(() => ({}));
    setBusy(false);
    setMsg(!r?.ok ? r?.error || 'That didn’t send.' : r.already ? 'Already sent — the next guests were told a few minutes ago.' : r.affected?.length ? `Told ${r.affected.length} guest${r.affected.length === 1 ? '' : 's'} — they’ll choose keep, reschedule or cancel.` : 'Nobody needed telling.');
  };
  return (
    <section className="space-y-3 rounded-3xl border p-4" aria-label="Running over">
      <p className="font-semibold">{inService.clientName ? `${String(inService.clientName).split(' ')[0]}’s` : 'This'} {inService.serviceName || 'service'} is running {overMin} min over{plannedEnd ? ` (planned to finish ${hm(plannedEnd)})` : ''}</p>
      {inService.overrunNotifiedAt && <p className="text-sm">The next guests were told at {hm(inService.overrunNotifiedAt)}.</p>}
      <div className="flex flex-wrap items-center gap-2 text-sm"><span>About how much longer?</span>
        {[5, 10, 15, 20, 30].map((m) => <button key={m} type="button" aria-pressed={extra === m} onClick={() => setExtra(m)} className={`rounded-full border px-3 py-1.5 ${extra === m ? 'bg-primary text-primary-foreground' : ''}`}>{m} min</button>)}</div>
      {impact.length === 0 ? <p className="text-sm">Nobody after them is affected — there’s room in the schedule.</p> : <>
        <ul className="space-y-1 text-sm">{impact.map((x) => <li key={x.appt.id}><b>{String(x.appt.clientName || 'Guest').split(' ')[0]}</b> · booked {hm(x.appt.startTime)} → about {hm(x.newStart)} (+{x.delayMin} min)</li>)}</ul>
        {preview && <p className="rounded-2xl bg-secondary p-3 text-sm"><b>They’ll get:</b> {preview}</p>}
        {can ? <button type="button" disabled={busy} onClick={send} className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">{busy ? 'Sending…' : `Tell ${impact.length} guest${impact.length === 1 ? '' : 's'}`}</button>
          : <p className="text-sm text-muted-foreground">Prepared — a manager sends running-over messages here.</p>}
        {overrunMode(tenant) === 'auto' && <p className="text-xs text-muted-foreground">Automatic mode is on — this is sent for you once a service is 10+ minutes over.</p>}
      </>}
      {msg && <p className="text-sm font-semibold">{msg}</p>}
    </section>
  );
}
