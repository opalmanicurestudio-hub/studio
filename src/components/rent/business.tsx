'use client';
import { downscaleImageToDataUrl } from '@/lib/client-image';
import { getApps, initializeApp } from 'firebase/app';
import { getStorage, ref as storageRef } from 'firebase/storage';
import { getAuth, signInWithCustomToken } from 'firebase/auth';
import { uploadImage } from '@/lib/upload-image';
import { firebaseConfig } from '@/firebase/config';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { credentialViews, stateLabel, CREDENTIAL_LABEL } from '@/lib/compliance';
import { LINK_KINDS, SECTION_KINDS, RENTER_FONTS, onAccent } from '@/lib/renter-identity';
import { useToast } from '@/hooks/use-toast';
import {
  Armchair, CalendarDays, Clock, CreditCard, LogOut, Loader,
  CheckCircle2, Sparkles, ChevronRight, Receipt, AlertTriangle,
  Wallet, KeyRound, Phone, RefreshCw, Repeat, X,
  MessageSquare,
  CalendarClock,
  Users,
  Home,
  Store,
  BellRing,
  ShieldAlert,
  Wrench,
  CloudLightning,
  FileSignature,
} from 'lucide-react';
import { SectionTitle, fmtDate, localDay } from '@/components/rent/shared';
import { api, clock } from '@/components/rent/studio';

// ─── Slot picker: only times that are actually free ──────────────────────────
// Asks the engine (book-slots) for the day's open times for THIS service and
// THIS renter — hours, existing bookings, blocks, events, day-offs all
// applied — and offers only those. A typed time could double-book; a picked
// slot cannot.
export function SlotPicker({ tenantId, token, serviceId, date, onDate, value, onPick }: {
  tenantId: string; token: string; serviceId: string; date: string; onDate: (d: string) => void; value: string; onPick: (iso: string, label: string) => void;
}) {
  const [slots, setSlots] = useState<{ time: string; startIso: string }[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!serviceId || !date) { setSlots(null); return; }
    let alive = true; setSlots(null); setErr('');
    api({ action: 'book-slots', tenantId, token, serviceId, date }).then((d) => { if (!alive) return; if (d?.ok) setSlots(d.slots || []); else setErr(d?.error || 'Could not load times.'); });
    return () => { alive = false; };
  }, [tenantId, token, serviceId, date]);
  const clock = (t: string) => { const [h, m] = t.split(':').map(Number); const ap = h < 12 ? 'am' : 'pm'; const hh = h % 12 === 0 ? 12 : h % 12; return `${hh}:${String(m || 0).padStart(2, '0')} ${ap}`; };
  const step = (n: number) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + n); onDate(localDay(d)); };
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => step(-1)} aria-label="Previous day" className="h-10 w-10 rounded-xl border-2 border-slate-200 text-[12px] font-black text-slate-600">‹</button>
        <input type="date" value={date} onChange={(e) => onDate(e.target.value)} aria-label="Day" className="h-10 flex-1 rounded-xl border-2 border-slate-200 px-3 text-sm font-bold" />
        <button type="button" onClick={() => step(1)} aria-label="Next day" className="h-10 w-10 rounded-xl border-2 border-slate-200 text-[12px] font-black text-slate-600">›</button>
      </div>
      {err && <p className="text-[11px] font-bold text-red-600">{err}</p>}
      {slots === null && !err && <p className="text-[11px] font-bold text-slate-400">Finding open times…</p>}
      {slots && slots.length === 0 && <p className="text-[11px] font-bold text-slate-500">Nothing open on {new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })} — try the next day.</p>}
      {slots && slots.length > 0 && (
        <div className="grid grid-cols-4 gap-1.5">
          {slots.map((sl) => (
            <button key={sl.startIso} type="button" aria-pressed={value === sl.startIso} onClick={() => onPick(sl.startIso, clock(sl.time))}
              className={cn('h-10 rounded-xl border-2 text-[11px] font-black', value === sl.startIso ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 bg-white text-slate-800')}>{clock(sl.time)}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Appointment sheet: the whole appointment in one place ───────────────────
// What the main app's appointment sheet gives the studio, for the renter:
// the client (contact, notes, history, no-shows, favourite), the visit
// (service, time, price, deposit), and every action — note, done, no-show,
// reschedule, rebook, cancel-and-tell, accept/decline — without hunting
// through a list row. Opened from Day, Week, Upcoming, Past.
export function ApptSheet({ a, services, tenantId, token, onClose, onChanged, bookViaEngine }: {
  a: any; services: any[]; tenantId: string; token: string; onClose: () => void; onChanged: () => void;
  bookViaEngine: (client: any, serviceId: string, startIso: string) => Promise<any>;
}) {
  const [client, setClient] = useState<any | null>(null);
  const [note, setNote] = useState(a.note || '');
  const [cnote, setCnote] = useState('');
  const [mode, setMode] = useState<'view' | 'move' | 'rebook' | 'series' | 'cancel'>('view');
  const [when, setWhen] = useState('');          // chosen slot, as an instant
  const [whenLabel, setWhenLabel] = useState('');
  const [pickDate, setPickDate] = useState('');
  const [svcId, setSvcId] = useState('');
  const [every, setEvery] = useState(4);        // weeks between visits
  const [count, setCount] = useState(3);        // how many to book
  const [seriesReport, setSeriesReport] = useState<string[]>([]);
  const [tell, setTell] = useState(true);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  useEffect(() => { let alive = true; api({ action: 'client-get', tenantId, token, clientId: a.clientId }).then((d) => { if (alive && d?.ok) { setClient(d.client); setCnote(d.client?.notes || ''); } }); return () => { alive = false; }; }, [tenantId, token, a.clientId]);
  const done = a.status === 'completed' || a.status === 'cancelled';
  const req = a.status === 'requested' || a.status === 'pending';
  const fmt = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
  const svcMatch = services.find((x: any) => x.name === a.serviceName);
  const run = async (key: string, fn: () => Promise<any>, after?: string) => {
    setBusy(key); setErr(''); setOk('');
    try { const d = await fn(); if (d && d.ok === false) { setErr(d.error || 'That did not work.'); return; } setOk(d?.creditNote ? `${after || 'Done'} · ${d.creditNote}` : (after || 'Done')); onChanged(); }
    catch (e: any) { setErr(e?.message || 'That did not work.'); } finally { setBusy(''); }
  };
  const move = async () => {
    const iso = when; const sid = svcMatch?.id || services[0]?.id;
    if (!iso || !sid) { setErr('Pick an open time.'); return; }
    await run('move', async () => {
      const r = await bookViaEngine({ id: a.clientId || undefined, name: a.clientName, phone: a.clientPhone || undefined, email: a.clientEmail || undefined }, sid, iso);
      if (!r?.ok) return r;
      return api({ action: 'book-cancel', tenantId, token, appointmentId: a.id, tellClient: false });
    }, 'Moved — the client gets the new confirmation');
  };
  const rebook = async () => {
    const iso = when; const sid = svcId || svcMatch?.id || services[0]?.id;
    if (!iso || !sid) { setErr('Pick a service and an open time.'); return; }
    await run('rebook', () => bookViaEngine({ id: a.clientId || undefined, name: a.clientName, phone: a.clientPhone || undefined, email: a.clientEmail || undefined }, sid, iso), 'Booked — they have their confirmation');
  };
  // "See you in four weeks" — the most common thing a renter says at the
  // chair. Same weekday, same service, the closest OPEN time to the same
  // hour on that day. If the day is full, it says so and opens the picker.
  // "+4 wks" jumps to that day and SHOWS the open times, with the slot
  // nearest this visit's hour already selected — one more tap to confirm,
  // never a booking the renter didn't see. Same weekday, same service.
  const quickRebook = async (weeks: number) => {
    const sid = svcMatch?.id || services[0]?.id;
    if (!sid) { setErr('No service to rebook with.'); return; }
    const base = new Date(a.startTime); const target = new Date(base); target.setDate(base.getDate() + weeks * 7);
    const day = localDay(target);
    setBusy(`q${weeks}`); setErr(''); setOk('');
    try {
      setSvcId(sid); setPickDate(day); setWhen(''); setWhenLabel(''); setMode('rebook');
      const d = await api({ action: 'book-slots', tenantId, token, serviceId: sid, date: day });
      const slots: { time: string; startIso: string }[] = d?.ok ? d.slots || [] : [];
      if (!slots.length) { setErr(`Nothing open on ${target.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} — step to a nearby day.`); return; }
      const want = base.getTime() - new Date(localDay(base) + 'T00:00:00').getTime();
      const best = slots.map((sl) => ({ sl, diff: Math.abs((new Date(sl.startIso).getTime() - new Date(day + 'T00:00:00').getTime()) - want) })).sort((x, y) => x.diff - y.diff)[0].sl;
      const [h, m] = best.time.split(':').map(Number); const ap = h < 12 ? 'am' : 'pm'; const hh = h % 12 === 0 ? 12 : h % 12;
      setWhen(best.startIso); setWhenLabel(`${hh}:${String(m || 0).padStart(2, '0')} ${ap}`);
    } finally { setBusy(''); }
  };
  // A standing appointment: every N weeks, M times, each at the nearest open
  // time to this one. Books what it can and reports every date it couldn't.
  const bookSeries = async () => {
    const sid = svcId || svcMatch?.id || services[0]?.id;
    if (!sid) { setErr('Pick a service.'); return; }
    setBusy('series'); setErr(''); setOk(''); setSeriesReport([]);
    const report: string[] = [];
    try {
      const base = new Date(a.startTime);
      for (let i = 1; i <= count; i++) {
        const target = new Date(base); target.setDate(base.getDate() + i * every * 7);
        const day = localDay(target);
        const label = target.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        const d = await api({ action: 'book-slots', tenantId, token, serviceId: sid, date: day });
        const slots: { time: string; startIso: string }[] = d?.ok ? d.slots || [] : [];
        if (!slots.length) { report.push(`${label}: nothing open — skipped`); continue; }
        const want = base.getTime() - new Date(localDay(base) + 'T00:00:00').getTime();
        const best = slots.map((sl) => ({ sl, diff: Math.abs((new Date(sl.startIso).getTime() - new Date(day + 'T00:00:00').getTime()) - want) })).sort((x, y) => x.diff - y.diff)[0].sl;
        const r = await bookViaEngine({ id: a.clientId || undefined, name: a.clientName, phone: a.clientPhone || undefined, email: a.clientEmail || undefined }, sid, best.startIso);
        report.push(r?.ok ? `${label} ${new Date(best.startIso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} ✓` : `${label}: ${r?.error || 'could not book'}`);
      }
      setSeriesReport(report); setOk('Series done'); onChanged();
    } finally { setBusy(''); }
  };
  const Btn = ({ k, label, onClick, tone = 'border-2 border-slate-200 text-slate-700' }: { k: string; label: string; onClick: () => void; tone?: string }) => (
    <button type="button" disabled={!!busy} onClick={onClick} className={cn('h-10 rounded-xl px-3 text-[10px] font-black uppercase tracking-widest disabled:opacity-40', tone)}>{busy === k ? '…' : label}</button>
  );
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label="Appointment">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-slate-900/40" />
      <div className="relative max-h-[92dvh] overflow-y-auto overscroll-contain rounded-t-3xl bg-white px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200" />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{a.viaStudio ? 'Studio booking on your chair' : req ? 'Request — needs your answer' : done ? (a.status === 'cancelled' ? 'Cancelled' : 'Completed') : 'Booked'}</p>
            <p className="text-lg font-black text-slate-900">{a.clientName}</p>
            <p className="text-[12px] font-bold text-slate-600">{a.serviceName}{a.price ? ` · $${Number(a.price).toFixed(0)}` : ''}{a.duration ? ` · ${a.duration} min` : ''}</p>
            <p className="text-[12px] font-bold text-slate-900">{fmt(a.startTime)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="h-9 w-9 shrink-0 rounded-xl border-2 border-slate-200 text-slate-500">×</button>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {a.clientPhone && <a href={`sms:${a.clientPhone}`} className="h-9 inline-flex items-center rounded-xl border-2 border-slate-200 px-3 text-[9px] font-black uppercase tracking-widest text-slate-700">Text</a>}
          {a.clientPhone && <a href={`tel:${a.clientPhone}`} className="h-9 inline-flex items-center rounded-xl border-2 border-slate-200 px-3 text-[9px] font-black uppercase tracking-widest text-slate-700">Call</a>}
          {a.clientEmail && <a href={`mailto:${a.clientEmail}`} className="h-9 inline-flex items-center rounded-xl border-2 border-slate-200 px-3 text-[9px] font-black uppercase tracking-widest text-slate-700">Email</a>}
        </div>

        {client && (
          <div className="mt-3 rounded-2xl border-2 border-slate-100 bg-slate-50 p-3 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Client</p>
              <p className="text-[10px] font-bold text-slate-500">{client.visits} visit{client.visits === 1 ? '' : 's'}{client.noShows ? ` · ${client.noShows} no-show${client.noShows === 1 ? '' : 's'}` : ''}{client.favourite ? ` · usually ${client.favourite}` : ''}</p>
            </div>
            {client.membership && (
              <div className="rounded-xl border-2 border-violet-200 bg-violet-50 p-2 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-black text-violet-900">Member · {client.membership.name}{client.membership.status === 'past_due' ? ' · payment overdue' : ''}</span>
                  <span className="text-[10px] font-bold text-violet-800">{client.membership.left} of {client.membership.includedVisits} visits left</span>
                </div>
                {client.membership.discountPct > 0 && <p className="text-[10px] font-bold text-violet-800">{client.membership.discountPct}% off other services{a.price ? ` — this one at $${(Number(a.price) * (1 - client.membership.discountPct / 100)).toFixed(0)}` : ''}.</p>}
                {(client.membership.perks || []).length > 0 && <p className="text-[10px] font-bold text-violet-700">{client.membership.perks.join(' · ')}</p>}
                {!a.viaStudio && !a.paidByPackageId && !a.paidByMembershipId && client.membership.status === 'active' && client.membership.left > 0 && (
                  <Btn k="mv-use" label="Use an included visit" tone="bg-violet-700 text-white" onClick={() => run('mv-use', () => api({ action: 'membership-redeem', tenantId, token, appointmentId: a.id, subscriptionId: client.membership.id }), 'Included visit used')} />
                )}
                {a.paidByMembershipId && <p className="text-[10px] font-bold text-violet-800">This visit is covered by their membership.</p>}
              </div>
            )}
            {Array.isArray(client.credits) && client.credits.length > 0 && (
              <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-2 space-y-1">
                {client.credits.map((cr: any) => (
                  <div key={cr.id} className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-black text-emerald-900">{cr.packageName} · {cr.remaining} left</span>
                    {!a.viaStudio && !a.paidByPackageId && (
                      <Btn k={`rd-${cr.id}`} label="Use a credit" tone="bg-emerald-600 text-white" onClick={() => run(`rd-${cr.id}`, () => api({ action: 'package-redeem', tenantId, token, appointmentId: a.id, purchaseId: cr.id }), 'Credit used for this visit')} />
                    )}
                  </div>
                ))}
                {a.paidByPackageId && <p className="text-[10px] font-bold text-emerald-800">This visit is covered by {a.paidByPackageName || 'a package'}.</p>}
              </div>
            )}
            {client.mine ? (
              <>
                <textarea value={cnote} onChange={(e) => setCnote(e.target.value.slice(0, 2000))} rows={2} aria-label="Client notes" placeholder="Formulas, allergies, how they like it. Only you see this." className="w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-[12px]" />
                {cnote !== (client.notes || '') && <Btn k="cnote" label="Save client notes" onClick={() => run('cnote', () => api({ action: 'client-save', tenantId, token, clientId: client.id, name: client.name, phone: client.phone || '', email: client.email || '', notes: cnote }), 'Client notes saved')} />}
              </>
            ) : (
              <p className="text-[10px] font-bold text-slate-500">This client is in the studio&apos;s book, not yours — their notes live there.</p>
            )}
            {client.history.length > 1 && (
              <div className="pt-1">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">History with you</p>
                {client.history.filter((h: any) => h.id !== a.id).slice(0, 5).map((h: any) => (
                  <p key={h.id} className="text-[10px] font-bold text-slate-600"><span className="font-black text-slate-800">{fmtDate(String(h.startTime).slice(0, 10))}</span> · {h.serviceName}{h.price ? ` · $${h.price.toFixed(0)}` : ''}{h.outcome === 'no_show' ? ' · no-show' : h.status === 'cancelled' ? ' · cancelled' : h.viaStudio ? ' · studio' : ''}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {!a.viaStudio && (
          <div className="mt-3 space-y-2">
            <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 1000))} rows={2} aria-label="Appointment note" placeholder="Note for this visit — only you see it" className="w-full rounded-xl border-2 border-slate-200 px-3 py-2 text-[12px]" />
            {note !== (a.note || '') && <Btn k="note" label="Save note" onClick={() => run('note', () => api({ action: 'book-note', tenantId, token, appointmentId: a.id, note }), 'Note saved')} />}

            {req && (
              <div className="flex gap-2">
                <Btn k="acc" label="Accept" tone="bg-emerald-600 text-white flex-1" onClick={() => run('acc', () => api({ action: 'book-decide', tenantId, token, appointmentId: a.id, decision: 'accept' }), 'Accepted — client told')} />
                <Btn k="dec" label="Decline" tone="border-2 border-red-300 text-red-700 flex-1" onClick={() => run('dec', () => api({ action: 'book-decide', tenantId, token, appointmentId: a.id, decision: 'decline' }), 'Declined — client told')} />
              </div>
            )}

            {mode === 'view' && (
              <>
                <div className="rounded-2xl border-2 border-slate-100 bg-slate-50 p-3">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Book them again — jumps to that day, shows what&apos;s open, nearest time preselected</p>
                  <div className="mt-2 flex gap-1.5">
                    {[2, 3, 4, 6].map((w) => <Btn key={w} k={`q${w}`} label={`+${w} wks`} tone="bg-white border-2 border-slate-900 text-slate-900 flex-1" onClick={() => quickRebook(w)} />)}
                  </div>
                  <div className="mt-1.5 flex gap-1.5">
                    <Btn k="rb" label="Pick a time" tone="flex-1" onClick={() => { setWhen(''); setPickDate(localDay(new Date(new Date(a.startTime).getTime() + 14 * 86400000))); setSvcId(svcMatch?.id || ''); setMode('rebook'); }} />
                    <Btn k="sr" label="Standing appointment" tone="flex-1" onClick={() => { setSvcId(svcMatch?.id || ''); setSeriesReport([]); setMode('series'); }} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {!done && <Btn k="done" label="Done ✓" tone="bg-emerald-600 text-white" onClick={() => run('done', () => api({ action: 'book-status', tenantId, token, appointmentId: a.id, outcome: 'completed' }), 'Marked done')} />}
                  {!done && <Btn k="ns" label="No-show" tone="border-2 border-amber-300 text-amber-800" onClick={() => run('ns', () => api({ action: 'book-status', tenantId, token, appointmentId: a.id, outcome: 'no_show' }), 'Marked no-show')} />}
                  {!done && <Btn k="mv" label="Reschedule" onClick={() => { setWhen(''); setPickDate(localDay(new Date(a.startTime))); setMode('move'); }} />}
                  {!done && <Btn k="cx" label="Cancel visit" tone="border-2 border-red-300 text-red-700" onClick={() => setMode('cancel')} />}
                </div>
              </>
            )}
            {mode === 'series' && (
              <div className="rounded-2xl border-2 border-slate-900 p-3 space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-800">Standing appointment</p>
                <select value={svcId} onChange={(e) => setSvcId(e.target.value)} aria-label="Service" className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3 text-sm font-bold">
                  {services.map((sv: any) => <option key={sv.id} value={sv.id}>{sv.name} · ${Number(sv.price).toFixed(0)} · {sv.duration}m</option>)}
                </select>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-slate-600">Every</span>
                  {[1, 2, 3, 4, 6].map((w) => <button key={w} type="button" aria-pressed={every === w} onClick={() => setEvery(w)} className={cn('h-9 w-10 rounded-lg border-2 text-[11px] font-black', every === w ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-700')}>{w}</button>)}
                  <span className="text-[11px] font-bold text-slate-600">wks</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-slate-600">Book</span>
                  {[2, 3, 4, 6, 8].map((n) => <button key={n} type="button" aria-pressed={count === n} onClick={() => setCount(n)} className={cn('h-9 w-10 rounded-lg border-2 text-[11px] font-black', count === n ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-700')}>{n}</button>)}
                  <span className="text-[11px] font-bold text-slate-600">visits</span>
                </div>
                <p className="text-[10px] font-bold text-slate-500">Each one lands at the nearest open time to this visit&apos;s hour. Full days are skipped and listed, never double-booked. The client gets one confirmation per visit.</p>
                {seriesReport.length > 0 && <div className="rounded-xl bg-slate-50 p-2">{seriesReport.map((l, i) => <p key={i} className="text-[10px] font-bold text-slate-700">{l}</p>)}</div>}
                <div className="flex gap-2">
                  <Btn k="series" label={`Book ${count} visits`} tone="bg-slate-900 text-white flex-1" onClick={bookSeries} />
                  <Btn k="back" label="Back" onClick={() => setMode('view')} />
                </div>
              </div>
            )}
            {(mode === 'move' || mode === 'rebook') && (
              <div className="rounded-2xl border-2 border-slate-900 p-3 space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-800">{mode === 'move' ? 'Move this visit to' : 'Book them again'}</p>
                {mode === 'rebook' && (
                  <select value={svcId} onChange={(e) => setSvcId(e.target.value)} aria-label="Service" className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3 text-sm font-bold">
                    {services.map((sv: any) => <option key={sv.id} value={sv.id}>{sv.name} · ${Number(sv.price).toFixed(0)} · {sv.duration}m</option>)}
                  </select>
                )}
                <SlotPicker tenantId={tenantId} token={token} serviceId={mode === 'rebook' ? (svcId || svcMatch?.id || services[0]?.id || '') : (svcMatch?.id || services[0]?.id || '')} date={pickDate} onDate={(d) => { setPickDate(d); setWhen(''); }} value={when} onPick={(iso, label) => { setWhen(iso); setWhenLabel(label); }} />
                <p className="text-[10px] font-bold text-slate-500">{when ? `Chosen: ${new Date(pickDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at ${whenLabel}. ` : 'Only open times are shown. '}{mode === 'move' ? 'The client gets one new confirmation; the old time is released quietly.' : 'Same client, same details — they get a confirmation.'}</p>
                <div className="flex gap-2">
                  <Btn k={mode} label={mode === 'move' ? 'Move' : 'Book'} tone="bg-slate-900 text-white flex-1" onClick={mode === 'move' ? move : rebook} />
                  <Btn k="back" label="Back" onClick={() => setMode('view')} />
                </div>
              </div>
            )}
            {mode === 'cancel' && (
              <div className="rounded-2xl border-2 border-red-300 bg-red-50 p-3 space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-red-800">Cancel this visit?</p>
                <button type="button" aria-pressed={tell} onClick={() => setTell((v) => !v)} className={cn('h-10 w-full rounded-xl border-2 px-3 text-left text-[10px] font-bold', tell ? 'border-slate-900 bg-white text-slate-900' : 'border-slate-200 bg-white text-slate-500')}>{tell ? 'Will tell the client, as you' : 'Cancel quietly — no message'}</button>
                <div className="flex gap-2">
                  <Btn k="cx" label="Yes, cancel" tone="bg-red-700 text-white flex-1" onClick={() => run('cx', () => api({ action: 'book-cancel', tenantId, token, appointmentId: a.id, tellClient: tell }), 'Cancelled')} />
                  <Btn k="back" label="Keep it" onClick={() => setMode('view')} />
                </div>
              </div>
            )}
          </div>
        )}
        {a.viaStudio && <p className="mt-3 rounded-xl border-2 border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-600">Booked by the studio on your chair — the studio manages and is paid for this one. Ask the studio to change it.</p>}
        {err && <p className="mt-2 text-xs font-bold text-red-600">{err}</p>}
        {ok && <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-emerald-700">{ok}</p>}
      </div>
    </div>
  );
}

// ─── My Book: the renter's appointments, run from here ───────────────────────
// Their ledger AND their controls. Cancel, complete, no-show, a note, a
// walk-in, a blocked hour — all against their own provider record, never the
// studio's. Walk-ins and reschedules go through the same public booking
// engine their link uses (source 'renter_portal'), so conflicts and client
// scoping are exactly the ones every other booking gets.
export function MyBook({ data, tenantId, token }: { data: any; tenantId: string; token: string }) {
  const [book, setBook] = useState<{ upcoming: any[]; past: any[]; services: any[]; staffId: string } | null>(null);
  const [blocks, setBlocks] = useState<any[]>([]);
  // A day view, like the planner the studio's staff get — the same
  // appointments and blocks already loaded, drawn on a clock instead of
  // listed. A renter's day is the thing they check most; a list makes them
  // do the arithmetic ("is 2pm free?") that a grid answers on sight.
  const [view, setView] = useState<'day' | 'week' | 'upcoming' | 'past' | 'blocks'>('day');
  const [dayISO, setDayISO] = useState(() => localDay(new Date()));
  const [openId, setOpenId] = useState('');
  const [sheetId, setSheetId] = useState('');
  const [bookErr, setBookErr] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [walkIn, setWalkIn] = useState(false);
  const [wi, setWi] = useState({ name: '', phone: '', serviceId: '', when: '', day: localDay(new Date()) });
  const [resched, setResched] = useState<{ id: string; when: string } | null>(null);
  const [blockOpen, setBlockOpen] = useState(false);
  const [blk, setBlk] = useState({ when: '', hours: '1', reason: '', showStudio: true });
  const [confirmCancel, setConfirmCancel] = useState('');
  const e = data?.earnings || {};
  const money = (c: number) => `$${((Number(c) || 0) / 100).toFixed(2)}`;
  const when = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
  const load = useCallback(async () => {
    const [d, b] = await Promise.all([api({ action: 'book-list', tenantId, token }), api({ action: 'book-blocks', tenantId, token })]);
    if (d?.ok) { setBook({ upcoming: d.upcoming || [], past: d.past || [], services: d.services || [], staffId: d.staffId }); setBookErr(d.apptError ? `Appointments could not load: ${d.apptError}` : ''); }
    else setBookErr(d?.error || 'Your book could not load.');
    if (b?.ok) setBlocks(b.blocks || []); else if (b?.error) setBookErr((e) => e || `Blocked time could not load: ${b.error}`);
  }, [tenantId, token]);
  useEffect(() => { void load(); }, [load]);
  const localToIso = (v: string) => { const d = new Date(v); return isNaN(d.getTime()) ? '' : d.toISOString(); };
  const run = async (key: string, fn: () => Promise<any>) => {
    setBusy(key); setErr('');
    try { const r = await fn(); if (r && r.ok === false) setErr(r.error || 'That did not work.'); else await load(); }
    finally { setBusy(''); }
  };
  // Walk-in and reschedule share the public engine. A reschedule is a new
  // booking at the new time, then the old one cancelled — the client is told
  // once, as a move, not as a cancel-and-rebook.
  const bookViaEngine = async (client: { name: string; phone?: string; email?: string; id?: string }, serviceId: string, startIso: string) => {
    const res = await fetch('/api/appointments/book', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, source: 'renter_portal', serviceId, staffId: book?.staffId, startTime: startIso, client }) });
    return res.json().catch(() => ({ ok: false, error: 'Could not book that.' }));
  };
  const submitWalkIn = () => run('walkin', async () => {
    if (!wi.name.trim() || !wi.serviceId || !wi.when) return { ok: false, error: 'Name, service and time are needed.' };
    const r = await bookViaEngine({ name: wi.name.trim(), phone: wi.phone.trim() || undefined }, wi.serviceId, wi.when);
    if (r?.ok) { setWalkIn(false); setWi({ name: '', phone: '', serviceId: '', when: '', day: localDay(new Date()) }); }
    return r;
  });
  const submitResched = (a: any) => run(`re-${a.id}`, async () => {
    if (!resched?.when) return { ok: false, error: 'Pick the new time.' };
    const svc = (book?.services || []).find((x) => x.name === a.serviceName);
    if (!svc) return { ok: false, error: 'That service is no longer on your menu — cancel and rebook instead.' };
    const r = await bookViaEngine({ id: a.clientId || undefined, name: a.clientName, phone: a.clientPhone || undefined, email: a.clientEmail || undefined }, svc.id, localToIso(resched.when));
    if (!r?.ok) return r;
    await api({ action: 'book-cancel', tenantId, token, appointmentId: a.id, tellClient: false });
    setResched(null);
    return r;
  });
  const rows = view === 'upcoming' ? (book?.upcoming || []) : (book?.past || []);
  return (
    <section className="space-y-3">
      <SectionTitle icon={CalendarDays}>My Book</SectionTitle>
      <div className="p-4 rounded-3xl bg-white border-2 space-y-3">
        <div className="rounded-2xl bg-slate-50 p-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Booked this month</p>
          <p className="text-2xl font-black text-slate-900">{money(e.monthBookedCents)}</p>
          <p className="text-[11px] font-bold text-slate-500">{e.monthCount || 0} appointment{(e.monthCount || 0) === 1 ? '' : 's'} so far · {(book?.upcoming || []).length} coming up</p>
          <p className="mt-1 text-[10px] font-bold text-slate-400">You collect these directly — this is your record, not a payout.</p>
        </div>

        <div className="flex gap-2">
          <button type="button" onClick={() => { setWalkIn((v) => !v); setBlockOpen(false); }} className="h-10 flex-1 rounded-2xl bg-slate-900 text-[10px] font-black uppercase tracking-widest text-white">{walkIn ? 'Close' : 'Add a walk-in'}</button>
          <button type="button" onClick={() => { setBlockOpen((v) => !v); setWalkIn(false); }} className="h-10 flex-1 rounded-2xl border-2 border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-700">{blockOpen ? 'Close' : 'Block time'}</button>
        </div>
        {walkIn && (
          <div className="rounded-2xl border-2 border-slate-200 bg-slate-50 p-3 space-y-2">
            <input value={wi.name} onChange={(ev) => setWi((f) => ({ ...f, name: ev.target.value.slice(0, 120) }))} aria-label="Client name" placeholder="Client name" className="h-11 w-full rounded-2xl border-2 border-slate-200 bg-white px-3 text-sm font-bold" />
            <input value={wi.phone} onChange={(ev) => setWi((f) => ({ ...f, phone: ev.target.value.slice(0, 40) }))} inputMode="tel" aria-label="Client phone" placeholder="Phone (optional — for their confirmation)" className="h-11 w-full rounded-2xl border-2 border-slate-200 bg-white px-3 text-sm font-bold" />
            <select value={wi.serviceId} onChange={(ev) => setWi((f) => ({ ...f, serviceId: ev.target.value }))} aria-label="Service" className="h-11 w-full rounded-2xl border-2 border-slate-200 bg-white px-3 text-sm font-bold">
              <option value="">Service…</option>
              {(book?.services || []).map((sv) => <option key={sv.id} value={sv.id}>{sv.name} · ${sv.price.toFixed(0)} · {sv.duration}m</option>)}
            </select>
            {wi.serviceId
              ? <SlotPicker tenantId={tenantId} token={token} serviceId={wi.serviceId} date={wi.day} onDate={(d) => setWi((f) => ({ ...f, day: d, when: '' }))} value={wi.when} onPick={(iso) => setWi((f) => ({ ...f, when: iso }))} />
              : <p className="text-[10px] font-bold text-slate-400">Pick a service to see open times.</p>}
            <button type="button" onClick={submitWalkIn} disabled={busy === 'walkin'} className="h-11 w-full rounded-2xl bg-slate-900 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40">{busy === 'walkin' ? 'Booking…' : 'Book it'}</button>
            <p className="text-[9px] font-bold text-slate-400">Goes through the same booking engine as your link, so it can't double-book you. If they gave a phone or email, they get your confirmation.</p>
          </div>
        )}
        {blockOpen && (
          <div className="rounded-2xl border-2 border-slate-200 bg-slate-50 p-3 space-y-2">
            <input type="datetime-local" value={blk.when} onChange={(ev) => setBlk((f) => ({ ...f, when: ev.target.value }))} aria-label="Block from" className="h-11 w-full rounded-2xl border-2 border-slate-200 bg-white px-3 text-sm font-bold" />
            <div className="grid grid-cols-2 gap-2">
              <select value={blk.hours} onChange={(ev) => setBlk((f) => ({ ...f, hours: ev.target.value }))} aria-label="For how long" className="h-11 rounded-2xl border-2 border-slate-200 bg-white px-3 text-sm font-bold">
                {['0.5', '1', '1.5', '2', '3', '4', '8'].map((h) => <option key={h} value={h}>{h} hr{h === '1' ? '' : 's'}</option>)}
              </select>
              <input value={blk.reason} onChange={(ev) => setBlk((f) => ({ ...f, reason: ev.target.value.slice(0, 120) }))} aria-label="Reason" placeholder="Lunch, errand, class…" className="h-11 rounded-2xl border-2 border-slate-200 bg-white px-3 text-sm font-bold" />
              <button type="button" aria-pressed={blk.showStudio} onClick={() => setBlk((f) => ({ ...f, showStudio: !f.showStudio }))}
                className={cn('h-11 rounded-2xl border-2 px-3 text-left text-[10px] font-bold', blk.showStudio ? 'border-slate-900 bg-slate-50 text-slate-900' : 'border-slate-200 bg-white text-slate-500')}>
                {blk.showStudio ? 'Shown on the studio\'s calendar — they\'ll see you\'re out' : 'Kept off the studio\'s calendar — clients still can\'t book it'}
              </button>
            </div>
            <button type="button" disabled={busy === 'block' || !blk.when} onClick={() => run('block', async () => { const r = await api({ action: 'book-block', tenantId, token, startTime: localToIso(blk.when), duration: Math.round(Number(blk.hours) * 60), reason: blk.reason, showOnStudioCalendar: blk.showStudio }); if (r?.ok) { setBlockOpen(false); setBlk({ when: '', hours: '1', reason: '', showStudio: true }); if (view !== 'day' && view !== 'week') setView('blocks'); } return r; })}
              className="h-11 w-full rounded-2xl bg-slate-900 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40">{busy === 'block' ? 'Saving…' : 'Block it'}</button>
            <p className="text-[9px] font-bold text-slate-400">Clients can't book you during a block. Your rent doesn't change.</p>
          </div>
        )}
        {err && <p className="text-xs font-bold text-red-600">{err}</p>}

        <div className="flex gap-1.5">
          {([['day', 'Day'], ['week', 'Week'], ['upcoming', `Upcoming · ${(book?.upcoming || []).length}`], ['past', 'Past'], ['blocks', `Blocks · ${blocks.length}`]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setView(k)} aria-pressed={view === k} className={cn('h-9 rounded-full border-2 px-3 text-[10px] font-black uppercase tracking-widest', view === k ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-600')}>{l}</button>
          ))}
        </div>

        {view === 'day' && (() => {
          // The day as a clock. Hours span the earliest start to the latest
          // finish (08:00–18:00 at minimum), so an early or late booking is
          // never off-screen. Appointments and blocks are laid on the same
          // grid — the gaps between them are the answer to "am I free?".
          const dayStart = (iso: string) => new Date(`${iso}T00:00:00`);
          const shift = (n: number) => { const d = dayStart(dayISO); d.setDate(d.getDate() + n); setDayISO(localDay(d)); };
          const onDay = (iso: string) => localDay(iso) === dayISO;
          const appts = [...(book?.upcoming || []), ...(book?.past || [])].filter((a: any) => onDay(a.startTime) && a.status !== 'cancelled');
          const blks = blocks.filter((b: any) => onDay(b.startTime));
          const mins = (iso: string) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); };
          const dur = (x: any) => Math.max(15, Number(x.duration) || (x.endTime ? Math.round((new Date(x.endTime).getTime() - new Date(x.startTime).getTime()) / 60000) : 60));
          const all = [...appts.map((a: any) => ({ ...a, kind: 'appt' })), ...blks.map((b: any) => ({ ...b, kind: 'block' }))];
          const firstMin = all.length ? Math.min(8 * 60, ...all.map((x) => mins(x.startTime))) : 8 * 60;
          const lastMin = all.length ? Math.max(18 * 60, ...all.map((x) => mins(x.startTime) + dur(x))) : 18 * 60;
          const startHour = Math.floor(firstMin / 60), endHour = Math.ceil(lastMin / 60);
          const PX = 1.1; // pixels per minute — an hour is a comfortable thumb-height
          const top = (iso: string) => (mins(iso) - startHour * 60) * PX;
          const isToday = dayISO === localDay(new Date());
          const nowTop = isToday ? (new Date().getHours() * 60 + new Date().getMinutes() - startHour * 60) * PX : -1;
          const booked = appts.reduce((n: number, a: any) => n + dur(a), 0);
          const earned = appts.reduce((n: number, a: any) => n + (Number(a.price) || 0), 0);
          return (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={() => shift(-1)} aria-label="Previous day" className="h-9 w-9 rounded-xl border-2 border-slate-200 text-[12px] font-black text-slate-600">‹</button>
                <button type="button" onClick={() => setDayISO(localDay(new Date()))} className="min-w-0 flex-1 text-center">
                  <span className="block text-[12px] font-black text-slate-900">{new Date(`${dayISO}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</span>
                  <span className="block text-[10px] font-bold text-slate-500">{isToday ? 'Today' : 'Tap for today'} · {appts.length} booked · {Math.round(booked / 6) / 10} hr{earned > 0 ? ` · $${earned.toFixed(0)}` : ''}</span>
                </button>
                <button type="button" onClick={() => shift(1)} aria-label="Next day" className="h-9 w-9 rounded-xl border-2 border-slate-200 text-[12px] font-black text-slate-600">›</button>
              </div>
              <div className="relative overflow-hidden rounded-2xl border-2 bg-white" style={{ height: (endHour - startHour) * 60 * PX + 8 }}>
                {Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i).map((h) => (
                  <div key={h} className="absolute inset-x-0 flex items-start gap-2" style={{ top: (h - startHour) * 60 * PX }}>
                    <span className="w-12 shrink-0 pl-2 text-[9px] font-black uppercase tracking-widest text-slate-300">{h % 12 === 0 ? 12 : h % 12}{h < 12 ? 'a' : 'p'}</span>
                    <span className="mt-1.5 h-px flex-1 bg-slate-100" />
                  </div>
                ))}
                {nowTop >= 0 && nowTop <= (endHour - startHour) * 60 * PX && (
                  <div className="absolute inset-x-0 z-20 flex items-center gap-1" style={{ top: nowTop }}>
                    <span className="ml-12 h-2 w-2 rounded-full bg-red-500" /><span className="h-px flex-1 bg-red-500" />
                  </div>
                )}
                {blks.map((b: any) => (
                  <div key={b.id} className="absolute left-14 right-2 z-10 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-2 py-1"
                       style={{ top: top(b.startTime), height: Math.max(22, dur(b) * PX - 2) }}>
                    <p className="truncate text-[10px] font-black uppercase tracking-widest text-slate-500">{b.reason || 'Blocked'}</p>
                  </div>
                ))}
                {appts.map((a: any) => {
                  const h = Math.max(26, dur(a) * PX - 2);
                  const req = a.status === 'requested' || a.status === 'pending';
                  return (
                    <button key={a.id} type="button" onClick={() => setSheetId(a.id)}
                            className={cn('absolute left-14 right-2 z-10 overflow-hidden rounded-lg border-2 px-2 py-1 text-left', a.viaStudio ? 'border-slate-400 bg-white' : req ? 'border-amber-300 bg-amber-50' : a.status === 'completed' ? 'border-slate-200 bg-slate-50' : 'border-slate-900 bg-slate-900')}
                            style={{ top: top(a.startTime), height: h }}>
                      <p className={cn('truncate text-[11px] font-black', a.viaStudio ? 'text-slate-700' : req ? 'text-amber-900' : a.status === 'completed' ? 'text-slate-600' : 'text-white')}>{a.clientName}{a.viaStudio ? ' · studio' : req ? ' · asked' : ''}</p>
                      {h > 34 && <p className={cn('truncate text-[10px] font-bold', req ? 'text-amber-800' : a.status === 'completed' ? 'text-slate-500' : 'text-slate-300')}>{a.serviceName}{a.price ? ` · $${Number(a.price).toFixed(0)}` : ''}</p>}
                    </button>
                  );
                })}
                {all.length === 0 && (
                  <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[11px] font-bold text-slate-400">Nothing on this day.</p>
                )}
              </div>
              <p className="text-[9px] font-bold text-slate-400">Tap a booking to open it. Solid is confirmed, amber is waiting on you, outlined is a studio booking on your chair, dashed is time you blocked.</p>
            </div>
          );
        })()}

        {view === 'week' && (() => {
          // A WEEK AT A GLANCE, and the question a client actually asks:
          // "what have you got next week?" Seven columns, each day's booked
          // blocks drawn to scale against that day's working hours, so a
          // renter can read their openings off the screen and answer on the
          // phone. Tapping a day opens it; tapping an OPEN gap blocks it.
          const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
          const base = new Date(`${dayISO}T12:00:00`);
          const weekStart = new Date(base); weekStart.setDate(base.getDate() - base.getDay());
          const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); return d; });
          const iso = (d: Date) => localDay(d);
          const week = (data?.provider?.week || {}) as any;
          const mins = (t: string) => { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
          const atMins = (isoStr: string) => { const d = new Date(isoStr); return d.getHours() * 60 + d.getMinutes(); };
          const dur = (x: any) => Math.max(15, Number(x.duration) || (x.endTime ? Math.round((new Date(x.endTime).getTime() - new Date(x.startTime).getTime()) / 60000) : 60));
          const appts = [...(book?.upcoming || []), ...(book?.past || [])].filter((a: any) => a.status !== 'cancelled');
          // One scale for the whole week so columns are comparable.
          const opens = DAYS.map((k) => week[k]).filter((d: any) => d?.enabled && d?.start && d?.end);
          const lo = opens.length ? Math.min(...opens.map((d: any) => mins(d.start))) : 8 * 60;
          const hi = opens.length ? Math.max(...opens.map((d: any) => mins(d.end))) : 18 * 60;
          const H = 200;
          const y = (m: number) => Math.max(0, Math.min(H, ((m - lo) / Math.max(1, hi - lo)) * H));
          const todayIso = localDay(new Date());
          const shiftWeek = (n: number) => { const d = new Date(weekStart); d.setDate(d.getDate() + n * 7); setDayISO(iso(d)); };
          let weekBooked = 0, weekEarned = 0, weekOpen = 0;
          const cols = days.map((d) => {
            const key = iso(d);
            const wk = week[DAYS[d.getDay()]];
            const working = !!(wk?.enabled && wk?.start && wk?.end);
            const dayAppts = appts.filter((a: any) => localDay(a.startTime) === key).sort((a: any, b: any) => atMins(a.startTime) - atMins(b.startTime));
            const dayBlocks = blocks.filter((b: any) => localDay(b.startTime) === key);
            const busy = [...dayAppts.map((a: any) => ({ s: atMins(a.startTime), e: atMins(a.startTime) + dur(a), kind: 'appt' as const })),
                          ...dayBlocks.map((b: any) => ({ s: atMins(b.startTime), e: atMins(b.startTime) + dur(b), kind: 'block' as const }))]
                          .sort((a, b) => a.s - b.s);
            weekBooked += dayAppts.reduce((n: number, a: any) => n + dur(a), 0);
            weekEarned += dayAppts.reduce((n: number, a: any) => n + (Number(a.price) || 0), 0);
            // Free gaps INSIDE their working hours, 30 min or longer — the
            // openings they'd offer on the phone.
            const gaps: { s: number; e: number }[] = [];
            if (working) {
              let cur = mins(wk.start);
              const end = mins(wk.end);
              for (const b of busy) { if (b.s > cur) gaps.push({ s: cur, e: Math.min(b.s, end) }); cur = Math.max(cur, b.e); }
              if (cur < end) gaps.push({ s: cur, e: end });
            }
            const real = gaps.filter((g) => g.e - g.s >= 30);
            weekOpen += real.reduce((n, g) => n + (g.e - g.s), 0);
            return { d, key, wk, working, dayAppts, busy, gaps: real };
          });
          const clock = (m: number) => { const h = Math.floor(m / 60), mm = m % 60; const ampm = h < 12 ? 'a' : 'p'; const hh = h % 12 === 0 ? 12 : h % 12; return `${hh}${mm ? ':' + String(mm).padStart(2, '0') : ''}${ampm}`; };
          return (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={() => shiftWeek(-1)} aria-label="Previous week" className="h-9 w-9 rounded-xl border-2 border-slate-200 text-[12px] font-black text-slate-600">‹</button>
                <button type="button" onClick={() => setDayISO(todayIso)} className="min-w-0 flex-1 text-center">
                  <span className="block text-[12px] font-black text-slate-900">{days[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {days[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  <span className="block text-[10px] font-bold text-slate-500">{Math.round(weekBooked / 6) / 10} hr booked{weekEarned > 0 ? ` · $${weekEarned.toFixed(0)}` : ''} · {Math.round(weekOpen / 6) / 10} hr open</span>
                </button>
                <button type="button" onClick={() => shiftWeek(1)} aria-label="Next week" className="h-9 w-9 rounded-xl border-2 border-slate-200 text-[12px] font-black text-slate-600">›</button>
              </div>

              <div className="grid grid-cols-7 gap-1">
                {cols.map((c) => (
                  <button key={c.key} type="button" onClick={() => { setDayISO(c.key); setView('day'); }} className="text-center">
                    <span className={cn('block text-[9px] font-black uppercase tracking-widest', c.key === todayIso ? 'text-slate-900' : 'text-slate-400')}>{c.d.toLocaleDateString('en-US', { weekday: 'narrow' })}</span>
                    <span className={cn('mx-auto mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-black', c.key === todayIso ? 'bg-slate-900 text-white' : 'text-slate-700')}>{c.d.getDate()}</span>
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1 rounded-2xl border-2 bg-white p-1">
                {cols.map((c) => (
                  <div key={c.key} className="relative rounded-lg bg-slate-50" style={{ height: H }}>
                    {!c.working && <span className="absolute inset-0 flex items-center justify-center text-[8px] font-black uppercase tracking-widest text-slate-300" style={{ writingMode: 'vertical-rl' }}>Off</span>}
                    {c.working && c.gaps.map((g, i) => (
                      <button key={`g${i}`} type="button" title={`Block ${clock(g.s)}–${clock(g.e)}`}
                        onClick={() => { const pad = (n: number) => String(n).padStart(2, '0'); setBlk({ when: `${c.key}T${pad(Math.floor(g.s / 60))}:${pad(g.s % 60)}`, hours: String(Math.round(((g.e - g.s) / 60) * 10) / 10), reason: '', showStudio: true }); setBlockOpen(true); }}
                        className="absolute inset-x-0.5 rounded bg-emerald-50 text-[8px] font-black text-emerald-700"
                        style={{ top: y(g.s), height: Math.max(8, y(g.e) - y(g.s)) }}>
                        {y(g.e) - y(g.s) > 22 ? clock(g.s) : ''}
                      </button>
                    ))}
                    {c.busy.map((b, i) => (
                      <span key={`b${i}`} className={cn('absolute inset-x-0.5 rounded', b.kind === 'block' ? 'border border-dashed border-slate-400 bg-white' : 'bg-slate-900')}
                            style={{ top: y(b.s), height: Math.max(4, y(b.e) - y(b.s)) }} />
                    ))}
                  </div>
                ))}
              </div>

              <div className="space-y-1">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Open times this week</p>
                {cols.every((c) => c.gaps.length === 0) && <p className="text-[11px] font-bold text-slate-400">Nothing open — or your hours aren&apos;t set yet (Setup → Hours).</p>}
                {cols.filter((c) => c.gaps.length > 0).map((c) => (
                  <p key={c.key} className="text-[11px] font-bold text-slate-600">
                    <span className="font-black text-slate-900">{c.d.toLocaleDateString('en-US', { weekday: 'short' })}</span> {c.gaps.map((g) => `${clock(g.s)}–${clock(g.e)}`).join(' · ')}
                  </p>
                ))}
              </div>
              <p className="text-[9px] font-bold text-slate-400">Tap a date to open that day. Tap a green gap to block it. Green is open, dark is booked, dashed is blocked.</p>
            </div>
          );
        })()}

        {view === 'blocks' && (blocks.length === 0 ? <p className="py-3 text-center text-[11px] font-bold text-slate-400">No blocked time.</p> : blocks.map((b) => (
          <div key={b.id} className="flex items-center justify-between gap-2 rounded-2xl border-2 p-3">
            <div className="min-w-0"><p className="text-[12px] font-black truncate">{b.reason || 'Blocked'}</p><p className="text-[10px] font-bold text-slate-500">{when(b.startTime)} · {Math.round((b.duration || 60) / 60 * 10) / 10} hr</p></div>
            <button type="button" disabled={busy === `ub-${b.id}`} onClick={() => run(`ub-${b.id}`, () => api({ action: 'book-unblock', tenantId, token, blockId: b.id }))} className="h-9 shrink-0 rounded-xl border-2 border-slate-200 px-3 text-[9px] font-black uppercase tracking-widest text-slate-600">Remove</button>
          </div>
        )))}

        {bookErr && <p className="rounded-xl border-2 border-red-200 bg-red-50 px-3 py-2 text-[11px] font-bold text-red-700">{bookErr}</p>}
        {view !== 'blocks' && view !== 'day' && view !== 'week' && (book === null ? <p className="py-3 text-center text-[11px] font-bold text-slate-400">{bookErr ? 'Nothing to show.' : 'Loading your book…'}</p>
          : rows.length === 0 ? <p className="py-3 text-center text-[11px] font-bold text-slate-400">{view === 'upcoming' ? 'Nothing coming up. Share your booking link or add a walk-in.' : 'No past appointments yet.'}</p>
          : rows.map((a) => {
            const isOpen = openId === a.id;
            const done = a.status === 'completed' || a.status === 'cancelled';
            const chip = a.viaStudio ? 'Studio booking' : a.status === 'cancelled' ? (a.outcome === 'no_show' ? 'No-show' : 'Cancelled') : a.status === 'completed' ? 'Done' : a.status === 'requested' ? 'Requested' : a.status === 'pending_payment' || a.status === 'deposit_pending' ? 'Awaiting deposit' : 'Booked';
            return (
              <div key={a.id} className={cn('rounded-2xl border-2 p-3 space-y-2', a.status === 'cancelled' && 'opacity-60')}>
                <button type="button" onClick={() => setSheetId(a.id)} className="w-full text-left">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-black text-slate-900">{a.clientName}</p>
                      <p className="text-[11px] font-bold text-slate-500">{a.serviceName} · {when(a.startTime)}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[13px] font-black text-slate-900">${Number(a.price || 0).toFixed(2)}</p>
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">{chip}</p>
                    </div>
                  </div>
                </button>
                {isOpen && a.viaStudio && (
                  <div className="space-y-2 pt-1">
                    {(a.clientPhone || a.clientEmail) && <p className="text-[10px] font-bold text-slate-500">{[a.clientPhone, a.clientEmail].filter(Boolean).join(' · ')}</p>}
                    <p className="rounded-xl border-2 border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-600">Booked by the studio on your chair — the studio manages and is paid for this one. It&apos;s here so your day reads true; ask the studio to change it.</p>
                  </div>
                )}
                {isOpen && !a.viaStudio && (
                  <div className="space-y-2 pt-1">
                    {(a.clientPhone || a.clientEmail) && <p className="text-[10px] font-bold text-slate-500">{[a.clientPhone, a.clientEmail].filter(Boolean).join(' · ')}</p>}
                    <textarea value={noteDraft} onChange={(ev) => setNoteDraft(ev.target.value.slice(0, 1000))} rows={2} aria-label="Your note" placeholder="Your note — formula, preferences, what to remember (only you see this)" className="w-full rounded-2xl border-2 border-slate-200 px-3.5 py-2.5 text-sm" />
                    {(a.status === 'requested' || a.status === 'pending') && (
                      <div className="flex gap-2 rounded-xl border-2 border-amber-300 bg-amber-50 p-2">
                        <button type="button" disabled={busy === `d-${a.id}`} onClick={() => run(`d-${a.id}`, () => api({ action: 'book-decide', tenantId, token, appointmentId: a.id, decision: 'accept' }))} className="h-10 flex-1 rounded-xl bg-emerald-600 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40">Accept</button>
                        <button type="button" disabled={busy === `d-${a.id}`} onClick={() => run(`d-${a.id}`, () => api({ action: 'book-decide', tenantId, token, appointmentId: a.id, decision: 'decline' }))} className="h-10 flex-1 rounded-xl border-2 border-red-300 bg-white text-[10px] font-black uppercase tracking-widest text-red-700 disabled:opacity-40">Decline</button>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      <button type="button" disabled={busy === `n-${a.id}` || noteDraft === (a.note || '')} onClick={() => run(`n-${a.id}`, () => api({ action: 'book-note', tenantId, token, appointmentId: a.id, note: noteDraft }))} className="h-9 rounded-xl border-2 border-slate-200 px-3 text-[9px] font-black uppercase tracking-widest text-slate-700 disabled:opacity-40">Save note</button>
                      {!done && <button type="button" disabled={busy === `s-${a.id}`} onClick={() => run(`s-${a.id}`, () => api({ action: 'book-status', tenantId, token, appointmentId: a.id, outcome: 'completed' }))} className="h-9 rounded-xl bg-emerald-600 px-3 text-[9px] font-black uppercase tracking-widest text-white">Done ✓</button>}
                      {!done && <button type="button" disabled={busy === `s-${a.id}`} onClick={() => run(`s-${a.id}`, () => api({ action: 'book-status', tenantId, token, appointmentId: a.id, outcome: 'no_show' }))} className="h-9 rounded-xl border-2 border-amber-300 px-3 text-[9px] font-black uppercase tracking-widest text-amber-800">No-show</button>}
                      {!done && view === 'upcoming' && <button type="button" onClick={() => setResched(resched?.id === a.id ? null : { id: a.id, when: '' })} className="h-9 rounded-xl border-2 border-slate-200 px-3 text-[9px] font-black uppercase tracking-widest text-slate-700">Move</button>}
                      {!done && (confirmCancel === a.id
                        ? <button type="button" disabled={busy === `c-${a.id}`} onClick={() => run(`c-${a.id}`, () => api({ action: 'book-cancel', tenantId, token, appointmentId: a.id, tellClient: true }))} className="h-9 rounded-xl bg-red-700 px-3 text-[9px] font-black uppercase tracking-widest text-white">Tap again · cancel &amp; tell them</button>
                        : <button type="button" onClick={() => setConfirmCancel(a.id)} className="h-9 rounded-xl border-2 border-red-200 px-3 text-[9px] font-black uppercase tracking-widest text-red-700">Cancel</button>)}
                    </div>
                    {resched && resched.id === a.id && (
                      <div className="flex gap-2">
                        <input type="datetime-local" value={resched.when} onChange={(ev) => setResched({ id: a.id, when: ev.target.value })} aria-label="New time" className="h-11 flex-1 rounded-2xl border-2 border-slate-200 bg-white px-3 text-sm font-bold" />
                        <button type="button" disabled={busy === `re-${a.id}` || !resched.when} onClick={() => submitResched(a)} className="h-11 rounded-2xl bg-slate-900 px-4 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40">{busy === `re-${a.id}` ? '…' : 'Move it'}</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          }))}
      </div>
      {sheetId && (() => {
        const target = [...(book?.upcoming || []), ...(book?.past || [])].find((x: any) => x.id === sheetId);
        if (!target) return null;
        return <ApptSheet a={target} services={book?.services || []} tenantId={tenantId} token={token} onClose={() => setSheetId('')} onChanged={() => { void load(); }} bookViaEngine={bookViaEngine} />;
      })()}
    </section>
  );
}

// ─── My Clients: the renter's own directory ─────────────────────────────────
// Built from the book they own (ownerRenterId) and their own appointments:
// last visit, next visit, visits, no-shows, what they usually get, spend.
// "Hasn't been in" is the one number that fills a slow week. Notes are the
// renter's; the studio never sees this list.
export const weeksAgo = (iso: string | null) => { if (!iso) return null; const w = Math.floor((Date.now() - new Date(iso).getTime()) / (7 * 86400000)); return w < 0 ? 0 : w; };
export function MyClients({ tenantId, token }: { tenantId: string; token: string }) {
  const [list, setList] = useState<any[] | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'lapsed' | 'new' | 'archived'>('all');
  const [openId, setOpenId] = useState('');
  const [edit, setEdit] = useState<{ id: string; name: string; phone: string; email: string; notes: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const load = useCallback(async () => { const d = await api({ action: 'clients-list', tenantId, token }); if (d?.ok) setList(d.clients || []); }, [tenantId, token]);
  useEffect(() => { void load(); }, [load]);
  const when = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  const save = async () => {
    if (!edit) return;
    setBusy('save'); setErr('');
    const d = await api({ action: 'client-save', tenantId, token, clientId: edit.id || undefined, name: edit.name, phone: edit.phone, email: edit.email, notes: edit.notes });
    setBusy('');
    if (!d?.ok) { setErr(d?.error || 'Could not save.'); return; }
    setEdit(null); setAdding(false); void load(); if (!edit.id) setOpenId(d.id);
  };
  const rows = (list || []).filter((c) => {
    if (filter === 'archived' ? !c.archived : c.archived) return false;
    if (filter === 'lapsed' && !(c.visits > 0 && (weeksAgo(c.lastVisit) ?? 0) >= 6 && !c.nextVisit)) return false;
    if (filter === 'new' && c.visits > 1) return false;
    if (q.trim()) { const t = q.trim().toLowerCase(); return [c.name, c.phone, c.email].some((v) => String(v || '').toLowerCase().includes(t)); }
    return true;
  });
  const lapsedCount = (list || []).filter((c) => !c.archived && c.visits > 0 && (weeksAgo(c.lastVisit) ?? 0) >= 6 && !c.nextVisit).length;
  return (
    <section className="space-y-3">
      <SectionTitle icon={Users}>My Clients</SectionTitle>
      <div className="p-4 rounded-3xl bg-white border-2 space-y-3">
        <div className="flex gap-2">
          <input value={q} onChange={(ev) => setQ(ev.target.value)} aria-label="Search clients" placeholder="Search name, phone, email" className="h-11 flex-1 rounded-2xl border-2 border-slate-200 px-3 text-sm font-bold" />
          <button type="button" onClick={() => { setAdding(true); setEdit({ id: '', name: '', phone: '', email: '', notes: '' }); }} className="h-11 rounded-2xl bg-slate-900 px-4 text-[10px] font-black uppercase tracking-widest text-white">Add</button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {([['all', `Everyone · ${(list || []).filter((c) => !c.archived).length}`], ['lapsed', `Haven't been in 6+ wks · ${lapsedCount}`], ['new', 'First-timers'], ['archived', 'Archived']] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k} className={cn('h-9 rounded-full border-2 px-3 text-[10px] font-black uppercase tracking-widest', filter === k ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-600')}>{l}</button>
          ))}
        </div>
        {(adding || (edit && edit.id)) && edit && (
          <div className="rounded-2xl border-2 border-slate-200 bg-slate-50 p-3 space-y-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">{edit.id ? 'Edit client' : 'New client'}</p>
            <input value={edit.name} onChange={(ev) => setEdit({ ...edit, name: ev.target.value.slice(0, 120) })} aria-label="Name" placeholder="Name" className="h-11 w-full rounded-2xl border-2 border-slate-200 bg-white px-3 text-sm font-bold" />
            <div className="grid grid-cols-2 gap-2">
              <input value={edit.phone} onChange={(ev) => setEdit({ ...edit, phone: ev.target.value.slice(0, 40) })} inputMode="tel" aria-label="Phone" placeholder="Phone" className="h-11 rounded-2xl border-2 border-slate-200 bg-white px-3 text-sm font-bold" />
              <input value={edit.email} onChange={(ev) => setEdit({ ...edit, email: ev.target.value.slice(0, 160) })} inputMode="email" aria-label="Email" placeholder="Email" className="h-11 rounded-2xl border-2 border-slate-200 bg-white px-3 text-sm font-bold" />
            </div>
            <textarea value={edit.notes} onChange={(ev) => setEdit({ ...edit, notes: ev.target.value.slice(0, 2000) })} rows={3} aria-label="Notes" placeholder="Formulas, allergies, how they take their coffee. Only you see this." className="w-full rounded-2xl border-2 border-slate-200 bg-white px-3.5 py-2.5 text-sm" />
            {err && <p className="text-xs font-bold text-red-600">{err}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={save} disabled={busy === 'save' || edit.name.trim().length < 2} className="h-11 flex-1 rounded-2xl bg-slate-900 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40">{busy === 'save' ? 'Saving…' : 'Save'}</button>
              <button type="button" onClick={() => { setEdit(null); setAdding(false); }} className="h-11 rounded-2xl border-2 border-slate-200 px-4 text-[10px] font-black uppercase tracking-widest text-slate-600">Cancel</button>
            </div>
          </div>
        )}
        {list === null ? <p className="py-3 text-center text-[11px] font-bold text-slate-400">Loading…</p>
          : rows.length === 0 ? <p className="py-3 text-center text-[11px] font-bold text-slate-400">{(list || []).length === 0 ? 'Nobody yet. Clients who book through your link land here automatically.' : 'No one matches.'}</p>
          : rows.map((c) => {
            const isOpen = openId === c.id;
            const w = weeksAgo(c.lastVisit);
            const lapsed = c.visits > 0 && (w ?? 0) >= 6 && !c.nextVisit;
            return (
              <div key={c.id} className="rounded-2xl border-2 p-3 space-y-2">
                <button type="button" onClick={() => { setOpenId(isOpen ? '' : c.id); setEdit(null); setAdding(false); }} className="w-full text-left">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-black text-slate-900">{c.name}</p>
                      <p className="text-[10px] font-bold text-slate-500">
                        {c.nextVisit ? `Next ${when(c.nextVisit.startTime)}` : c.lastVisit ? `Last ${when(c.lastVisit)}${w !== null && w > 0 ? ` · ${w} wk${w === 1 ? '' : 's'} ago` : ''}` : 'No visits yet'}
                        {c.favourite ? ` · usually ${c.favourite}` : ''}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[12px] font-black text-slate-900">{c.visits} visit{c.visits === 1 ? '' : 's'}</p>
                      {lapsed && <p className="text-[9px] font-black uppercase tracking-widest text-amber-700">Reach out</p>}
                      {c.noShows > 0 && <p className="text-[9px] font-black uppercase tracking-widest text-red-700">{c.noShows} no-show{c.noShows === 1 ? '' : 's'}</p>}
                    </div>
                  </div>
                </button>
                {isOpen && (
                  <div className="space-y-2 pt-1">
                    <p className="text-[10px] font-bold text-slate-500">{[c.phone, c.email].filter(Boolean).join(' · ') || 'No contact details'} · ${(c.spentCents / 100).toFixed(0)} with you</p>
                    {c.notes && <p className="rounded-xl bg-amber-50 border-2 border-amber-100 px-3 py-2 text-[11px] font-medium text-amber-950 whitespace-pre-wrap">{c.notes}</p>}
                    <div className="flex flex-wrap gap-1.5">
                      {c.phone && <a href={`sms:${c.phone}`} className="h-9 inline-flex items-center rounded-xl border-2 border-slate-200 px-3 text-[9px] font-black uppercase tracking-widest text-slate-700">Text</a>}
                      {c.phone && <a href={`tel:${c.phone}`} className="h-9 inline-flex items-center rounded-xl border-2 border-slate-200 px-3 text-[9px] font-black uppercase tracking-widest text-slate-700">Call</a>}
                      <button type="button" onClick={() => setEdit({ id: c.id, name: c.name, phone: c.phone || '', email: c.email || '', notes: c.notes || '' })} className="h-9 rounded-xl border-2 border-slate-200 px-3 text-[9px] font-black uppercase tracking-widest text-slate-700">Edit &amp; notes</button>
                      <button type="button" disabled={busy === `a-${c.id}`} onClick={async () => { setBusy(`a-${c.id}`); await api({ action: 'client-archive', tenantId, token, clientId: c.id, restore: c.archived }); setBusy(''); void load(); }} className="h-9 rounded-xl border-2 border-slate-200 px-3 text-[9px] font-black uppercase tracking-widest text-slate-500">{c.archived ? 'Restore' : 'Archive'}</button>
                    </div>
                    {c.history.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">History</p>
                        {c.history.slice(0, 8).map((h: any) => (
                          <p key={h.id} className="text-[10px] font-bold text-slate-600"><span className="font-black text-slate-800">{when(h.startTime)}</span> · {h.serviceName} · ${Number(h.price).toFixed(0)}{h.outcome === 'no_show' ? ' · no-show' : h.status === 'cancelled' ? ' · cancelled' : ''}{h.note ? ` — ${h.note}` : ''}</p>
                        ))}
                      </div>
                    )}
                    <p className="text-[9px] font-bold text-slate-400">To book them: add a walk-in in My Book, or send them your booking link.</p>
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </section>
  );
}

// ─── My client messages ──────────────────────────────────────────────────────
// The renter's switches for what their clients hear from them, automatically:
// a reminder the day before, a thank-you the day after. Off until they say
// so. Sent in their name; the studio's message settings never touch these.
export const COMMS_KIND: Record<string, string> = { renter_client_reminder: 'Reminder', renter_client_thanks: 'Thank-you', renter_client_cancelled: 'Cancellation' };
export function MyClientMessages({ tenantId, token }: { tenantId: string; token: string }) {
  const [state, setState] = useState<{ comms: { remindersEnabled: boolean; thankYouEnabled: boolean; signoff: string }; log: any[] } | null>(null);
  const [draft, setDraft] = useState<{ remindersEnabled: boolean; thankYouEnabled: boolean; signoff: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const load = useCallback(async () => { const d = await api({ action: 'comms-get', tenantId, token }); if (d?.ok) { setState({ comms: d.comms, log: d.log || [] }); setDraft(d.comms); } }, [tenantId, token]);
  useEffect(() => { void load(); }, [load]);
  if (!state || !draft) return null;
  const dirty = JSON.stringify(draft) !== JSON.stringify(state.comms);
  const save = async () => { setBusy(true); const d = await api({ action: 'comms-save', tenantId, token, ...draft }); setBusy(false); if (d?.ok) { setSaved(true); setTimeout(() => setSaved(false), 1800); void load(); } };
  const Row = ({ k, title, body }: { k: 'remindersEnabled' | 'thankYouEnabled'; title: string; body: string }) => (
    <button type="button" aria-pressed={draft[k]} onClick={() => setDraft({ ...draft, [k]: !draft[k] })}
      className={cn('w-full rounded-2xl border-2 px-3.5 py-3 flex items-center justify-between gap-3 text-left', draft[k] ? 'border-slate-900 bg-slate-50' : 'border-slate-200 bg-white')}>
      <span className="min-w-0"><span className="block text-[11px] font-black uppercase tracking-widest">{title}</span><span className="block text-[10px] font-bold text-slate-500">{body}</span></span>
      <span className={cn('shrink-0 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest', draft[k] ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500')}>{draft[k] ? 'On' : 'Off'}</span>
    </button>
  );
  return (
    <section className="space-y-3">
      <SectionTitle icon={BellRing}>My client messages</SectionTitle>
      <div className="p-4 rounded-3xl bg-white border-2 space-y-3">
        <p className="text-[10px] font-bold text-slate-500">Sent in your name to your clients, automatically. These are your messages — the studio's message settings don't touch them.</p>
        <Row k="remindersEnabled" title="Reminder the day before" body="“Reminder — your Gel Fill with Ana is Tue, Sep 8 at 2:00 PM.” Text first, email if there's no phone." />
        <Row k="thankYouEnabled" title="Thank-you the day after" body="A thanks and your booking link, the morning after a visit. No review link — that's yours to ask for." />
        <div>
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Sign-off (optional)</p>
          <input value={draft.signoff} onChange={(ev) => setDraft({ ...draft, signoff: ev.target.value.slice(0, 160) })} aria-label="Sign-off added to your messages" placeholder="Can't wait to see you! — Ana" className="h-11 w-full rounded-2xl border-2 border-slate-200 px-3 text-sm font-bold" />
        </div>
        <div className="flex items-center justify-end gap-2">
          {saved && <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Saved</span>}
          <button type="button" onClick={save} disabled={busy || !dirty} className="h-11 rounded-2xl bg-slate-900 px-5 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40">{busy ? 'Saving…' : 'Save'}</button>
        </div>
        {state.log.length > 0 && (
          <div className="space-y-1">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Recently sent for you</p>
            {state.log.map((m) => (
              <p key={m.id} className="text-[10px] font-bold text-slate-600">{fmtDate(String(m.at).slice(0, 10))} · {COMMS_KIND[m.kind] || m.kind} · {m.channel} to {m.to} · <span className={cn('font-black', m.status === 'sent' ? 'text-emerald-700' : 'text-slate-500')}>{m.status}</span></p>
            ))}
          </div>
        )}
        <p className="text-[9px] font-bold text-slate-400">Reminders go out at the studio's reminder hour, the day before. Cancellations you make in My Book are always sent when you choose “cancel & tell them”.</p>
      </div>
    </section>
  );
}
