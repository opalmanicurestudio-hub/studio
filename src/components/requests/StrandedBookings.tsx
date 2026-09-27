'use client';
// src/components/requests/StrandedBookings.tsx — on the Requests page:
// online bookings that never became appointments (the pre-5a deposit-path
// bug), with Accept (books it, with a clash check) / Decline (tells the
// client kindly). Also deposits paid after a hold ran out.
import { useCallback, useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { deviceId } from '@/lib/device';

async function call(method: 'GET' | 'POST', tenantId: string, body?: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch(`/api/appointments/recover-request${method === 'GET' ? `?tenantId=${encodeURIComponent(tenantId)}` : ''}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}`, 'x-cf-device': deviceId() }, ...(body ? { body: JSON.stringify({ tenantId, ...body }) } : {}) });
  return r.json().catch(() => ({ ok: false, error: 'No response' }));
}
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'time not recorded');

export function StrandedBookings({ tenantId }: { tenantId: string }) {
  const [d, setD] = useState<any>(null); const [busy, setBusy] = useState(''); const [msg, setMsg] = useState<Record<string, string>>({});
  const load = useCallback(async () => { if (tenantId) setD(await call('GET', tenantId)); }, [tenantId]);
  useEffect(() => { void load(); }, [load]);
  if (!d?.ok || (!d.stranded.length && !d.paidLate.length)) return null;
  const act = async (id: string, decision: 'accept' | 'decline') => {
    let reason = '';
    if (decision === 'decline') { const r = window.prompt('Decline this booking? The client will be told kindly, with a link to book again. Add a short note (optional):'); if (r === null) return; reason = r; }
    setBusy(`${id}-${decision}`);
    const r = await call('POST', tenantId, { requestId: id, decision, reason });
    setBusy(''); setMsg((m) => ({ ...m, [id]: r.ok ? (decision === 'accept' ? '✓ Booked — it’s on the planner and the client has been told.' : '✓ Declined — the client has been told.') : (r.error || 'Couldn’t do that — try again.') }));
    if (r.ok) setTimeout(() => void load(), 1200);
  };
  return (
    <section className="space-y-2 rounded-2xl border-2 border-amber-300 bg-amber-50/70 p-4" aria-label="Online bookings that never reached you">
      {d.stranded.length > 0 && <>
        <p className="font-black">Found: {d.stranded.length} online booking{d.stranded.length === 1 ? '' : 's'} that never reached you</p>
        <p className="text-[13px] text-muted-foreground">These were made on your booking page but got stuck waiting for a payment the client wasn’t asked to make, so they never appeared as requests. Accept to book them (it checks the time is still free), or decline to let the client know.</p>
        {d.stranded.map((x: any) => (
          <div key={x.id} className="space-y-1.5 rounded-xl bg-background p-3 text-sm">
            <p><b>{x.clientName}</b> · {x.serviceName} · <b>{when(x.startTime)}</b></p>
            <p className="text-[12px] text-muted-foreground">{[x.clientEmail, x.clientPhone].filter(Boolean).join(' · ')}{x.createdAt ? ` · asked ${when(x.createdAt)}` : ''}{x.notes ? ` · “${x.notes}”` : ''}</p>
            {msg[x.id] ? <p className="text-[13px] font-bold" role="status">{msg[x.id]}</p> : (
              <div className="flex gap-2">
                <button type="button" disabled={!!busy} onClick={() => void act(x.id, 'accept')} className="h-9 rounded-lg bg-foreground px-4 text-[13px] font-bold text-background disabled:opacity-40">{busy === `${x.id}-accept` ? 'Booking…' : 'Accept & book'}</button>
                <button type="button" disabled={!!busy} onClick={() => void act(x.id, 'decline')} className="h-9 rounded-lg border-2 px-4 text-[13px] font-bold disabled:opacity-40">Decline</button>
              </div>
            )}
          </div>
        ))}
      </>}
      {d.paidLate.length > 0 && <>
        <p className="pt-1 font-black">Deposits paid after a hold ran out</p>
        {d.paidLate.map((x: any) => <p key={x.id} className="rounded-xl bg-background p-3 text-sm"><b>{x.clientName}</b> · {x.serviceName} · {when(x.startTime)} · ${((Number(x.depositAmountCents) || 0) / 100).toFixed(2)} paid — open the appointment to re-confirm it or refund.</p>)}
      </>}
    </section>
  );
}
