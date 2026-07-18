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

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
  Armchair, CalendarDays, Clock, CreditCard, LogOut, Loader,
  CheckCircle2, Sparkles, ChevronRight, Receipt, AlertTriangle,
  Wallet, KeyRound, Phone, RefreshCw,
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
const ResCard = ({ r, isToday, onCheckIn, onCheckOut, busy }: {
  r: any; isToday: boolean;
  onCheckIn?: (id: string) => void; onCheckOut?: (id: string) => void; busy?: boolean;
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

  const saveSession = (s: { token: string; expiresAt: number; name: string | null } | null) => {
    if (s) localStorage.setItem(STORE(tenantId), JSON.stringify(s));
    else localStorage.removeItem(STORE(tenantId));
    setSession(s);
    if (!s) setData(null);
  };

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
        {/* Header */}
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
            {/* Today */}
            {todays.length > 0 && (
              <section className="space-y-3">
                <SectionTitle icon={Clock}>Today</SectionTitle>
                {todays.map((r: any) => (
                  <ResCard key={r.id} r={r} isToday onCheckIn={doCheckIn} onCheckOut={doCheckOut} busy={actionBusy} />
                ))}
              </section>
            )}

            {/* Credits */}
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

            {/* Rent (leased renters) */}
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
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Pay at desk</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Upcoming */}
            <section className="space-y-3">
              <SectionTitle icon={CalendarDays}>Upcoming Bookings</SectionTitle>
              {later.length === 0 && todays.length === 0 ? (
                <div className="p-6 rounded-3xl bg-white border-2 border-dashed border-slate-200 text-center space-y-2">
                  <Armchair className="w-8 h-8 text-slate-200 mx-auto" />
                  <p className="text-[11px] font-bold text-slate-400">No upcoming bookings</p>
                </div>
              ) : (
                later.map((r: any) => <ResCard key={r.id} r={r} isToday={false} />)
              )}
              {data?.rebookUrl && (
                <a href={data.rebookUrl}
                  className="w-full h-12 rounded-2xl border-2 border-violet-200 bg-violet-50 text-violet-700 font-black uppercase tracking-widest text-[11px] active:scale-[0.98] transition-all flex items-center justify-center gap-2">
                  Book Another Visit <ChevronRight className="w-4 h-4" />
                </a>
              )}
            </section>

            {/* Payments */}
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

            {/* History */}
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
