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
import { useToast } from '@/hooks/use-toast';
import {
  Armchair, CalendarDays, Clock, CreditCard, LogOut, Loader,
  CheckCircle2, Sparkles, ChevronRight, Receipt, AlertTriangle,
  Wallet, KeyRound, Phone, RefreshCw, Repeat, X,
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
                  <p className="text-[9px] font-bold uppercase tracking-widest text-slate-300 text-center">Prefer cash or check? Pay at the front desk — it posts here too.</p>
                </div>
              </section>
            )}

            {data?.provider && session?.token && (
              <MyServices data={data} tenantId={tenantId} token={session.token} onChanged={() => refresh()} />
            )}

            {data?.provider && session?.token && (
              <MyNumber data={data} tenantId={tenantId} token={session.token} onChanged={() => refresh()} />
            )}

            {data?.provider && session?.token && (
              <MyHours data={data} tenantId={tenantId} token={session.token} onChanged={() => refresh()} />
            )}

            {data?.provider && session?.token && data?.swaps?.enabled !== false && (
              <MySwaps data={data} tenantId={tenantId} token={session.token} onChanged={() => refresh()} />
            )}

            {data?.provider && <MyBook data={data} />}

            {data?.provider && session?.token && (
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
              <SectionTitle icon={Receipt}>Documents</SectionTitle>
              <div className="rounded-3xl bg-white border-2 border-slate-100 p-4 space-y-2.5">
                <p className="text-[11px] font-bold text-slate-500">License or insurance renewed? Upload the new one here — the studio is notified automatically.</p>
                <div className="grid grid-cols-2 gap-2">
                  {(['license', 'insurance'] as const).map((kind) => (
                    <label key={kind} className={`h-12 rounded-2xl border-2 font-black uppercase text-[10px] tracking-widest flex items-center justify-center cursor-pointer ${credBusy === kind ? 'opacity-50' : 'text-slate-700'}`}>
                      {credBusy === kind ? 'Uploading…' : credDone === kind ? `${kind} ✓` : `Upload ${kind}`}
                      <input type="file" accept="image/*" className="hidden" disabled={!!credBusy}
                        onChange={async (e) => {
                          const f = e.target.files?.[0]; e.target.value = '';
                          if (!f || !session) return;
                          setCredBusy(kind);
                          try {
                            const dataUrl: string = await downscaleImageToDataUrl(f, { maxDim: 1600 });
                            const d = await api({ action: 'upload-credential', tenantId, token: session.token, kind, photoData: dataUrl });
                            if (d.ok) { setCredDone(kind); toast({ title: 'Uploaded ✓', description: 'The studio has been notified — you\'re all set.' }); }
                            else toast({ variant: 'destructive', title: 'Upload failed', description: d.error || 'Try again.' });
                          } catch { toast({ variant: 'destructive', title: 'Upload failed', description: 'Try again.' }); }
                          finally { setCredBusy(null); }
                        }} />
                    </label>
                  ))}
                </div>
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
