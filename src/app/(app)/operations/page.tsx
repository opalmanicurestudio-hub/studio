'use client';
// src/app/(app)/operations/page.tsx — APPOINTMENT OPERATIONS.
//
// One place to see today's appointments that need attention — running late,
// ETA overdue, en route, arrived after a reschedule offer, payment required,
// provider running late, rescheduling offered — and decide. Every decision
// updates the same appointment record the planner, POS, staff portal and the
// client's visit link read, and the client is told. Who can decide follows
// Booking policies → "Who can decide". Live (Firestore listeners).

import Link from 'next/link';
import React, { useMemo, useState } from 'react';
import { collection, query, where } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { opsStatus, fitCheck, opsCan, opsLevelOf, paymentOutstanding, type OpsView } from '@/lib/appointment-ops';
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

function CaseCard({ a, ops, tenant, tenantId, staffById, next, role, uid }: { a: any; ops: OpsView; tenant: any; tenantId: string; staffById: Map<string, any>; next: any | null; role: string; uid?: string }) {
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
        {a.providerDelay && <><dt className="text-muted-foreground">Provider delay</dt><dd>~{a.providerDelay.minutes} min · new start ~{hm(a.providerDelay.newStartAt)} · {a.providerDelay.reply ? `they chose: ${a.providerDelay.reply}` : 'waiting for their choice'}</dd></>}
      </dl>
      {a.lateReply?.message && <p className="rounded-2xl bg-secondary p-3 text-sm"><b>They’ve been told:</b> {a.lateReply.message}</p>}
      {late && (can('keep') || can('move')) && <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={tell} onChange={(e) => setTell(e.target.checked)} /> Tell {first} (text/email + their visit link)</label>
        <div className="flex flex-wrap gap-2">
          {can('keep') && <button type="button" disabled={!!busy} onClick={() => decide('keep')} className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">{busy === 'keep' ? 'Saving…' : 'Still see them'}</button>}
          {can('move') && <button type="button" disabled={!!busy} onClick={() => decide('move')} className="rounded-full border px-4 py-2 text-sm font-semibold disabled:opacity-60">{busy === 'move' ? 'Saving…' : 'Ask them to reschedule'}</button>}
          {can('condense') && <Link href="/pos" className="rounded-full border px-4 py-2 text-sm">Shorter visit, switch or late fee →</Link>}
        </div>
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

export default function OperationsPage() {
  const { firestore, user } = useFirebase() as any;
  const { selectedTenant, role } = useTenant() as any;
  const tenant: any = selectedTenant || {}; const tenantId = tenant.id;
  const [view, setView] = useState<'attention' | 'all'>('attention');
  const day = useMemo(() => { const s = new Date(); s.setHours(0, 0, 0, 0); const e = new Date(s); e.setHours(23, 59, 59, 999); return { s: s.toISOString(), e: e.toISOString() }; }, []);
  const apptQ = useMemoFirebase(() => (firestore && tenantId ? query(collection(firestore, `tenants/${tenantId}/appointments`), where('startTime', '>=', day.s), where('startTime', '<=', day.e)) : null), [firestore, tenantId, day.s, day.e]);
  const staffQ = useMemoFirebase(() => (firestore && tenantId ? collection(firestore, `tenants/${tenantId}/staff`) : null), [firestore, tenantId]);
  const { data: appts } = useCollection<any>(apptQ); const { data: staff } = useCollection<any>(staffQ);
  const staffById = useMemo(() => new Map((staff || []).map((s: any) => [s.id, s])), [staff]);
  const grace = Number(resolvePolicy(tenant).late.graceMinutes.value) || 0;
  const now = new Date();
  const rows = useMemo(() => (appts || []).map((a: any) => ({ a, ops: opsStatus(a, now, { graceMinutes: grace }) })), [appts, grace]); // eslint-disable-line react-hooks/exhaustive-deps
  const nextFor = (a: any) => (appts || []).filter((x: any) => x.staffId === a.staffId && x.id !== a.id && Date.parse(x.startTime) > Date.parse(a.startTime) && !['cancelled', 'completed', 'no_show'].includes(String(x.status || ''))).sort((x: any, y: any) => Date.parse(x.startTime) - Date.parse(y.startTime))[0] || null;
  const attention = rows.filter((r) => r.ops.needsDecision || ['running_late', 'eta_overdue', 'location_shared', 'rescheduling_offered', 'provider_late', 'arrived_payment_required', 'decision_needed', 'payment_required'].includes(r.ops.status));
  const shown = (view === 'attention' ? attention : rows.filter((r) => r.ops.status !== 'finished'))
    .sort((x, y) => Number(y.ops.needsDecision) - Number(x.ops.needsDecision) || Date.parse(x.a.startTime) - Date.parse(y.a.startTime));
  const decisions = attention.filter((r) => r.ops.needsDecision).length;
  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6">
      <header>
        <h1 className="text-3xl font-light tracking-tight">Today’s <b className="font-semibold">operations</b></h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Late arrivals, delays and payment holds in one place. Decide here and the planner, front desk, staff portal and the client’s visit link all update — and the client is told.</p>
      </header>
      <ProviderLate tenantId={tenantId} staff={(staff || []).filter((s: any) => s.isActive !== false)} role={role} uid={user?.uid} tenant={tenant} />
      <div className="flex flex-wrap items-center gap-2">
        {([['attention', `Needs attention · ${attention.length}`], ['all', 'All of today']] as const).map(([v, l]) => <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v} className={`rounded-full border px-4 py-1.5 text-sm ${view === v ? 'bg-primary text-primary-foreground' : ''}`}>{l}</button>)}
        {decisions > 0 && <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-800">{decisions} decision{decisions === 1 ? '' : 's'} needed</span>}
      </div>
      {shown.length === 0 ? <p className="rounded-3xl border bg-card p-8 text-center text-muted-foreground">{view === 'attention' ? 'All calm — nothing needs attention right now.' : 'No appointments today.'}</p> : (
        <div className="grid gap-4 md:grid-cols-2">{shown.map(({ a, ops }) => <CaseCard key={a.id} a={a} ops={ops} tenant={tenant} tenantId={tenantId} staffById={staffById} next={nextFor(a)} role={role} uid={user?.uid} />)}</div>
      )}
    </div>
  );
}
