'use client';
// src/components/ops/OpsBoard.tsx — APPOINTMENT OPERATIONS (lives in the POS).
//
// One place to see today's appointments that need attention — running late,
// ETA overdue, en route, arrived after a reschedule offer, payment required,
// provider running late, rescheduling offered — and decide. Every decision
// updates the same appointment record the planner, POS, staff portal and the
// client's visit link read, and the client is told. Who can decide follows
// Booking policies → "Who can decide". Live (Firestore listeners).

import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';
import { collection, query, where } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { opsStatus, fitCheck, opsCan, opsLevelOf, paymentOutstanding, serviceOverrun, overrunImpact, type OpsView } from '@/lib/appointment-ops';
import { OverrunPanel } from '@/components/ops/OverrunPanel';
import { disruptionTotals } from '@/lib/disruptions';
import { resolvePolicy } from '@/lib/booking-policies';

const hm = (v: any) => { if (!v) return ''; const d = new Date(v); return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); };
const ago = (v: any) => { const t = Date.parse(v || ''); if (!Number.isFinite(t)) return ''; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
async function staffPost(url: string, body: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) });
  return r.json().catch(() => ({}));
}
const TONE: Record<OpsView['tone'], string> = { alert: 'bg-red-50 text-red-800 border-red-200', warn: 'bg-amber-50 text-amber-900 border-amber-200', info: 'bg-sky-50 text-sky-900 border-sky-200', ok: 'bg-emerald-50 text-emerald-900 border-emerald-200', muted: 'bg-secondary text-muted-foreground border-transparent' };

/** The decision log for one appointment (who did what, when). */
function DecisionLog({ tenantId, id }: { tenantId: string; id: string }) {
  const { firestore } = useFirebase() as any;
  const q = useMemoFirebase(() => (firestore ? query(collection(firestore, `tenants/${tenantId}/auditLogs`), where('targetId', '==', id)) : null), [firestore, tenantId, id]);
  const { data } = useCollection<any>(q);
  const rows = (data || []).slice().sort((a: any, b: any) => String(b.at || '').localeCompare(String(a.at || ''))).slice(0, 5);
  if (!rows.length) return <p className="text-xs text-muted-foreground">No decisions yet.</p>;
  return <ul className="space-y-1">{rows.map((r: any) => <li key={r.id || r.at} className="text-xs"><span className="text-muted-foreground">{hm(r.at)} · {r.actor?.name || 'System'}:</span> {r.summary}</li>)}</ul>;
}

function CaseCard({ a, ops, tenant, tenantId, staffById, next, role, uid, freeOthers }: { a: any; ops: OpsView; tenant: any; tenantId: string; staffById: Map<string, any>; next: any | null; role: string; uid?: string; freeOthers: { staff: any; startAt: string }[] }) {
  const [busy, setBusy] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null); const [tell, setTell] = useState(true);
  const [excWhy, setExcWhy] = useState(''); const [showLog, setShowLog] = useState(false);
  const level = opsLevelOf(tenant); const own = !!uid && a.staffId === uid;
  const can = (x: any) => opsCan(role, level, own, x);
  const provider = staffById.get(a.staffId); const first = String(a.clientName || 'Client').split(' ')[0];
  const mins = Math.max(15, Math.round((Date.parse(a.endTime || a.startTime) - Date.parse(a.startTime)) / 60000) || 60);
  const fit = fitCheck(a, next, mins, Number(tenant?.bookingBufferMinutes) || 0);
  const trip = a.clientTrip?.at && Date.now() - Date.parse(a.clientTrip.at) < 15 * 60000 ? a.clientTrip : null;
  const unpaid = paymentOutstanding(a); const dep = (Number(a.depositAmountCents) || 0) / 100;
  const decide = async (option: 'keep' | 'move') => { setBusy(option); setMsg(null); const r = await staffPost('/api/appointments/late-decision', { tenantId, appointmentId: a.id, option, tell }); setBusy(null); setMsg(r?.ok ? (tell ? `${first} has been told.` : 'Saved.') : r?.error || 'That didn’t save.'); };
  const pay = async (action: 'charge' | 'waive') => { setBusy(action); setMsg(null); const r = await staffPost('/api/appointments/desk-deposit', { tenantId, appointmentId: a.id, action, ...(action === 'waive' ? { reason: excWhy.trim() } : {}) }); setBusy(null); setMsg(r?.ok ? (action === 'charge' ? 'Deposit collected.' : 'Exception recorded.') : r?.error || 'That didn’t go through.'); };
  const late = a.checkInStatus === 'running_late' || ops.status === 'eta_overdue' || ops.status === 'decision_needed';
  const callout = a.disruption?.status === 'pending' && a.disruption.kind === 'callout';
  const offer = async (toStaffId: string, startAt: string) => { setBusy(`offer:${toStaffId}`); setMsg(null); const r = await staffPost('/api/appointments/provider-offer', { tenantId, appointmentId: a.id, toStaffId, startAt, tell }); setBusy(null); setMsg(r?.ok ? `Offered — waiting for ${first} to accept.` : r?.error || 'That didn’t send.'); };
  return (
    <article className="space-y-3 rounded-3xl border bg-card p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div><p className="font-semibold">{a.clientName || 'Client'} <span className="font-normal text-muted-foreground">· {a.serviceName || 'Appointment'}</span></p>
          <p className="text-sm text-muted-foreground">Booked {hm(a.startTime)}{provider?.name ? ` with ${String(provider.name).split(' ')[0]}` : ''}</p></div>
        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${TONE[ops.tone]}`}>{ops.label}</span>
      </header>
      {ops.detail && <p className="text-sm">{ops.detail}</p>}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {a.checkInStatus === 'running_late' && <><dt className="text-muted-foreground">They told us</dt><dd>~{a.lateTimeMinutes || '?'} min late{ops.etaAt ? ` · ETA ${hm(ops.etaAt)}` : ''}{a.clientStatusAt ? ` · ${ago(a.clientStatusAt)}` : ''}</dd></>}
        {a.clientLateNote && <><dt className="text-muted-foreground">Their note</dt><dd>“{a.clientLateNote}”</dd></>}
        <dt className="text-muted-foreground">Location</dt><dd>{trip ? `Shared · ${trip.distanceKm ?? '?'} km, ~${trip.etaMin ?? '?'} min · ${ago(trip.at)}` : 'Not shared'}</dd>
        <dt className="text-muted-foreground">Service</dt><dd>{mins} min{fit.finishAt && late ? ` · finishes ~${hm(fit.finishAt)}` : ''}</dd>
        <dt className="text-muted-foreground">Next booking</dt><dd>{next ? `${String(next.clientName || 'Guest').split(' ')[0]} at ${hm(next.startTime)} — ${fit.fits ? 'fits' : `runs ${fit.overrunMinutes} min into it`}` : 'Nothing after'}</dd>
        {(dep > 0 || unpaid) && <><dt className="text-muted-foreground">Deposit</dt><dd>{unpaid ? `Due${dep ? ` · $${dep.toFixed(2)}` : ''}` : a.paymentException ? 'Exception recorded' : 'Paid'}</dd></>}
        {a.providerOffer && <><dt className="text-muted-foreground">Provider offer</dt><dd>{String(a.providerOffer.toStaffName || '').split(' ')[0]} at {hm(a.providerOffer.startAt)} · {a.providerOffer.status}</dd></>}
        {a.originalScheduledTime && <><dt className="text-muted-foreground">Originally</dt><dd>{hm(a.originalScheduledTime)}{a.originalStaffId && staffById.get(a.originalStaffId) ? ` with ${String(staffById.get(a.originalStaffId).name).split(' ')[0]}` : ''}</dd></>}
        {a.providerDelay && <><dt className="text-muted-foreground">Provider delay</dt><dd>~{a.providerDelay.minutes} min · new start ~{hm(a.providerDelay.newStartAt)} · {a.providerDelay.reply ? `they chose: ${a.providerDelay.reply}` : 'waiting for their choice'}</dd></>}
      </dl>
      {a.lateReply?.message && <p className="rounded-2xl bg-secondary p-3 text-sm"><b>They’ve been told:</b> {a.lateReply.message}</p>}
      {((late && (can('keep') || can('move'))) || (callout && opsLevelOf(tenant) !== 'view')) && <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={tell} onChange={(e) => setTell(e.target.checked)} /> Tell {first} (text/email + their visit link)</label>
        {late && <div className="flex flex-wrap gap-2">
          {can('keep') && <button type="button" disabled={!!busy} onClick={() => decide('keep')} className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">{busy === 'keep' ? 'Saving…' : 'Still see them'}</button>}
          {can('move') && <button type="button" disabled={!!busy} onClick={() => decide('move')} className="rounded-full border px-4 py-2 text-sm font-semibold disabled:opacity-60">{busy === 'move' ? 'Saving…' : 'Ask them to reschedule'}</button>}
          {can('condense') && <Link href="/pos" className="rounded-full border px-4 py-2 text-sm">Shorter visit or late fee →</Link>}
        </div>}
        {callout && Array.isArray(a.coverVolunteers) && a.coverVolunteers.length > 0 && <p className="text-xs"><b>Offered to cover:</b> {a.coverVolunteers.map((v: any) => String(v.name || '').split(' ')[0]).join(', ')}{can('switch') ? ' — send them the offer below' : ''}</p>}
        {callout && uid && uid !== a.staffId && !(a.coverVolunteers || []).some((v: any) => v.staffId === uid) && opsLevelOf(tenant) !== 'view' && <button type="button" disabled={!!busy} onClick={async () => { setBusy('vol'); const r = await staffPost('/api/appointments/disruption', { tenantId, action: 'cover_volunteer', kind: 'callout', disruptionId: a.disruption.id, appointmentId: a.id }); setBusy(null); setMsg(r?.ok ? 'Thanks — a manager will send them the offer.' : r?.error || 'That didn’t send.'); }} className="rounded-full border px-4 py-2 text-sm font-semibold disabled:opacity-60">I can cover this</button>}
        {(late || callout) && can('switch') && freeOthers.length > 0 && a.providerOffer?.status !== 'pending' && <div className="space-y-1"><p className="text-xs text-muted-foreground">Offer another provider (they accept or decline on their link):</p>
          <div className="flex flex-wrap gap-2">{freeOthers.slice(0, 4).map(({ staff: s0, startAt }) => <button key={s0.id} type="button" disabled={!!busy} onClick={() => offer(s0.id, startAt)} className="rounded-full border px-3 py-1.5 text-sm disabled:opacity-60">{busy === `offer:${s0.id}` ? 'Offering…' : `Offer ${String(s0.name).split(' ')[0]} at ${hm(startAt)}`}</button>)}</div></div>}
      </div>}
      {unpaid && ['arrived_payment_required', 'payment_required'].includes(ops.status) && <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!!busy} onClick={() => pay('charge')} className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">{busy === 'charge' ? 'Charging…' : 'Charge card on file'}</button>
        </div>
        {can('payment_exception') && <div className="flex flex-wrap gap-2"><input value={excWhy} onChange={(e) => setExcWhy(e.target.value)} placeholder="Exception reason" className="h-9 flex-1 rounded-full border px-3 text-sm" />
          <button type="button" disabled={!excWhy.trim() || !!busy} onClick={() => pay('waive')} className="rounded-full border px-4 py-2 text-sm font-semibold disabled:opacity-60">Record exception</button></div>}
      </div>}
      {!can('keep') && !can('move') && late && <p className="text-xs text-muted-foreground">You can view this case. A manager{a.staffId ? ' or their provider' : ''} decides.</p>}
      {msg && <p className="text-sm font-semibold">{msg}</p>}
      <button type="button" className="text-xs underline underline-offset-2" onClick={() => setShowLog((v) => !v)}>{showLog ? 'Hide' : 'Show'} decision log</button>
      {showLog && <DecisionLog tenantId={tenantId} id={a.id} />}
    </article>
  );
}

function ProviderLate({ tenantId, staff, role, uid, tenant }: { tenantId: string; staff: any[]; role: string; uid?: string; tenant: any }) {
  const mgr = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());
  const mine = staff.filter((s) => mgr || s.id === uid);
  const [pick, setWho] = useState<string>('');
  // A solo provider is picked automatically once staff load.
  const who = pick || (mine.length === 1 ? mine[0].id : '');
  const [mins, setMins] = useState(15); const [tell, setTell] = useState(true);
  const [busy, setBusy] = useState(false); const [res, setRes] = useState<string | null>(null);
  if (!mine.length || opsLevelOf(tenant) === 'view' && !mgr) return null;
  const send = async (m: number) => {
    setBusy(true); setRes(null);
    const r = await staffPost('/api/appointments/provider-late', { tenantId, staffId: who, minutes: m, tell });
    setBusy(false);
    setRes(!r?.ok ? r?.error || 'That didn’t send.' : m === 0 ? 'Back on time — cleared.' : r.affected?.length ? `${r.affected.length} guest${r.affected.length === 1 ? '' : 's'} affected: ${r.affected.map((x: any) => `${String(x.clientName || 'Guest').split(' ')[0]} (+${x.delayMin} min${x.told ? ', told' : ''})`).join(', ')}.` : 'Nobody’s affected — there’s room in the schedule.');
  };
  return (
    <section className="space-y-2 rounded-3xl border bg-card p-4">
      <p className="font-semibold">Provider running late</p>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {mine.length > 1 && <select value={pick} onChange={(e) => setWho(e.target.value)} className="h-9 rounded-full border px-3"><option value="">Who?</option>{mine.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
        {[5, 10, 15, 20, 30, 45].map((m) => <button key={m} type="button" onClick={() => setMins(m)} aria-pressed={mins === m} className={`rounded-full border px-3 py-1.5 ${mins === m ? 'bg-primary text-primary-foreground' : ''}`}>{m} min</button>)}
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={tell} onChange={(e) => setTell(e.target.checked)} /> Tell affected guests (they choose: keep, reschedule or cancel — no fee)</label>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!who || busy} onClick={() => send(mins)} className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">{busy ? 'Working…' : `Running ${mins} min behind`}</button>
        <button type="button" disabled={!who || busy} onClick={() => send(0)} className="rounded-full border px-4 py-2 text-sm">Back on time</button>
      </div>
      {res && <p className="text-sm">{res}</p>}
    </section>
  );
}



function ReportCallout({ tenantId, staff, role, uid, tenant }: { tenantId: string; staff: any[]; role: string; uid?: string; tenant: any }) {
  const mgr = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());
  const mine = staff.filter((s) => mgr || s.id === uid);
  const [open, setOpen] = useState(false); const [pick, setPick] = useState(''); const [span, setSpan] = useState<'today' | 'tomorrow' | 'days'>('today'); const [days, setDays] = useState(2);
  const [reason, setReason] = useState<string>('other'); const [prev, setPrev] = useState<any>(null); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  if (!mine.length || (opsLevelOf(tenant) === 'view' && !mgr)) return null;
  const who = pick || (mine.length === 1 ? mine[0].id : '');
  const range = () => { const s = new Date(); const e = new Date(); if (span === 'tomorrow') { s.setDate(s.getDate() + 1); s.setHours(0, 0, 0, 0); e.setDate(e.getDate() + 1); } if (span === 'days') e.setDate(e.getDate() + days - 1); e.setHours(23, 59, 59, 999); return { from: s.toISOString(), to: e.toISOString() }; };
  const run = async (action: 'preview' | 'notify') => { setBusy(true); setMsg(null); const r = await staffPost('/api/appointments/disruption', { tenantId, action, kind: 'callout', staffId: who, reason, ...range() }); setBusy(false);
    if (!r?.ok) { setMsg(r?.error || 'That didn’t work.'); return; } if (action === 'preview') setPrev(r); else { setPrev(null); setMsg(`Recorded. ${r.told} client${r.told === 1 ? '' : 's'} told and asked to choose${r.rentersTold ? `; ${r.rentersTold} renter${r.rentersTold === 1 ? '' : 's'} told about their bookings` : ''}. Offer another provider from each case below if someone’s free.`); } };
  const money = (c: number) => `$${(c / 100).toFixed(2)}`;
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="w-full rounded-3xl border bg-card p-4 text-left text-sm"><b>Provider callout</b> — someone can’t work (illness, transport, family…)</button>;
  return (
    <section className="space-y-2 rounded-3xl border bg-card p-4">
      <p className="font-semibold">Provider callout</p>
      <p className="text-xs text-muted-foreground">No private details are needed — just who, and when.</p>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {mine.length > 1 && <select value={pick} onChange={(e) => { setPick(e.target.value); setPrev(null); }} className="h-9 rounded-full border px-3"><option value="">Who?</option>{mine.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
        {([['today', 'Rest of today'], ['tomorrow', 'Tomorrow'], ['days', 'Several days']] as const).map(([v, l]) => <button key={v} type="button" aria-pressed={span === v} onClick={() => { setSpan(v); setPrev(null); }} className={`rounded-full border px-3 py-1.5 ${span === v ? 'bg-primary text-primary-foreground' : ''}`}>{l}</button>)}
        {span === 'days' && <label className="flex items-center gap-1">for <input type="number" min={2} max={14} value={days} onChange={(e) => { setDays(Math.max(2, Math.min(14, Number(e.target.value) || 2))); setPrev(null); }} className="h-9 w-16 rounded-full border px-2" /> days</label>}
      </div>
      <div className="flex flex-wrap gap-2 text-sm"><span className="text-muted-foreground">Reason (optional):</span>{(['illness', 'transport', 'family', 'other'] as const).map((r) => <button key={r} type="button" aria-pressed={reason === r} onClick={() => setReason(r)} className={`rounded-full border px-3 py-1 ${reason === r ? 'bg-secondary font-semibold' : ''}`}>{r[0].toUpperCase() + r.slice(1)}</button>)}</div>
      {!prev ? <button type="button" disabled={!who || busy} onClick={() => run('preview')} className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">{busy ? 'Checking…' : 'See who’s affected'}</button> : <>
        <p className="text-sm"><b>{prev.totals.appointments}</b> appointment{prev.totals.appointments === 1 ? '' : 's'} ({prev.totals.studio} studio, {prev.totals.renter} renter) · booked value {money(prev.totals.bookedCents)} · deposits held {money(prev.totals.depositsCents)} · {prev.hoursLost} scheduled hours</p>
        <ul className="max-h-40 space-y-0.5 overflow-auto text-sm">{prev.affected.map((x: any) => <li key={x.appointmentId}>{new Date(x.startTime).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })} · {x.clientName || 'Client'} · {x.serviceName || ''}{x.isRenterBooking ? ' (renter — they’ll be told)' : ''}</li>)}</ul>
        {prev.totals.appointments > 0 ? <button type="button" disabled={busy} onClick={() => run('notify')} className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">{busy ? 'Sending…' : 'Record it and tell clients'}</button> : <p className="text-sm">Nobody’s booked — nothing to send.</p>}
      </>}
      {msg && <p className="text-sm font-semibold">{msg}</p>}
    </section>
  );
}


/** Recent provider callouts — follow-ups: ask the team to cover, remind the undecided, "they're back", spreadsheet. */
function CalloutRecords({ tenantId }: { tenantId: string }) {
  const { firestore } = useFirebase() as any;
  const since = useMemo(() => new Date(Date.now() - 7 * 864e5).toISOString(), []);
  const q = useMemoFirebase(() => (firestore && tenantId ? query(collection(firestore, `tenants/${tenantId}/providerCallouts`), where('createdAt', '>=', since)) : null), [firestore, tenantId, since]);
  const { data } = useCollection<any>(q);
  const [busy, setBusy] = useState<string | null>(null); const [msg, setMsg] = useState<Record<string, string>>({});
  const list = (data || []).slice().sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt)));
  if (!list.length) return null;
  const act = async (rec: any, action: 'cover_request' | 'chase' | 'reopen') => { setBusy(`${rec.id}:${action}`);
    const r = await staffPost('/api/appointments/disruption', { tenantId, action, kind: 'callout', disruptionId: rec.id }); setBusy(null);
    setMsg((m) => ({ ...m, [rec.id]: !r?.ok ? r?.error || 'That didn’t work.' : action === 'cover_request' ? `Asked ${r.asked} team member${r.asked === 1 ? '' : 's'} to cover ${r.appointments}.` : action === 'chase' ? `Reminded ${r.chased}.` : `Invited ${r.invited} back to book.` })); };
  return (
    <section className="space-y-2 rounded-3xl border bg-card p-4">
      <p className="font-semibold">Recent callouts</p>
      {list.map((rec: any) => { const t = disruptionTotals(rec.affected); return (
        <div key={rec.id} className="space-y-1.5 rounded-2xl bg-secondary p-3 text-sm">
          <p><b>{rec.staffName || 'Provider'}</b> · {new Date(rec.from).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}{rec.to && new Date(rec.to).toDateString() !== new Date(rec.from).toDateString() ? ` – ${new Date(rec.to).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''} · {rec.hoursLost ?? 0} h</p>
          <p className="text-xs">{t.appointments} affected · {t.rescheduled} rescheduled · {t.reassigned} another provider · {t.cancelled} cancelled · {t.pending} waiting</p>
          <div className="flex flex-wrap gap-2">
            {t.pending > 0 && <button type="button" disabled={!!busy} onClick={() => act(rec, 'cover_request')} className="rounded-full border px-3 py-1 text-xs font-semibold disabled:opacity-60">Ask the team to cover</button>}
            {t.pending > 0 && <button type="button" disabled={!!busy} onClick={() => act(rec, 'chase')} className="rounded-full border px-3 py-1 text-xs font-semibold disabled:opacity-60">Remind undecided</button>}
            <button type="button" disabled={!!busy} onClick={() => act(rec, 'reopen')} className="rounded-full border px-3 py-1 text-xs font-semibold disabled:opacity-60">They’re back — invite rebooking</button>
            <a href={`/api/booths/interruption-export?tenantId=${tenantId}&id=${rec.id}&kind=callout`} className="rounded-full border px-3 py-1 text-xs font-semibold">Spreadsheet</a>
          </div>
          {msg[rec.id] && <p className="text-xs font-semibold">{msg[rec.id]}</p>}
        </div>); })}
    </section>
  );
}


/** Refunds to process — deposits promised back (delays, callouts, closures, cancellations). Managers only. */
function RefundQueue({ tenantId, role }: { tenantId: string; role: string }) {
  const mgr = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());
  const [data, setData] = useState<any>(null); const [sel, setSel] = useState<string[]>([]); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null); const [arm, setArm] = useState<string | null>(null);
  const load = async () => { const r = await staffPost('/api/deposits/refund-queue', { tenantId, action: 'list' }); if (r?.ok) setData(r); };
  useEffect(() => { if (mgr && tenantId) void load(); }, [mgr, tenantId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!mgr || !data || !data.items.length) return null;
  const go = async (opts: any, key: string) => { if (arm !== key) { setArm(key); return; } setArm(null); setBusy(true); setMsg(null);
    const r = await staffPost('/api/deposits/refund-queue', { tenantId, action: 'process', ...opts }); setBusy(false);
    setMsg(r?.ok ? `${r.done} done${r.failed ? ` · ${r.failed} didn’t go through (reasons below)` : ''}.` : r?.error || 'That didn’t work.'); setSel([]); await load(); };
  const selTotal = data.items.filter((x: any) => sel.includes(x.id)).reduce((m: number, x: any) => m + x.amountDollars, 0);
  return (
    <section className="space-y-2 rounded-3xl border bg-card p-4">
      <p className="font-semibold">Refunds to process · {data.items.length} · ${data.totalDollars.toFixed(2)}</p>
      <p className="text-xs text-muted-foreground">Deposits you’ve promised back. Each goes back to the card it was paid with (processing fees aren’t returned by Stripe).</p>
      <ul className="max-h-56 space-y-1 overflow-auto text-sm">{data.items.map((x: any) => <li key={x.id} className="flex items-start gap-2">
        <input type="checkbox" className="mt-1" checked={sel.includes(x.id)} onChange={(e) => setSel((l) => (e.target.checked ? [...l, x.id] : l.filter((y) => y !== x.id)))} />
        <span><b>${x.amountDollars.toFixed(2)}</b> · {x.clientName || 'Client'}{x.startTime ? ` · ${new Date(x.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''} · {x.why}{x.lastError ? <span className="block text-xs text-red-700">Last try: {x.lastError}</span> : null}</span></li>)}</ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => go({ all: true }, 'all')} className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">{busy ? 'Processing…' : arm === 'all' ? `Tap again — refund all $${data.totalDollars.toFixed(2)}` : `Refund all ($${data.totalDollars.toFixed(2)})`}</button>
        {sel.length > 0 && <button type="button" disabled={busy} onClick={() => go({ ids: sel }, 'sel')} className="rounded-full border px-4 py-2 text-sm font-semibold disabled:opacity-60">{arm === 'sel' ? `Tap again — refund $${selTotal.toFixed(2)}` : `Refund selected ($${selTotal.toFixed(2)})`}</button>}
        {sel.length > 0 && <button type="button" disabled={busy} onClick={() => go({ ids: sel, as: 'credit' }, 'credit')} className="rounded-full border px-4 py-2 text-sm disabled:opacity-60">{arm === 'credit' ? 'Tap again — give as credit' : 'Give selected as credit'}</button>}
      </div>
      {msg && <p className="text-sm font-semibold">{msg}</p>}
    </section>
  );
}

/** Services running over that affect a later guest (planned length = the booking's own length). */
function overrunCases(appts: any[], now = new Date()) {
  return (appts || []).map((a: any) => { const planned = Math.max(15, Math.round((Date.parse(a.endTime || a.startTime) - Date.parse(a.startTime)) / 60000) || 60);
    const ov = serviceOverrun(a, planned, now); return ov && ov.overMin >= 1 && overrunImpact(appts, a, Math.max(10, ov.overMin), now).length ? { a, ov } : null; }).filter(Boolean) as { a: any; ov: { overMin: number; plannedEnd: Date } }[];
}

/** The Needs-attention board: provider running late + today's cases. Fed the
 *  data by its host (the POS panel), so it shows exactly what the desk sees. */
export function OpsBoard({ appts, staff, tenant, tenantId, role, uid }: { appts: any[]; staff: any[]; tenant: any; tenantId: string; role: string; uid?: string }) {
  const [view, setView] = useState<'attention' | 'all'>('attention');
  const staffById = useMemo(() => new Map((staff || []).map((s: any) => [s.id, s])), [staff]);
  const grace = Number(resolvePolicy(tenant).late.graceMinutes.value) || 0;
  const now = new Date();
  const rows = useMemo(() => (appts || []).map((a: any) => ({ a, ops: opsStatus(a, now, { graceMinutes: grace }) })), [appts, grace]); // eslint-disable-line react-hooks/exhaustive-deps
  const freeFor = (a: any) => {
    const mins = Math.max(15, Math.round((Date.parse(a.endTime || a.startTime) - Date.parse(a.startTime)) / 60000) || 60);
    const start = Math.max(Date.now(), Date.parse(a.etaAt || a.clientEtaAt || a.startTime)); const end = start + mins * 60000;
    return (staff || []).filter((s0: any) => s0.isActive !== false && s0.id !== a.staffId && !(appts || []).some((x: any) => x.staffId === s0.id && !['cancelled', 'completed', 'no_show', 'declined', 'expired'].includes(String(x.status || '')) && Date.parse(x.startTime) < end && Date.parse(x.endTime || x.startTime) > start))
      .map((s0: any) => ({ staff: s0, startAt: new Date(Math.ceil(start / 300000) * 300000).toISOString() }));
  };
  const nextFor = (a: any) => (appts || []).filter((x: any) => x.staffId === a.staffId && x.id !== a.id && Date.parse(x.startTime) > Date.parse(a.startTime) && !['cancelled', 'completed', 'no_show'].includes(String(x.status || ''))).sort((x: any, y: any) => Date.parse(x.startTime) - Date.parse(y.startTime))[0] || null;
  const attention = rows.filter((r) => r.ops.needsDecision || ['running_late', 'eta_overdue', 'location_shared', 'rescheduling_offered', 'provider_late', 'provider_offered', 'disruption', 'arrived_payment_required', 'decision_needed', 'payment_required'].includes(r.ops.status));
  const shown = (view === 'attention' ? attention : rows.filter((r) => r.ops.status !== 'finished'))
    .sort((x, y) => Number(y.ops.needsDecision) - Number(x.ops.needsDecision) || Date.parse(x.a.startTime) - Date.parse(y.a.startTime));
  const decisions = attention.filter((r) => r.ops.needsDecision).length;
  return (
    <div className="space-y-4">
      <ProviderLate tenantId={tenantId} staff={(staff || []).filter((s: any) => s.isActive !== false)} role={role} uid={uid} tenant={tenant} />
      <RefundQueue tenantId={tenantId} role={role} />
      <ReportCallout tenantId={tenantId} staff={(staff || []).filter((s: any) => s.isActive !== false)} role={role} uid={uid} tenant={tenant} />
      <CalloutRecords tenantId={tenantId} />
      {overrunCases(appts).map(({ a, ov }) => <OverrunPanel key={`ov-${a.id}`} tenant={tenant} tenantId={tenantId} role={role} inService={a} today={appts} overMin={ov.overMin} plannedEnd={ov.plannedEnd} providerName={staffById.get(a.staffId)?.name || null} />)}
      <div className="flex flex-wrap items-center gap-2">
        {([['attention', `Needs attention · ${attention.length}`], ['all', 'All of today']] as const).map(([v, l]) => <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v} className={`rounded-full border px-4 py-1.5 text-sm ${view === v ? 'bg-primary text-primary-foreground' : ''}`}>{l}</button>)}
        {decisions > 0 && <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-800">{decisions} decision{decisions === 1 ? '' : 's'} needed</span>}
      </div>
      {shown.length === 0 ? <p className="rounded-3xl border bg-card p-8 text-center text-muted-foreground">{view === 'attention' ? 'All calm — nothing needs attention right now.' : 'No appointments today.'}</p> : (
        <div className="grid gap-4">{shown.map(({ a, ops }) => <CaseCard key={a.id} a={a} ops={ops} tenant={tenant} tenantId={tenantId} staffById={staffById} next={nextFor(a)} role={role} uid={uid} freeOthers={freeFor(a)} />)}</div>
      )}
    </div>
  );
}

/** How many of today's appointments need attention (for the POS badge). */
export function opsAttentionCount(appts: any[], tenant: any): { attention: number; decisions: number } {
  const grace = Number(resolvePolicy(tenant).late.graceMinutes.value) || 0; const now = new Date();
  let attention = 0, decisions = 0;
  for (const a of appts || []) { const o = opsStatus(a, now, { graceMinutes: grace });
    if (o.needsDecision) decisions++;
    if (o.needsDecision || ['running_late', 'eta_overdue', 'location_shared', 'rescheduling_offered', 'provider_late', 'provider_offered', 'disruption', 'arrived_payment_required', 'decision_needed', 'payment_required'].includes(o.status)) attention++; }
  const over = overrunCases(appts, now).filter((x) => !x.a.overrunNotifiedAt).length;
  return { attention: attention + over, decisions: decisions + over };
}
