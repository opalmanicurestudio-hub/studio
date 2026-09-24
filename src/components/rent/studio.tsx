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
import { Chip, SectionTitle, fmtDate, fmtMoney, fmtTime, localISO } from '@/components/rent/shared';

// ─── Leave ───────────────────────────────────────────────────────────────────
// The renter asks; the studio decides. Only treatments the shop offers are
// shown, and a request changes nothing until it is approved. Banked days work
// the same way: asking to spend them is not spending them.
// ─── Today: the reasons they logged in, one tap each ─────────────────────────
export function TodayQuick({ data, booksHere, onGo, tenantId, token, onBadges, visible }: { data: any; booksHere: boolean; onGo: (t: 'today' | 'book' | 'rent' | 'studio') => void; tenantId: string; token: string; onBadges: (b: Record<string, number>) => void; visible: boolean }) {
  const [inbox, setInbox] = useState<{ items: any[]; todayAppts: any[] } | null>(null);
  useEffect(() => {
    let alive = true;
    api({ action: 'today', tenantId, token }).then((d) => {
      if (!alive || !d?.ok) return;
      setInbox({ items: d.items || [], todayAppts: d.todayAppts || [] });
      onBadges(d.badges || {});
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, token, data?.invoices?.length]);
  const due = (data?.invoices || []).filter((i: any) => i.status === 'due' || i.status === 'late');
  const dueCents = due.reduce((n: number, i: any) => n + (Number(i.amountCents) || 0) + (Number(i.lateFeeCents) || 0), 0);
  const late = due.some((i: any) => i.status === 'late');
  const nextAppt = (data?.myBookings || []).filter((b: any) => b.status !== 'cancelled').sort((a: any, b: any) => String(a.startTime).localeCompare(String(b.startTime)))[0] || null;
  const when = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }); };
  const clock = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); };
  const ago = (iso: string) => { const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000); return h < 1 ? 'just now' : h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`; };
  const tone: Record<string, string> = { red: 'border-red-300 bg-red-50', amber: 'border-amber-300 bg-amber-50', green: 'border-emerald-200 bg-emerald-50', slate: 'border-slate-200 bg-white' };
  const quiet = inbox && inbox.items.length === 0 && due.length === 0 && (!booksHere || inbox.todayAppts.length === 0);
  const Action = ({ label, sub, onClick }: { label: string; sub?: string; onClick: () => void }) => (
    <button type="button" onClick={onClick} className="rounded-2xl border-2 bg-white px-3 py-3 text-left">
      <span className="block text-[11px] font-black uppercase tracking-widest">{label}</span>
      {sub && <span className="block text-[10px] font-bold text-slate-500 truncate">{sub}</span>}
    </button>
  );
  return (
    <section className={visible ? 'space-y-2' : 'hidden'}>
      {due.length > 0 && (
        <button type="button" onClick={() => onGo('rent')} className={cn('w-full rounded-2xl border-2 px-4 py-3 text-left', late ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50')}>
          <span className={cn('block text-[11px] font-black uppercase tracking-widest', late ? 'text-red-800' : 'text-amber-800')}>{late ? 'Rent is late' : 'Rent due'} · ${(dueCents / 100).toFixed(2)}</span>
          <span className="block text-[10px] font-bold text-slate-600">Tap to see and pay.</span>
        </button>
      )}
      {booksHere && inbox && inbox.todayAppts.length > 0 && (
        <button type="button" onClick={() => onGo('book')} className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-left space-y-1">
          <span className="block text-[11px] font-black uppercase tracking-widest text-slate-800">Today · {inbox.todayAppts.length} appointment{inbox.todayAppts.length === 1 ? '' : 's'}</span>
          {inbox.todayAppts.slice(0, 4).map((a) => (
            <span key={a.id} className="block text-[11px] font-bold text-slate-700 truncate"><span className="font-black">{clock(a.startTime)}</span> · {a.clientName}{a.serviceName ? ` · ${a.serviceName}` : ''}</span>
          ))}
          {inbox.todayAppts.length > 4 && <span className="block text-[10px] font-bold text-slate-500">and {inbox.todayAppts.length - 4} more</span>}
        </button>
      )}
      {booksHere && inbox && inbox.todayAppts.length === 0 && nextAppt && (
        <button type="button" onClick={() => onGo('book')} className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-left">
          <span className="block text-[11px] font-black uppercase tracking-widest text-slate-800">Nothing today · next {when(nextAppt.startTime)}</span>
          <span className="block text-[10px] font-bold text-slate-500 truncate">{nextAppt.clientName || 'Client'}{nextAppt.serviceName ? ` · ${nextAppt.serviceName}` : ''}</span>
        </button>
      )}
      {inbox && inbox.items.map((it, i) => (
        <button key={i} type="button" onClick={() => onGo(it.tab)} className={cn('w-full rounded-2xl border-2 px-4 py-3 text-left', tone[it.tone || 'slate'])}>
          <span className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-black uppercase tracking-widest text-slate-800">{it.title}</span>
            <span className="shrink-0 text-[9px] font-black uppercase tracking-widest text-slate-400">{ago(it.at)}</span>
          </span>
          {it.body && <span className="block text-[10px] font-bold text-slate-600 truncate">{it.body}</span>}
        </button>
      ))}
      {quiet && (
        <div className="rounded-2xl border-2 border-slate-100 bg-white px-4 py-3">
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-800">Nothing needs you</p>
          <p className="text-[10px] font-bold text-slate-500">Rent is settled and nothing is waiting.{booksHere && data?.provider?.bookingUrl ? ' Share your booking link to fill the book.' : ''}</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {booksHere && <Action label="Add walk-in" sub="Book someone now" onClick={() => onGo('book')} />}
        <Action label="Pay rent" sub={due.length ? 'Something is due' : 'Nothing due right now'} onClick={() => onGo('rent')} />
        <Action label="Report a problem" sub="Something broken?" onClick={() => onGo('studio')} />
        <Action label="Message the studio" sub="Or raise a concern" onClick={() => onGo('studio')} />
      </div>
    </section>
  );
}

// ─── Documents ───────────────────────────────────────────────────────────────
// The paperwork after the lease, read and signed here. Signing is typing your
// full name — the same way the lease was signed — and the record lands beside
// it, with the exact text, the time, and the device. Declining is allowed and
// is a message to the studio, not a silent no.
export const DOC_STATUS: Record<string, string> = { sent: 'Waiting for you', signed: 'Signed', declined: 'Declined', withdrawn: 'Withdrawn by the studio' };
export function RenterDocuments({ tenantId, token }: { tenantId: string; token: string }) {
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
export const ITYPE: Record<string, string> = { flood: 'Flood / water damage', fire: 'Fire / smoke', power: 'Power loss', water: 'No running water', weather: 'Weather', closure: 'Forced closure', other: 'Closure' };
export function RenterInterruptions({ tenantId, token }: { tenantId: string; token: string }) {
  const [state, setState] = useState<{ interruptions: any[]; portalToken: string | null } | null>(null);
  const [logFor, setLogFor] = useState('');
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), appointmentsLost: '', lost: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ticked, setTicked] = useState<Record<string, string[]>>({});
  const [cancelToo, setCancelToo] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState('');
  const load = useCallback(async () => {
    const d = await api({ action: 'interruption-list', tenantId, token });
    if (d?.ok) setState({ interruptions: d.interruptions || [], portalToken: d.portalToken || null });
  }, [tenantId, token]);
  const logTicked = async (id: string) => {
    const ids = ticked[id] || [];
    if (ids.length === 0) return;
    setBusy(true); setErr(''); setResult('');
    const d = await api({ action: 'interruption-loss', tenantId, token, interruptionId: id, appointmentIds: ids, cancelAndTell: !!cancelToo[id] });
    setBusy(false);
    if (!d?.ok) { setErr(d?.error || 'Could not log those.'); return; }
    setResult(`Logged ${d.stamped} appointment${d.stamped === 1 ? '' : 's'} across ${d.days} day${d.days === 1 ? '' : 's'}${d.cancelled ? ` · cancelled ${d.cancelled} and told the clients` : ''}.`);
    setTicked((m) => ({ ...m, [id]: [] })); void load();
  };
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
            {Array.isArray(r.appointments) && r.appointments.length > 0 && (
              <div className="rounded-xl bg-white border-2 border-slate-200 px-3 py-2.5 space-y-1.5">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Your bookings inside the closure · tick the ones you couldn't do</p>
                {r.appointments.map((a: any) => {
                  const on = (ticked[r.id] || []).includes(a.id);
                  const d = new Date(a.startTime);
                  return (
                    <button key={a.id} type="button" disabled={a.lost} aria-pressed={on || a.lost}
                      onClick={() => setTicked((m) => ({ ...m, [r.id]: on ? (m[r.id] || []).filter((x) => x !== a.id) : [...(m[r.id] || []), a.id] }))}
                      className={cn('w-full rounded-xl border-2 px-3 py-2 text-left flex items-center justify-between gap-2', a.lost ? 'border-slate-200 bg-slate-100 opacity-70' : on ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white')}>
                      <span className="min-w-0"><span className="block text-[11px] font-black truncate">{a.clientName} · {a.serviceName}</span><span className={cn('block text-[10px] font-bold', on ? 'text-slate-300' : 'text-slate-500')}>{isNaN(d.getTime()) ? a.startTime : d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{a.status === 'cancelled' ? ' · cancelled' : ''}{a.lost ? ' · logged' : ''}</span></span>
                      <span className="shrink-0 text-[11px] font-black tabular-nums">${Number(a.price).toFixed(0)}</span>
                    </button>
                  );
                })}
                {(ticked[r.id] || []).length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <button type="button" aria-pressed={!!cancelToo[r.id]} onClick={() => setCancelToo((m) => ({ ...m, [r.id]: !m[r.id] }))}
                      className={cn('h-10 w-full rounded-xl border-2 px-3 text-left text-[10px] font-bold', cancelToo[r.id] ? 'border-slate-900 bg-slate-50 text-slate-900' : 'border-slate-200 text-slate-600')}>
                      {cancelToo[r.id] ? 'Will also cancel these and tell each client, as you' : 'Also cancel them and tell the clients?'}
                    </button>
                    <button type="button" disabled={busy} onClick={() => logTicked(r.id)} className="h-11 w-full rounded-2xl bg-slate-900 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40">
                      {busy ? '…' : `Log ${(ticked[r.id] || []).length} as lost · $${r.appointments.filter((a: any) => (ticked[r.id] || []).includes(a.id)).reduce((n: number, a: any) => n + Number(a.price || 0), 0).toFixed(0)}`}
                    </button>
                  </div>
                )}
                {result && <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">{result}</p>}
              </div>
            )}
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
export const TICKET_CATS: [string, string][] = [
  ['equipment', 'Equipment'], ['plumbing', 'Plumbing / water'], ['electrical', 'Electrical / power'], ['cleaning', 'Cleaning'],
  ['safety', 'Safety'], ['request', 'A request'], ['other', 'Something else'],
];
export const TSTATUS: Record<string, string> = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved', cancelled: 'Cancelled' };
export const hrs = (h: number) => (h < 24 ? `${h} hr${h === 1 ? '' : 's'}` : h % 24 === 0 ? `${h / 24} day${h === 24 ? '' : 's'}` : `${Math.round(h / 24)} days`);
export const clock = (iso: string | null, done: boolean) => {
  if (!iso || done) return null;
  const ms = new Date(iso).getTime() - Date.now();
  const h = Math.round(Math.abs(ms) / 3_600_000);
  return ms >= 0 ? `${h < 1 ? 'under an hour' : hrs(h)} left` : `${hrs(Math.max(1, h))} over`;
};
export function RenterMaintenance({ tenantId, token }: { tenantId: string; token: string }) {
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
export const CONCERN_CATEGORIES: [string, string][] = [
  ['space', 'My space'], ['equipment', 'Equipment'], ['cleanliness', 'Cleanliness'], ['noise', 'Noise or disruption'],
  ['another_renter', 'Another renter'], ['staff', 'A staff member'], ['billing', 'Rent or billing'], ['safety', 'Safety'],
  ['access', 'Access or hours'], ['other', 'Something else'],
];
export const CONCERN_STATUS: Record<string, string> = { open: 'Received', acknowledged: 'Being looked at', resolved: 'Resolved', closed: 'Closed' };
export function RenterConcerns({ tenantId, token }: { tenantId: string; token: string }) {
  const [list, setList] = useState<any[] | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ category: 'space', what: '', when: new Date().toISOString().slice(0, 10), wanted: '', confidential: false });
  const [photos, setPhotos] = useState<string[]>([]);
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
    const d = await api({ action: 'concern-file', tenantId, token, ...form, confidential: form.confidential || sensitive, photos });
    setBusy(false);
    if (!d?.ok) { setErr(d?.error || 'Could not send that.'); return; }
    setJustFiled(d.ref); setOpen(false); setPhotos([]);
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
            <div className="flex flex-wrap items-center gap-2">
              {photos.map((p, i) => (
                <button key={i} type="button" onClick={() => setPhotos((ps) => ps.filter((_, j) => j !== i))} aria-label={`Remove photo ${i + 1}`} className="relative h-14 w-14 overflow-hidden rounded-xl border-2 border-slate-200">
                  <img src={p} alt="" className="h-full w-full object-cover" />
                  <span className="absolute inset-x-0 bottom-0 bg-slate-900/80 text-[8px] font-black uppercase tracking-widest text-white">Remove</span>
                </button>
              ))}
              {photos.length < 3 && (
                <label className="h-14 rounded-xl border-2 border-dashed border-slate-300 px-3 inline-flex items-center text-[10px] font-black uppercase tracking-widest text-slate-600 cursor-pointer">
                  {photos.length ? 'Add another' : 'Add a photo'}
                  <input type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Add a photo to this concern"
                    onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; try { const d: string = await downscaleImageToDataUrl(f, { maxDim: 1400 }); setPhotos((ps) => [...ps, d].slice(0, 3)); } catch { setErr('Could not read that photo.'); } }} />
                </label>
              )}
            </div>
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

export function RenterLeave({ tenantId, token }: { tenantId: string; token: string }) {
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
export function RenterThread({ tenantId, token, studioName }: { tenantId: string; token: string; studioName: string }) {
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

// The server has to know which Storage bucket to write to, and the only
// party that reliably does is this browser (its Firebase config is the one
// that has always worked). The Booth Hub used to record it on the tenant;
// the hub is gone, so the portal sends it with every call instead.
// Not the env var — the env var can be unset and the client still works,
// because the client SDK falls back to the project's default bucket on its
// own. Asking the SDK for a reference and reading its .bucket returns the
// name it RESOLVED, which is the only name that is guaranteed to be real.
export function resolvedStorageBucket(): string {
  try {
    const app = getApps()[0] || initializeApp(firebaseConfig);
    return String(storageRef(getStorage(app)).bucket || '');
  } catch { return process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || ''; }
}
/** Why the browser could or couldn't resolve a bucket — shown in the brand panel so nobody has to guess. */
export function storageDiagnostic(): string {
  const b = resolvedStorageBucket();
  if (b) return `Uploads go to ${b}.`;
  const env = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '';
  return env ? `Bucket from settings: ${env}, but the browser could not open it.` : 'No storage bucket is configured for this site (NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET is empty) — no upload anywhere in the app can work until it is set.';
}
// ── Browser-side uploads, the same road every other upload in the app uses ──
// The renter signs into Firebase with a token scoped to their own record,
// then uploadImage() puts the file in Storage under Storage rules and returns
// the download URL. The server never touches the bytes, so it never needs to
// know the bucket. One sign-in per session; every upload after is instant.
// Throws with the REAL reason rather than returning false — "could not
// sign in, try reloading" is the least useful sentence in the app, and it
// hid whichever of four different failures actually happened.
export let storageSignIn: Promise<void> | null = null;
export async function ensureStorageSignIn(tenantId: string, token: string): Promise<void> {
  if (storageSignIn) return storageSignIn;
  storageSignIn = (async () => {
    const app = getApps()[0] || initializeApp(firebaseConfig);
    const auth = getAuth(app);
    if (auth.currentUser && auth.currentUser.uid.startsWith('renter:')) return;
    const d = await api({ action: 'storage-token', tenantId, token });
    if (!d?.ok || !d.token) throw new Error(d?.error || 'The server would not issue an upload token.');
    try {
      await signInWithCustomToken(auth, d.token);
    } catch (e: any) {
      const code = String(e?.code || '');
      if (code.includes('operation-not-allowed') || code.includes('admin-restricted')) {
        throw new Error('Uploads need Anonymous or Custom sign-in enabled: Firebase Console → Authentication → Sign-in method. (' + code + ')');
      }
      if (code.includes('invalid-custom-token') || code.includes('custom-token-mismatch')) {
        throw new Error('The upload token was refused — the server\'s Firebase project does not match this app\'s. (' + code + ')');
      }
      if (code.includes('api-key') || code.includes('configuration-not-found')) {
        throw new Error('Firebase Authentication is not configured for this site. (' + code + ')');
      }
      throw new Error(e?.message || code || 'Sign-in for uploads failed.');
    }
  })();
  try { await storageSignIn; } catch (e) { storageSignIn = null; throw e; }
}
export async function uploadRenterPhoto(tenantId: string, token: string, renterId: string, sub: string, file: File, maxDim: number): Promise<string> {
  if (!renterId) throw new Error('Your renter record is still loading — try again in a moment.');
  await ensureStorageSignIn(tenantId, token);
  const safe = sub.replace(/[^A-Za-z0-9/_-]/g, '');
  try {
    return await uploadImage(`tenants/${tenantId}/renters/${renterId}/${safe}/${Date.now()}.jpg`, file, maxDim);
  } catch (e: any) {
    const code = String(e?.code || '');
    if (code.includes('unauthorized')) throw new Error('Storage refused the upload — publish the renters Storage rule in Firebase Console → Storage → Rules. (' + code + ')');
    if (code.includes('unknown') || code.includes('retry-limit')) throw new Error('The upload could not reach Storage — check the connection and try again. (' + code + ')');
    throw new Error(e?.message || code || 'The upload failed.');
  }
}

// Every portal request has a time limit and always comes back with an
// answer — before, a request that never returned (or a server error) left
// the portal spinning forever with no clue why.
export const api = async (payload: any) => {
  const bucket = resolvedStorageBucket();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch('/api/portal/renter', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, ...(bucket ? { storageBucket: bucket } : {}) }),
      signal: ctrl.signal,
    });
    const d = await res.json().catch(() => ({ error: `The server answered with an error (${res.status}).` }));
    return { status: res.status, ...(res.ok ? {} : { ok: false }), ...d, ...(!res.ok && !d?.error ? { error: `The server answered with an error (${res.status}).` } : {}) };
  } catch (e: any) {
    const timedOut = e?.name === 'AbortError';
    return { ok: false, status: 0, error: timedOut ? 'The server took more than 30 seconds to answer.' : 'Couldn’t reach the server — check your connection.' };
  } finally { clearTimeout(timer); }
};

export const STORE = (tenantId: string) => `opal_renter_${tenantId}`;

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
export const SWAP_SLICE: Array<[string, string]> = [
  ['whole', 'The whole day'],
  ['trailing', 'Leave early — give away the end'],
  ['leading', 'Come in late — give away the start'],
];

export function MySwaps({ data, tenantId, token, onChanged }: { data: any; tenantId: string; token: string; onChanged: () => void }) {
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

// ─── Reservation card ─────────────────────────────────────────────────────────
export const ResCard = ({ r, isToday, onCheckIn, onCheckOut, onRequestReschedule, busy }: {
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

// ─── Login (contact → code) ───────────────────────────────────────────────────
export const LoginFlow = ({ tenantId, onSession }: {
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
