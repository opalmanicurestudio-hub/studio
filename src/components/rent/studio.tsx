'use client';
import { biz, bizs } from '@/components/rent/biz';
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
import { PrintLink } from '@/components/shared/PrintLink';
import { sha256Hex } from '@/lib/sha256';
import { esignConsentText } from '@/lib/esign-consent';
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
// "Needs you": rent due, things to sign or read, booking requests, repairs, answers. Each row opens the exact thing
// (the page maps a row's kind to where it lives). Then today's appointments. Setup steps follow on the page.
const NEEDS_ACTION: Record<string, string> = {
  rent: 'Pay', document: 'Open', rules: 'Sign', notice: 'Read', message: 'Read', request: 'Review', prep: 'Open', ticket: 'See', concern: 'See', leave: 'See',
};
// refreshKey changes when they come back from a screen, so what they just did (read a notice, signed a document) leaves
// the list. onBadges gets the server's dots by place, plus `k:<kind>` counts so a row can say what's waiting in it.
export function TodayQuick({ data, booksHere, onGo, tenantId, token, onBadges, visible, refreshKey = 0 }: { data: any; booksHere: boolean; onGo: (t: 'today' | 'book' | 'rent' | 'studio', kind?: string) => void; tenantId: string; token: string; onBadges: (b: Record<string, number>) => void; visible: boolean; refreshKey?: number }) {
  const [inbox, setInbox] = useState<{ items: any[]; todayAppts: any[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    api({ action: 'today', tenantId, token }).then((d) => {
      if (!alive) return;
      if (!d?.ok) { setFailed(true); return; }
      setFailed(false);
      const items = d.items || [];
      setInbox({ items, todayAppts: d.todayAppts || [] });
      const byKind: Record<string, number> = {};
      for (const it of items) if (it?.kind && it.tone !== 'green') byKind[`k:${it.kind}`] = (byKind[`k:${it.kind}`] || 0) + 1;
      onBadges({ ...(d.badges || {}), ...byKind });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, token, data?.invoices?.length, refreshKey, retry]);
  const due = (data?.invoices || []).filter((i: any) => i.status === 'due' || i.status === 'late');
  const dueCents = due.reduce((n: number, i: any) => n + Math.max(0, (Number(i.amountCents) || 0) + (Number(i.lateFeeCents) || 0) - (Number(i.paidCents) || 0)), 0);
  const late = due.some((i: any) => i.status === 'late');
  const firstDue = due.map((i: any) => String(i.dueDate || '')).sort()[0] || '';
  const nextAppt = (data?.myBookings || []).filter((b: any) => b.status !== 'cancelled').sort((a: any, b: any) => String(a.startTime).localeCompare(String(b.startTime)))[0] || null;
  const when = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }); };
  const clock = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/, ''); };
  const length = (a: any) => { const m = Math.round((Date.parse(a.endTime) - Date.parse(a.startTime)) / 60000); return m > 0 ? (m >= 60 ? `${Math.floor(m / 60)} hr${m >= 120 ? 's' : ''}${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`) : ''; };
  const ago = (iso: string) => { const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000); return h < 1 ? 'Just now' : h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`; };
  const needs = [
    ...(due.length ? [{ kind: 'rent', tab: 'rent' as const, title: late ? 'Rent is late' : 'Rent is due', body: `$${(dueCents / 100).toFixed(2)}${firstDue ? `, due ${new Date(`${firstDue}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}`, tone: late ? 'amber' : 'slate', at: '' }] : []),
    ...(inbox?.items || []),
  ];
  const quiet = inbox && needs.length === 0;
  const card = 'overflow-hidden rounded-2xl border border-[#ececee] bg-white';
  return (
    <div className={visible ? 'space-y-6' : 'hidden'}>
      <section aria-labelledby="needs-you" className="space-y-2">
        <h2 id="needs-you" className="px-1 text-[14px] font-semibold text-[#6d7075]">{quiet ? 'Nothing needs you' : `Needs you${needs.length ? ` · ${needs.length}` : ''}`}</h2>
        {inbox === null && failed && needs.length === 0 ? (
          <div className={cn(card, 'flex items-center justify-between gap-3 px-4 py-3')}>
            <p className="text-[14px] text-[#b45309]">Couldn’t check what needs you.</p>
            <button type="button" onClick={() => setRetry((n) => n + 1)} className="h-11 shrink-0 rounded-full border border-[#ececee] px-4 text-[14px] font-medium text-[#16171a]">Try again</button>
          </div>
        ) : inbox === null && needs.length === 0 ? <div className={cn(card, 'px-4 py-4 text-[14px] text-[#6d7075]')}>Checking…</div>
          : quiet ? (
            <div className={cn(card, 'px-4 py-4')}>
              <p className="text-[14px] text-[#16171a]">Rent is settled and nothing is waiting.</p>
              {booksHere && data?.provider?.bookingUrl && <p className="mt-0.5 text-[13px] text-[#6d7075]">Share your booking link to fill your calendar.</p>}
            </div>
          ) : (
            <ul className={cn(card, 'divide-y divide-[#ececee]')}>
              {needs.map((it: any, i: number) => {
                const label = NEEDS_ACTION[it.kind] || 'Open';
                const primary = it.kind === 'rent';
                return (
                  <li key={`${it.kind}-${i}`}>
                    <button type="button" onClick={() => onGo(it.tab, it.kind)} className="flex min-h-[44px] w-full items-center gap-3 px-4 py-3 text-left hover:bg-[#fafafa]">
                      <span className="min-w-0 flex-1">
                        <span className={cn('block text-[15px] font-medium', it.tone === 'amber' || it.tone === 'red' ? 'text-[#b45309]' : 'text-[#16171a]')}>{it.title}</span>
                        {(it.body || it.at) && <span className="block truncate text-[13px] text-[#6d7075]">{it.body}{it.body && it.at ? ' · ' : ''}{it.at ? ago(it.at) : ''}</span>}
                      </span>
                      <span className={cn('inline-flex h-11 shrink-0 items-center rounded-full px-4 text-[14px] font-medium', primary ? 'bg-[#16171a] text-white' : 'border border-[#ececee] text-[#16171a]')}>{label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        {failed && !(inbox === null && needs.length === 0) && (
          <div className="flex items-center justify-between gap-3 px-1">
            <p className="text-[13px] text-[#b45309]">Couldn’t check everything just now.</p>
            <button type="button" onClick={() => setRetry((n) => n + 1)} className="h-11 shrink-0 rounded-full border border-[#ececee] bg-white px-4 text-[14px] font-medium text-[#16171a]">Try again</button>
          </div>
        )}
      </section>

      {booksHere && inbox && (inbox.todayAppts.length > 0 || nextAppt) && (
        <section aria-labelledby="today-appts" className="space-y-2">
          <h2 id="today-appts" className="px-1 text-[14px] font-semibold text-[#6d7075]">
            {inbox.todayAppts.length ? `Today · ${inbox.todayAppts.length} appointment${inbox.todayAppts.length === 1 ? '' : 's'}` : 'Nothing booked today'}
          </h2>
          <ul className={cn(card, 'divide-y divide-[#ececee]')}>
            {inbox.todayAppts.length ? inbox.todayAppts.map((a: any) => (
              <li key={a.id}>
                <button type="button" onClick={() => onGo('book', 'appointment')} className="flex min-h-[44px] w-full gap-4 px-4 py-3 text-left hover:bg-[#fafafa]">
                  <span className="w-12 shrink-0 text-[15px] font-semibold tabular-nums text-[#16171a]">{clock(a.startTime)}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-medium text-[#16171a]">{a.serviceName || 'Appointment'}</span>
                    <span className="block truncate text-[13px] text-[#6d7075]">{a.clientName || 'Client'}{length(a) ? ` · ${length(a)}` : ''}</span>
                  </span>
                </button>
              </li>
            )) : nextAppt && (
              <li>
                <button type="button" onClick={() => onGo('book', 'appointment')} className="flex min-h-[44px] w-full flex-col px-4 py-3 text-left hover:bg-[#fafafa]">
                  <span className="text-[15px] font-medium text-[#16171a]">Next: {when(nextAppt.startTime)}</span>
                  <span className="truncate text-[13px] text-[#6d7075]">{nextAppt.clientName || 'Client'}{nextAppt.serviceName ? ` · ${nextAppt.serviceName}` : ''}</span>
                </button>
              </li>
            )}
          </ul>
        </section>
      )}
    </div>
  );
}

// ─── Documents ───────────────────────────────────────────────────────────────
// The paperwork after the lease, read and signed here. Signing is typing your
// full name — the same way the lease was signed — and the record lands beside
// it, with the exact text, the time, and the device. Declining is allowed and
// is a message to the studio, not a silent no.
export const DOC_STATUS: Record<string, string> = { sent: 'Waiting for you', signed: 'Signed', declined: 'Declined', withdrawn: 'Withdrawn' };
export function RenterDocuments({ tenantId, token }: { tenantId: string; token: string }) {
  const [state, setState] = useState<{ documents: any[]; signed: any[] } | null>(null);
  const [openId, setOpenId] = useState('');
  const [name, setName] = useState('');
  const [declining, setDeclining] = useState('');
  const [declineNote, setDeclineNote] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');
  const load = useCallback(async () => {
    const d = await api({ action: 'documents-list', tenantId, token });
    if (d?.ok) setState({ documents: d.documents || [], signed: d.signed || [] });
  }, [tenantId, token]);
  useEffect(() => { void load(); }, [load]);
  if (!state) return null;
  const pending = state.documents.filter((d) => d.status === 'sent');
  const past = state.documents.filter((d) => d.status !== 'sent').slice(0, 6);
  if (pending.length === 0 && past.length === 0 && state.signed.length === 0) return null;
  // Opening a document is noted once, for its signature certificate.
  const open = (id: string) => { setOpenId(id); setErr(''); setConsent(false); setDone(''); void api({ action: 'document-viewed', tenantId, token, documentId: id }); };
  // What's signed is the exact text on screen: its fingerprint goes with the signature and is checked.
  const sign = async (doc: any) => {
    setBusy(true); setErr('');
    const d = await api({ action: 'document-sign', tenantId, token, documentId: doc.id, signedName: name, consent, shownSha: sha256Hex(String(doc.body || '')), consentSha: sha256Hex(esignConsentText(biz())) });
    setBusy(false);
    if (!d?.ok) { setErr(d?.error || 'Could not sign.'); return; }
    setDone(doc.action === 'acknowledge' ? `“${doc.title}” acknowledged.` : `“${doc.title}” signed.${d.emailed ? ' A signed copy is on its way to your email.' : ' You can print a signed copy below.'}`);
    setOpenId(''); setName(''); setConsent(false); void load();
  };
  const decline = async (id: string) => {
    setBusy(true); setErr('');
    const d = await api({ action: 'document-decline', tenantId, token, documentId: id, note: declineNote });
    setBusy(false);
    if (!d?.ok) { setErr(d?.error || 'Could not send that.'); return; }
    setDeclining(''); setDeclineNote(''); setOpenId(''); void load();
  };
  return (
    <section className="space-y-3">
      <SectionTitle icon={FileSignature}>Documents</SectionTitle>
      <div className="p-4 rounded-2xl bg-white border border-[#ececee] space-y-3">
        {done && <p role="status" className="text-[13px] font-medium text-[#1f7a4d]">{done}</p>}
        {pending.map((d) => {
          const isOpen = openId === d.id;
          const verb = d.action === 'acknowledge' ? 'acknowledge' : 'sign';
          return (
            <div key={d.id} className="rounded-2xl border border-[#f3d9bd] bg-[#fdf6ee] px-3.5 py-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[15px] font-semibold">{d.title}</p>
                <span className="shrink-0 rounded-full bg-[#f3d9bd] px-2.5 py-1 text-[12px] font-semibold text-[#b45309]">To {verb}</span>
              </div>
              <p className="text-[13px] font-medium text-[#b45309]">Sent {fmtDate(String(d.sentAt).slice(0, 10))} by {d.sentBy}</p>
              {!isOpen ? (
                <button type="button" onClick={() => open(d.id)} className="h-11 w-full rounded-2xl bg-[#16171a] text-[13px] font-semibold text-white">Read it</button>
              ) : (
                <div className="space-y-2">
                  <div className="max-h-80 overflow-y-auto overscroll-contain rounded-2xl bg-white border border-[#ececee] px-3.5 py-3 text-[15px] leading-relaxed font-medium text-[#16171a] whitespace-pre-wrap">{d.body}</div>
                  {declining === d.id ? (
                    <div className="space-y-2">
                      <textarea value={declineNote} onChange={(e) => setDeclineNote(e.target.value.slice(0, 600))} rows={2} aria-label="Why you are declining" placeholder={`Tell ${biz()} why (optional). This goes to them as a message.`} className="w-full rounded-2xl border border-[#ececee] px-3.5 py-2.5 text-sm bg-white" />
                      <div className="flex gap-2">
                        <button type="button" onClick={() => decline(d.id)} disabled={busy} className="h-11 flex-1 rounded-2xl border border-[#f1c7c2] bg-white text-[13px] font-semibold text-[#b42318] disabled:opacity-40">{busy ? '…' : 'Decline this document'}</button>
                        <button type="button" onClick={() => setDeclining('')} className="h-11 rounded-2xl border border-[#ececee] bg-white px-3 text-[13px] font-semibold text-[#6d7075]">Back</button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <input value={name} onChange={(e) => setName(e.target.value.slice(0, 120))} aria-label="Type your full name to sign" placeholder="Type your full name to sign" autoComplete="name" className="h-11 w-full rounded-2xl border border-[#ececee] bg-white px-3 text-sm font-medium" />
                      {verb === 'sign' && (
                        <label className="flex min-h-[44px] items-start gap-3 rounded-2xl border border-[#ececee] bg-white px-3.5 py-3 text-[13px] font-medium leading-relaxed text-[#16171a]">
                          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[#16171a]" />
                          <span>{esignConsentText(biz())}</span>
                        </label>
                      )}
                      <p className="text-[12px] font-medium text-[#6d7075]">Typing your name and tapping {verb} is your signature. The exact text above, the time and this device are recorded with it{verb === 'sign' ? `, and you and ${biz()} each get a signed copy by email` : ''}.</p>
                      {err && <p className="text-[13px] font-medium text-[#b45309]">{err}</p>}
                      <div className="flex gap-2">
                        <button type="button" onClick={() => sign(d)} disabled={busy || name.trim().length < 2 || (verb === 'sign' && !consent)} className="h-11 flex-1 rounded-2xl bg-[#16171a] text-[13px] font-semibold text-white disabled:opacity-40">{busy ? '…' : verb === 'sign' ? 'Sign' : 'Acknowledge'}</button>
                        <button type="button" onClick={() => setDeclining(d.id)} className="h-11 rounded-2xl border border-[#ececee] bg-white px-3 text-[13px] font-semibold text-[#6d7075]">Decline</button>
                        <PrintLink path="/api/booths/renter-document" params={{ tenantId, id: d.id }} token={token} className="h-11 inline-flex items-center rounded-2xl border border-[#ececee] bg-white px-3 text-[13px] font-semibold text-[#6d7075]">Print</PrintLink>
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
            <p className="text-[12px] font-semibold text-[#6d7075]">On file</p>
            {past.map((d) => (
              <p key={d.id} className="text-[13px] font-medium text-[#6d7075] flex items-center justify-between gap-2">
                <span className="truncate">{d.title} · {DOC_STATUS[d.status] || d.status}{d.signedAt ? ` ${fmtDate(String(d.signedAt).slice(0, 10))}` : ''}</span>
                {d.status === 'signed' && <PrintLink path="/api/booths/renter-document" params={{ tenantId, id: d.id }} token={token} className="shrink-0 text-[12px] font-semibold underline">Print</PrintLink>}
              </p>
            ))}
            {state.signed.filter((sd) => !past.some((d) => d.signedDocumentId === sd.id)).map((sd) => (
              <p key={sd.id} className="text-[13px] font-medium text-[#6d7075]">{sd.title} · Signed {fmtDate(String(sd.signedAt).slice(0, 10))}</p>
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
  const [state, setState] = useState<{ interruptions: any[] } | null>(null);
  const [logFor, setLogFor] = useState('');
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), appointmentsLost: '', lost: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ticked, setTicked] = useState<Record<string, string[]>>({});
  const [cancelToo, setCancelToo] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState('');
  const load = useCallback(async () => {
    const d = await api({ action: 'interruption-list', tenantId, token });
    if (d?.ok) setState({ interruptions: d.interruptions || [] });
  }, [tenantId, token]);
  const logTicked = async (id: string) => {
    const ids = ticked[id] || [];
    if (ids.length === 0) return;
    setBusy(true); setErr(''); setResult('');
    const d = await api({ action: 'interruption-loss', tenantId, token, interruptionId: id, appointmentIds: ids, cancelAndTell: !!cancelToo[id] });
    setBusy(false);
    if (!d?.ok) { setErr(d?.error || 'Could not log those.'); return; }
    setResult(`Logged ${d.stamped} appointment${d.stamped === 1 ? '' : 's'} across ${d.days} day${d.days === 1 ? '' : 's'}${d.cancelled ? ` · canceled ${d.cancelled} and told the clients` : ''}.`);
    setTicked((m) => ({ ...m, [id]: [] })); void load();
  };
  useEffect(() => { void load(); }, [load]);
  if (!state) return null;
  if (state.interruptions.length === 0) return <p className="rounded-2xl border border-[#ececee] bg-white px-4 py-4 text-[14px] leading-relaxed text-[#6d7075]">No closures so far. If the space can’t be used for a while, it shows here, with what you lost and what you were credited.</p>;
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
        <div key={r.id} className="p-4 rounded-2xl bg-white border border-[#ececee] space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[15px] font-semibold truncate">{r.title}</p>
              <p className="text-[13px] font-medium text-[#6d7075]">{ITYPE[r.type] || 'Closure'} · {fmtDate(r.startDate)}{r.endDate ? ` – ${fmtDate(r.endDate)}` : ' – ongoing'}</p>
            </div>
            <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold', r.status === 'open' ? 'bg-[#fdf6ee] text-[#b45309]' : 'bg-[#f5f5f7] text-[#16171a]')}>{r.status === 'open' ? 'Ongoing' : 'Over'}</span>
          </div>
          {r.updates.length > 0 && (
            <div className="space-y-1">
              {r.updates.slice(-3).map((u: any, i: number) => <p key={i} className="text-[13px] font-medium text-[#6d7075]"><span className="font-semibold">{fmtDate(String(u.at).slice(0, 10))}</span> · {u.text}</p>)}
            </div>
          )}
          <div className="rounded-2xl bg-[#f5f5f7] border border-[#ececee] px-3.5 py-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[12px] font-semibold text-[#6d7075]">Your loss log</p>
              <p className="text-[14px] font-semibold tabular-nums">{r.totals.appointmentsLost} appt{r.totals.appointmentsLost === 1 ? '' : 's'} · ${(r.totals.lostCents / 100).toFixed(2)} · {r.totals.days} day{r.totals.days === 1 ? '' : 's'}</p>
            </div>
            {Array.isArray(r.appointments) && r.appointments.length > 0 && (
              <div className="rounded-xl bg-white border border-[#ececee] px-3 py-2.5 space-y-1.5">
                <p className="text-[12px] font-semibold text-[#6d7075]">Your bookings inside the closure · tick the ones you couldn't do</p>
                {r.appointments.map((a: any) => {
                  const on = (ticked[r.id] || []).includes(a.id);
                  const d = new Date(a.startTime);
                  return (
                    <button key={a.id} type="button" disabled={a.lost} aria-pressed={on || a.lost}
                      onClick={() => setTicked((m) => ({ ...m, [r.id]: on ? (m[r.id] || []).filter((x) => x !== a.id) : [...(m[r.id] || []), a.id] }))}
                      className={cn('w-full rounded-xl border px-3 py-2 text-left flex items-center justify-between gap-2', a.lost ? 'border-[#ececee] bg-[#f5f5f7] opacity-70' : on ? 'border-[#16171a] bg-[#16171a] text-white' : 'border-[#ececee] bg-white')}>
                      <span className="min-w-0"><span className="block text-[14px] font-semibold truncate">{a.clientName} · {a.serviceName}</span><span className={cn('block text-[13px] font-medium', on ? 'text-white/70' : 'text-[#6d7075]')}>{isNaN(d.getTime()) ? a.startTime : d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{a.status === 'cancelled' ? ' · canceled' : ''}{a.lost ? ' · logged' : ''}</span></span>
                      <span className="shrink-0 text-[14px] font-semibold tabular-nums">${Number(a.price).toFixed(0)}</span>
                    </button>
                  );
                })}
                {(ticked[r.id] || []).length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <button type="button" aria-pressed={!!cancelToo[r.id]} onClick={() => setCancelToo((m) => ({ ...m, [r.id]: !m[r.id] }))}
                      className={cn('h-11 w-full rounded-xl border px-3 text-left text-[13px] font-medium', cancelToo[r.id] ? 'border-[#16171a] bg-[#f5f5f7] text-[#16171a]' : 'border-[#ececee] text-[#6d7075]')}>
                      {cancelToo[r.id] ? 'Will also cancel these and tell each client, as you' : 'Also cancel them and tell the clients?'}
                    </button>
                    <button type="button" disabled={busy} onClick={() => logTicked(r.id)} className="h-11 w-full rounded-2xl bg-[#16171a] text-[13px] font-semibold text-white disabled:opacity-40">
                      {busy ? '…' : `Log ${(ticked[r.id] || []).length} as lost · $${r.appointments.filter((a: any) => (ticked[r.id] || []).includes(a.id)).reduce((n: number, a: any) => n + Number(a.price || 0), 0).toFixed(0)}`}
                    </button>
                  </div>
                )}
                {result && <p className="text-[13px] font-semibold text-[#1f7a4d]">{result}</p>}
              </div>
            )}
            {r.losses.length === 0 && <p className="text-[13px] font-medium text-[#6d7075]">Nothing logged yet. A rent credit covers the chair — this is for the clients you couldn't see, the number your own insurer or accountant will ask for. Log it while it's fresh.</p>}
            {r.losses.map((l: any) => (
              <p key={l.id} className="text-[13px] font-medium text-[#16171a]"><span className="font-semibold">{fmtDate(l.date)}</span> · {l.appointmentsLost} appt{l.appointmentsLost === 1 ? '' : 's'} · ${(l.lostCents / 100).toFixed(2)}{l.note ? ` — ${l.note}` : ''}</p>
            ))}
            {logFor === r.id ? (
              <div className="space-y-2">
                <input type="date" value={form.date} min={r.startDate} max={r.endDate || undefined} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} aria-label="Which day" className="h-11 w-full rounded-2xl border border-[#ececee] px-3 text-sm font-medium bg-white" />
                <div className="grid grid-cols-2 gap-2">
                  <input inputMode="numeric" value={form.appointmentsLost} onChange={(e) => setForm((f) => ({ ...f, appointmentsLost: e.target.value.replace(/[^0-9]/g, '') }))} aria-label="Appointments you couldn't do" placeholder="Appts lost" className="h-11 rounded-2xl border border-[#ececee] px-3 text-sm font-medium bg-white" />
                  <input inputMode="decimal" value={form.lost} onChange={(e) => setForm((f) => ({ ...f, lost: e.target.value.replace(/[^0-9.]/g, '') }))} aria-label="Income lost, dollars" placeholder="$ lost (your estimate)" className="h-11 rounded-2xl border border-[#ececee] px-3 text-sm font-medium bg-white" />
                </div>
                <input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value.slice(0, 500) }))} aria-label="Note" placeholder="Who you rescheduled, what you refunded (optional)" className="h-11 w-full rounded-2xl border border-[#ececee] px-3 text-sm bg-white" />
                {err && <p className="text-[13px] font-medium text-[#b45309]">{err}</p>}
                <div className="flex gap-2">
                  <button type="button" onClick={() => submit(r.id)} disabled={busy || !form.date} className="h-11 flex-1 rounded-2xl bg-[#16171a] text-[13px] font-semibold text-white disabled:opacity-40">{busy ? 'Saving…' : 'Save this day'}</button>
                  <button type="button" onClick={() => setLogFor('')} className="h-11 rounded-2xl border border-[#ececee] px-4 text-[13px] font-semibold text-[#6d7075]">Cancel</button>
                </div>
                <p className="text-[12px] font-medium text-[#6d7075]">One entry per day. Saving a day again replaces it.</p>
              </div>
            ) : (
              <div className="flex gap-2">
                <button type="button" onClick={() => { setLogFor(r.id); setErr(''); }} className="h-11 flex-1 rounded-2xl border border-[#ececee] text-[13px] font-semibold text-[#16171a]">Log a day</button>
                {r.losses.length > 0 && (
                  <PrintLink path="/api/booths/interruption-packet" params={{ tenantId, id: r.id }} token={token}
                    className="h-11 inline-flex items-center rounded-2xl border border-[#ececee] px-3 text-[13px] font-semibold text-[#16171a]">Print my statement</PrintLink>
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
export const TSTATUS: Record<string, string> = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved', cancelled: 'Canceled' };
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
      <div className="p-4 rounded-2xl bg-white border border-[#ececee] space-y-3">
        {promise.length > 0 && (
          <div className="rounded-2xl bg-[#f5f5f7] border border-[#ececee] px-3.5 py-3">
            <p className="text-[12px] font-semibold text-[#6d7075] mb-1.5">{bizs(true)} promise</p>
            <div className="space-y-1">
              {promise.map((c) => (
                <p key={c.priority} className="text-[14px] font-medium text-[#16171a]"><span className="capitalize font-semibold">{c.label}</span> · answered within {hrs(c.respondHours)}, fixed within {hrs(c.fixHours)}</p>
              ))}
              {urgent && <p className="text-[13px] font-medium text-[#6d7075]">Safety or no-water issues {biz()} judges urgent: answered within {hrs(urgent.respondHours)}, fixed within {hrs(urgent.fixHours)}.</p>}
            </div>
          </div>
        )}

        {openT.map((t) => {
          const done = t.status === 'resolved' || t.status === 'cancelled';
          const ans = clock(t.respondBy, t.acknowledged || done);
          const fix = clock(t.dueAt, done);
          const isOpen = expanded === t.id;
          return (
            <div key={t.id} className="rounded-2xl border border-[#ececee] px-3.5 py-3 space-y-1.5">
              <button type="button" onClick={() => setExpanded(isOpen ? '' : t.id)} aria-expanded={isOpen} className="w-full text-left">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[15px] font-semibold truncate">{t.title}</p>
                  <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold', t.status === 'in_progress' ? 'bg-[#fdf6ee] text-[#b45309]' : 'bg-[#f5f5f7] text-[#16171a]')}>{TSTATUS[t.status] || t.status}</span>
                </div>
                <p className="text-[13px] font-medium text-[#6d7075]">
                  {String(t.priority || '').charAt(0).toUpperCase() + String(t.priority || '').slice(1)} · reported {fmtDate(String(t.createdAt).slice(0, 10))}
                  {t.assigneeName ? ` · ${t.assigneeName} has it` : t.acknowledged ? ` · seen by ${biz()}` : ans ? ` · answer due: ${ans}` : ''}
                  {fix ? ` · fix due: ${fix}` : ''}
                </p>
              </button>
              {isOpen && (
                <div className="space-y-1.5 pt-1">
                  {t.description && <p className="text-[14px] font-medium text-[#16171a] whitespace-pre-wrap">{t.description}</p>}
                  {(t.updates || []).slice(1).map((u: any, i: number) => (
                    <p key={i} className="text-[13px] font-medium text-[#6d7075]"><span className="font-semibold">{fmtDate(String(u.at).slice(0, 10))} · {u.by}</span>{u.note ? ` — ${u.note}` : ''}{u.status ? ` (${TSTATUS[u.status] || u.status})` : ''}{u.photoUrl ? ' · photo' : ''}</p>
                  ))}
                  {noteFor === t.id ? (
                    <div className="space-y-1.5">
                      <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 1000))} rows={2} aria-label="Add to this ticket" placeholder="Still happening? Something changed?" className="w-full rounded-2xl border border-[#ececee] px-3.5 py-2.5 text-sm" />
                      <div className="flex gap-2">
                        <button type="button" disabled={busy || !note.trim()} onClick={() => addNote(t.id)} className="h-11 flex-1 rounded-2xl bg-[#16171a] text-[13px] font-semibold text-white disabled:opacity-40">Add note</button>
                        <label className="h-11 rounded-2xl border border-[#ececee] px-3 inline-flex items-center text-[13px] font-semibold text-[#16171a] cursor-pointer">
                          Photo<input type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Add a photo to this ticket" onChange={(e) => readPhoto(e.target.files?.[0], (d) => addNote(t.id, d))} />
                        </label>
                        <button type="button" onClick={() => { setNoteFor(''); setNote(''); }} className="h-11 rounded-2xl border border-[#ececee] px-3 text-[13px] font-semibold text-[#6d7075]">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setNoteFor(t.id)} className="h-11 w-full rounded-2xl border border-[#ececee] text-[13px] font-semibold text-[#16171a]">Add a note or photo</button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {!open ? (
          <button type="button" onClick={() => setOpen(true)} className="h-11 w-full rounded-2xl bg-[#16171a] text-[13px] font-semibold text-white">Report a problem</button>
        ) : (
          <div className="space-y-2">
            <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value.slice(0, 120) }))} aria-label="What's wrong, in a few words" placeholder="Dryer at my station won't turn on" className="h-11 w-full rounded-2xl border border-[#ececee] px-3 text-sm font-medium" />
            <div className="grid grid-cols-2 gap-2">
              <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} aria-label="Category" className="h-11 rounded-2xl border border-[#ececee] px-3 text-sm font-medium bg-white">
                {TICKET_CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))} aria-label="How urgent" className="h-11 rounded-2xl border border-[#ececee] px-3 text-sm font-medium bg-white">
                <option value="high">High · can't work</option>
                <option value="normal">Normal · a nuisance</option>
                <option value="low">Low · whenever</option>
              </select>
            </div>
            <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value.slice(0, 2000) }))} rows={3} aria-label="Details" placeholder="What's happening, since when, what you've tried." className="w-full rounded-2xl border border-[#ececee] px-3.5 py-2.5 text-sm" />
            <label className="h-11 w-full rounded-2xl border border-[#ececee] inline-flex items-center justify-center text-[13px] font-semibold text-[#16171a] cursor-pointer">
              {form.photoData ? 'Photo attached · tap to change' : 'Add a photo'}
              <input type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Photo of the problem" onChange={(e) => readPhoto(e.target.files?.[0], (d) => setForm((f) => ({ ...f, photoData: d })))} />
            </label>
            {err && <p className="text-[13px] font-medium text-[#b45309]">{err}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={submit} disabled={busy || !form.title.trim()} className="h-11 flex-1 rounded-2xl bg-[#16171a] text-[13px] font-semibold text-white disabled:opacity-40">{busy ? 'Sending…' : 'Send it'}</button>
              <button type="button" onClick={() => setOpen(false)} className="h-11 rounded-2xl border border-[#ececee] px-4 text-[13px] font-semibold text-[#6d7075]">Cancel</button>
            </div>
          </div>
        )}
        {err && !open && <p className="text-[13px] font-medium text-[#b45309]">{err}</p>}
        {doneT.length > 0 && (
          <div className="space-y-1">
            {doneT.map((t) => <p key={t.id} className="text-[13px] font-medium text-[#6d7075]">{t.title} · {TSTATUS[t.status] || t.status}{t.resolvedAt ? ` ${fmtDate(String(t.resolvedAt).slice(0, 10))}` : ''}</p>)}
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
      <div className="p-4 rounded-2xl bg-white border border-[#ececee] space-y-3">
        {justFiled && (
          <div className="rounded-2xl border border-[#cfe5d8] bg-[#eef6f1] px-3.5 py-3">
            <p className="text-[14px] font-semibold text-[#1f7a4d]">On file · {justFiled}</p>
            <p className="text-[14px] font-medium text-[#1f7a4d]">Keep that reference. A receipt is on its way to your email, and you'll see replies below.</p>
          </div>
        )}
        {openOnes.map((c) => (
          <div key={c.id} className="rounded-2xl border border-[#ececee] bg-[#f5f5f7] px-3.5 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[14px] font-semibold text-[#16171a]">{c.ref} · {(CONCERN_CATEGORIES.find(([k]) => k === c.category) || [])[1] || c.category}</p>
              <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold', c.status === 'acknowledged' ? 'bg-[#fdf6ee] text-[#b45309]' : 'bg-[#f5f5f7] text-[#16171a]')}>{CONCERN_STATUS[c.status] || c.status}</span>
            </div>
            <p className="text-[14px] font-medium text-[#16171a] mt-1 line-clamp-2">{c.what}</p>
            <p className="text-[13px] font-medium text-[#6d7075] mt-1">Filed {fmtDate(String(c.filedAt).slice(0, 10))}{c.responses ? ` · ${c.responses} repl${c.responses === 1 ? 'y' : 'ies'} in your messages` : ''}</p>
          </div>
        ))}
        {!open ? (
          <button type="button" onClick={() => { setOpen(true); setJustFiled(''); }}
            className="h-11 w-full rounded-2xl border border-[#ececee] text-[13px] font-semibold text-[#16171a]">
            Raise a concern
          </button>
        ) : (
          <div className="space-y-2">
            <p className="text-[13px] font-medium text-[#6d7075]">For anything that should be on record. Quick questions belong in messages below.</p>
            <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} aria-label="What is it about"
              className="h-11 w-full rounded-2xl border border-[#ececee] px-3 text-sm font-medium bg-white">
              {CONCERN_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input type="date" value={form.when} onChange={(e) => setForm((f) => ({ ...f, when: e.target.value }))} aria-label="When did it happen or start" className="h-11 w-full rounded-2xl border border-[#ececee] px-3 text-sm font-medium" />
            <textarea value={form.what} onChange={(e) => setForm((f) => ({ ...f, what: e.target.value.slice(0, 2000) }))} rows={4} aria-label="What happened"
              placeholder="What happened, in your words. Dates, names, what you've already tried." className="w-full rounded-2xl border border-[#ececee] px-3.5 py-2.5 text-sm" />
            <textarea value={form.wanted} onChange={(e) => setForm((f) => ({ ...f, wanted: e.target.value.slice(0, 800) }))} rows={2} aria-label="What you would like to see happen"
              placeholder="What would put this right? (optional)" className="w-full rounded-2xl border border-[#ececee] px-3.5 py-2.5 text-sm" />
            <div className="flex flex-wrap items-center gap-2">
              {photos.map((p, i) => (
                <button key={i} type="button" onClick={() => setPhotos((ps) => ps.filter((_, j) => j !== i))} aria-label={`Remove photo ${i + 1}`} className="relative h-14 w-14 overflow-hidden rounded-xl border border-[#ececee]">
                  <img src={p} alt="" className="h-full w-full object-cover" />
                  <span className="absolute inset-x-0 bottom-0 bg-[#16171a]/80 text-[12px] font-semibold text-white">Remove</span>
                </button>
              ))}
              {photos.length < 3 && (
                <label className="h-14 rounded-xl border border-dashed border-[#ececee] px-3 inline-flex items-center text-[13px] font-semibold text-[#6d7075] cursor-pointer">
                  {photos.length ? 'Add another' : 'Add a photo'}
                  <input type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Add a photo to this concern"
                    onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; try { const d: string = await downscaleImageToDataUrl(f, { maxDim: 1400 }); setPhotos((ps) => [...ps, d].slice(0, 3)); } catch { setErr('Could not read that photo.'); } }} />
                </label>
              )}
            </div>
            <button type="button" aria-pressed={form.confidential || sensitive} onClick={() => setForm((f) => ({ ...f, confidential: !f.confidential }))} disabled={sensitive}
              className={cn('h-11 w-full rounded-2xl border px-3 text-left text-[13px] font-medium', (form.confidential || sensitive) ? 'border-[#16171a] bg-[#f5f5f7] text-[#16171a]' : 'border-[#ececee] text-[#6d7075]')}>
              {sensitive ? 'Treated as confidential — concerns about people always are' : form.confidential ? `Confidential — for ${bizs()} owner only` : 'Mark confidential'}
            </button>
            {err && <p className="text-[13px] font-medium text-[#b45309]">{err}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={submit} disabled={busy || form.what.trim().length < 10}
                className="h-11 flex-1 rounded-2xl bg-[#16171a] text-[13px] font-semibold text-white disabled:opacity-40">{busy ? 'Sending…' : 'Put it on record'}</button>
              <button type="button" onClick={() => setOpen(false)} className="h-11 rounded-2xl border border-[#ececee] px-4 text-[13px] font-semibold text-[#6d7075]">Cancel</button>
            </div>
          </div>
        )}
        {doneOnes.length > 0 && (
          <div className="space-y-1">
            {doneOnes.map((c) => (
              <p key={c.id} className="text-[13px] font-medium text-[#6d7075]">{c.ref} · {CONCERN_STATUS[c.status] || c.status}{c.resolvedAt ? ` ${fmtDate(String(c.resolvedAt).slice(0, 10))}` : ''}{c.resolution ? ` — ${c.resolution}` : ''}</p>
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
  if (!state) return null;
  if (state.policy.offered.length === 0) return <p className="rounded-2xl border border-[#ececee] bg-white px-4 py-4 text-[14px] leading-relaxed text-[#6d7075]">{biz(true)} doesn’t offer time away through the portal yet. Send them a message to ask.</p>;
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
      <div className="p-4 rounded-2xl bg-white border border-[#ececee] space-y-3">
        {active && (
          <div className="rounded-2xl border border-[#cfe5d8] bg-[#eef6f1] px-3.5 py-3">
            <p className="text-[14px] font-semibold text-[#1f7a4d]">On leave · {fmtDate(active.startDate)} – {fmtDate(active.endDate)}</p>
            <p className="text-[14px] font-medium text-[#1f7a4d]">{TL[active.treatment] || active.treatment}{active.treatment === 'bank' && active.bankedDays ? ` · ${active.bankedDays} day${active.bankedDays === 1 ? '' : 's'} banked so far` : ''}{active.treatment === 'pause' && active.pausedDays ? ` · lease extends ${active.pausedDays} day${active.pausedDays === 1 ? '' : 's'}` : ''}</p>
          </div>
        )}
        {pending && (
          <div className="rounded-2xl border border-[#f3d9bd] bg-[#fdf6ee] px-3.5 py-3">
            <p className="text-[14px] font-semibold text-[#b45309]">Requested · {fmtDate(pending.startDate)} – {fmtDate(pending.endDate)}</p>
            <p className="text-[14px] font-medium text-[#b45309]">Waiting on {biz()}. Rent continues as normal until it is approved.</p>
          </div>
        )}

        {banked.map((l) => (
          <div key={`bank-${l.id}`} className="rounded-2xl border border-[#ececee] bg-[#f5f5f7] px-3.5 py-3 space-y-2">
            <p className="text-[14px] font-semibold text-[#16171a]">{l.left} banked rental day{l.left === 1 ? '' : 's'}</p>
            {l.redeem && l.redeem.status === 'requested' ? (
              <p className="text-[14px] font-medium text-[#b45309]">You asked to use {l.redeem.days} — waiting on {biz()}.</p>
            ) : redeemFor === l.id ? (
              <div className="flex gap-2">
                <input inputMode="numeric" aria-label="Days to use" value={redeemDays}
                  onChange={(e) => setRedeemDays(e.target.value.replace(/[^0-9]/g, ''))}
                  className="h-11 w-20 rounded-2xl border border-[#ececee] px-3 text-center text-sm font-medium" />
                <button type="button" disabled={busy} onClick={() => askRedeem(l.id, l.left)}
                  className="h-11 flex-1 rounded-2xl bg-[#16171a] text-[13px] font-semibold text-white disabled:opacity-40">Ask to use them</button>
                <button type="button" onClick={() => setRedeemFor('')} className="h-11 rounded-2xl border border-[#ececee] px-3 text-[13px] font-semibold text-[#6d7075]">Cancel</button>
              </div>
            ) : (
              <button type="button" onClick={() => { setRedeemFor(l.id); setRedeemDays(String(l.left)); }}
                className="h-11 w-full rounded-2xl border border-[#ececee] text-[13px] font-semibold text-[#16171a]">Use banked days</button>
            )}
          </div>
        ))}

        {!open ? (
          <button type="button" onClick={() => setOpen(true)} disabled={!!pending}
            className="h-11 w-full rounded-2xl border border-[#ececee] text-[13px] font-semibold text-[#16171a] disabled:opacity-50">
            {pending ? 'Request pending' : 'Request time away'}
          </button>
        ) : (
          <div className="space-y-2">
            <p className="text-[13px] font-medium text-[#6d7075]">
              {state.policy.noticeDays > 0 ? `${biz(true)} asks for ${state.policy.noticeDays} days' notice where possible. ` : ''}Up to {state.policy.maxWeeks} weeks.
            </p>
            <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} aria-label="Type of leave"
              className="h-11 w-full rounded-2xl border border-[#ececee] px-3 text-sm font-medium bg-white">
              {[['maternity', 'Maternity / parental'], ['medical', 'Medical'], ['family', 'Family'], ['personal', 'Personal'], ['other', 'Other']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} aria-label="First day away" className="h-11 rounded-2xl border border-[#ececee] px-3 text-sm font-medium" />
              <input type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} aria-label="Expected return" className="h-11 rounded-2xl border border-[#ececee] px-3 text-sm font-medium" />
            </div>
            <div>
              <p className="text-[12px] font-semibold text-[#6d7075] mb-1">How you'd prefer rent handled</p>
              <div className="flex flex-wrap gap-1.5">
                {state.policy.offered.map((t: string) => (
                  <button key={t} type="button" onClick={() => setForm((f) => ({ ...f, preferred: f.preferred === t ? '' : t }))}
                    className={cn('h-11 px-3 rounded-full border text-[13px] font-semibold', form.preferred === t ? 'bg-[#16171a] text-white border-[#16171a]' : 'border-[#ececee] text-[#6d7075]')}>
                    {TL[t]}
                  </button>
                ))}
              </div>
              <p className="text-[12px] font-medium text-[#6d7075] mt-1">A preference, not a promise — {biz()} decides.</p>
            </div>
            <textarea value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value.slice(0, 600) }))} rows={2} placeholder={`Anything ${biz()} should know (optional)`} aria-label="Note"
              className="w-full rounded-2xl border border-[#ececee] px-3.5 py-2.5 text-sm" />
            <div className="flex gap-2">
              <button type="button" onClick={submit} disabled={busy || !form.startDate || !form.endDate}
                className="h-11 flex-1 rounded-2xl bg-[#16171a] text-[13px] font-semibold text-white disabled:opacity-40">{busy ? 'Sending…' : 'Send request'}</button>
              <button type="button" onClick={() => setOpen(false)} className="h-11 rounded-2xl border border-[#ececee] px-4 text-[13px] font-semibold text-[#6d7075]">Cancel</button>
            </div>
          </div>
        )}
        {err && <p className="text-[13px] font-medium text-[#b45309]">{err}</p>}
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
    <section className="space-y-3" aria-labelledby="renter-thread-title">
      <h2 id="renter-thread-title" className="px-1 text-[14px] font-semibold text-[#6d7075]">Your conversation with {studioName}</h2>
      <div className="space-y-3 rounded-2xl border border-[#ececee] bg-white p-4">
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {msgs === null ? <p className="text-[14px] text-[#6d7075]">Loading…</p>
            : msgs.length === 0 ? <p className="text-[14px] leading-relaxed text-[#6d7075]">Nothing yet. Ask a question, report something, or just say hi. It’s all kept on your account.</p>
            : msgs.map((m) => (
              <div key={m.id} className={cn('max-w-[88%] rounded-2xl px-3.5 py-2.5', m.direction === 'inbound' ? 'ml-auto bg-[#16171a] text-white' : 'mr-auto bg-[#f5f5f7] text-[#16171a]')}>
                <p className="whitespace-pre-wrap text-[15px] leading-snug">{m.text}</p>
                <p className={cn('mt-1 text-[12px]', m.direction === 'inbound' ? 'text-white/70' : 'text-[#6d7075]')}>
                  {m.direction === 'inbound' ? 'You' : (m.byName || studioName)} · {fmtDate(m.createdAt)}
                </p>
              </div>
            ))}
        </div>
        <div className="flex gap-2">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value.slice(0, 2000))} rows={2}
            placeholder={`Write to ${biz()}…`} aria-label={`Message to ${biz()}`}
            className="min-w-0 flex-1 rounded-xl border border-[#ececee] bg-white px-3.5 py-2.5 text-[15px] text-[#16171a] outline-none placeholder:text-[#6d7075] focus:border-[#16171a]" />
          <button type="button" onClick={send} disabled={busy || !draft.trim()}
            className="h-11 self-end rounded-full bg-[#16171a] px-5 text-[15px] font-medium text-white disabled:opacity-40">
            {busy ? 'Sending…' : 'Send'}
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
/** Shown under the photo pickers in the brand panel only when uploads can't work here; the reason goes to the console. */
export function storageDiagnostic(): string {
  if (resolvedStorageBucket()) return '';
  console.error('[rent] no storage bucket resolved: set the storage bucket setting for this site');
  return 'Photo uploads aren’t available right now.';
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
        console.error('[rent upload] sign-in for uploads is off', code); throw new Error('Uploads aren’t available right now. Please try again later.');
      }
      console.error('[rent upload] upload sign-in failed', code, e?.message);
      throw new Error('Uploads aren’t available right now. Please try again later.');
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
    if (code.includes('unauthorized')) { console.error('[rent upload] storage refused', code); throw new Error('That upload didn’t go through. Please try again later.'); }
    if (code.includes('unknown') || code.includes('retry-limit')) throw new Error('The upload didn’t reach us. Check your connection and try again.');
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
      title: decision === 'accept' ? 'Swap confirmed' : 'Swap declined',
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
    toast({ title: 'It’s yours', description: 'Your booking hours have moved for that window only. Rent is unchanged.' });
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
      <SectionTitle icon={Repeat}>Swap days</SectionTitle>

      {openOffers.map((o: any) => (
        <div key={o.id} className="p-4 rounded-2xl bg-white border border-[#ececee] space-y-3">
          <div>
            <p className="font-semibold text-[#16171a] text-sm">{o.fromName} is offering a day</p>
            <p className="text-[14px] font-medium text-[#6d7075] mt-0.5">
              {o.giveLabel}, {o.windowLabel}{o.boothName ? ` · ${o.boothName}` : ''}
            </p>
            {o.note && <p className="text-[14px] font-medium text-[#6d7075] mt-1">“{o.note}”</p>}
          </div>
          <button onClick={() => claim(o.id)} disabled={!!busy}
            className="w-full py-3 rounded-2xl bg-[#16171a] text-white text-[14px] font-semibold transition-all disabled:opacity-50">
            {busy === o.id ? 'Taking…' : 'Take this day'}
          </button>
          <p className="text-[13px] font-medium text-[#6d7075]">
            First to take it gets it{o.offeredTo > 1 ? ` — ${o.offeredTo} people were asked` : ''}. Rent is not affected.
          </p>
        </div>
      ))}

      {myOpen.map((o: any) => (
        <div key={o.id} className="p-4 rounded-2xl bg-white border border-[#ececee] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-[#16171a] text-sm truncate">Offered to anyone who can take it</p>
            <p className="text-[14px] font-medium text-[#6d7075] mt-0.5">
              {o.giveLabel}, {o.windowLabel}{o.offeredTo ? ` · ${o.offeredTo} asked` : ''}
            </p>
          </div>
          <button onClick={() => withdraw(o.id)} disabled={!!busy}
            className="shrink-0 w-11 h-11 rounded-xl bg-[#f5f5f7] flex items-center justify-center text-[#6d7075] transition-all disabled:opacity-50">
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}

      {incoming.map((s2: any) => (
        <div key={s2.id} className={cn('p-4 rounded-2xl bg-white border space-y-3',
          s2.conflictCount > 0 ? 'border-[#f3d9bd]' : 'border-[#ececee]')}>
          <div>
            <p className="font-semibold text-[#16171a] text-sm">{s2.otherName} wants you to cover</p>
            <p className="text-[14px] font-medium text-[#6d7075] mt-0.5">{s2.giveLabel}, {s2.windowLabel}</p>
            {s2.note && <p className="text-[14px] font-medium text-[#6d7075] mt-1">“{s2.note}”</p>}
          </div>

          {s2.conflictCount > 0 ? (
            <div className="space-y-2">
              <div className="flex items-start gap-2 p-3 rounded-2xl bg-[#fdf6ee]">
                <AlertTriangle className="w-4 h-4 text-[#b45309] mt-0.5 shrink-0" />
                <p className="text-[14px] font-medium text-[#b45309]">
                  You have {s2.conflictCount === 1 ? 'a client' : `${s2.conflictCount} clients`} booked in that window,
                  so you can&apos;t accept this yet. Move or cancel that booking yourself and this turns green on its own.
                </p>
              </div>
              <button onClick={() => setDeclineFor(s2.id)} disabled={!!busy}
                className="w-full py-3 rounded-2xl bg-[#f5f5f7] text-[#6d7075] text-[14px] font-semibold transition-all disabled:opacity-50">
                Decline
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => respond(s2.id, 'accept')} disabled={!!busy}
                className="flex-1 py-3 rounded-2xl bg-[#16171a] text-white text-[14px] font-semibold transition-all disabled:opacity-50">
                {busy === s2.id ? 'Working…' : 'Accept'}
              </button>
              <button onClick={() => setDeclineFor(s2.id)} disabled={!!busy}
                className="px-5 py-3 rounded-2xl bg-[#f5f5f7] text-[#6d7075] text-[14px] font-semibold transition-all disabled:opacity-50">
                Decline
              </button>
            </div>
          )}

          {declineFor === s2.id && (
            <div className="space-y-2 pt-1">
              <p className="text-[13px] font-semibold text-[#6d7075]">Why?</p>
              <button onClick={() => respond(s2.id, 'decline', 'not_this_time')} disabled={!!busy}
                className="w-full py-3 rounded-2xl bg-white border text-[#16171a] text-[14px] font-semibold transition-all disabled:opacity-50">
                Not this time
              </button>
              <button onClick={() => respond(s2.id, 'decline', 'never_that_day')} disabled={!!busy}
                className="w-full py-3 rounded-2xl bg-white border text-[#16171a] text-[14px] font-semibold transition-all disabled:opacity-50">
                That day never works for me
              </button>
            </div>
          )}

          <p className="text-[13px] font-medium text-[#6d7075]">Your rent is not affected either way.</p>
        </div>
      ))}

      {outgoing.map((s2: any) => (
        <div key={s2.id} className="p-4 rounded-2xl bg-white border border-[#ececee] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-[#16171a] text-sm truncate">Waiting on {s2.otherName}</p>
            <p className="text-[14px] font-medium text-[#6d7075] mt-0.5">{s2.giveLabel}, {s2.windowLabel}</p>
          </div>
          <button onClick={() => withdraw(s2.id)} disabled={!!busy}
            className="shrink-0 w-11 h-11 rounded-xl bg-[#f5f5f7] flex items-center justify-center text-[#6d7075] transition-all disabled:opacity-50">
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}

      {confirmed.map((s2: any) => (
        <div key={s2.id} className="p-4 rounded-2xl bg-[#eef6f1] border border-[#cfe5d8]">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#1f7a4d] shrink-0" />
            <p className="font-semibold text-[#1f7a4d] text-sm">Swapped with {s2.otherName}</p>
          </div>
          <p className="text-[14px] font-medium text-[#1f7a4d] mt-1">{line(s2)}</p>
        </div>
      ))}

      {!open ? (
        <button onClick={start}
          className="w-full p-4 rounded-2xl bg-white border border-dashed border-[#ececee] text-left active:scale-[0.99] transition-all">
          <p className="font-semibold text-[#16171a] text-sm">Give away a day, or part of one</p>
          <p className="text-[14px] font-medium text-[#6d7075] mt-0.5">
            Hand a whole day, or just your morning or afternoon, to another professional here. You arrange it between you.
          </p>
        </button>
      ) : (
        <div className="p-4 rounded-2xl bg-white border space-y-4">
          {loadingOpts ? (
            <div className="flex items-center gap-2 py-4 text-[#6d7075]">
              <Loader className="w-4 h-4 animate-spin" />
              <span className="text-[14px] font-semibold">Finding your free time…</span>
            </div>
          ) : myDates.length === 0 ? (
            <div className="space-y-2">
              <p className="text-[14px] font-medium text-[#6d7075]">
                Nothing to offer right now. A day shows up here when it is one of yours and somebody else could take at least part of it.
              </p>
              <button onClick={reset} className="text-[14px] font-semibold text-[#6d7075]">Close</button>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <p className="text-[13px] font-semibold text-[#6d7075]">1 · Which day</p>
                <div className="flex flex-wrap gap-2">
                  {myDates.map((d: any) => (
                    <button key={d.date} onClick={() => pickDate(d)}
                      className={cn('px-3 py-2 rounded-xl text-[14px] font-semibold border transition-all',
                        giveDate === d.date ? 'bg-[#16171a] text-white border-[#16171a]' : 'bg-white text-[#6d7075] border-[#ececee]')}>
                      {d.label}
                    </button>
                  ))}
                </div>
                {chosen && (
                  <p className="text-[13px] font-medium text-[#6d7075]">
                    You hold {fmtTime(chosen.held.start)}–{fmtTime(chosen.held.end)} that day.
                  </p>
                )}
              </div>

              {chosen && (
                <div className="space-y-2">
                  <p className="text-[13px] font-semibold text-[#6d7075]">2 · How much of it</p>
                  <div className="space-y-2">
                    {SWAP_SLICE.map(([k, label]) => {
                      const avail = k === 'whole' ? chosen.held : k === 'leading' ? chosen.leading : chosen.trailing;
                      if (!avail) return null;
                      return (
                        <button key={k} onClick={() => pickSlice(k)}
                          className={cn('w-full px-3 py-3 rounded-xl text-left text-[14px] font-semibold border transition-all',
                            slice === k ? 'bg-[#16171a] text-white border-[#16171a]' : 'bg-white text-[#6d7075] border-[#ececee]')}>
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  {slice !== 'whole' && seg && (
                    <div className="flex items-center gap-2 pt-1">
                      <label htmlFor="swap-edge" className="text-[13px] font-semibold text-[#6d7075]">
                        {slice === 'leading' ? 'Coming in at' : 'Leaving at'}
                      </label>
                      <input id="swap-edge" type="time" value={edge}
                        min={slice === 'leading' ? seg.start : seg.start}
                        max={slice === 'leading' ? seg.end : seg.end}
                        onChange={(e) => setEdge(e.target.value)}
                        className="px-3 py-2 rounded-xl border border-[#ececee] text-sm font-medium" />
                    </div>
                  )}
                  {win && (
                    <p className="text-[13px] font-medium text-[#6d7075]">
                      Giving away {fmtTime(win.start)}–{fmtTime(win.end)}.
                    </p>
                  )}
                </div>
              )}

              {chosen && win && (
                <div className="space-y-2">
                  <p className="text-[13px] font-semibold text-[#6d7075]">3 · Who you&apos;re asking</p>
                  <div className="flex flex-wrap gap-2">
                    {partners.map((pp: any) => (
                      <button key={pp.staffId} onClick={() => { setToStaffId(pp.staffId); setConfirmAsk(''); setErr(''); }}
                        className={cn('px-3 py-2 rounded-xl text-[14px] font-semibold border transition-all',
                          toStaffId === pp.staffId ? 'bg-[#16171a] text-white border-[#16171a]' : 'bg-white text-[#6d7075] border-[#ececee]')}>
                        {pp.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {toStaffId && (
                <div className="space-y-2">
                  <label htmlFor="swap-note" className="block text-[13px] font-semibold text-[#6d7075]">Message (optional)</label>
                  <input id="swap-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={240}
                    placeholder="Family thing that afternoon…"
                    className="w-full px-3 py-3 rounded-xl border border-[#ececee] text-sm font-medium" />
                </div>
              )}

              {confirmAsk && (
                <div className="p-3 rounded-2xl bg-[#fdf6ee] border border-[#f3d9bd] space-y-2">
                  <p className="text-[14px] font-medium text-[#b45309]">{confirmAsk}</p>
                  <div className="flex gap-2">
                    <button onClick={() => send(true)} disabled={!!busy}
                      className="flex-1 py-3 rounded-2xl bg-[#b45309] text-white text-[14px] font-semibold transition-all disabled:opacity-50">
                      {busy === 'send' ? 'Sending…' : 'Ask anyway'}
                    </button>
                    <button onClick={() => setConfirmAsk('')}
                      className="px-5 py-3 rounded-2xl bg-white border text-[#6d7075] text-[14px] font-semibold transition-all">
                      Back
                    </button>
                  </div>
                </div>
              )}

              {err && (
                <div className="flex items-start gap-2 text-[#b45309]">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <p className="text-[14px] font-medium">{err}</p>
                </div>
              )}

              {chosen && win && !confirmAsk && (
                <button onClick={broadcast} disabled={!!busy}
                  className="w-full p-3 rounded-2xl bg-[#f5f5f7] border border-[#ececee] text-left active:scale-[0.99] transition-all disabled:opacity-50">
                  <p className="text-[14px] font-semibold text-[#16171a]">
                    {busy === 'send' ? 'Offering…' : 'Or offer it to anyone who can take it'}
                  </p>
                  <p className="text-[13px] font-medium text-[#16171a] mt-0.5">
                    Everyone who could actually cover it gets asked once. First to take it gets it — no chasing.
                  </p>
                </button>
              )}

              {!confirmAsk && (
                <div className="flex gap-2">
                  <button onClick={() => send(false)} disabled={!giveDate || !toStaffId || !win || !!busy}
                    className="flex-1 py-3 rounded-2xl bg-[#16171a] text-white text-[14px] font-semibold transition-all disabled:opacity-40">
                    {busy === 'send' ? 'Sending…' : 'Send request'}
                  </button>
                  <button onClick={reset}
                    className="px-5 py-3 rounded-2xl bg-[#f5f5f7] text-[#6d7075] text-[14px] font-semibold transition-all">
                    Cancel
                  </button>
                </div>
              )}
              <p className="text-[13px] font-medium text-[#6d7075]">
                Nothing moves until they accept, and rent stays exactly where it is.
              </p>
            </>
          )}
        </div>
      )}

      {err && !open && (
        <div className="flex items-start gap-2 text-[#b45309] px-1">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <p className="text-[14px] font-medium">{err}</p>
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
    <div className={cn('p-4 rounded-2xl border bg-white space-y-3',
      isToday ? 'border-[#16171a]' : 'border-[#ececee]')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-[#16171a] text-sm truncate">{r.boothName}</p>
          <p className="text-[13px] font-medium text-[#6d7075] mt-0.5">
            {fmtDate(r.startDate)} · {window}{r.slotLabel ? ` · ${r.slotLabel}` : ''}
          </p>
        </div>
        {statusChip}
      </div>

      {(r.balanceDueCents > 0 && !r.balancePaid && r.status !== 'refunded') && (
        <div className="flex items-center gap-2 p-2.5 rounded-xl bg-[#fdf6ee] border border-[#f3d9bd]">
          <AlertTriangle className="w-3.5 h-3.5 text-[#b45309] shrink-0" />
          <p className="text-[13px] font-medium text-[#b45309]">
            {fmtMoney(r.balanceDueCents)} balance {r.balanceMode === 'at_checkin' ? 'due at check-in' : 'payable in person'}
          </p>
        </div>
      )}
      {r.overageStatus === 'due' && r.overageDueCents > 0 && (
        <div className="flex items-center gap-2 p-2.5 rounded-xl bg-[#fdf6ee] border border-[#f3d9bd]">
          <Clock className="w-3.5 h-3.5 text-[#b45309] shrink-0" />
          <p className="text-[13px] font-medium text-[#b45309]">
            {fmtMoney(r.overageDueCents)} overtime due ({r.overageMinutes} min past booked time)
          </p>
        </div>
      )}
      {r.creditDecision === 'pending' && r.potentialCreditCents > 0 && (
        <div className="flex items-center gap-2 p-2.5 rounded-xl bg-[#eef6f1] border border-[#cfe5d8]">
          <Sparkles className="w-3.5 h-3.5 text-[#1f7a4d] shrink-0" />
          <p className="text-[13px] font-medium text-[#1f7a4d]">
            {fmtMoney(r.potentialCreditCents)} credit for unused time, waiting on {biz()} to review
          </p>
        </div>
      )}

      {isToday && r.status === 'confirmed' && onCheckIn && (
        <button onClick={() => onCheckIn(r.id)} disabled={busy}
          className="w-full h-12 rounded-2xl bg-[#16171a] text-white font-semibold text-[14px] transition-all disabled:opacity-50 flex items-center justify-center gap-2">
          {busy ? <Loader className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Check In
        </button>
      )}
      {isToday && r.status === 'checked_in' && onCheckOut && (
        <button onClick={() => onCheckOut(r.id)} disabled={busy}
          className="w-full h-12 rounded-2xl bg-[#16171a] text-white font-semibold text-[14px] transition-all disabled:opacity-50 flex items-center justify-center gap-2">
          {busy ? <Loader className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />} Check Out
        </button>
      )}
      {!isToday && r.status === 'confirmed' && onRequestReschedule && (
        r.rescheduleRequestedAt ? (
          <p className="text-[13px] font-semibold text-[#16171a] text-center py-1.5">
            Asked to move it. {biz(true)} will be in touch.
          </p>
        ) : (
          <button onClick={() => onRequestReschedule(r.id)} disabled={busy}
            className="w-full h-11 rounded-2xl border border-[#ececee] text-[#6d7075] font-semibold text-[13px] transition-all disabled:opacity-50">
            Ask to move it
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
    <div className="min-h-screen bg-white flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-3">
          <div className="w-16 h-16 rounded-2xl bg-[#f5f5f7] flex items-center justify-center mx-auto">
            <Armchair className="w-8 h-8 text-[#16171a]" />
          </div>
          <h1 className="text-3xl font-semibold text-[#16171a]">Renter portal</h1>
          <p className="text-[14px] font-medium text-[#6d7075]">
            {phase === 'contact' ? 'Your rent, bookings and messages in one place' : 'Enter your sign-in code'}
          </p>
        </div>

        {phase === 'contact' ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[13px] font-semibold text-[#6d7075] px-1">
                Phone or email you booked with
              </label>

              <p className="text-[13px] font-medium text-[#6d7075] px-1 leading-snug">
                We'll text a one-time sign-in code to this number. Msg &amp; data rates may
                apply. Reply STOP to opt out. <a href="/legal/sms" target="_blank" rel="noreferrer" className="underline">SMS Terms</a> · <a href="/legal/privacy" target="_blank" rel="noreferrer" className="underline">Privacy</a>
              </p>
              <div className="relative">
                <Phone className="w-4 h-4 text-[#6d7075] absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  value={contact}
                  onChange={e => setContact(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && requestCode()}
                  inputMode="email"
                  autoComplete="tel"
                  placeholder="(555) 123-4567 or you@email.com"
                  className="w-full h-14 pl-11 pr-4 rounded-2xl border border-[#ececee] bg-white font-medium text-[#16171a] placeholder:text-[#6d7075] focus:border-[#16171a] focus:outline-none"
                />
              </div>
            </div>
            <button
              onClick={requestCode}
              disabled={busy || !contact.trim()}
              className="w-full h-14 rounded-2xl bg-[#16171a] text-white font-semibold text-[13px] transition-all disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {busy ? <Loader className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
              Get a sign-in code
            </button>
            <p className="text-[13px] font-medium text-[#6d7075] text-center leading-relaxed px-4">
              We’ll verify it’s really you. {bizs(true)} front desk can share your one-time code.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-[#f5f5f7] border border-[#ececee] text-center">
              <p className="text-[13px] font-medium text-[#16171a] leading-relaxed">
                A 6-digit code was sent to {biz()} for <strong>{contact.trim()}</strong>.
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
              className="w-full h-16 rounded-2xl border border-[#ececee] bg-white font-semibold text-3xl text-center tracking-[0.5em] text-[#16171a] placeholder:text-[#6d7075] focus:border-[#16171a] focus:outline-none"
            />
            <button
              onClick={verify}
              disabled={busy || code.length !== 6}
              className="w-full h-14 rounded-2xl bg-[#16171a] text-white font-semibold text-[13px] transition-all disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {busy ? <Loader className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Sign in
            </button>
            <button
              onClick={() => { setPhase('contact'); setCode(''); }}
              className="w-full text-[13px] font-semibold text-[#6d7075] hover:text-[#6d7075] py-2"
            >
              Use a different phone / email
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
