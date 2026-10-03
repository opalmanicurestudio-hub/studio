'use client';
// src/components/settings/CancellationReview.tsx — CANCELLATIONS TO REVIEW (Settings → Fees & credit).
// Older cancellations that were set aside rather than charged out of the blue. Shows only when there are some.
import * as React from 'react';
import { collection, query, where, onSnapshot, type Firestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
const when = (iso: string, tz?: string) => { try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) }); } catch { return ''; } };

export function CancellationReview({ firestore, tenantId, timezone, canDecide }: { firestore: Firestore | null; tenantId: string; timezone?: string; canDecide: boolean }) {
  const [list, setList] = React.useState<any[]>([]); const [busy, setBusy] = React.useState(''); const [msg, setMsg] = React.useState('');
  React.useEffect(() => { if (!firestore || !tenantId) return;
    return onSnapshot(query(collection(firestore, 'tenants', tenantId, 'cancellationEvents'), where('status', '==', 'needs_review')),
      (s) => setList(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })).sort((a, b) => String(b.appointmentStartTime || '').localeCompare(String(a.appointmentStartTime || '')))), () => setList([])); }, [firestore, tenantId]);
  if (!list.length) return null;
  const act = async (ev: any, action: 'charge' | 'balance' | 'waive') => {
    if (action === 'charge' && !window.confirm(`Charge ${ev.clientName || 'this client'} ${money(ev.feeAmount)} now? They’ll be told by text or email.`)) return;
    setBusy(ev.id); setMsg('');
    try { const tk = await getAuth().currentUser?.getIdToken();
      const r = await fetch('/api/cancellations/review', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ tenantId, eventId: ev.id, action }) }).then((x) => x.json());
      setMsg(!r.ok ? r.error || 'That didn’t work.' : r.result === 'charged' ? `${money(ev.feeAmount)} charged — ${ev.clientName || 'they'} have been told.` : r.result === 'declined' ? 'Their card was declined — the fee is on their balance now.' : r.result === 'balance' ? 'Added to their balance — collect it in person; it won’t be charged automatically.' : 'Waived.');
    } catch { setMsg('That didn’t work — check your connection.'); } finally { setBusy(''); }
  };
  return (
    <section className="space-y-3" aria-label="Cancellations to review">
      <div className="space-y-1"><h2 className="text-[19px] font-semibold tracking-tight">Cancellations to review ({list.length})</h2>
        <p className="text-[14.5px] cf-muted">Late cancellations and no-shows from before fees were charged automatically. Nothing has been charged and nobody has been messaged — you decide each one.</p></div>
      <div className="cf-sheet">{list.map((ev) => { const card = ev.paymentMethod === 'card_on_file' && ev.stripeCustomerId && ev.stripePaymentMethodId; const fee = Number(ev.feeAmount) || 0; return (
        <div key={ev.id} className="space-y-2.5 px-5 py-4 [&+&]:border-t" style={{ borderColor: 'var(--line)' }}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[15px] font-medium">{ev.clientName || 'Client'} <span className="font-normal cf-muted">· {ev.cancellationAudit?.actorType === 'no_show' ? 'No-show' : 'Late cancel'} · {ev.serviceName || 'Appointment'}</span></p>
            <p className="text-[15px] font-semibold">{fee > 0 ? money(fee) : 'No fee'}</p>
          </div>
          <p className="text-[13.5px] cf-muted">{when(ev.appointmentStartTime, timezone)}{card ? ' · card on file' : ' · no card on file'}</p>
          {canDecide ? (
            <div className="flex flex-wrap gap-2">
              {card && fee > 0 && <button type="button" disabled={!!busy} onClick={() => void act(ev, 'charge')} className="h-10 rounded-full px-4 text-[14px] font-semibold disabled:opacity-50" style={{ background: 'var(--accent)', color: 'hsl(var(--primary-foreground))' }}>Charge {money(fee)}</button>}
              {fee > 0 && <button type="button" disabled={!!busy} onClick={() => void act(ev, 'balance')} className="h-10 rounded-full px-4 text-[14px] font-medium disabled:opacity-50" style={{ background: 'var(--soft)' }}>Add to their balance (collect in person)</button>}
              <button type="button" disabled={!!busy} onClick={() => void act(ev, 'waive')} className="h-10 rounded-full px-4 text-[14px] font-medium disabled:opacity-50" style={{ background: 'var(--soft)' }}>Waive it</button>
            </div>) : <p className="text-[13px] cf-muted">An owner or manager decides these.</p>}
        </div>); })}</div>
      {msg && <p role="status" className="text-[14px] font-medium">{msg}</p>}
    </section>
  );
}
