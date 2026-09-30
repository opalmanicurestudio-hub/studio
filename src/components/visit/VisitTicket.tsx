'use client';
// src/components/visit/VisitTicket.tsx — THE STAFF VISIT TICKET. One screen for a visit, opened from anywhere
// (a scanned ticket, the desk, the planner, a client's profile, Today's sales). Stage (worded for the business) with the
// next step one tap away · payment status and flags · receipts · handoff notes (staff-only or for the client) · the
// timeline (who / when / how) · signed approvals · the client's visit link. Updates live while it's open.
import * as React from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { useFirebase } from '@/firebase';
import { visitActions } from '@/lib/visit-client';
import { openReceipt } from '@/lib/receipt-client';

async function post(body: any) {
  const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  return fetch('/api/visits', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'We couldn’t reach the server.' }));
}
const money = (n: any) => `$${(Number(n) || 0).toFixed(2)}`;
const when = (iso: any) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const clock = (iso: any) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); };
const TRACK = ['booked', 'arrived', 'in_service', 'ready_to_pay', 'complete'];
const PRIMARY: Record<string, string> = { booked: 'arrived', arrived: 'in_service', in_service: 'ready_to_pay' };

export function VisitTicket({ tenantId, appointmentId, onClose }: { tenantId: string; appointmentId: string; onClose?: () => void }) {
  const { firestore } = useFirebase() as any;
  const [v, setV] = React.useState<any>(null); const [err, setErr] = React.useState<string | null>(null); const [busy, setBusy] = React.useState<string | null>(null);
  const [note, setNote] = React.useState(''); const [forClient, setForClient] = React.useState(false); const [msg, setMsg] = React.useState<string | null>(null);
  const load = React.useCallback(async () => { const r: any = await post({ tenantId, action: 'get', appointmentId }); if (r?.ok) { setV(r.visit); setErr(null); } else setErr(r?.error || 'Couldn’t load this visit.'); }, [tenantId, appointmentId]);
  React.useEffect(() => { load(); }, [load]);
  // Live: whenever the visit changes (someone else moved it on, a payment landed), refresh.
  React.useEffect(() => { if (!firestore || !tenantId || !appointmentId) return; let t: any = null; let first = true;
    const un = onSnapshot(doc(firestore, 'tenants', tenantId, 'appointments', appointmentId), () => { if (first) { first = false; return; } clearTimeout(t); t = setTimeout(load, 350); }, () => {});
    return () => { clearTimeout(t); un(); }; }, [firestore, tenantId, appointmentId, load]);
  const act = React.useMemo(() => visitActions(), [v?.stage]);
  const move = async (to: string) => { setBusy(to); setMsg(null); const r: any = await post({ tenantId, action: 'stage', appointmentId, to, via: 'ticket' }); setBusy(null); if (r?.ok) { setMsg(`Moved to ${r.label || to}.`); load(); } else setMsg(r?.error || 'That didn’t work.'); };
  const addNote = async () => { if (!note.trim()) return; setBusy('note'); const r: any = await post({ tenantId, action: 'note', appointmentId, text: note, forClient }); setBusy(null); if (r?.ok) { setNote(''); setForClient(false); load(); } else setMsg(r?.error || 'The note didn’t save.'); };
  const card = 'space-y-2 rounded-3xl p-4'; const cardStyle = { background: 'var(--card)', border: '1px solid var(--line)' } as React.CSSProperties;
  const soft = { background: 'var(--soft)' } as React.CSSProperties; const muted = { color: 'var(--muted)' } as React.CSSProperties;
  const primaryBtn = 'h-12 w-full rounded-full text-[15px] font-semibold disabled:opacity-40'; const primaryStyle = { background: 'var(--accent)', color: 'var(--accent-ink)' } as React.CSSProperties;
  if (err) return <p className="text-[15px] font-semibold" style={{ color: 'var(--warn)' }}>{err}</p>;
  if (!v) return <p className="text-[15px]" style={muted}>Loading the visit…</p>;
  const first = String(v.clientName || 'Guest').split(' ')[0];
  const primaryTo = PRIMARY[v.stage]; const primaryLabel = (v.next || []).find((n: any) => n.stage === primaryTo)?.label;
  const back = (v.next || []).filter((n: any) => n.stage !== primaryTo);
  const link = v.checkInToken && typeof window !== 'undefined' ? `${window.location.origin}/check-in/${v.checkInToken}` : null;
  const closed = ['complete', 'cancelled', 'no_show', 'declined', 'expired'].includes(v.stage);
  const trackIdx = TRACK.indexOf(v.stage);
  return (
    <div className="space-y-3">
      {/* Who, what, when */}
      <section className={card} style={cardStyle} aria-label="The visit">
        <div className="flex items-start justify-between gap-3">
          <div><p className="text-[20px] font-semibold leading-tight">{v.clientName || 'Guest'}</p>
            <p className="text-[14px]" style={muted}>{v.serviceName || 'Visit'}{v.staffName ? ` · ${String(v.staffName).split(' ')[0]}` : ''}{v.partySize > 1 ? ` · party of ${v.partySize}` : ''}</p>
            <p className="text-[14px]" style={muted}>{when(v.startTime)}{v.shortCode ? ` · ${v.shortCode}` : ''}</p></div>
          <span className="shrink-0 rounded-full px-3 py-1 text-[13px] font-semibold" style={v.paymentStatus === 'paid' ? { background: 'color-mix(in srgb, var(--ok) 14%, transparent)', color: 'var(--ok)' } : v.paymentStatus === 'deposit_due' || v.paymentStatus === 'partly_paid' ? { background: 'color-mix(in srgb, var(--warn) 12%, transparent)', color: 'var(--warn)' } : soft}>{v.paymentLabel}</span>
        </div>
        {(v.flags?.runningLate || v.flags?.depositDue || v.flags?.needsDecision || v.flags?.balanceDue || v.isWalkIn) && <div className="flex flex-wrap gap-1.5 text-[12px] font-semibold">
          {v.isWalkIn && <span className="rounded-full px-2.5 py-1" style={soft}>Walk-in</span>}
          {v.flags?.runningLate && <span className="rounded-full px-2.5 py-1" style={{ background: 'color-mix(in srgb, var(--warn) 12%, transparent)', color: 'var(--warn)' }}>Running late</span>}
          {v.flags?.depositDue && <span className="rounded-full px-2.5 py-1" style={{ background: 'color-mix(in srgb, var(--warn) 12%, transparent)', color: 'var(--warn)' }}>Deposit due</span>}
          {v.flags?.needsDecision && <span className="rounded-full px-2.5 py-1" style={soft}>Needs a decision</span>}
          {v.flags?.balanceDue && <span className="rounded-full px-2.5 py-1" style={soft}>Balance due</span>}
        </div>}
        {v.notes && <p className="rounded-2xl p-3 text-[14px]" style={soft}>{v.notes}</p>}
      </section>
      {/* Stage + the next step */}
      <section className={card} style={cardStyle} aria-label="Where the visit is">
        {closed && v.stage !== 'complete' ? <p className="text-[16px] font-semibold">{v.stageLabel}</p> : <ol className="grid grid-cols-5 gap-1" aria-label={`Stage: ${v.stageLabel}`}>
          {TRACK.map((s, i) => <li key={s} className="space-y-1 text-center"><span className="block h-1.5 rounded-full" style={{ background: i <= trackIdx ? 'var(--accent)' : 'var(--line)' }} />
            <span className="block text-[11px] leading-tight" style={i === trackIdx ? { fontWeight: 700 } : muted}>{i === trackIdx ? v.stageLabel : ''}</span></li>)}
        </ol>}
        {primaryTo && primaryLabel && <button type="button" disabled={!!busy} onClick={() => move(primaryTo)} className={primaryBtn} style={primaryStyle}>{busy === primaryTo ? 'Moving…' : primaryTo === 'arrived' ? `Check ${first} in` : primaryLabel === 'Ready to pay' ? 'Finished — ready to pay' : `Start — ${primaryLabel}`}</button>}
        {v.stage === 'ready_to_pay' && <button type="button" onClick={() => (act.checkout ? act.checkout(v.id) : (window.location.href = `/pos?checkout=${encodeURIComponent(v.id)}`))} className={primaryBtn} style={primaryStyle}>Take payment</button>}
        {!!back.length && <div className="flex flex-wrap gap-1.5">{back.map((n: any) => <button key={n.stage} type="button" disabled={!!busy} onClick={() => move(n.stage)} className="h-9 rounded-full px-3 text-[13px]" style={soft}>Back to {n.label}</button>)}</div>}
        {!closed && act.cancel && <button type="button" onClick={() => { act.cancel!(v.id); onClose?.(); }} className="text-[13px] underline underline-offset-4" style={{ color: 'var(--warn)' }}>Cancel or no-show</button>}
        {msg && <p className="text-[13px] font-semibold" role="status">{msg}</p>}
      </section>
      {/* Paid: receipts + book next */}
      {(v.receipts || []).length > 0 && <section className={card} style={cardStyle} aria-label="Payments">
        <p className="text-[15px] font-semibold">Payments</p>
        {v.receipts.map((r: any) => <div key={r.id} className="flex items-center justify-between gap-2 text-[14px]"><span>{money(r.total)} · {r.payments?.length ? `split · ${r.payments.length} payments` : String(r.paymentMethod || '').replace(/_/g, ' ')}{r.voided ? ' · voided' : ''}</span>
          <button type="button" onClick={() => openReceipt(tenantId, r.id)} className="text-[13px] font-semibold underline underline-offset-4">{r.voided ? 'Void slip' : 'Receipt'}</button></div>)}
        {v.stage === 'complete' && act.bookNext && <button type="button" onClick={() => act.bookNext!(v.id, v.clientId, v.serviceId)} className="h-10 w-full rounded-full text-[14px] font-semibold" style={soft}>Book {first}’s next visit</button>}
      </section>}
      {/* Handoff notes */}
      <section className={card} style={cardStyle} aria-label="Add a note">
        <p className="text-[15px] font-semibold">Handoff note</p>
        <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} rows={2} placeholder={forClient ? `A note ${first} will see on their visit link` : 'For the team — e.g. “prefers a softer file”'} aria-label="Note" className="w-full resize-none rounded-2xl p-3 text-[15px] outline-none" style={soft} />
        <div className="flex items-center justify-between gap-2"><label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={forClient} onChange={(e) => setForClient(e.target.checked)} /> Show to {first}</label>
          <button type="button" disabled={busy === 'note' || !note.trim()} onClick={addNote} className="h-9 rounded-full px-4 text-[13px] font-semibold disabled:opacity-40" style={primaryStyle}>{busy === 'note' ? 'Saving…' : 'Add note'}</button></div>
      </section>
      {/* The timeline */}
      <section className={card} style={cardStyle} aria-label="Timeline">
        <p className="text-[15px] font-semibold">Timeline</p>
        {!(v.timeline || []).length ? <p className="text-[14px]" style={muted}>Nothing yet — moves, notes and payments appear here.</p>
          : <ol className="space-y-2">{[...v.timeline].reverse().map((e: any, i: number) => <li key={`${e.at}-${i}`} className="flex gap-3 text-[14px]">
              <span className="w-16 shrink-0 tabular-nums" style={muted}>{clock(e.at)}</span>
              <span className="flex-1"><span style={e.kind === 'note' ? { fontStyle: 'italic' } : undefined}>{e.text}</span>{e.forClient ? <span className="ml-1 text-[12px]" style={muted}>· shown to client</span> : null}
                {(e.by || e.via) && <span className="block text-[12px]" style={muted}>{[e.by, e.via && e.via !== 'desk' ? e.via : null].filter(Boolean).join(' · ')}</span>}</span></li>)}</ol>}
      </section>
      {/* Signed approvals */}
      {(v.consents || []).length > 0 && <section className={card} style={cardStyle} aria-label="Signed">
        <p className="text-[15px] font-semibold">Signed</p>
        {v.consents.map((c: any) => <p key={c.id} className="text-[14px]">{c.kind === 'membership_terms' ? (c.title || 'Membership terms') : c.kind === 'card_on_file_charge' ? `Card charge approved${c.amount ? ` · ${money(c.amount)}` : ''}` : c.title || 'Signed'} <span style={muted}>· {when(c.signedAt)}</span></p>)}
      </section>}
      {/* The client's link + more */}
      <section className={card} style={cardStyle} aria-label="More">
        {link && <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => { navigator.clipboard?.writeText(link).then(() => setMsg('Visit link copied.')).catch(() => setMsg(link)); }} className="h-9 rounded-full px-3 text-[13px]" style={soft}>Copy {first}’s visit link</button>
          {v.clientPhone && <a href={`sms:${String(v.clientPhone).replace(/[^\d+]/g, '')}?&body=${encodeURIComponent(link)}`} className="inline-flex h-9 items-center rounded-full px-3 text-[13px]" style={soft}>Text it to {first}</a>}
        </div>}
        {act.details && <button type="button" onClick={() => { act.details!(v.id); onClose?.(); }} className="text-[13px] underline underline-offset-4">Booking details</button>}
      </section>
    </div>
  );
}
