'use client';

// src/app/rent/[tenantId]/page.tsx
//
// v81 — Guest portal for booth renters WITHOUT staff records (day/hourly
// renters), plus a lightweight view for leased renters who never got a
// staff login. Everything goes through /api/portal/renter — this page
// makes ZERO direct Firestore reads, so it works under the hardened rules
// with no client SDK auth at all.
//
// Flow: enter the phone/email you booked with → the studio front desk
// receives a 6-digit code and relays it (SMS delivery slots in later,
// server-side only) → 24h session (token in localStorage) → dashboard:
//   · Today card — self check-in / check-out with honest settlement
//     results (overage due / credit pending review)
//   · Upcoming bookings + booking history
//   · Credits balance (auto-applies at their next booking)
//   · Lease + rent invoices (for leased renters) and payment history
//
// Hybrid renters (chair + salon booking system) keep the full staff
// portal; this page is intentionally simpler.

import { downscaleImageToDataUrl } from '@/lib/client-image';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { credentialViews, stateLabel, CREDENTIAL_LABEL } from '@/lib/compliance';
import { useToast } from '@/hooks/use-toast';
import {
  Armchair, CalendarDays, Clock, CreditCard, LogOut, Loader,
  CheckCircle2, Sparkles, ChevronRight, Receipt, AlertTriangle,
  Wallet, KeyRound, Phone, RefreshCw, Repeat, X,
  MessageSquare,
  CalendarClock,
  ShieldAlert,
  Wrench,
  CloudLightning,
  FileSignature,
} from 'lucide-react';

// Local YYYY-MM-DD — the UTC-slice version flips to tomorrow in the evening.
const localISO = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmtDate = (s?: string | null) => {
  if (!s) return '';
  try { return format(parseISO(String(s).slice(0, 10) + 'T12:00:00'), 'EEE, MMM d'); } catch { return s; }
};
const fmtMoney = (cents: number) => `$${((cents || 0) / 100).toFixed(2)}`;
const fmtTime = (t?: string | null) => {
  if (!t) return '';
  try { return format(parseISO(`2000-01-01T${t}:00`), 'h:mm a'); } catch { return t; }
};

// ─── Leave ───────────────────────────────────────────────────────────────────
// The renter asks; the studio decides. Only treatments the shop offers are
// shown, and a request changes nothing until it is approved. Banked days work
// the same way: asking to spend them is not spending them.
// ─── Documents ───────────────────────────────────────────────────────────────
// The paperwork after the lease, read and signed here. Signing is typing your
// full name — the same way the lease was signed — and the record lands beside
// it, with the exact text, the time, and the device. Declining is allowed and
// is a message to the studio, not a silent no.
const DOC_STATUS: Record<string, string> = { sent: 'Waiting for you', signed: 'Signed', declined: 'Declined', withdrawn: 'Withdrawn by the studio' };
function RenterDocuments({ tenantId, token }: { tenantId: string; token: string }) {
  const [state, setState] = useState<{ documents: any[]; signed: any[]; portalToken: string | null } | null>(null);
  const [openId, setOpenId] = useState('');
  const [name, setName] = useState('');
  const [declining, setDeclining] = useState('');
  const [declineNote, setDeclineNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    const d = await api({ action: 'documents-list', tenantId, token });
    if (d?.ok) setState({ documents: d.documents || [], signed: d.signed || [], portalToken: d.portalToken || null });
  }, [tenantId, token]);
  useEffect(() => { void load(); }, [load]);
  if (!state) return null;
  const pending = state.documents.filter((d) => d.status === 'sent');
  const past = state.documents.filter((d) => d.status !== 'sent').slice(0, 6);
  if (pending.length === 0 && past.length === 0 && state.signed.length === 0) return null;
  const sign = async (id: string) => {
    setBusy(true); setErr('');
    const d = await api({ action: 'document-sign', tenantId, token, documentId: id, signedName: name });
    setBusy(false);
    if (!d?.ok) { setErr(d?.error || 'Could not sign.'); return; }
    setOpenId(''); setName(''); void load();
  };
  const decline = async (id: string) => {
    setBusy(true); setErr('');
    const d = await api({ action: 'document-decline', tenantId, token, documentId: id, note: declineNote });
    setBusy(false);
    if (!d?.ok) { setErr(d?.error || 'Could not send that.'); return; }
    setDeclining(''); setDeclineNote(''); setOpenId(''); void load();
  };
  const printUrl = (id: string) => `/api/booths/renter-document?tenantId=${encodeURIComponent(tenantId)}&id=${encodeURIComponent(id)}${state.portalToken ? `&renter=${encodeURIComponent(state.portalToken)}` : ''}`;
  return (
    <section className="space-y-3">
      <SectionTitle icon={FileSignature}>Documents</SectionTitle>
      <div className="p-4 rounded-3xl bg-white border-2 border-slate-100 space-y-3">
        {pending.map((d) => {
          const isOpen = openId === d.id;
          const verb = d.action === 'acknowledge' ? 'acknowledge' : 'sign';
          return (
            <div key={d.id} className="rounded-2xl border-2 border-amber-300 bg-amber-50 px-3.5 py-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[12px] font-black">{d.title}</p>
                <span className="shrink-0 rounded-full bg-amber-200 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-amber-900">To {verb}</span>
              </div>
              <p className="text-[10px] font-bold text-amber-900">Sent {fmtDate(String(d.sentAt).slice(0, 10))} by {d.sentBy}</p>
              {!isOpen ? (
                <button type="button" onClick={() => { setOpenId(d.id); setErr(''); }} className="h-11 w-full rounded-2xl bg-slate-900 text-[10px] font-black uppercase tracking-widest text-white">Read it</button>
              ) : (
                <div className="space-y-2">
                  <div className="max-h-80 overflow-y-auto overscroll-contain rounded-2xl bg-white border-2 border-slate-200 px-3.5 py-3 text-[12px] leading-relaxed font-medium text-slate-800 whitespace-pre-wrap">{d.body}</div>
                  {declining === d.id ? (
                    <div className="space-y-2">
                      <textarea value={declineNote} onChange={(e) => setDeclineNote(e.target.value.slice(0, 600))} rows={2} aria-label="Why you are declining" placeholder="Tell the studio why (optional). This goes to them as a message." className="w-full rounded-2xl border-2 border-slate-200 px-3.5 py-2.5 text-sm bg-white" />
                      <div className="flex gap-2">
                        <button type="button" onClick={() => decline(d.id)} disabled={busy} className="h-11 flex-1 rounded-2xl border-2 border-red-300 bg-white text-[10px] font-black uppercase tracking-widest text-red-700 disabled:opacity-40">{busy ? '…' : 'Decline this document'}</button>
                        <button type="button" onClick={() => setDeclining('')} className="h-11 rounded-2xl border-2 border-slate-200 bg-white px-3 text-[10px] font-black uppercase tracking-widest text-slate-600">Back</button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <input value={name} onChange={(e) => setName(e.target.value.slice(0, 120))} aria-label="Type your full name to sign" placeholder="Type your full name to sign" autoComplete="name" className="h-11 w-full rounded-2xl border-2 border-slate-200 bg-white px-3 text-sm font-bold" />
                      <p className="text-[9px] font-bold text-slate-500">Typing your name and tapping {verb} is your signature. The exact text above, the time and this device are recorded with it.</p>
                      {err && <p className="text-xs font-bold text-red-600">{err}</p>}
                      <div className="flex gap-2">
                        <button type="button" onClick={() => sign(d.id)} disabled={busy || name.trim().length < 2} className="h-11 flex-1 rounded-2xl bg-slate-900 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40">{busy ? '…' : verb === 'sign' ? 'Sign' : 'Acknowledge'}</button>
                        <button type="button" onClick={() => setDeclining(d.id)} className="h-11 rounded-2xl border-2 border-slate-200 bg-white px-3 text-[10px] font-black uppercase tracking-widest text-slate-600">Decline</button>
                        <a href={printUrl(d.id)} target="_blank" rel="noopener" className="h-11 inline-flex items-center rounded-2xl border-2 border-slate-200 bg-white px-3 text-[10px] font-black uppercase tracking-widest text-slate-600">Print</a>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {(past.length > 0 || state.signed.length > 0) && (
          <div className="space-y-1">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">On file</p>
            {past.map((d) => (
              <p key={d.id} className="text-[10px] font-bold text-slate-600 flex items-center justify-between gap-2">
                <span className="truncate">{d.title} · {DOC_STATUS[d.status] || d.status}{d.signedAt ? ` ${fmtDate(String(d.signedAt).slice(0, 10))}` : ''}</span>
                {d.status === 'signed' && <a href={printUrl(d.id)} target="_blank" rel="noopener" className="shrink-0 text-[9px] font-black uppercase tracking-widest underline">Print</a>}
              </p>
            ))}
            {state.signed.filter((sd) => !past.some((d) => d.signedDocumentId === sd.id)).map((sd) => (
              <p key={sd.id} className="text-[10px] font-bold text-slate-600">{sd.title} · Signed {fmtDate(String(sd.signedAt).slice(0, 10))}</p>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Closures — what it cost you ─────────────────────────────────────────────
// Shown only when the studio has recorded an interruption that touched this
// renter's space. A rent credit covers the chair; this covers the clients they
// turned away — the number THEIR insurer or accountant will ask for. They
// write it, day by day, while it is fresh. The studio can read it, never edit
// it. "Print my statement" is their slice of the packet, signed by them.
const ITYPE: Record<string, string> = { flood: 'Flood / water damage', fire: 'Fire / smoke', power: 'Power loss', water: 'No running water', weather: 'Weather', closure: 'Forced closure', other: 'Closure' };
function RenterInterruptions({ tenantId, token }: { tenantId: string; token: string }) {
  const [state, setState] = useState<{ interruptions: any[]; portalToken: string | null } | null>(null);
  const [logFor, setLogFor] = useState('');
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), appointmentsLost: '', lost: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    const d = await api({ action: 'interruption-list', tenantId, token });
    if (d?.ok) setState({ interruptions: d.interruptions || [], portalToken: d.portalToken || null });
  }, [tenantId, token]);
  useEffect(() => { void load(); }, [load]);
  if (!state || state.interruptions.length === 0) return null;
  const submit = async (id: string) => {
    setBusy(true); setErr('');
    const d = await api({ action: 'interruption-loss', tenantId, token, interruptionId: id, date: form.date, appointmentsLost: Number(form.appointmentsLost) || 0, lostCents: Math.round((Number(form.lost) || 0) * 100), note: form.note });
    setBusy(false);
    if (!d?.ok) { setErr(d?.error || 'Could not save that.'); return; }
    setLogFor(''); setForm({ date: new Date().toISOString().slice(0, 10), appointmentsLost: '', lost: '', note: '' }); void load();
  };
  return (
    <section className="space-y-3">
      <SectionTitle icon={CloudLightning}>Closures · what it cost you</SectionTitle>
      {state.interruptions.map((r) => (
        <div key={r.id} className="p-4 rounded-3xl bg-white border-2 border-slate-100 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[12px] font-black truncate">{r.title}</p>
              <p className="text-[10px] font-bold text-slate-500">{ITYPE[r.type] || 'Closure'} · {fmtDate(r.startDate)}{r.endDate ? ` – ${fmtDate(r.endDate)}` : ' – ongoing'}</p>
            </div>
            <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-widest', r.status === 'open' ? 'bg-red-600 text-white' : 'bg-slate-200 text-slate-700')}>{r.status === 'open' ? 'Ongoing' : 'Over'}</span>
          </div>
          {r.updates.length > 0 && (
            <div className="space-y-1">
              {r.updates.slice(-3).map((u: any, i: number) => <p key={i} className="text-[10px] font-medium text-slate-600"><span className="font-black">{fmtDate(String(u.at).slice(0, 10))}</span> · {u.text}</p>)}
            </div>
          )}
          <div className="rounded-2xl bg-slate-50 border-2 border-slate-100 px-3.5 py-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Your loss log</p>
              <p className="text-[11px] font-black tabular-nums">{r.totals.appointmentsLost} appt{r.totals.appointmentsLost === 1 ? '' : 's'} · ${(r.totals.lostCents / 100).toFixed(2)} · {r.totals.days} day{r.totals.days === 1 ? '' : 's'}</p>
            </div>
            {r.losses.length === 0 && <p className="text-[10px] font-bold text-slate-500">Nothing logged yet. A rent credit covers the chair — this is for the clients you couldn't see, the number your own insurer or accountant will ask for. Log it while it's fresh.</p>}
            {r.losses.map((l: any) => (
              <p key={l.id} className="text-[10px] font-medium text-slate-700"><span className="font-black">{fmtDate(l.date)}</span> · {l.appointmentsLost} appt{l.appointmentsLost === 1 ? '' : 's'} · ${(l.lostCents / 100).toFixed(2)}{l.note ? ` — ${l.note}` : ''}</p>
            ))}
            {logFor === r.id ? (
              <div className="space-y-2">
                <input type="date" value={form.date} min={r.startDate} max={r.endDate || undefined} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} aria-label="Which day" className="h-11 w-full rounded-2xl border-2 border-slate-200 px-3 text-sm font-bold bg-white" />
                <div className="grid grid-cols-2 gap-2">
                  <input inputMode="numeric" value={form.appointmentsLost} onChange={(e) => setForm((f) => ({ ...f, appointmentsLost: e.target.value.replace(/[^0-9]/g, '') }))} aria-label="Appointments you couldn't do" placeholder="Appts lost" className="h-11 rounded-2xl border-2 border-slate-200 px-3 text-sm font-bold bg-white" />
                  <input inputMode="decimal" value={form.lost} onChange={(e) => setForm((f) => ({ ...f, lost: e.target.value.replace(/[^0-9.]/g, '') }))} aria-label="Income lost, dollars" placeholder="$ lost (your estimate)" className="h-11 rounded-2xl border-2 border-slate-200 px-3 text-sm font-bold bg-white" />
                </div>
                <input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value.slice(0, 500) }))} aria-label="Note" placeholder="Who you rescheduled, what you refunded (optional)" className="h-11 w-full rounded-2xl border-2 border-slate-200 px-3 text-sm bg-white" />
                {err && <p className="text-xs font-bold text-red-600">{err}</p>}
                <div className="flex gap-2">
                  <button type="button" onClick={() => submit(r.id)} disabled={busy || !form.date} className="h-11 flex-1 rounded-2xl bg-slate-900 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40">{busy ? 'Saving…' : 'Save this day'}</button>
                  <button type="button" onClick={() => setLogFor('')} className="h-11 rounded-2xl border-2 border-slate-200 px-4 text-[10px] font-black uppercase tracking-widest text-slate-600">Cancel</button>
                </div>
                <p className="text-[9px] font-bold text-slate-400">One entry per day. Saving a day again replaces it.</p>
              </div>
            ) : (
              <div className="flex gap-2">
                <button type="button" onClick={() => { setLogFor(r.id); setErr(''); }} className="h-10 flex-1 rounded-2xl border-2 border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-700">Log a day</button>
                {r.losses.length > 0 && state.portalToken && (
                  <a href={`/api/booths/interruption-packet?tenantId=${encodeURIComponent(tenantId)}&id=${encodeURIComponent(r.id)}&renter=${encodeURIComponent(state.portalToken)}`} target="_blank" rel="noopener"
                    className="h-10 inline-flex items-center rounded-2xl border-2 border-slate-200 px-3 text-[10px] font-black uppercase tracking-widest text-slate-700">Print my statement</a>
                )}
              </div>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}

// ─── Maintenance ─────────────────────────────────────────────────────────────
// Report a problem with the space, see the studio's promise BEFORE reporting,
// then watch the ticket move. The two clocks are the studio's own commitments
// (set in Maintenance → Rules), so what this page promises is exactly what
// the ticket is measured against. A photo beats any description.
const TICKET_CATS: [string, string][] = [
  ['equipment', 'Equipment'], ['plumbing', 'Plumbing / water'], ['electrical', 'Electrical / power'], ['cleaning', 'Cleaning'],
  ['safety', 'Safety'], ['request', 'A request'], ['other', 'Something else'],
];
const TSTATUS: Record<string, string> = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved', cancelled: 'Cancelled' };
const hrs = (h: number) => (h < 24 ? `${h} hr${h === 1 ? '' : 's'}` : h % 24 === 0 ? `${h / 24} day${h === 24 ? '' : 's'}` : `${Math.round(h / 24)} days`);
const clock = (iso: string | null, done: boolean) => {
  if (!iso || done) return null;
  const ms = new Date(iso).getTime() - Date.now();
  const h = Math.round(Math.abs(ms) / 3_600_000);
  return ms >= 0 ? `${h < 1 ? 'under an hour' : hrs(h)} left` : `${hrs(Math.max(1, h))} over`;
};
function RenterMaintenance({ tenantId, token }: { tenantId: string; token: string }) {
  const [state, setState] = useState<{ tickets: any[]; commitments: any[] } | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', category: 'equipment', priority: 'normal', description: '', photoData: '' });
  const [noteFor, setNoteFor] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [expanded, setExpanded] = useState('');
  const load = useCallback(async () => {
    const d = await api({ action: 'my-tickets', tenantId, token });
    if (d?.ok) setState({ tickets: d.tickets || [], commitments: d.commitments || [] });
  }, [tenantId, token]);
  useEffect(() => { void load(); }, [load]);
  const readPhoto = (file: File | undefined, cb: (dataUrl: string) => void) => {
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) { setErr('That photo is over 6MB — try a smaller one.'); return; }
    const r = new FileReader(); r.onload = () => cb(String(r.result || '')); r.readAsDataURL(file);
  };
  const submit = async () => {
    setBusy(true); setErr('');
    const d = await api({ action: 'create-ticket', tenantId, token, ...form });
    setBusy(false);
    if (!d?.ok) { setErr(d?.error || 'Could not send that.'); return; }
    setOpen(false); setForm({ title: '', category: 'equipment', priority: 'normal', description: '', photoData: '' }); void load();
  };
  const addNote = async (ticketId: string, photoData?: string) => {
    setBusy(true); setErr('');
    const d = await api({ action: 'ticket-note', tenantId, token, ticketId, note: note.trim(), photoData: photoData || '' });
    setBusy(false);
    if (!d?.ok) { setErr(d?.error || 'Could not send that.'); return; }
    setNote(''); setNoteFor(''); void load();
  };
  if (!state) return null;
  const openT = state.tickets.filter((t) => t.status === 'open' || t.status === 'in_progress');
  const doneT = state.tickets.filter((t) => !(t.status === 'open' || t.status === 'in_progress')).slice(0, 5);
  const promise = state.commitments.filter((c) => c.renterCanPick);
  const urgent = state.commitments.find((c) => c.priority === 'urgent');
  return (
    <section className="space-y-3">
      <SectionTitle icon={Wrench}>Something broken?</SectionTitle>
      <div className="p-4 rounded-3xl bg-white border-2 border-slate-100 space-y-3">
        {promise.length > 0 && (
          <div className="rounded-2xl bg-slate-50 border-2 border-slate-100 px-3.5 py-3">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1.5">The studio's promise</p>
            <div className="space-y-1">
              {promise.map((c) => (
                <p key={c.priority} className="text-[11px] font-bold text-slate-700"><span className="capitalize font-black">{c.label}</span> · answered within {hrs(c.respondHours)}, fixed within {hrs(c.fixHours)}</p>
              ))}
              {urgent && <p className="text-[10px] font-bold text-slate-500">Safety or no-water issues the studio judges urgent: answered within {hrs(urgent.respondHours)}, fixed within {hrs(urgent.fixHours)}.</p>}
            </div>
          </div>
        )}

        {openT.map((t) => {
          const done = t.status === 'resolved' || t.status === 'cancelled';
          const ans = clock(t.respondBy, t.acknowledged || done);
          const fix = clock(t.dueAt, done);
          const isOpen = expanded === t.id;
          return (
            <div key={t.id} className="rounded-2xl border-2 border-slate-200 px-3.5 py-3 space-y-1.5">
              <button type="button" onClick={() => setExpanded(isOpen ? '' : t.id)} aria-expanded={isOpen} className="w-full text-left">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[12px] font-black truncate">{t.title}</p>
                  <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-widest', t.status === 'in_progress' ? 'bg-amber-100 text-amber-800' : 'bg-slate-200 text-slate-700')}>{TSTATUS[t.status] || t.status}</span>
                </div>
                <p className="text-[10px] font-bold text-slate-500">
                  {t.priority} · reported {fmtDate(String(t.createdAt).slice(0, 10))}
                  {t.assigneeName ? ` · ${t.assigneeName} has it` : t.acknowledged ? ' · seen by the studio' : ans ? ` · answer due: ${ans}` : ''}
                  {fix ? ` · fix due: ${fix}` : ''}
                </p>
              </button>
              {isOpen && (
                <div className="space-y-1.5 pt-1">
                  {t.description && <p className="text-[11px] font-medium text-slate-700 whitespace-pre-wrap">{t.description}</p>}
                  {(t.updates || []).slice(1).map((u: any, i: number) => (
                    <p key={i} className="text-[10px] font-medium text-slate-600"><span className="font-black">{fmtDate(String(u.at).slice(0, 10))} · {u.by}</span>{u.note ? ` — ${u.note}` : ''}{u.status ? ` (${TSTATUS[u.status] || u.status})` : ''}{u.photoUrl ? ' · photo' : ''}</p>
                  ))}
                  {noteFor === t.id ? (
                    <div className="space-y-1.5">
                      <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 1000))} rows={2} aria-label="Add to this ticket" placeholder="Still happening? Something changed?" className="w-full rounded-2xl border-2 border-slate-200 px-3.5 py-2.5 text-sm" />
                      <div className="flex gap-2">
                        <button type="button" disabled={busy || !note.trim()} onClick={() => addNote(t.id)} className="h-10 flex-1 rounded-2xl bg-slate-900 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40">Add note</button>
                        <label className="h-10 rounded-2xl border-2 border-slate-200 px-3 inline-flex items-center text-[10px] font-black uppercase tracking-widest text-slate-700 cursor-pointer">
                          Photo<input type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Add a photo to this ticket" onChange={(e) => readPhoto(e.target.files?.[0], (d) => addNote(t.id, d))} />
                        </label>
                        <button type="button" onClick={() => { setNoteFor(''); setNote(''); }} className="h-10 rounded-2xl border-2 border-slate-200 px-3 text-[10px] font-black uppercase tracking-widest text-slate-600">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setNoteFor(t.id)} className="h-9 w-full rounded-2xl border-2 border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-700">Add a note or photo</button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {!open ? (
          <button type="button" onClick={() => setOpen(true)} className="h-11 w-full rounded-2xl bg-slate-900 text-[10px] font-black uppercase tracking-widest text-white">Report a problem</button>
        ) : (
          <div className="space-y-2">
            <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value.slice(0, 120) }))} aria-label="What's wrong, in a few words" placeholder="Dryer at my station won't turn on" className="h-11 w-full rounded-2xl border-2 border-slate-200 px-3 text-sm font-bold" />
            <div className="grid grid-cols-2 gap-2">
              <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} aria-label="Category" className="h-11 rounded-2xl border-2 border-slate-200 px-3 text-sm font-bold bg-white">
                {TICKET_CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))} aria-label="How urgent" className="h-11 rounded-2xl border-2 border-slate-200 px-3 text-sm font-bold bg-white">
                <option value="high">High · can't work</option>
                <option value="normal">Normal · a nuisance</option>
                <option value="low">Low · whenever</option>
              </select>
            </div>
            <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value.slice(0, 2000) }))} rows={3} aria-label="Details" placeholder="What's happening, since when, what you've tried." className="w-full rounded-2xl border-2 border-slate-200 px-3.5 py-2.5 text-sm" />
            <label className="h-11 w-full rounded-2xl border-2 border-slate-200 inline-flex items-center justify-center text-[10px] font-black uppercase tracking-widest text-slate-700 cursor-pointer">
              {form.photoData ? 'Photo attached · tap to change' : 'Add a photo'}
              <input type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Photo of the problem" onChange={(e) => readPhoto(e.target.files?.[0], (d) => setForm((f) => ({ ...f, photoData: d })))} />
            </label>
            {err && <p className="text-xs font-bold text-red-600">{err}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={submit} disabled={busy || !form.title.trim()} className="h-11 flex-1 rounded-2xl bg-slate-900 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40">{busy ? 'Sending…' : 'Send it'}</button>
              <button type="button" onClick={() => setOpen(false)} className="h-11 rounded-2xl border-2 border-slate-200 px-4 text-[10px] font-black uppercase tracking-widest text-slate-600">Cancel</button>
            </div>
          </div>
        )}
        {err && !open && <p className="text-xs font-bold text-red-600">{err}</p>}
        {doneT.length > 0 && (
          <div className="space-y-1">
            {doneT.map((t) => <p key={t.id} className="text-[10px] font-bold text-slate-500">{t.title} · {TSTATUS[t.status] || t.status}{t.resolvedAt ? ` ${fmtDate(String(t.resolvedAt).slice(0, 10))}` : ''}</p>)}
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Concerns ────────────────────────────────────────────────────────────────
// Raising something properly: a category, what happened, when, what they'd
// like to see. It gets a reference number and a receipt, and its status shows
// here until it is resolved. Replies from the studio arrive in the thread
// below with the reference on them. A chat message is for "is the back door
// locked?"; this is for the thing that needs to be on record.
const CONCERN_CATEGORIES: [string, string][] = [
  ['space', 'My space'], ['equipment', 'Equipment'], ['cleanliness', 'Cleanliness'], ['noise', 'Noise or disruption'],
  ['another_renter', 'Another renter'], ['staff', 'A staff member'], ['billing', 'Rent or billing'], ['safety', 'Safety'],
  ['access', 'Access or hours'], ['other', 'Something else'],
];
const CONCERN_STATUS: Record<string, string> = { open: 'Received', acknowledged: 'Being looked at', resolved: 'Resolved', closed: 'Closed' };
function RenterConcerns({ tenantId, token }: { tenantId: string; token: string }) {
  const [list, setList] = useState<any[] | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ category: 'space', what: '', when: new Date().toISOString().slice(0, 10), wanted: '', confidential: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [justFiled, setJustFiled] = useState('');
  const load = useCallback(async () => {
    const d = await api({ action: 'concern-list', tenantId, token });
    if (d?.ok) setList(d.concerns || []);
  }, [tenantId, token]);
  useEffect(() => { void load(); }, [load]);
  const sensitive = ['another_renter', 'staff', 'safety'].includes(form.category);
  const submit = async () => {
    setBusy(true); setErr('');
    const d = await api({ action: 'concern-file', tenantId, token, ...form, confidential: form.confidential || sensitive });
    setBusy(false);
    if (!d?.ok) { setErr(d?.error || 'Could not send that.'); return; }
    setJustFiled(d.ref); setOpen(false);
    setForm({ category: 'space', what: '', when: new Date().toISOString().slice(0, 10), wanted: '', confidential: false });
    void load();
  };
  const openOnes = (list || []).filter((c) => c.status === 'open' || c.status === 'acknowledged');
  const doneOnes = (list || []).filter((c) => !(c.status === 'open' || c.status === 'acknowledged')).slice(0, 5);
  return (
    <section className="space-y-3">
      <SectionTitle icon={ShieldAlert}>Raise a concern</SectionTitle>
      <div className="p-4 rounded-3xl bg-white border-2 border-slate-100 space-y-3">
        {justFiled && (
          <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 px-3.5 py-3">
            <p className="text-[11px] font-black uppercase tracking-widest text-emerald-800">On file · {justFiled}</p>
            <p className="text-[11px] font-bold text-emerald-900">Keep that reference. A receipt is on its way to your email, and you'll see replies below.</p>
          </div>
        )}
        {openOnes.map((c) => (
          <div key={c.id} className="rounded-2xl border-2 border-slate-200 bg-slate-50 px-3.5 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-black uppercase tracking-widest text-slate-700">{c.ref} · {(CONCERN_CATEGORIES.find(([k]) => k === c.category) || [])[1] || c.category}</p>
              <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-widest', c.status === 'acknowledged' ? 'bg-amber-100 text-amber-800' : 'bg-slate-200 text-slate-700')}>{CONCERN_STATUS[c.status] || c.status}</span>
            </div>
            <p className="text-[11px] font-medium text-slate-700 mt-1 line-clamp-2">{c.what}</p>
            <p className="text-[10px] font-bold text-slate-500 mt-1">Filed {fmtDate(String(c.filedAt).slice(0, 10))}{c.responses ? ` · ${c.responses} repl${c.responses === 1 ? 'y' : 'ies'} in your messages` : ''}</p>
          </div>
        ))}
        {!open ? (
          <button type="button" onClick={() => { setOpen(true); setJustFiled(''); }}
            className="h-11 w-full rounded-2xl border-2 border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-700">
            Raise a concern
          </button>
        ) : (
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-slate-500">For anything that should be on record. Quick questions belong in messages below.</p>
            <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} aria-label="What is it about"
              className="h-11 w-full rounded-2xl border-2 border-slate-200 px-3 text-sm font-bold bg-white">
              {CONCERN_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input type="date" value={form.when} onChange={(e) => setForm((f) => ({ ...f, when: e.target.value }))} aria-label="When did it happen or start" className="h-11 w-full rounded-2xl border-2 border-slate-200 px-3 text-sm font-bold" />
            <textarea value={form.what} onChange={(e) => setForm((f) => ({ ...f, what: e.target.value.slice(0, 2000) }))} rows={4} aria-label="What happened"
              placeholder="What happened, in your words. Dates, names, what you've already tried." className="w-full rounded-2xl border-2 border-slate-200 px-3.5 py-2.5 text-sm" />
            <textarea value={form.wanted} onChange={(e) => setForm((f) => ({ ...f, wanted: e.target.value.slice(0, 800) }))} rows={2} aria-label="What you would like to see happen"
              placeholder="What would put this right? (optional)" className="w-full rounded-2xl border-2 border-slate-200 px-3.5 py-2.5 text-sm" />
            <button type="button" aria-pressed={form.confidential || sensitive} onClick={() => setForm((f) => ({ ...f, confidential: !f.confidential }))} disabled={sensitive}
              className={cn('h-10 w-full rounded-2xl border-2 px-3 text-left text-[10px] font-bold', (form.confidential || sensitive) ? 'border-slate-900 bg-slate-50 text-slate-900' : 'border-slate-200 text-slate-600')}>
              {sensitive ? 'Treated as confidential — concerns about people always are' : form.confidential ? 'Confidential — for the studio owner only' : 'Mark confidential'}
            </button>
            {err && <p className="text-xs font-bold text-red-600">{err}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={submit} disabled={busy || form.what.trim().length < 10}
                className="h-11 flex-1 rounded-2xl bg-slate-900 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40">{busy ? 'Sending…' : 'Put it on record'}</button>
              <button type="button" onClick={() => setOpen(false)} className="h-11 rounded-2xl border-2 border-slate-200 px-4 text-[10px] font-black uppercase tracking-widest text-slate-600">Cancel</button>
            </div>
          </div>
        )}
        {doneOnes.length > 0 && (
          <div className="space-y-1">
            {doneOnes.map((c) => (
              <p key={c.id} className="text-[10px] font-bold text-slate-500">{c.ref} · {CONCERN_STATUS[c.status] || c.status}{c.resolvedAt ? ` ${fmtDate(String(c.resolvedAt).slice(0, 10))}` : ''}{c.resolution ? ` — ${c.resolution}` : ''}</p>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function RenterLeave({ tenantId, token }: { tenantId: string; token: string }) {
  const [state, setState] = useState<{ policy: any; leaves: any[] } | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ type: 'maternity', startDate: '', endDate: '', preferred: '', note: '' });
  const [redeemFor, setRedeemFor] = useState('');
  const [redeemDays, setRedeemDays] = useState('1');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    const d = await api({ action: 'leave-list', tenantId, token });
    if (d?.ok) setState({ policy: d.policy, leaves: d.leaves || [] });
  }, [tenantId, token]);
  useEffect(() => { void load(); }, [load]);
  if (!state || state.policy.offered.length === 0) return null;
  const TL: Record<string, string> = { pause: 'Pause rent', reduced: 'Reduced holding rate', bank: 'Keep paying, bank days', sublet: 'Sublet while away' };
  const pending = state.leaves.find((l) => l.status === 'requested');
  const active = state.leaves.find((l) => l.status === 'approved');
  const banked = state.leaves
    .filter((l) => ['approved', 'ended'].includes(l.status))
    .map((l) => ({ ...l, left: Math.max(0, (Number(l.bankedDays) || 0) - (Number(l.redeemedDays) || 0)) }))
    .filter((l) => l.left > 0 || (l.redeem && l.redeem.status === 'requested'));
  const submit = async () => {
    setBusy(true); setErr('');
    const d = await api({ action: 'leave-request', tenantId, token, ...form });
    setBusy(false);
    if (!d?.ok) { setErr(d?.error || 'Could not send that.'); return; }
    setOpen(false); setForm({ type: 'maternity', startDate: '', endDate: '', preferred: '', note: '' }); void load();
  };
  const askRedeem = async (leaveId: string, max: number) => {
    setBusy(true); setErr('');
    const d = await api({ action: 'leave-redeem', tenantId, token, leaveId, days: Math.max(1, Math.min(max, Number(redeemDays) || 1)) });
    setBusy(false);
    if (!d?.ok) { setErr(d?.error || 'Could not send that.'); return; }
    setRedeemFor(''); setRedeemDays('1'); void load();
  };
  return (
    <section className="space-y-3">
      <SectionTitle icon={CalendarClock}>Time away</SectionTitle>
      <div className="p-4 rounded-3xl bg-white border-2 border-slate-100 space-y-3">
        {active && (
          <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 px-3.5 py-3">
            <p className="text-[11px] font-black uppercase tracking-widest text-emerald-800">On leave · {fmtDate(active.startDate)} – {fmtDate(active.endDate)}</p>
            <p className="text-[11px] font-bold text-emerald-900">{TL[active.treatment] || active.treatment}{active.treatment === 'bank' && active.bankedDays ? ` · ${active.bankedDays} day${active.bankedDays === 1 ? '' : 's'} banked so far` : ''}{active.treatment === 'pause' && active.pausedDays ? ` · lease extends ${active.pausedDays} day${active.pausedDays === 1 ? '' : 's'}` : ''}</p>
          </div>
        )}
        {pending && (
          <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 px-3.5 py-3">
            <p className="text-[11px] font-black uppercase tracking-widest text-amber-800">Requested · {fmtDate(pending.startDate)} – {fmtDate(pending.endDate)}</p>
            <p className="text-[11px] font-bold text-amber-900">Waiting on the studio. Rent continues as normal until it is approved.</p>
          </div>
        )}

        {banked.map((l) => (
          <div key={`bank-${l.id}`} className="rounded-2xl border-2 border-slate-200 bg-slate-50 px-3.5 py-3 space-y-2">
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-700">{l.left} banked rental day{l.left === 1 ? '' : 's'}</p>
            {l.redeem && l.redeem.status === 'requested' ? (
              <p className="text-[11px] font-bold text-amber-800">You asked to use {l.redeem.days} — waiting on the studio.</p>
            ) : redeemFor === l.id ? (
              <div className="flex gap-2">
                <input inputMode="numeric" aria-label="Days to use" value={redeemDays}
                  onChange={(e) => setRedeemDays(e.target.value.replace(/[^0-9]/g, ''))}
                  className="h-11 w-20 rounded-2xl border-2 border-slate-200 px-3 text-center text-sm font-bold" />
                <button type="button" disabled={busy} onClick={() => askRedeem(l.id, l.left)}
                  className="h-11 flex-1 rounded-2xl bg-slate-900 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40">Ask to use them</button>
                <button type="button" onClick={() => setRedeemFor('')} className="h-11 rounded-2xl border-2 border-slate-200 px-3 text-[10px] font-black uppercase tracking-widest text-slate-600">Cancel</button>
              </div>
            ) : (
              <button type="button" onClick={() => { setRedeemFor(l.id); setRedeemDays(String(l.left)); }}
                className="h-11 w-full rounded-2xl border-2 border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-700">Use banked days</button>
            )}
          </div>
        ))}

        {!open ? (
          <button type="button" onClick={() => setOpen(true)} disabled={!!pending}
            className="h-11 w-full rounded-2xl border-2 border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-700 disabled:opacity-50">
            {pending ? 'Request pending' : 'Request time away'}
          </button>
        ) : (
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-slate-500">
              {state.policy.noticeDays > 0 ? `The studio asks for ${state.policy.noticeDays} days' notice where possible. ` : ''}Up to {state.policy.maxWeeks} weeks.
            </p>
            <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} aria-label="Type of leave"
              className="h-11 w-full rounded-2xl border-2 border-slate-200 px-3 text-sm font-bold bg-white">
              {[['maternity', 'Maternity / parental'], ['medical', 'Medical'], ['family', 'Family'], ['personal', 'Personal'], ['other', 'Other']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} aria-label="First day away" className="h-11 rounded-2xl border-2 border-slate-200 px-3 text-sm font-bold" />
              <input type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} aria-label="Expected return" className="h-11 rounded-2xl border-2 border-slate-200 px-3 text-sm font-bold" />
            </div>
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">How you'd prefer rent handled</p>
              <div className="flex flex-wrap gap-1.5">
                {state.policy.offered.map((t: string) => (
                  <button key={t} type="button" onClick={() => setForm((f) => ({ ...f, preferred: f.preferred === t ? '' : t }))}
                    className={cn('h-10 px-3 rounded-full border-2 text-[10px] font-black uppercase tracking-widest', form.preferred === t ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-600')}>
                    {TL[t]}
                  </button>
                ))}
              </div>
              <p className="text-[9px] font-bold text-slate-400 mt-1">A preference, not a promise — the studio decides.</p>
            </div>
            <textarea value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value.slice(0, 600) }))} rows={2} placeholder="Anything the studio should know (optional)" aria-label="Note"
              className="w-full rounded-2xl border-2 border-slate-200 px-3.5 py-2.5 text-sm" />
            <div className="flex gap-2">
              <button type="button" onClick={submit} disabled={busy || !form.startDate || !form.endDate}
                className="h-11 flex-1 rounded-2xl bg-slate-900 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40">{busy ? 'Sending…' : 'Send request'}</button>
              <button type="button" onClick={() => setOpen(false)} className="h-11 rounded-2xl border-2 border-slate-200 px-4 text-[10px] font-black uppercase tracking-widest text-slate-600">Cancel</button>
            </div>
          </div>
        )}
        {err && <p className="text-xs font-bold text-red-600">{err}</p>}
      </div>
    </section>
  );
}

// ─── Messages with the studio ─────────────────────────────────────────────────
// The renter's side of the one conversation. Replies are on the record the
// instant they're sent, and the studio is told in-app.
function RenterThread({ tenantId, token, studioName }: { tenantId: string; token: string; studioName: string }) {
  const [msgs, setMsgs] = useState<any[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const d = await api({ action: 'thread-list', tenantId, token });
    setMsgs(d?.ok ? [...(d.messages || [])].reverse() : []);
  }, [tenantId, token]);
  useEffect(() => { void load(); }, [load]);
  const send = async () => {
    const text = draft.trim(); if (!text || busy) return;
    setBusy(true);
    const d = await api({ action: 'thread-send', tenantId, token, text });
    setBusy(false);
    if (d?.ok) { setDraft(''); void load(); }
  };
  return (
    <section className="space-y-3">
      <SectionTitle icon={MessageSquare}>Messages with {studioName}</SectionTitle>
      <div className="p-4 rounded-3xl bg-white border-2 border-slate-100 space-y-3">
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {msgs === null ? <p className="text-[11px] text-slate-500">Loading…</p>
            : msgs.length === 0 ? <p className="text-[11px] text-slate-500">Nothing yet. Ask a question, report something, or just say hi — it's all kept on your account.</p>
            : msgs.map((m) => (
              <div key={m.id} className={cn('max-w-[88%] rounded-2xl px-3.5 py-2.5', m.direction === 'inbound' ? 'ml-auto bg-slate-900 text-white' : 'mr-auto bg-slate-100')}>
                <p className="text-xs font-medium whitespace-pre-wrap leading-snug">{m.text}</p>
                <p className={cn('mt-1 text-[9px] font-bold', m.direction === 'inbound' ? 'text-white/60' : 'text-slate-500')}>
                  {m.direction === 'inbound' ? 'You' : (m.byName || studioName)} · {fmtDate(m.createdAt)}
                </p>
              </div>
            ))}
        </div>
        <div className="flex gap-2">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value.slice(0, 2000))} rows={2}
            placeholder="Write to the studio…" aria-label="Message to the studio"
            className="flex-1 rounded-2xl border-2 border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-slate-900" />
          <button type="button" onClick={send} disabled={busy || !draft.trim()}
            className="h-11 self-end rounded-2xl bg-slate-900 px-4 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40">
            {busy ? '…' : 'Send'}
          </button>
        </div>
      </div>
    </section>
  );
}

const api = async (payload: any) => {
  const res = await fetch('/api/portal/renter', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const d = await res.json().catch(() => ({}));
  return { status: res.status, ...d };
};

const STORE = (tenantId: string) => `opal_renter_${tenantId}`;

// ─── My Hours: the renter's own weekly availability ──────────────────────────
// Writes staff.availability.week, which the booking engine already treats as
// layer 3 (per-staff weekly hours) — so a renter's template beats the house
// profile for their own link, with no engine changes. Days left off simply
// produce no slots.
const DAY_ROWS: Array<[string, string]> = [
  ['monday', 'Mon'], ['tuesday', 'Tue'], ['wednesday', 'Wed'], ['thursday', 'Thu'],
  ['friday', 'Fri'], ['saturday', 'Sat'], ['sunday', 'Sun'],
];

function MyHours({ data, tenantId, token, onChanged }: { data: any; tenantId: string; token: string; onChanged: () => void }) {
  const initial = () => {
    const w = data?.provider?.week || {};
    const out: any = {};
    for (const [key] of DAY_ROWS) {
      const r = w[key] || {};
      out[key] = { enabled: !!r.enabled, start: r.start || '09:00', end: r.end || '17:00' };
    }
    return out;
  };
  const [week, setWeek] = useState<any>(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');

  const set = (day: string, patch: any) => setWeek((w: any) => ({ ...w, [day]: { ...w[day], ...patch } }));

  const save = async () => {
    setBusy(true); setErr('');
    const bad = DAY_ROWS.find(([k]) => week[k].enabled && !(week[k].start < week[k].end));
    if (bad) { setBusy(false); setErr('End time has to be after start time.'); return; }
    const d = await api({ action: 'my-hours', tenantId, token, week });
    setBusy(false);
    if (!d.ok) { setErr(d.error || 'Could not save'); return; }
    setSaved(true); setTimeout(() => setSaved(false), 2000);
    onChanged();
  };

  const anyOn = DAY_ROWS.some(([k]) => week[k].enabled);

  return (
    <section className="space-y-3">
      <SectionTitle icon={Clock}>My Hours</SectionTitle>
      <div className="p-4 rounded-3xl bg-white border-2 space-y-2">
        <p className="text-[11px] font-bold text-slate-500">
          When clients can book you. These are your hours — they don&apos;t have to match the studio&apos;s.
        </p>
        {Array.isArray(data?.provider?.leasedDays) && data.provider.leasedDays.length > 0 && (
          <p className="rounded-2xl bg-slate-50 p-3 text-[11px] font-bold text-slate-600">
            Your lease covers {data.provider.leasedDays.map((d: string) => d.slice(0, 3)).join(', ')}
            {data.provider.leasedStart ? ' ' + data.provider.leasedStart + '\u2013' + (data.provider.leasedEnd || 'close') : ''}.
            {' '}Hours outside that save as off — the chair belongs to someone else then.
          </p>
        )}
        {DAY_ROWS.map(([key, label]) => (
          <div key={key} className="flex items-center gap-2 rounded-2xl border-2 p-2">
            <button type="button" onClick={() => set(key, { enabled: !week[key].enabled })}
                    className={cn('h-9 w-16 shrink-0 rounded-xl text-[10px] font-black uppercase tracking-widest',
                      week[key].enabled ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-400')}>
              {label}
            </button>
            {week[key].enabled ? (
              <div className="flex flex-1 items-center gap-2">
                <input type="time" value={week[key].start} onChange={e => set(key, { start: e.target.value })}
                       className="h-9 min-w-0 flex-1 rounded-xl border-2 px-2 text-[12px] font-bold" />
                <span className="text-[11px] font-black text-slate-400">to</span>
                <input type="time" value={week[key].end} onChange={e => set(key, { end: e.target.value })}
                       className="h-9 min-w-0 flex-1 rounded-xl border-2 px-2 text-[12px] font-bold" />
              </div>
            ) : (
              <span className="flex-1 text-[11px] font-bold text-slate-400">Off</span>
            )}
          </div>
        ))}
        {!anyOn && (
          <p className="rounded-2xl bg-amber-50 p-3 text-[11px] font-bold text-amber-800">
            Every day is off right now, so nobody can book you. Turn on at least one day.
          </p>
        )}
        {err && <p className="text-[11px] font-black text-red-600">{err}</p>}
        <button onClick={save} disabled={busy}
                className="h-11 w-full rounded-2xl bg-slate-900 text-[10px] font-black uppercase tracking-widest text-white active:scale-95 disabled:opacity-50">
          {busy ? 'Saving…' : saved ? 'Saved ✓' : 'Save my hours'}
        </button>
        <p className="text-[10px] font-bold text-slate-400">
          Time off for a single day? Ask the studio to block it — that keeps the calendar honest for everyone.
        </p>
      </div>
    </section>
  );
}

// ─── Card payments: their own Stripe ─────────────────────────────────────────
// Connecting here creates an account that belongs to the RENTER. Money, refunds
// and disputes are all theirs; the studio is never in the path. Half-finished
// onboarding is an expected state, not an error — services simply stay
// pay-in-person until Stripe reports charges are live.
function MyPayments({ data, tenantId, token }: { data: any; tenantId: string; token: string }) {
  const [st, setSt] = useState<any>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/portal/renter-connect', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'status', tenantId, token }),
        });
        const d = await res.json().catch(() => ({}));
        if (!cancelled) setSt(d);
      } catch { /* offline — the card just shows the connect option */ }
      if (!cancelled) setBusy(false);
    })();
    return () => { cancelled = true; };
  }, [tenantId, token]);

  const connected = !!st?.connected;
  const live = !!st?.chargesEnabled;
  const submitted = !!st?.detailsSubmitted;
  const onboardHref = `/api/portal/renter-connect?tenantId=${encodeURIComponent(tenantId)}&token=${encodeURIComponent(token)}`;

  return (
    <section className="space-y-3">
      <SectionTitle icon={CreditCard}>Card Payments</SectionTitle>
      <div className="p-4 rounded-3xl bg-white border-2 space-y-3">
        {busy ? (
          <p className="py-3 text-center text-[11px] font-bold text-slate-400">Checking your account…</p>
        ) : live ? (
          <div className="rounded-2xl bg-emerald-50 p-4">
            <p className="text-[13px] font-black text-emerald-900">You can take cards.</p>
            <p className="mt-1 text-[11px] font-bold text-emerald-800">
              Payments go straight to your own Stripe account and pay out to your bank. {data?.studioName || 'The studio'} never touches them.
            </p>
          </div>
        ) : connected && submitted ? (
          <div className="rounded-2xl bg-amber-50 p-4">
            <p className="text-[13px] font-black text-amber-900">Stripe is still reviewing your details.</p>
            <p className="mt-1 text-[11px] font-bold text-amber-800">
              This usually takes a few minutes. Until it clears, your clients pay you in person as usual — nothing is broken.
            </p>
          </div>
        ) : connected ? (
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-[13px] font-black text-slate-900">You started setting up — a few steps left.</p>
            <p className="mt-1 text-[11px] font-bold text-slate-500">Pick up where you left off. Your bookings keep working meanwhile.</p>
          </div>
        ) : (
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-[13px] font-black text-slate-900">Want to take cards and deposits?</p>
            <p className="mt-1 text-[11px] font-bold text-slate-500">
              Connect your own Stripe account — you keep 100%, minus Stripe&apos;s normal processing fee. It pays out to your bank, not the studio&apos;s.
            </p>
          </div>
        )}

        {!live && !busy && (
          <a href={onboardHref}
             className="flex h-11 w-full items-center justify-center rounded-2xl bg-slate-900 text-[10px] font-black uppercase tracking-widest text-white active:scale-95">
            {connected ? 'Finish setting up' : 'Connect my Stripe'}
          </a>
        )}
        {live && (
          <a href={onboardHref}
             className="flex h-11 w-full items-center justify-center rounded-2xl border-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
            Manage my account
          </a>
        )}
        <p className="text-[10px] font-bold text-slate-400">
          Payment questions go to Stripe, not the front desk — it&apos;s your account.
        </p>
      </div>
    </section>
  );
}

// ─── My Number: what they need to earn ───────────────────────────────────────
// Rough is fine. These inputs live in a server-only subcollection the studio
// cannot read — the card says so plainly, because a renter's landlord asking
// about their household budget is exactly the thing that would stop them from
// answering honestly. Sharing is one derived rate, opt-in, off by default.
function MyNumber({ data, tenantId, token, onChanged }: { data: any; tenantId: string; token: string; onChanged: () => void }) {
  const p = data?.pricing || {};
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [personal, setPersonal] = useState(String(((Number(p.personalMonthlyCents) || 0) / 100) || ''));
  const [business, setBusiness] = useState(String(((Number(p.businessMonthlyCents) || 0) / 100) || ''));
  const [taxPct, setTaxPct] = useState(String(p.taxSetAsidePct ?? 25));
  const [share, setShare] = useState(!!p.shareTargetHourly);

  const save = async () => {
    setBusy(true); setErr('');
    const d = await api({
      action: 'my-goals', tenantId, token,
      personalMonthly: Number(personal) || 0,
      businessMonthly: Number(business) || 0,
      taxSetAsidePct: Number(taxPct) || 0,
      shareTargetHourly: share,
    });
    setBusy(false);
    if (!d.ok) { setErr(d.error || 'Could not save'); return; }
    setOpen(false); onChanged();
  };

  const target = (Number(p.targetHourlyCents) || 0) / 100;
  const monthly = (Number(p.monthlyTargetCents) || 0) / 100;

  return (
    <section className="space-y-3">
      <SectionTitle icon={Wallet}>My Number</SectionTitle>
      <div className="p-4 rounded-3xl bg-white border-2 space-y-3">
        {p.hasGoals && !open ? (
          <div className="rounded-2xl bg-slate-900 p-4 text-white">
            <p className="text-[10px] font-black uppercase tracking-widest text-white/50">Your hour needs to make</p>
            <p className="text-3xl font-black">${target.toFixed(2)}</p>
            <p className="mt-1 text-[11px] font-bold text-white/70">
              ${monthly.toFixed(2)} a month across {p.bookableHoursPerMonth} booked hours — rent, taxes and living covered.
            </p>
          </div>
        ) : !open ? (
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-[13px] font-black text-slate-900">Know what your hour has to earn.</p>
            <p className="mt-1 text-[11px] font-bold text-slate-500">
              Tell us roughly what you need each month and we&apos;ll work backwards through taxes and rent to the number that makes your prices make sense.
            </p>
          </div>
        ) : null}

        {open && (
          <div className="space-y-2">
            <p className="rounded-2xl bg-emerald-50 p-3 text-[11px] font-bold text-emerald-900">
              🔒 Only you can see these numbers. {data?.studioName || 'The studio'} sees that you&apos;ve set a goal, never what&apos;s in it.
            </p>
            <label className="block">
              <span className="block text-[9px] font-black uppercase tracking-widest text-slate-400">What you need to live on, a month</span>
              <input type="number" min={0} value={personal} onChange={e => setPersonal(e.target.value)} placeholder="3000"
                     className="h-11 w-full rounded-xl border-2 px-3 text-[15px] font-black" />
              <span className="mt-1 block text-[10px] font-bold text-slate-400">Housing, car, food, insurance, debt, savings — rough is fine.</span>
            </label>
            <div className="flex gap-2">
              <label className="flex-1">
                <span className="block text-[9px] font-black uppercase tracking-widest text-slate-400">Business costs / mo</span>
                <input type="number" min={0} value={business} onChange={e => setBusiness(e.target.value)} placeholder="200"
                       className="h-11 w-full rounded-xl border-2 text-center text-[15px] font-black" />
              </label>
              <label className="flex-1">
                <span className="block text-[9px] font-black uppercase tracking-widest text-slate-400">Tax set-aside %</span>
                <input type="number" min={0} max={60} value={taxPct} onChange={e => setTaxPct(e.target.value)}
                       className="h-11 w-full rounded-xl border-2 text-center text-[15px] font-black" />
              </label>
            </div>
            <button type="button" onClick={() => setShare(v => !v)}
                    className="flex w-full items-center justify-between gap-3 rounded-2xl border-2 p-3 text-left">
              <span>
                <span className="block text-[12px] font-black text-slate-900">Share just my hourly target with {data?.studioName || 'the studio'}</span>
                <span className="block text-[10px] font-bold text-slate-500">One number, so they can help you price. Never your costs.</span>
              </span>
              <span className={cn('shrink-0 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest',
                share ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500')}>{share ? 'On' : 'Off'}</span>
            </button>
            {err && <p className="text-[11px] font-black text-red-600">{err}</p>}
            <div className="flex gap-2">
              <button onClick={save} disabled={busy}
                      className="h-11 flex-1 rounded-2xl bg-slate-900 text-[10px] font-black uppercase tracking-widest text-white active:scale-95 disabled:opacity-50">
                {busy ? 'Saving…' : 'Save my number'}
              </button>
              <button onClick={() => { setOpen(false); setErr(''); }} className="h-11 rounded-2xl border-2 px-4 text-[10px] font-black uppercase tracking-widest">Cancel</button>
            </div>
          </div>
        )}

        {!open && (
          <button onClick={() => setOpen(true)}
                  className="h-11 w-full rounded-2xl border-2 border-dashed text-[10px] font-black uppercase tracking-widest text-slate-500">
            {p.hasGoals ? 'Update my number' : 'Set up my number'}
          </button>
        )}
      </div>
    </section>
  );
}



// ─── My Profile ──────────────────────────────────────────────────────────────
// What a client sees when they land on this person. Which fields matter depends
// entirely on how they take bookings, so the card asks for different things:
// someone booking through the studio needs a face and a line about themselves,
// while someone on their own system needs their real booking URL, so a client
// who lands here can still reach them instead of hitting a dead end.
function MyProfile({ data, tenantId, token, onChanged }: { data: any; tenantId: string; token: string; onChanged: () => void }) {
  const { toast } = useToast();
  const p0 = data?.profile || {};
  const ownSystem = data?.bookingMode === 'own';
  const [bio, setBio] = useState(p0.bio || '');
  const [ig, setIg] = useState(p0.instagram || '');
  const [url, setUrl] = useState(p0.externalBookingUrl || '');
  const [listed, setListed] = useState(p0.listExternally === true);
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const shown = photo || p0.photoUrl || '';

  const pick = (e: any) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { setErr('Keep the photo under 3 MB.'); return; }
    const r = new FileReader();
    r.onload = () => { setPhoto(String(r.result || '')); setErr(''); };
    r.readAsDataURL(file);
  };

  const save = async () => {
    setBusy(true); setErr('');
    const d = await api({
      action: 'my-profile', tenantId, token,
      bio, instagram: ig, externalBookingUrl: url, listExternally: listed,
      ...(photo ? { photoData: photo } : {}),
    });
    setBusy(false);
    if (!d.ok) { setErr(d.error || 'Could not save that.'); return; }
    setPhoto(null);
    toast({ title: 'Profile saved', description: ownSystem ? 'Your booking link is live.' : 'Clients will see this on your booking page.' });
    onChanged();
  };

  return (
    <section className="space-y-3">
      <SectionTitle icon={Sparkles}>My Profile</SectionTitle>
      <div className="p-5 rounded-3xl bg-white border-2 space-y-4">
        {!ownSystem && (
          <>
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-slate-100 overflow-hidden shrink-0 flex items-center justify-center">
                {shown
                  ? <img src={shown} alt="Your profile" className="w-full h-full object-cover" />
                  : <Sparkles className="w-5 h-5 text-slate-300" />}
              </div>
              <div className="min-w-0">
                <label htmlFor="pf-photo" className="block text-[11px] font-black uppercase tracking-widest text-slate-900 cursor-pointer underline">
                  {shown ? 'Change photo' : 'Add a photo'}
                </label>
                <input id="pf-photo" type="file" accept="image/*" onChange={pick} className="hidden" />
                <p className="text-[10px] font-bold text-slate-400 mt-1">A real face books better than a blank square.</p>
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor="pf-bio" className="block text-[10px] font-black uppercase tracking-widest text-slate-400">About you</label>
              <textarea id="pf-bio" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={300} rows={3}
                placeholder="What you specialise in, how long you've been doing it…"
                className="w-full px-3 py-3 rounded-xl border-2 border-slate-200 text-sm font-bold resize-none" />
              <p className="text-[10px] font-bold text-slate-400">{300 - bio.length} left</p>
            </div>

            <div className="space-y-1">
              <label htmlFor="pf-ig" className="block text-[10px] font-black uppercase tracking-widest text-slate-400">Instagram</label>
              <input id="pf-ig" value={ig} onChange={(e) => setIg(e.target.value)} placeholder="yourhandle"
                className="w-full px-3 py-3 rounded-xl border-2 border-slate-200 text-sm font-bold" />
            </div>
          </>
        )}

        {ownSystem && (
          <>
            <div className="space-y-1">
              <label htmlFor="pf-url" className="block text-[10px] font-black uppercase tracking-widest text-slate-400">Your booking link</label>
              <input id="pf-url" value={url} onChange={(e) => setUrl(e.target.value)}
                placeholder="https://yourname.glossgenius.com"
                className="w-full px-3 py-3 rounded-xl border-2 border-slate-200 text-sm font-bold" />
              <p className="text-[10px] font-bold text-slate-400">
                Square, GlossGenius, Booksy, your own site — wherever clients actually book you.
              </p>
            </div>

            <button onClick={() => setListed(!listed)}
              className="w-full flex items-center justify-between gap-3 p-3 rounded-2xl border-2 text-left">
              <span className="min-w-0">
                <span className="block text-[12px] font-black text-slate-900">Show me on the studio&apos;s booking page</span>
                <span className="block text-[11px] font-bold text-slate-500">
                  Clients looking for you there get sent to your link instead of finding nothing.
                </span>
              </span>
              <span className={cn('shrink-0 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest',
                listed ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
                {listed ? 'On' : 'Off'}
              </span>
            </button>
          </>
        )}

        {err && (
          <div className="flex items-start gap-2 text-red-600">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <p className="text-[11px] font-bold">{err}</p>
          </div>
        )}

        <button onClick={save} disabled={busy}
          className="w-full py-3 rounded-2xl bg-slate-900 text-white text-[11px] font-black uppercase tracking-widest active:scale-95 transition-all disabled:opacity-50">
          {busy ? 'Saving…' : 'Save profile'}
        </button>
      </div>
    </section>
  );
}

// ─── Getting set up ──────────────────────────────────────────────────────────
// Two things live here, and the first decides whether the second exists.
//
// BOOKING MODE is an explicit choice, not an absence. Plenty of renters already
// run their own booking system and are never going to move; treating that as
// "incomplete setup" would leave them staring at a permanent to-do list for
// tools they don't want. Choosing "my own system" makes their portal complete
// as it stands — rent, documents, credits — and switches every booking section
// off, including on the booking page itself, not just here.
//
// THE CHECKLIST only appears for people who chose the studio system, is derived
// live from what actually exists rather than a stored flag, and can be
// dismissed once and for good. Setup prompts that come back are nags.
function GettingSetUp({ data, tenantId, token, onChanged }: { data: any; tenantId: string; token: string; onChanged: () => void }) {
  const { toast } = useToast();
  const cl = data?.checklist;
  const [busy, setBusy] = useState('');
  const [switching, setSwitching] = useState(false);
  const [err, setErr] = useState('');

  if (!cl) return null;

  const setMode = async (mode: 'studio' | 'own') => {
    setBusy(mode); setErr('');
    const d = await api({ action: 'booking-mode', tenantId, token, mode });
    setBusy(''); setSwitching(false);
    if (!d.ok) { setErr(d.error || 'Could not save that.'); return; }
    toast({
      title: mode === 'own' ? 'Set to your own system' : 'Set to the studio system',
      description: mode === 'own'
        ? 'Your booking sections are switched off. Your rent, documents and credits are unaffected.'
        : 'Set your hours and add a service and clients can start booking you.',
    });
    onChanged();
  };

  const dismiss = async () => {
    setBusy('dismiss');
    await api({ action: 'checklist-dismiss', tenantId, token });
    setBusy('');
    onChanged();
  };

  if (!cl.modeChosen || switching) {
    return (
      <section className="space-y-3">
        <SectionTitle icon={Sparkles}>Getting set up</SectionTitle>
        <div className="p-5 rounded-3xl bg-white border-2 space-y-3">
          <div>
            <p className="font-black text-slate-900 text-sm">How do you take bookings?</p>
            <p className="text-[11px] font-bold text-slate-500 mt-1">
              Either answer is fine, and you can change it whenever you like. Your rent, documents and credits work the same either way.
            </p>
          </div>
          <button onClick={() => setMode('studio')} disabled={!!busy}
            className="w-full p-4 rounded-2xl border-2 text-left active:scale-[0.99] transition-all disabled:opacity-50">
            <p className="text-[12px] font-black text-slate-900">I&apos;ll book through the studio</p>
            <p className="text-[11px] font-bold text-slate-500 mt-0.5">
              You get your own menu at your own prices, your own hours, a personal booking link, and you keep what you charge.
            </p>
          </button>
          <button onClick={() => setMode('own')} disabled={!!busy}
            className="w-full p-4 rounded-2xl border-2 text-left active:scale-[0.99] transition-all disabled:opacity-50">
            <p className="text-[12px] font-black text-slate-900">I use my own booking system</p>
            <p className="text-[11px] font-bold text-slate-500 mt-0.5">
              Square, GlossGenius, Booksy, a paper book — whatever you already use. Nothing here will pester you about it.
            </p>
          </button>
          {switching && (
            <button onClick={() => setSwitching(false)}
              className="text-[11px] font-black uppercase tracking-widest text-slate-400">Never mind</button>
          )}
          {err && (
            <div className="flex items-start gap-2 text-red-600">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <p className="text-[11px] font-bold">{err}</p>
            </div>
          )}
        </div>
      </section>
    );
  }

  if (cl.mode === 'own') {
    return (
      <section className="space-y-3">
        <div className="p-4 rounded-3xl bg-white border-2 border-slate-100">
          <p className="text-[11px] font-bold text-slate-500">
            You&apos;re running your own booking system. If you ever want to try the studio&apos;s — your own menu, your own prices, your own link —{' '}
            <button onClick={() => setSwitching(true)} className="font-black text-slate-900 underline">switch it on here</button>.
          </p>
        </div>
      </section>
    );
  }

  if (cl.dismissed || cl.allDone) {
    return (
      <section className="space-y-3">
        <div className="p-4 rounded-3xl bg-white border-2 border-slate-100">
          <p className="text-[11px] font-bold text-slate-500">
            Booking through the studio.{' '}
            <button onClick={() => setSwitching(true)} className="font-black text-slate-900 underline">Use my own system instead</button>
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <SectionTitle icon={Sparkles}>Getting set up</SectionTitle>
      <div className="p-5 rounded-3xl bg-white border-2 space-y-3">
        <div>
          <p className="font-black text-slate-900 text-sm">
            {cl.remaining === 1 ? 'One thing left' : `${cl.remaining} things left`}
          </p>
          <p className="text-[11px] font-bold text-slate-500 mt-0.5">
            Until these are done, clients can&apos;t book you.
          </p>
        </div>
        <div className="space-y-2">
          {cl.items.map((it: any) => (
            <div key={it.key} className={cn('flex items-start gap-3 p-3 rounded-2xl border-2',
              it.done ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200')}>
              {it.done
                ? <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                : <div className="w-4 h-4 rounded-full border-2 border-slate-300 mt-0.5 shrink-0" />}
              <div className="min-w-0">
                <p className={cn('text-[12px] font-black', it.done ? 'text-emerald-900' : 'text-slate-900')}>
                  {it.label}{it.optional ? ' · optional' : ''}
                </p>
                {it.hint && <p className="text-[11px] font-bold text-slate-500 mt-0.5">{it.hint}</p>}
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 pt-1">
          <button onClick={() => setSwitching(true)} className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            I use my own system
          </button>
          <button onClick={dismiss} disabled={!!busy} className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            {busy === 'dismiss' ? '…' : 'Hide this'}
          </button>
        </div>
      </div>
    </section>
  );
}

// ─── Day Swaps: renter ↔ renter, the studio is told but never asked ───────────
// A swap trades TIME, not money. Rent never moves — a permanent change of days
// is a lease change, which is the owner's business.
//
// A day can be given whole, or from either EDGE — "I need to leave early", "I'm
// coming in late". Never a hole out of the middle: the remainder has to stay one
// window, and two handoffs in one chair helps nobody.
//
// If the other person has their own client inside the window, the request can
// still be sent, but it arrives flagged and cannot be accepted until they move
// that booking themselves. The clash is theirs to resolve, never the asker's to
// override — a client who is not in this conversation would be the one moved.
const SWAP_SLICE: Array<[string, string]> = [
  ['whole', 'The whole day'],
  ['trailing', 'Leave early — give away the end'],
  ['leading', 'Come in late — give away the start'],
];

function MySwaps({ data, tenantId, token, onChanged }: { data: any; tenantId: string; token: string; onChanged: () => void }) {
  const { toast } = useToast();
  const swaps = data?.swaps || {};
  const incoming: any[] = swaps.incoming || [];
  const outgoing: any[] = swaps.outgoing || [];
  const confirmed: any[] = swaps.confirmed || [];
  const openOffers: any[] = swaps.openOffers || [];
  const myOpen: any[] = swaps.myOpen || [];

  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<any>(null);
  const [loadingOpts, setLoadingOpts] = useState(false);
  const [giveDate, setGiveDate] = useState('');
  const [slice, setSlice] = useState('whole');
  const [edge, setEdge] = useState('');
  const [toStaffId, setToStaffId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [confirmAsk, setConfirmAsk] = useState('');
  const [declineFor, setDeclineFor] = useState('');

  const myDates: any[] = opts?.myDates || [];
  const chosen = myDates.find((d: any) => d.date === giveDate) || null;
  const partners: any[] = opts?.partners || [];

  const seg = (() => {
    if (!chosen) return null;
    if (slice === 'whole') return chosen.held;
    return slice === 'leading' ? chosen.leading : chosen.trailing;
  })();

  const win = (() => {
    if (!seg || !chosen) return null;
    if (slice === 'whole') return { start: chosen.held.start, end: chosen.held.end };
    if (slice === 'leading') return { start: chosen.held.start, end: edge || seg.end };
    return { start: edge || seg.start, end: chosen.held.end };
  })();

  const reset = () => {
    setOpen(false); setOpts(null); setGiveDate(''); setSlice('whole'); setEdge('');
    setToStaffId(''); setNote(''); setErr(''); setConfirmAsk('');
  };

  const start = async () => {
    setOpen(true); setErr(''); setLoadingOpts(true);
    const d = await api({ action: 'swap-options', tenantId, token, today: localISO() });
    setLoadingOpts(false);
    if (!d.ok) { setErr(d.error || 'Could not load your days.'); return; }
    setOpts(d);
  };

  const pickDate = (d: any) => {
    setGiveDate(d.date); setSlice('whole'); setEdge(''); setErr(''); setConfirmAsk('');
  };
  const pickSlice = (k: string) => {
    setSlice(k); setErr(''); setConfirmAsk('');
    if (!chosen) return;
    const s2 = k === 'leading' ? chosen.leading : k === 'trailing' ? chosen.trailing : chosen.held;
    setEdge(k === 'leading' ? (s2?.end || '') : k === 'trailing' ? (s2?.start || '') : '');
  };

  const send = async (askAnyway: boolean) => {
    if (!win) return;
    setBusy('send'); setErr('');
    const d = await api({
      action: 'swap-request', tenantId, token, today: localISO(),
      toStaffId, giveDate, giveStart: win.start, giveEnd: win.end, note, askAnyway,
    });
    setBusy('');
    if (d.needsConfirm) { setConfirmAsk(d.error || ''); return; }
    if (!d.ok) { setErr(d.error || 'Could not send that request.'); setConfirmAsk(''); return; }
    const who = partners.find((p: any) => p.staffId === toStaffId)?.name || 'They';
    toast({
      title: d.conflicted ? 'Asked anyway' : 'Swap request sent',
      description: d.conflicted
        ? `${who} will see it flagged — they can only accept if they move their own booking.`
        : `${who} will get an email and a text.`,
    });
    reset(); onChanged();
  };

  const respond = async (id: string, decision: 'accept' | 'decline', reason?: string) => {
    setBusy(id); setErr('');
    const d = await api({ action: 'swap-respond', tenantId, token, today: localISO(), swapId: id, decision, reason });
    setBusy('');
    setDeclineFor('');
    if (!d.ok) { setErr(d.error || 'That did not go through.'); onChanged(); return; }
    toast({
      title: decision === 'accept' ? 'Swap confirmed ✓' : 'Swap declined',
      description: decision === 'accept'
        ? 'Your booking hours have moved for that window only. Rent is unchanged.'
        : 'Their day is unchanged and nothing was charged.',
    });
    onChanged();
  };

  const claim = async (id: string) => {
    setBusy(id); setErr('');
    const d = await api({ action: 'swap-claim', tenantId, token, today: localISO(), swapId: id });
    setBusy('');
    if (!d.ok) { setErr(d.error || 'Could not take that one.'); onChanged(); return; }
    toast({ title: 'It’s yours ✓', description: 'Your booking hours have moved for that window only. Rent is unchanged.' });
    onChanged();
  };

  const broadcast = async () => {
    if (!win) return;
    setBusy('send'); setErr('');
    const d = await api({
      action: 'swap-broadcast', tenantId, token, today: localISO(),
      giveDate, giveStart: win.start, giveEnd: win.end, note,
    });
    setBusy('');
    if (!d.ok) { setErr(d.error || 'Could not offer that.'); return; }
    toast({
      title: 'Offered to everyone who can take it',
      description: `${d.offeredTo} ${d.offeredTo === 1 ? 'person was' : 'people were'} asked. First to take it gets it.`,
    });
    reset(); onChanged();
  };

  const withdraw = async (id: string) => {
    setBusy(id);
    const d = await api({ action: 'swap-cancel', tenantId, token, swapId: id });
    setBusy('');
    if (!d.ok) { setErr(d.error || 'Could not withdraw that.'); return; }
    onChanged();
  };

  const line = (s2: any) =>
    `${s2.iAmGiver ? 'They cover' : 'You cover'} ${s2.giveLabel}, ${s2.windowLabel}`;

  return (
    <section className="space-y-3">
      <SectionTitle icon={Repeat}>Day Swaps</SectionTitle>

      {openOffers.map((o: any) => (
        <div key={o.id} className="p-4 rounded-3xl bg-white border-2 border-sky-300 space-y-3">
          <div>
            <p className="font-black text-slate-900 text-sm">{o.fromName} is offering a day</p>
            <p className="text-[11px] font-bold text-slate-500 mt-0.5">
              {o.giveLabel}, {o.windowLabel}{o.boothName ? ` · ${o.boothName}` : ''}
            </p>
            {o.note && <p className="text-[11px] font-bold text-slate-400 mt-1 italic">“{o.note}”</p>}
          </div>
          <button onClick={() => claim(o.id)} disabled={!!busy}
            className="w-full py-3 rounded-2xl bg-sky-600 text-white text-[11px] font-black uppercase tracking-widest active:scale-95 transition-all disabled:opacity-50">
            {busy === o.id ? 'Taking…' : 'Take this day'}
          </button>
          <p className="text-[10px] font-bold text-slate-400">
            First to take it gets it{o.offeredTo > 1 ? ` — ${o.offeredTo} people were asked` : ''}. Rent is not affected.
          </p>
        </div>
      ))}

      {myOpen.map((o: any) => (
        <div key={o.id} className="p-4 rounded-3xl bg-white border-2 border-slate-100 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-black text-slate-900 text-sm truncate">Offered to anyone who can take it</p>
            <p className="text-[11px] font-bold text-slate-500 mt-0.5">
              {o.giveLabel}, {o.windowLabel}{o.offeredTo ? ` · ${o.offeredTo} asked` : ''}
            </p>
          </div>
          <button onClick={() => withdraw(o.id)} disabled={!!busy}
            className="shrink-0 w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400 active:scale-95 transition-all disabled:opacity-50">
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}

      {incoming.map((s2: any) => (
        <div key={s2.id} className={cn('p-4 rounded-3xl bg-white border-2 space-y-3',
          s2.conflictCount > 0 ? 'border-red-300' : 'border-amber-300')}>
          <div>
            <p className="font-black text-slate-900 text-sm">{s2.otherName} wants you to cover</p>
            <p className="text-[11px] font-bold text-slate-500 mt-0.5">{s2.giveLabel}, {s2.windowLabel}</p>
            {s2.note && <p className="text-[11px] font-bold text-slate-400 mt-1 italic">“{s2.note}”</p>}
          </div>

          {s2.conflictCount > 0 ? (
            <div className="space-y-2">
              <div className="flex items-start gap-2 p-3 rounded-2xl bg-red-50">
                <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                <p className="text-[11px] font-bold text-red-700">
                  You have {s2.conflictCount === 1 ? 'a client' : `${s2.conflictCount} clients`} booked in that window,
                  so you can&apos;t accept this yet. Move or cancel that booking yourself and this turns green on its own.
                </p>
              </div>
              <button onClick={() => setDeclineFor(s2.id)} disabled={!!busy}
                className="w-full py-3 rounded-2xl bg-slate-100 text-slate-600 text-[11px] font-black uppercase tracking-widest active:scale-95 transition-all disabled:opacity-50">
                Decline
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => respond(s2.id, 'accept')} disabled={!!busy}
                className="flex-1 py-3 rounded-2xl bg-slate-900 text-white text-[11px] font-black uppercase tracking-widest active:scale-95 transition-all disabled:opacity-50">
                {busy === s2.id ? 'Working…' : 'Accept'}
              </button>
              <button onClick={() => setDeclineFor(s2.id)} disabled={!!busy}
                className="px-5 py-3 rounded-2xl bg-slate-100 text-slate-600 text-[11px] font-black uppercase tracking-widest active:scale-95 transition-all disabled:opacity-50">
                Decline
              </button>
            </div>
          )}

          {declineFor === s2.id && (
            <div className="space-y-2 pt-1">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Why?</p>
              <button onClick={() => respond(s2.id, 'decline', 'not_this_time')} disabled={!!busy}
                className="w-full py-3 rounded-2xl bg-white border-2 text-slate-700 text-[11px] font-black active:scale-95 transition-all disabled:opacity-50">
                Not this time
              </button>
              <button onClick={() => respond(s2.id, 'decline', 'never_that_day')} disabled={!!busy}
                className="w-full py-3 rounded-2xl bg-white border-2 text-slate-700 text-[11px] font-black active:scale-95 transition-all disabled:opacity-50">
                That day never works for me
              </button>
            </div>
          )}

          <p className="text-[10px] font-bold text-slate-400">Your rent is not affected either way.</p>
        </div>
      ))}

      {outgoing.map((s2: any) => (
        <div key={s2.id} className="p-4 rounded-3xl bg-white border-2 border-slate-100 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-black text-slate-900 text-sm truncate">Waiting on {s2.otherName}</p>
            <p className="text-[11px] font-bold text-slate-500 mt-0.5">{s2.giveLabel}, {s2.windowLabel}</p>
          </div>
          <button onClick={() => withdraw(s2.id)} disabled={!!busy}
            className="shrink-0 w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400 active:scale-95 transition-all disabled:opacity-50">
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}

      {confirmed.map((s2: any) => (
        <div key={s2.id} className="p-4 rounded-3xl bg-emerald-50 border-2 border-emerald-200">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <p className="font-black text-emerald-900 text-sm">Swapped with {s2.otherName}</p>
          </div>
          <p className="text-[11px] font-bold text-emerald-700 mt-1">{line(s2)}</p>
        </div>
      ))}

      {!open ? (
        <button onClick={start}
          className="w-full p-4 rounded-3xl bg-white border-2 border-dashed border-slate-200 text-left active:scale-[0.99] transition-all">
          <p className="font-black text-slate-900 text-sm">Give away a day, or part of one</p>
          <p className="text-[11px] font-bold text-slate-500 mt-0.5">
            Hand a whole day, or just your morning or afternoon, to another professional here. You arrange it between you.
          </p>
        </button>
      ) : (
        <div className="p-4 rounded-3xl bg-white border-2 space-y-4">
          {loadingOpts ? (
            <div className="flex items-center gap-2 py-4 text-slate-400">
              <Loader className="w-4 h-4 animate-spin" />
              <span className="text-[11px] font-black uppercase tracking-widest">Finding your free time…</span>
            </div>
          ) : myDates.length === 0 ? (
            <div className="space-y-2">
              <p className="text-[11px] font-bold text-slate-500">
                Nothing to offer right now. A day shows up here when it is one of yours and somebody else could take at least part of it.
              </p>
              <button onClick={reset} className="text-[11px] font-black uppercase tracking-widest text-slate-400">Close</button>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">1 · Which day</p>
                <div className="flex flex-wrap gap-2">
                  {myDates.map((d: any) => (
                    <button key={d.date} onClick={() => pickDate(d)}
                      className={cn('px-3 py-2 rounded-xl text-[11px] font-black border-2 transition-all',
                        giveDate === d.date ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200')}>
                      {d.label}
                    </button>
                  ))}
                </div>
                {chosen && (
                  <p className="text-[10px] font-bold text-slate-400">
                    You hold {fmtTime(chosen.held.start)}–{fmtTime(chosen.held.end)} that day.
                  </p>
                )}
              </div>

              {chosen && (
                <div className="space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">2 · How much of it</p>
                  <div className="space-y-2">
                    {SWAP_SLICE.map(([k, label]) => {
                      const avail = k === 'whole' ? chosen.held : k === 'leading' ? chosen.leading : chosen.trailing;
                      if (!avail) return null;
                      return (
                        <button key={k} onClick={() => pickSlice(k)}
                          className={cn('w-full px-3 py-3 rounded-xl text-left text-[11px] font-black border-2 transition-all',
                            slice === k ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200')}>
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  {slice !== 'whole' && seg && (
                    <div className="flex items-center gap-2 pt-1">
                      <label htmlFor="swap-edge" className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                        {slice === 'leading' ? 'Coming in at' : 'Leaving at'}
                      </label>
                      <input id="swap-edge" type="time" value={edge}
                        min={slice === 'leading' ? seg.start : seg.start}
                        max={slice === 'leading' ? seg.end : seg.end}
                        onChange={(e) => setEdge(e.target.value)}
                        className="px-3 py-2 rounded-xl border-2 border-slate-200 text-sm font-bold" />
                    </div>
                  )}
                  {win && (
                    <p className="text-[10px] font-bold text-slate-400">
                      Giving away {fmtTime(win.start)}–{fmtTime(win.end)}.
                    </p>
                  )}
                </div>
              )}

              {chosen && win && (
                <div className="space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">3 · Who you&apos;re asking</p>
                  <div className="flex flex-wrap gap-2">
                    {partners.map((pp: any) => (
                      <button key={pp.staffId} onClick={() => { setToStaffId(pp.staffId); setConfirmAsk(''); setErr(''); }}
                        className={cn('px-3 py-2 rounded-xl text-[11px] font-black border-2 transition-all',
                          toStaffId === pp.staffId ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200')}>
                        {pp.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {toStaffId && (
                <div className="space-y-2">
                  <label htmlFor="swap-note" className="block text-[10px] font-black uppercase tracking-widest text-slate-400">Message (optional)</label>
                  <input id="swap-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={240}
                    placeholder="Family thing that afternoon…"
                    className="w-full px-3 py-3 rounded-xl border-2 border-slate-200 text-sm font-bold" />
                </div>
              )}

              {confirmAsk && (
                <div className="p-3 rounded-2xl bg-amber-50 border-2 border-amber-200 space-y-2">
                  <p className="text-[11px] font-bold text-amber-800">{confirmAsk}</p>
                  <div className="flex gap-2">
                    <button onClick={() => send(true)} disabled={!!busy}
                      className="flex-1 py-3 rounded-2xl bg-amber-500 text-white text-[11px] font-black uppercase tracking-widest active:scale-95 transition-all disabled:opacity-50">
                      {busy === 'send' ? 'Sending…' : 'Ask anyway'}
                    </button>
                    <button onClick={() => setConfirmAsk('')}
                      className="px-5 py-3 rounded-2xl bg-white border-2 text-slate-600 text-[11px] font-black uppercase tracking-widest active:scale-95 transition-all">
                      Back
                    </button>
                  </div>
                </div>
              )}

              {err && (
                <div className="flex items-start gap-2 text-red-600">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <p className="text-[11px] font-bold">{err}</p>
                </div>
              )}

              {chosen && win && !confirmAsk && (
                <button onClick={broadcast} disabled={!!busy}
                  className="w-full p-3 rounded-2xl bg-sky-50 border-2 border-sky-200 text-left active:scale-[0.99] transition-all disabled:opacity-50">
                  <p className="text-[11px] font-black text-sky-800">
                    {busy === 'send' ? 'Offering…' : 'Or offer it to anyone who can take it'}
                  </p>
                  <p className="text-[10px] font-bold text-sky-600 mt-0.5">
                    Everyone who could actually cover it gets asked once. First to take it gets it — no chasing.
                  </p>
                </button>
              )}

              {!confirmAsk && (
                <div className="flex gap-2">
                  <button onClick={() => send(false)} disabled={!giveDate || !toStaffId || !win || !!busy}
                    className="flex-1 py-3 rounded-2xl bg-slate-900 text-white text-[11px] font-black uppercase tracking-widest active:scale-95 transition-all disabled:opacity-40">
                    {busy === 'send' ? 'Sending…' : 'Send request'}
                  </button>
                  <button onClick={reset}
                    className="px-5 py-3 rounded-2xl bg-slate-100 text-slate-600 text-[11px] font-black uppercase tracking-widest active:scale-95 transition-all">
                    Cancel
                  </button>
                </div>
              )}
              <p className="text-[10px] font-bold text-slate-400">
                Nothing moves until they accept, and rent stays exactly where it is.
              </p>
            </>
          )}
        </div>
      )}

      {err && !open && (
        <div className="flex items-start gap-2 text-red-600 px-1">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <p className="text-[11px] font-bold">{err}</p>
        </div>
      )}
    </section>
  );
}

// ─── My Book: their client appointments + what they've earned this month ──────
// The renter's own ledger. The studio's reports deliberately exclude every one
// of these, so this is the only place these numbers live.
function MyBook({ data }: { data: any }) {
  const rows: any[] = data?.myBookings || [];
  const e = data?.earnings || {};
  const money = (c: number) => `$${((Number(c) || 0) / 100).toFixed(2)}`;
  return (
    <section className="space-y-3">
      <SectionTitle icon={CalendarDays}>My Book</SectionTitle>
      <div className="p-4 rounded-3xl bg-white border-2 space-y-3">
        <div className="rounded-2xl bg-slate-50 p-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Booked this month</p>
          <p className="text-2xl font-black text-slate-900">{money(e.monthBookedCents)}</p>
          <p className="text-[11px] font-bold text-slate-500">
            {e.monthCount || 0} appointment{(e.monthCount || 0) === 1 ? '' : 's'} so far · {e.upcomingCount || 0} coming up
          </p>
          <p className="mt-1 text-[10px] font-bold text-slate-400">You collect these directly — this is your record, not a payout.</p>
        </div>
        {rows.length === 0 ? (
          <p className="py-4 text-center text-[11px] font-bold text-slate-400">No upcoming client bookings yet. Share your booking link to fill it.</p>
        ) : rows.map((b: any) => (
          <div key={b.id} className="flex items-center justify-between gap-3 rounded-2xl border-2 p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-black text-slate-900">{b.clientName}</p>
              <p className="text-[11px] font-bold text-slate-500">{b.serviceName || 'Service'} · {fmtDate(String(b.startTime).slice(0, 10))}</p>
            </div>
            <p className="shrink-0 text-[13px] font-black text-slate-900">${Number(b.price || 0).toFixed(2)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── My Services: menu editor + pricing coach ─────────────────────────────────
// The renter's own business tool. Every number here is derived from THEIR rent
// and THEIR hours — the studio never sees these calculations, only the menu
// that results. The lease floor is shown as the agreed term it is, and the
// server enforces it too, so a refused save is never a surprise.
function MyServices({ data, tenantId, token, onChanged }: { data: any; tenantId: string; token: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [hours, setHours] = useState(String(data?.pricing?.bookableHoursPerMonth || 100));
  const [draft, setDraft] = useState<any>(null);

  const pricing = data?.pricing || {};
  const rentPerHour = (Number(pricing.rentPerHourCents) || 0) / 100;
  const floor = (Number(pricing.priceFloorCents) || 0) / 100;
  const services: any[] = data?.myServices || [];

  // When they've told us what they need to live on, the bar becomes THEIR
  // target hourly instead of a generic multiple of rent. Same shape either
  // way, so the UI doesn't branch — only the standard gets more honest.
  const targetHourly = (Number(pricing.targetHourlyCents) || 0) / 100;
  const hasGoals = !!pricing.hasGoals && targetHourly > 0;

  const coach = (price: number, duration: number, productCost: number) => {
    const hrs = Math.max(0.01, (Number(duration) || 60) / 60);
    const rentShare = rentPerHour * hrs;
    const keep = (Number(price) || 0) - rentShare - (Number(productCost) || 0);
    const perHour = keep / hrs;
    const bar = hasGoals ? targetHourly : rentPerHour * 2;
    const tone = keep <= 0 ? 'bad' : perHour < bar ? 'thin' : 'good';
    const monthlyTarget = hasGoals
      ? (Number(pricing.monthlyTargetCents) || 0) / 100
      : (Number(pricing.monthlyRentCents) || 0) / 100;
    const needed = keep > 0 ? Math.ceil(monthlyTarget / keep) : 0;
    return { rentShare, keep, perHour, tone, needed, bar };
  };

  const saveHours = async () => {
    setBusy(true); setErr('');
    const d = await api({ action: 'my-hours', tenantId, token, bookableHoursPerMonth: Number(hours) });
    setBusy(false);
    if (!d.ok) { setErr(d.error || 'Could not save'); return; }
    onChanged();
  };

  const saveService = async () => {
    if (!draft) return;
    setBusy(true); setErr('');
    const d = await api({
      action: 'my-service-save', tenantId, token,
      serviceId: draft.id || '', name: draft.name,
      price: Number(draft.price), duration: Number(draft.duration), productCost: Number(draft.productCost || 0),
      depositAmount: Number(draft.depositAmount || 0),
    });
    setBusy(false);
    if (!d.ok) { setErr(d.error || 'Could not save'); return; }
    setDraft(null); onChanged();
  };

  const removeService = async (id: string) => {
    setBusy(true); setErr('');
    const d = await api({ action: 'my-service-remove', tenantId, token, serviceId: id });
    setBusy(false);
    if (!d.ok) { setErr(d.error || 'Could not remove'); return; }
    onChanged();
  };

  const live = draft ? coach(Number(draft.price) || 0, Number(draft.duration) || 60, Number(draft.productCost) || 0) : null;

  return (
    <section className="space-y-3">
      <SectionTitle icon={Sparkles}>My Services</SectionTitle>

      <div className="p-4 rounded-3xl bg-white border-2 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Your booking link</p>
            <p className="text-[11px] font-bold text-slate-700 truncate">{data?.provider?.bookingUrl}</p>
          </div>
          <button onClick={() => { navigator.clipboard?.writeText(data?.provider?.bookingUrl || ''); }}
                  className="h-9 shrink-0 rounded-xl bg-slate-900 px-4 text-[10px] font-black uppercase tracking-widest text-white active:scale-95">
            Copy
          </button>
        </div>

        <div className="rounded-2xl bg-slate-50 p-3 space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            {hasGoals ? 'What an hour needs to earn' : 'What an hour costs you'}
          </p>
          <p className="text-[13px] font-bold text-slate-700">
            {hasGoals ? (
              <>Your hour needs to make <span className="font-black text-slate-900">${targetHourly.toFixed(2)}</span> — rent, taxes and what you live on, over the hours you book.</>
            ) : (
              <>Your rent works out to <span className="font-black text-slate-900">${rentPerHour.toFixed(2)}/hour</span> in the chair.</>
            )}
          </p>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-slate-500">Hours you book a month</span>
            <input type="number" min={1} max={400} value={hours} onChange={e => setHours(e.target.value)}
                   className="h-9 w-20 rounded-xl border-2 text-center text-[12px] font-black" />
            <button onClick={saveHours} disabled={busy}
                    className="h-9 rounded-xl border-2 px-3 text-[10px] font-black uppercase tracking-widest disabled:opacity-50">Save</button>
          </div>
        </div>

        {floor > 0 && (
          <p className="text-[11px] font-bold text-slate-500">Your lease sets a ${floor.toFixed(2)} minimum per service.</p>
        )}
        {err && <p className="text-[11px] font-black text-red-600">{err}</p>}

        {services.map((sv: any) => {
          const c = coach(sv.price, sv.duration, sv.productCost);
          return (
            <div key={sv.id} className="rounded-2xl border-2 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-black text-slate-900">{sv.name}</p>
                  <p className="text-[11px] font-bold text-slate-500">${Number(sv.price).toFixed(2)} · {sv.duration} min</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button onClick={() => setDraft({ ...sv })} className="h-8 rounded-lg border-2 px-3 text-[10px] font-black uppercase tracking-widest">Edit</button>
                  <button onClick={() => removeService(sv.id)} disabled={busy} className="h-8 rounded-lg px-2 text-[10px] font-black uppercase tracking-widest text-slate-400 disabled:opacity-50">Remove</button>
                </div>
              </div>
              <p className={cn('mt-2 text-[11px] font-bold',
                c.tone === 'bad' ? 'text-red-600' : c.tone === 'thin' ? 'text-amber-600' : 'text-emerald-700')}>
                {c.keep <= 0
                  ? `You lose $${Math.abs(c.keep).toFixed(2)} on this one after rent and product.`
                  : `You keep $${c.keep.toFixed(2)} — that's $${c.perHour.toFixed(2)}/hour. ${c.needed} a month ${hasGoals ? 'hits your goal' : 'covers your rent'}.`}
              </p>
            </div>
          );
        })}

        {draft ? (
          <div className="rounded-2xl border-2 border-slate-900 p-3 space-y-2">
            <input placeholder="Service name" value={draft.name || ''} onChange={e => setDraft((d: any) => ({ ...d, name: e.target.value }))}
                   className="h-10 w-full rounded-xl border-2 px-3 text-[13px] font-bold" />
            <div className="flex flex-wrap gap-2">
              <label className="flex-1 min-w-[5rem]">
                <span className="block text-[9px] font-black uppercase tracking-widest text-slate-400">Price</span>
                <input type="number" min={0} value={draft.price ?? ''} onChange={e => setDraft((d: any) => ({ ...d, price: e.target.value }))}
                       className="h-10 w-full rounded-xl border-2 text-center text-[13px] font-black" />
              </label>
              <label className="flex-1 min-w-[5rem]">
                <span className="block text-[9px] font-black uppercase tracking-widest text-slate-400">Minutes</span>
                <input type="number" min={5} step={5} value={draft.duration ?? 60} onChange={e => setDraft((d: any) => ({ ...d, duration: e.target.value }))}
                       className="h-10 w-full rounded-xl border-2 text-center text-[13px] font-black" />
              </label>
              <label className="flex-1 min-w-[5rem]">
                <span className="block text-[9px] font-black uppercase tracking-widest text-slate-400">Product $</span>
                <input type="number" min={0} value={draft.productCost ?? 0} onChange={e => setDraft((d: any) => ({ ...d, productCost: e.target.value }))}
                       className="h-10 w-full rounded-xl border-2 text-center text-[13px] font-black" />
              </label>
              {data?.provider?.chargesEnabled && (
                <label className="flex-1 min-w-[5rem]">
                  <span className="block text-[9px] font-black uppercase tracking-widest text-slate-400">Deposit $</span>
                  <input type="number" min={0} value={draft.depositAmount ?? 0} onChange={e => setDraft((d: any) => ({ ...d, depositAmount: e.target.value }))}
                         className="h-10 w-full rounded-xl border-2 text-center text-[13px] font-black" />
                </label>
              )}
            </div>
            {data?.provider?.chargesEnabled ? (
              <p className="text-[10px] font-bold text-slate-400">A deposit holds the slot and goes straight to your Stripe. Leave it 0 for no deposit.</p>
            ) : (
              <p className="text-[10px] font-bold text-slate-400">Connect your Stripe below to start taking deposits and stop losing no-shows.</p>
            )}
            {live && (
              <div className={cn('rounded-xl p-3',
                live.tone === 'bad' ? 'bg-red-50' : live.tone === 'thin' ? 'bg-amber-50' : 'bg-emerald-50')}>
                <p className={cn('text-[12px] font-black',
                  live.tone === 'bad' ? 'text-red-700' : live.tone === 'thin' ? 'text-amber-700' : 'text-emerald-800')}>
                  {live.keep <= 0
                    ? `At this price you lose $${Math.abs(live.keep).toFixed(2)} each time.`
                    : `You keep $${live.keep.toFixed(2)} — $${live.perHour.toFixed(2)}/hour.`}
                </p>
                <p className="mt-1 text-[11px] font-bold text-slate-600">
                  Rent share ${live.rentShare.toFixed(2)}{Number(draft.productCost) > 0 ? ` · product $${Number(draft.productCost).toFixed(2)}` : ''}
                  {live.needed > 0 ? ` · ${live.needed} a month covers your rent` : ''}
                </p>
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={saveService} disabled={busy}
                      className="h-10 flex-1 rounded-xl bg-slate-900 text-[10px] font-black uppercase tracking-widest text-white active:scale-95 disabled:opacity-50">
                {busy ? 'Saving…' : 'Save service'}
              </button>
              <button onClick={() => { setDraft(null); setErr(''); }} className="h-10 rounded-xl border-2 px-4 text-[10px] font-black uppercase tracking-widest">Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setDraft({ name: '', price: '', duration: 60, productCost: 0 })}
                  className="h-11 w-full rounded-2xl border-2 border-dashed text-[10px] font-black uppercase tracking-widest text-slate-500">
            ＋ Add a service
          </button>
        )}
      </div>
    </section>
  );
}

// ─── Shared UI bits ───────────────────────────────────────────────────────────
const SectionTitle = ({ icon: Icon, children }: { icon: any; children: React.ReactNode }) => (
  <div className="flex items-center gap-2 px-1">
    <Icon className="w-3.5 h-3.5 text-primary" />
    <h2 className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-500">{children}</h2>
  </div>
);

const Chip = ({ tone, children }: { tone: 'green' | 'amber' | 'red' | 'slate' | 'violet'; children: React.ReactNode }) => (
  <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest',
    tone === 'green' && 'bg-emerald-100 text-emerald-700',
    tone === 'amber' && 'bg-amber-100 text-amber-700',
    tone === 'red' && 'bg-red-100 text-red-700',
    tone === 'violet' && 'bg-violet-100 text-violet-700',
    tone === 'slate' && 'bg-slate-100 text-slate-600')}>
    {children}
  </span>
);

// ─── Login (contact → code) ───────────────────────────────────────────────────
const LoginFlow = ({ tenantId, onSession }: {
  tenantId: string;
  onSession: (s: { token: string; expiresAt: number; name: string | null }) => void;
}) => {
  const { toast } = useToast();
  const [phase, setPhase] = useState<'contact' | 'code'>('contact');
  const [contact, setContact] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const requestCode = async () => {
    if (!contact.trim()) return;
    setBusy(true);
    const d = await api({ action: 'request-code', tenantId, contact: contact.trim() });
    setBusy(false);
    if (d.ok) {
      setPhase('code');
    } else {
      toast({ variant: 'destructive', title: 'Couldn’t send a code', description: d.error || 'Try again.' });
    }
  };

  const verify = async () => {
    if (code.length !== 6) return;
    setBusy(true);
    const d = await api({ action: 'verify-code', tenantId, contact: contact.trim(), code });
    setBusy(false);
    if (d.ok && d.token) {
      onSession({ token: d.token, expiresAt: d.expiresAt, name: d.name || null });
    } else {
      setCode('');
      toast({ variant: 'destructive', title: 'Code didn’t match', description: d.error || 'Check the code and try again.' });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-violet-50 via-white to-white flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-3">
          <div className="w-16 h-16 rounded-3xl bg-violet-100 flex items-center justify-center mx-auto">
            <Armchair className="w-8 h-8 text-violet-600" />
          </div>
          <h1 className="text-3xl font-black uppercase tracking-tighter text-slate-900">Renter Portal</h1>
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
            {phase === 'contact' ? 'Your bookings, credits & rent — one place' : 'Enter your access code'}
          </p>
        </div>

        {phase === 'contact' ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 px-1">
                Phone or email you booked with
              </label>

              <p className="text-[10px] font-medium text-slate-400 px-1 leading-snug">
                We'll text a one-time sign-in code to this number. Msg &amp; data rates may
                apply. Reply STOP to opt out. <a href="/terms" target="_blank" rel="noreferrer" className="underline">SMS Terms</a> · <a href="/privacy" target="_blank" rel="noreferrer" className="underline">Privacy</a>
              </p>
              <div className="relative">
                <Phone className="w-4 h-4 text-slate-300 absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  value={contact}
                  onChange={e => setContact(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && requestCode()}
                  inputMode="email"
                  autoComplete="tel"
                  placeholder="(555) 123-4567 or you@email.com"
                  className="w-full h-14 pl-11 pr-4 rounded-2xl border-2 border-slate-200 bg-white font-bold text-slate-900 placeholder:text-slate-300 focus:border-violet-400 focus:outline-none"
                />
              </div>
            </div>
            <button
              onClick={requestCode}
              disabled={busy || !contact.trim()}
              className="w-full h-14 rounded-2xl bg-slate-900 text-white font-black uppercase tracking-widest text-xs shadow-xl shadow-slate-900/20 active:scale-[0.98] transition-all disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {busy ? <Loader className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
              Get Access Code
            </button>
            <p className="text-[10px] font-medium text-slate-400 text-center leading-relaxed px-4">
              We’ll verify it’s really you. The studio front desk can share your one-time code.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-violet-50 border border-violet-100 text-center">
              <p className="text-[10px] font-bold text-violet-700 leading-relaxed">
                A 6-digit code was sent to the studio for <strong>{contact.trim()}</strong>.
                Ask the front desk to read it to you.
              </p>
            </div>
            <input
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={e => e.key === 'Enter' && verify()}
              inputMode="numeric"
              autoFocus
              placeholder="••••••"
              className="w-full h-16 rounded-2xl border-2 border-slate-200 bg-white font-black text-3xl text-center tracking-[0.5em] text-slate-900 placeholder:text-slate-200 focus:border-violet-400 focus:outline-none"
            />
            <button
              onClick={verify}
              disabled={busy || code.length !== 6}
              className="w-full h-14 rounded-2xl bg-slate-900 text-white font-black uppercase tracking-widest text-xs shadow-xl shadow-slate-900/20 active:scale-[0.98] transition-all disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {busy ? <Loader className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Sign In
            </button>
            <button
              onClick={() => { setPhase('contact'); setCode(''); }}
              className="w-full text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 py-2"
            >
              Use a different phone / email
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Reservation card ─────────────────────────────────────────────────────────
const ResCard = ({ r, isToday, onCheckIn, onCheckOut, onRequestReschedule, busy }: {
  r: any; isToday: boolean;
  onCheckIn?: (id: string) => void; onCheckOut?: (id: string) => void;
  onRequestReschedule?: (id: string) => void; busy?: boolean;
}) => {
  const window = r.bookingType === 'hourly' && r.startTime
    ? `${fmtTime(r.startTime)} – ${fmtTime(r.endTime)}`
    : r.startDate === r.endDate ? 'All day' : `through ${fmtDate(r.endDate)}`;
  const statusChip =
    r.status === 'checked_in' ? <Chip tone="green">Checked in</Chip> :
    r.status === 'confirmed' ? <Chip tone="violet">Confirmed</Chip> :
    r.status === 'completed' ? <Chip tone="slate">Completed</Chip> :
    r.status === 'refunded' ? <Chip tone="slate">Refunded</Chip> :
    <Chip tone="slate">{String(r.status || '').replace(/_/g, ' ')}</Chip>;

  return (
    <div className={cn('p-4 rounded-3xl border-2 bg-white space-y-3',
      isToday ? 'border-violet-200 shadow-lg shadow-violet-100' : 'border-slate-100')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-black text-slate-900 text-sm truncate">{r.boothName}</p>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">
            {fmtDate(r.startDate)} · {window}{r.slotLabel ? ` · ${r.slotLabel}` : ''}
          </p>
        </div>
        {statusChip}
      </div>

      {(r.balanceDueCents > 0 && !r.balancePaid && r.status !== 'refunded') && (
        <div className="flex items-center gap-2 p-2.5 rounded-xl bg-amber-50 border border-amber-100">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
          <p className="text-[10px] font-bold text-amber-700">
            {fmtMoney(r.balanceDueCents)} balance {r.balanceMode === 'at_checkin' ? 'due at check-in' : 'payable in person'}
          </p>
        </div>
      )}
      {r.overageStatus === 'due' && r.overageDueCents > 0 && (
        <div className="flex items-center gap-2 p-2.5 rounded-xl bg-red-50 border border-red-100">
          <Clock className="w-3.5 h-3.5 text-red-600 shrink-0" />
          <p className="text-[10px] font-bold text-red-700">
            {fmtMoney(r.overageDueCents)} overtime due ({r.overageMinutes} min past booked time)
          </p>
        </div>
      )}
      {r.creditDecision === 'pending' && r.potentialCreditCents > 0 && (
        <div className="flex items-center gap-2 p-2.5 rounded-xl bg-emerald-50 border border-emerald-100">
          <Sparkles className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          <p className="text-[10px] font-bold text-emerald-700">
            {fmtMoney(r.potentialCreditCents)} credit for unused time — pending studio review
          </p>
        </div>
      )}

      {isToday && r.status === 'confirmed' && onCheckIn && (
        <button onClick={() => onCheckIn(r.id)} disabled={busy}
          className="w-full h-12 rounded-2xl bg-violet-600 text-white font-black uppercase tracking-widest text-[11px] shadow-lg shadow-violet-200 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2">
          {busy ? <Loader className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Check In
        </button>
      )}
      {isToday && r.status === 'checked_in' && onCheckOut && (
        <button onClick={() => onCheckOut(r.id)} disabled={busy}
          className="w-full h-12 rounded-2xl bg-slate-900 text-white font-black uppercase tracking-widest text-[11px] active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2">
          {busy ? <Loader className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />} Check Out
        </button>
      )}
      {!isToday && r.status === 'confirmed' && onRequestReschedule && (
        r.rescheduleRequestedAt ? (
          <p className="text-[10px] font-black uppercase tracking-widest text-violet-500 text-center py-1.5">
            ⏱ Reschedule requested — the studio will reach out
          </p>
        ) : (
          <button onClick={() => onRequestReschedule(r.id)} disabled={busy}
            className="w-full h-10 rounded-2xl border-2 border-slate-200 text-slate-500 font-black uppercase tracking-widest text-[10px] active:scale-[0.98] transition-all disabled:opacity-50">
            Request Reschedule
          </button>
        )
      )}
    </div>
  );
};

// ─── Main page ────────────────────────────────────────────────────────────────
export default function RenterPortalPage() {
  const params = useParams();
  const tenantId = params.tenantId as string;
  const { toast } = useToast();

  const [session, setSession] = useState<{ token: string; expiresAt: number; name: string | null } | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const s = JSON.parse(localStorage.getItem(STORE(tenantId)) || 'null');
      return s && s.expiresAt > Date.now() ? s : null;
    } catch { return null; }
  });
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [credBusy, setCredBusy] = useState<'license' | 'insurance' | null>(null);
  const [credDone, setCredDone] = useState<'license' | 'insurance' | null>(null);
  const [credOpen, setCredOpen] = useState<'license' | 'insurance' | null>(null);
  const [credForm, setCredForm] = useState({ expiry: '', carrier: '', policyNumber: '' });

  const saveSession = (s: { token: string; expiresAt: number; name: string | null } | null) => {
    if (s) localStorage.setItem(STORE(tenantId), JSON.stringify(s));
    else localStorage.removeItem(STORE(tenantId));
    setSession(s);
    if (!s) setData(null);
  };

  // Magic link (?rt=TOKEN): the owner shared a personal sign-in link from
  // the renter's profile — exchange it for a session on arrival, then wipe
  // the token from the URL so it doesn't linger in history or share sheets.
  // This is the no-SMS path: it works before Twilio is configured.
  useEffect(() => {
    if (typeof window === 'undefined' || session?.token) return;
    const rt = new URLSearchParams(window.location.search).get('rt');
    if (!rt) return;
    window.history.replaceState({}, '', window.location.pathname);
    (async () => {
      const d = await api({ action: 'token-login', tenantId, magicToken: rt });
      if (d.ok && d.token) saveSession({ token: d.token, expiresAt: d.expiresAt, name: d.name || null });
      else toast({ variant: 'destructive', title: 'Link didn’t work', description: d.error || 'Sign in with your phone or email below.' });
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(async (tok?: string) => {
    const token = tok || session?.token;
    if (!token) return;
    setLoading(true);
    const d = await api({ action: 'me', tenantId, token, today: localISO() });
    setLoading(false);
    if (d.ok) setData(d);
    else if (d.status === 401) saveSession(null);
    else toast({ variant: 'destructive', title: 'Couldn’t load your info', description: d.error || 'Pull to refresh or try again.' });
  }, [session?.token, tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (session?.token && !data) refresh(); }, [session?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Returning from Stripe Checkout (?cfInvoiceId=&cfSession=) → confirm the
  // payment server-side (idempotent), then clean the URL.
  useEffect(() => {
    if (typeof window === 'undefined' || !session?.token) return;
    const params = new URLSearchParams(window.location.search);
    const invoiceId = params.get('cfInvoiceId');
    const sessionId = params.get('cfSession');
    if (!invoiceId || !sessionId) return;
    window.history.replaceState({}, '', window.location.pathname);
    (async () => {
      const d = await api({ action: 'confirm-invoice', tenantId, token: session.token, invoiceId, sessionId });
      if (d.ok) toast({ title: 'Rent paid ✓', description: 'Your receipt is in Payment History below.' });
      else toast({ variant: 'destructive', title: 'Payment needs attention', description: d.error || 'If you were charged, contact the studio — nothing is lost.' });
      refresh();
    })();
  }, [session?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = localISO();
  const todays = useMemo(() => (data?.upcoming || []).filter((r: any) => r.startDate <= today && r.endDate >= today), [data, today]);
  const later = useMemo(() => (data?.upcoming || []).filter((r: any) => r.startDate > today), [data, today]);

  // Every booking section hangs off this one derived flag. A renter on their
  // own system keeps rent, documents and credits and loses the rest — and the
  // engine enforces the same thing server-side, so this is presentation
  // following truth rather than pretending.
  const booksHere = !!data?.provider && data?.bookingMode !== 'own';
  const openInvoices = useMemo(() => (data?.invoices || []).filter((i: any) => i.status === 'due' || i.status === 'late'), [data]);

  const doCheckIn = async (reservationId: string) => {
    if (!session) return;
    setActionBusy(true);
    const d = await api({ action: 'check-in', tenantId, token: session.token, reservationId, today: localISO() });
    setActionBusy(false);
    if (d.ok) {
      toast({
        title: 'You’re checked in ✓',
        description: d.needsBalance
          ? `Reminder: ${fmtMoney(d.balanceDueCents)} balance is ${d.balanceMode === 'at_checkin' ? 'due now at the front desk' : 'payable in person'}.`
          : 'Have a great day at the studio.',
      });
      refresh();
    } else if (d.status === 401) { saveSession(null); }
    else toast({ variant: 'destructive', title: 'Check-in didn’t go through', description: d.error || 'See the front desk.' });
  };

  const payInvoice = async (invoiceId: string) => {
    if (!session) return;
    setActionBusy(true);
    const d = await api({ action: 'pay-invoice', tenantId, token: session.token, invoiceId, returnUrl: window.location.href });
    setActionBusy(false);
    if (d.ok && d.url) { window.location.href = d.url; }
    else if (d.ok && d.alreadyPaid) { toast({ title: 'Already paid ✓' }); refresh(); }
    else if (d.status === 401) { saveSession(null); }
    else toast({ variant: 'destructive', title: 'Couldn’t start payment', description: d.error || 'You can always pay at the front desk.' });
  };

  const requestReschedule = async (reservationId: string) => {
    if (!session) return;
    setActionBusy(true);
    const d = await api({ action: 'request-reschedule', tenantId, token: session.token, reservationId });
    setActionBusy(false);
    if (d.ok) {
      toast({ title: 'Request sent ✓', description: 'The studio will reach out to move your booking.' });
      refresh();
    } else if (d.status === 401) { saveSession(null); }
    else toast({ variant: 'destructive', title: 'Couldn’t send request', description: d.error || 'Try again.' });
  };

  const doCheckOut = async (reservationId: string) => {
    if (!session) return;
    setActionBusy(true);
    const d = await api({ action: 'check-out', tenantId, token: session.token, reservationId });
    setActionBusy(false);
    if (d.ok) {
      const desc = d.overageDueCents > 0
        ? `${fmtMoney(d.overageDueCents)} for ${d.overageMinutes} extra minutes will be settled by the studio.`
        : d.potentialCreditCents > 0
          ? `${fmtMoney(d.potentialCreditCents)} of unused time was sent to the studio for credit review.`
          : 'All settled — see you next time.';
      toast({ title: 'Checked out ✓', description: desc });
      refresh();
    } else if (d.status === 401) { saveSession(null); }
    else toast({ variant: 'destructive', title: 'Check-out didn’t go through', description: d.error || 'See the front desk.' });
  };

  if (!session) return <LoginFlow tenantId={tenantId} onSession={s => { saveSession(s); refresh(s.token); }} />;

  const firstName = (data?.name || session.name || '').split(' ')[0] || 'there';

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-lg mx-auto px-4 pb-16">

        <header className="flex items-center justify-between pt-8 pb-6">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">{data?.studioName || 'Studio'}</p>
            <h1 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Hi, {firstName}</h1>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => refresh()} disabled={loading}
              className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-600 active:scale-95 transition-all">
              <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            </button>
            <button onClick={() => saveSession(null)}
              className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-400 hover:text-red-500 active:scale-95 transition-all">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        {loading && !data ? (
          <div className="flex flex-col items-center py-24 gap-3 text-slate-400">
            <Loader className="w-8 h-8 animate-spin" />
            <p className="text-[10px] font-black uppercase tracking-widest">Loading your studio life…</p>
          </div>
        ) : (
          <div className="space-y-8">

            {todays.length > 0 && (
              <section className="space-y-3">
                <SectionTitle icon={Clock}>Today</SectionTitle>
                {todays.map((r: any) => (
                  <ResCard key={r.id} r={r} isToday onCheckIn={doCheckIn} onCheckOut={doCheckOut} busy={actionBusy} />
                ))}
              </section>
            )}

            {(data?.availableCreditCents > 0 || (data?.credits || []).length > 0) && (
              <section className="space-y-3">
                <SectionTitle icon={Sparkles}>Studio Credit</SectionTitle>
                <div className="p-5 rounded-3xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-xl shadow-emerald-200">
                  <p className="text-[9px] font-black uppercase tracking-[0.3em] opacity-70">Available balance</p>
                  <p className="text-4xl font-black tracking-tighter font-mono mt-1">{fmtMoney(data?.availableCreditCents || 0)}</p>
                  <p className="text-[10px] font-bold opacity-80 mt-2">Applies automatically to your next booking.</p>
                </div>
              </section>
            )}

            {data?.lease && (
              <section className="space-y-3">
                <SectionTitle icon={Wallet}>Your Rent</SectionTitle>
                <div className="p-4 rounded-3xl bg-white border-2 border-slate-100 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-black text-slate-900 text-sm">{data.lease.boothName || 'Your space'}</p>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">
                        {fmtMoney(data.lease.rentAmountCents)} / {String(data.lease.frequency || 'month').replace('biweekly', '2 weeks').replace('ly', '')}
                      </p>
                    </div>
                    {openInvoices.some((i: any) => i.status === 'late')
                      ? <Chip tone="red">Late</Chip>
                      : openInvoices.length > 0 ? <Chip tone="amber">Due</Chip> : <Chip tone="green">Current</Chip>}
                  </div>
                  {openInvoices.map((i: any) => (
                    <div key={i.id} className={cn('flex items-center justify-between p-3 rounded-xl',
                      i.status === 'late' ? 'bg-red-50' : 'bg-amber-50')}>
                      <div>
                        <p className={cn('text-[11px] font-black', i.status === 'late' ? 'text-red-700' : 'text-amber-700')}>
                          {fmtMoney(i.amountCents + i.lateFeeCents)}
                          {i.lateFeeCents > 0 && <span className="font-bold opacity-70"> (incl. {fmtMoney(i.lateFeeCents)} late fee)</span>}
                        </p>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Due {fmtDate(i.dueDate)}</p>
                      </div>
                      <button onClick={() => payInvoice(i.id)} disabled={actionBusy}
                        className={cn('h-9 px-4 rounded-xl font-black uppercase tracking-widest text-[10px] text-white active:scale-95 transition-all disabled:opacity-50 shrink-0',
                          i.status === 'late' ? 'bg-red-600' : 'bg-slate-900')}>
                        {actionBusy ? '…' : 'Pay Now'}
                      </button>
                    </div>
                  ))}
                  {/* Autopay — their own switch. Reads the same flag the owner
                      can set; refuses without a card on file. */}
                  {(() => {
                    const r: any = data?.renter || {};
                    const on = r.autopayEnabled === true;
                    return (
                      <button type="button" disabled={actionBusy}
                        onClick={async () => {
                          if (!on && !r.cardOnFile) { toast({ variant: 'destructive', title: 'No card on file', description: 'Add a card first — autopay needs one to draft from.' }); return; }
                          setActionBusy(true);
                          const d = await api({ action: 'autopay-set', tenantId, token: session?.token, enabled: !on });
                          setActionBusy(false);
                          if (!d.ok) { toast({ variant: 'destructive', title: 'Could not change autopay', description: d.error || 'Try again in a moment.' }); return; }
                          toast({ title: !on ? 'Autopay on' : 'Autopay off', description: !on ? 'Your rent drafts on each due day.' : 'You pay each invoice yourself from now on.' });
                          refresh();
                        }}
                        aria-pressed={on}
                        className={cn('w-full rounded-2xl border-2 px-4 py-3 flex items-center justify-between gap-3 text-left transition-colors disabled:opacity-50',
                          on ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white')}>
                        <span className="min-w-0">
                          <span className="block text-[11px] font-black uppercase tracking-widest text-slate-900">Autopay</span>
                          <span className="block text-[10px] font-bold text-slate-500">
                            {on
                              ? `Your rent drafts on each due day from ${r.cardBrand || 'your card'} ····${r.cardLast4 || ''}. Nothing to remember.`
                              : r.cardOnFile ? `Off — you pay each invoice yourself. Your ${r.cardBrand || 'card'} ····${r.cardLast4 || ''} is saved if you'd like it automatic.`
                              : 'Off — add a card on file to turn this on.'}
                          </span>
                        </span>
                        <span className={cn('shrink-0 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest',
                          on ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500')}>{on ? 'On' : 'Off'}</span>
                      </button>
                    );
                  })()}
                  <p className="text-[9px] font-bold uppercase tracking-widest text-slate-300 text-center">Prefer cash or check? Pay at the front desk — it posts here too.</p>
                </div>
              </section>
            )}

            {session?.token && data?.renter?.id && (
              <RenterThread tenantId={tenantId} token={session.token} studioName={data?.studioName || data?.tenant?.name || 'the studio'} />
            )}

            {session?.token && data?.lease && (
              <RenterLeave tenantId={tenantId} token={session.token} />
            )}

            {session?.token && data?.renter?.id && (
              <RenterDocuments tenantId={tenantId} token={session.token} />
            )}

            {session?.token && data?.renter?.id && (
              <RenterInterruptions tenantId={tenantId} token={session.token} />
            )}

            {session?.token && data?.renter?.id && (
              <RenterMaintenance tenantId={tenantId} token={session.token} />
            )}

            {session?.token && data?.renter?.id && (
              <RenterConcerns tenantId={tenantId} token={session.token} />
            )}

            {session?.token && (
              <GettingSetUp data={data} tenantId={tenantId} token={session.token} onChanged={() => refresh()} />
            )}

            {data?.provider && session?.token && data?.checklist?.modeChosen && (
              <MyProfile data={data} tenantId={tenantId} token={session.token} onChanged={() => refresh()} />
            )}

            {booksHere && session?.token && (
              <MyServices data={data} tenantId={tenantId} token={session.token} onChanged={() => refresh()} />
            )}

            {booksHere && session?.token && (
              <MyNumber data={data} tenantId={tenantId} token={session.token} onChanged={() => refresh()} />
            )}

            {booksHere && session?.token && (
              <MyHours data={data} tenantId={tenantId} token={session.token} onChanged={() => refresh()} />
            )}

            {booksHere && session?.token && data?.swaps?.enabled !== false && (
              <MySwaps data={data} tenantId={tenantId} token={session.token} onChanged={() => refresh()} />
            )}

            {booksHere && <MyBook data={data} />}

            {booksHere && session?.token && (
              <MyPayments data={data} tenantId={tenantId} token={session.token} />
            )}

            <section className="space-y-3">
              <SectionTitle icon={CalendarDays}>Upcoming Bookings</SectionTitle>
              {later.length === 0 && todays.length === 0 ? (
                <div className="p-6 rounded-3xl bg-white border-2 border-dashed border-slate-200 text-center space-y-2">
                  <Armchair className="w-8 h-8 text-slate-200 mx-auto" />
                  <p className="text-[11px] font-bold text-slate-400">No upcoming bookings</p>
                </div>
              ) : (
                later.map((r: any) => <ResCard key={r.id} r={r} isToday={false} onRequestReschedule={requestReschedule} busy={actionBusy} />)
              )}
              {data?.rebookUrl && (
                <a href={data.rebookUrl}
                  className="w-full h-12 rounded-2xl border-2 border-violet-200 bg-violet-50 text-violet-700 font-black uppercase tracking-widest text-[11px] active:scale-[0.98] transition-all flex items-center justify-center gap-2">
                  Book Another Visit <ChevronRight className="w-4 h-4" />
                </a>
              )}
            </section>

            <section className="space-y-3">
              <SectionTitle icon={Receipt}>Insurance &amp; licence</SectionTitle>
              <div className="rounded-3xl bg-white border-2 border-slate-100 p-4 space-y-2.5">
                {credentialViews(data?.renter, { bookingPageSettings: { automationRules: data?.compliance || {} } }, new Date().toISOString().slice(0, 10)).map((v) => {
                  const kind = v.kind;
                  const tone = v.state === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : v.state === 'expiring' ? 'border-amber-200 bg-amber-50 text-amber-900' : (v.state === 'expired' || (v.state === 'missing' && v.required)) ? 'border-red-200 bg-red-50 text-red-900' : 'border-slate-200 bg-slate-50 text-slate-700';
                  return (
                    <div key={kind} className={cn('rounded-2xl border-2 px-3.5 py-3 space-y-2', tone)}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] font-black uppercase tracking-widest">{CREDENTIAL_LABEL[kind]}</p>
                        <span className="text-[10px] font-black">{stateLabel(v)}</span>
                      </div>
                      {kind === 'insurance' && (v.carrier || v.policyNumber) && <p className="text-[11px] font-bold">{v.carrier}{v.carrier && v.policyNumber ? ' · ' : ''}{v.policyNumber ? `policy ${v.policyNumber}` : ''}</p>}
                      {v.state === 'missing' && v.required && <p className="text-[10px] font-bold">The studio requires this on file to rent here.</p>}
                      {v.docUrl && <a href={v.docUrl} target="_blank" rel="noopener" className="text-[10px] font-black uppercase tracking-widest underline">See the copy on file</a>}
                      {credOpen === kind ? (
                        <div className="space-y-2 pt-1">
                          <input type="date" value={credForm.expiry} onChange={(e) => setCredForm((f) => ({ ...f, expiry: e.target.value }))} aria-label="Expiry date on the document" className="h-11 w-full rounded-2xl border-2 border-slate-200 bg-white px-3 text-sm font-bold" />
                          {kind === 'insurance' && (
                            <div className="grid grid-cols-2 gap-2">
                              <input value={credForm.carrier} onChange={(e) => setCredForm((f) => ({ ...f, carrier: e.target.value.slice(0, 120) }))} aria-label="Insurance carrier" placeholder="Carrier" className="h-11 rounded-2xl border-2 border-slate-200 bg-white px-3 text-sm font-bold" />
                              <input value={credForm.policyNumber} onChange={(e) => setCredForm((f) => ({ ...f, policyNumber: e.target.value.slice(0, 80) }))} aria-label="Policy number" placeholder="Policy number" className="h-11 rounded-2xl border-2 border-slate-200 bg-white px-3 text-sm font-bold" />
                            </div>
                          )}
                          <p className="text-[9px] font-bold opacity-80">Enter the expiry date exactly as it appears on the document, then attach a photo of it. The studio is notified automatically.</p>
                          <div className="flex gap-2">
                            <label className={cn('h-11 flex-1 rounded-2xl bg-slate-900 text-white font-black uppercase text-[10px] tracking-widest flex items-center justify-center cursor-pointer', (credBusy === kind || !credForm.expiry) && 'opacity-50 pointer-events-none')}>
                              {credBusy === kind ? 'Uploading…' : 'Attach photo & save'}
                              <input type="file" accept="image/*" capture="environment" className="hidden" disabled={!!credBusy || !credForm.expiry}
                                onChange={async (e) => {
                                  const f = e.target.files?.[0]; e.target.value = '';
                                  if (!f || !session) return;
                                  setCredBusy(kind);
                                  try {
                                    const dataUrl: string = await downscaleImageToDataUrl(f, { maxDim: 1600 });
                                    const d = await api({ action: 'upload-credential', tenantId, token: session.token, kind, photoData: dataUrl, expiry: credForm.expiry, carrier: credForm.carrier, policyNumber: credForm.policyNumber });
                                    if (d.ok) { setCredDone(kind); setCredOpen(null); setCredForm({ expiry: '', carrier: '', policyNumber: '' }); toast({ title: 'On file ✓', description: 'The studio has been notified.' }); void refresh(); }
                                    else toast({ variant: 'destructive', title: 'Upload failed', description: d.error || 'Try again.' });
                                  } catch { toast({ variant: 'destructive', title: 'Upload failed', description: 'Try again.' }); }
                                  finally { setCredBusy(null); }
                                }} />
                            </label>
                            <button type="button" onClick={() => setCredOpen(null)} className="h-11 rounded-2xl border-2 border-slate-200 bg-white px-3 text-[10px] font-black uppercase tracking-widest text-slate-600">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <button type="button" onClick={() => { setCredOpen(kind); setCredForm({ expiry: v.expiry || '', carrier: v.carrier || '', policyNumber: v.policyNumber || '' }); }}
                          className="h-10 w-full rounded-2xl border-2 border-current/20 bg-white text-[10px] font-black uppercase tracking-widest text-slate-700">
                          {credDone === kind ? 'Uploaded ✓ · update again' : v.docUrl ? 'Upload a renewed one' : `Add ${kind === 'insurance' ? 'insurance' : 'licence'}`}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            {(data?.payments || []).length > 0 && (
              <section className="space-y-3">
                <SectionTitle icon={Receipt}>Payment History</SectionTitle>
                <div className="rounded-3xl bg-white border-2 border-slate-100 divide-y divide-slate-50 overflow-hidden">
                  {(data.payments || []).map((p: any) => (
                    <div key={p.id || p.date + p.description} className="flex items-center justify-between p-3.5">
                      <div className="min-w-0 pr-3">
                        <p className="text-[11px] font-bold text-slate-800 truncate">{p.description || p.category}</p>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
                          {p.date ? fmtDate(String(p.date).slice(0, 10)) : ''}
                        </p>
                      </div>
                      <p className={cn('text-xs font-black font-mono shrink-0',
                        p.type === 'reversal' ? 'text-slate-400' : 'text-slate-900')}>
                        {p.type === 'reversal' ? '−' : ''}${Number(p.amount || 0).toFixed(2)}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {(data?.past || []).length > 0 && (
              <section className="space-y-3">
                <SectionTitle icon={CreditCard}>Past Visits</SectionTitle>
                <div className="space-y-2">
                  {(data.past || []).map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between p-3.5 rounded-2xl bg-white border border-slate-100">
                      <div className="min-w-0 pr-3">
                        <p className="text-[11px] font-bold text-slate-800 truncate">{r.boothName}</p>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{fmtDate(r.startDate)}</p>
                      </div>
                      <Chip tone={r.status === 'refunded' ? 'slate' : 'slate'}>
                        {String(r.status || '').replace(/_/g, ' ')}
                      </Chip>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
