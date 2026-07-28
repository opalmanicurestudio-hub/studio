'use client';

// src/app/walk-in/[tenantId]/page.tsx
//
// v12 — WALK-IN KIOSK, rebuilt. The old walk-in kiosk was replaced by the
// booth-renter check-in kiosk; this is its successor for walk-in
// APPOINTMENTS, built directly on the shared booking engine
// (/api/appointments/book) — which means:
//
//   · AUTO-TURN: the guest taps a service, enters name + phone, and the
//     engine finds the earliest free, qualified chair from RIGHT NOW
//     (flexible mode, 15-min steps). Turn rotation is the same fairness
//     queue every other surface uses, so walk-ins don't skew assignments.
//   · RACE-PROOF: the conflict check runs in a server transaction — the
//     kiosk can't double-book against the front desk or the public page.
//   · NO DUPLICATE CLIENTS: returning guests who type the same phone
//     number land on their existing profile (server-side dedupe).
//   · Guests are marked checkInStatus:'arrived' (they're standing here).
//
// UX: giant touch targets, auto-resets to the welcome screen after 90s of
// inactivity (25s on the success screen), zero owner intervention needed.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { getApp } from 'firebase/app';
import { getFirestore, doc, getDoc, getDocs, collection } from 'firebase/firestore';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  Sparkles, ArrowRight, ArrowLeft, Loader, CheckCircle2,
  Phone, User, Clock, Scissors, RotateCcw, Frown, BellRing,
} from 'lucide-react';

type Step = 'welcome' | 'service' | 'details' | 'placing' | 'success' | 'full';

// The "we're full" screen used to be a dead end that told the guest to go ask
// the front desk. It now writes them onto the real waitlist itself — they have
// already typed their name and number and picked a service seconds earlier, so
// this is one tap with nothing to re-enter.
type WaitState = 'idle' | 'joining' | 'joined' | 'failed';

const IDLE_RESET_MS = 90 * 1000;
const SUCCESS_RESET_MS = 25 * 1000;

const fmtPrice = (p: any) => {
  const n = Number(p);
  return Number.isFinite(n) && n > 0 ? `$${n.toFixed(0)}` : '';
};

export default function WalkInKioskPage() {
  const params = useParams();
  const tenantId = params.tenantId as string;

  const [tenant, setTenant] = useState<any>(null);
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [step, setStep] = useState<Step>('welcome');
  const [service, setService] = useState<any>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [result, setResult] = useState<any>(null);
  const [failMessage, setFailMessage] = useState('');
  const [waitState, setWaitState] = useState<WaitState>('idle');
  const [waitMessage, setWaitMessage] = useState('');

  // ── Load tenant + walk-in-able services (same public reads the booking page uses) ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = getFirestore(getApp());
        const [tSnap, svSnap] = await Promise.all([
          getDoc(doc(db, 'tenants', tenantId)),
          getDocs(collection(db, `tenants/${tenantId}/services`)),
        ]);
        if (cancelled) return;
        if (tSnap.exists()) setTenant({ id: tSnap.id, ...tSnap.data() });
        setServices(
          svSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
            .filter((s: any) => s.isActive !== false && s.type !== 'addon' && s.walkInEnabled !== false),
        );
      } catch { /* welcome screen still renders; booking will surface errors */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [tenantId]);

  // A ref, not just the `waitState` flag: two taps inside a single frame would
  // both read the same state snapshot and both fire. A kiosk gets jabbed.
  const joinLock = useRef(false);

  // ── Idle auto-reset — a kiosk must never be left mid-flow for the next guest ──
  const reset = useCallback(() => {
    setStep('welcome'); setService(null); setName(''); setPhone('');
    setResult(null); setFailMessage('');
    setWaitState('idle'); setWaitMessage('');
    joinLock.current = false;
  }, []);
  const idleTimer = useRef<any>(null);
  useEffect(() => {
    if (step === 'welcome') return;
    // The "full" screen asks the guest to make one more decision, so it keeps
    // the full idle window until they have answered it; once they're on the
    // waitlist it clears itself as quickly as the success screen does.
    const settled = step === 'success' || (step === 'full' && waitState === 'joined');
    const ms = settled ? SUCCESS_RESET_MS : IDLE_RESET_MS;
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(reset, ms);
    return () => clearTimeout(idleTimer.current);
  }, [step, name, phone, service, waitState, reset]);

  // ── The booking: auto-turn via the shared engine ──
  const placeMe = async () => {
    if (!service || !name.trim()) return;
    setStep('placing');
    try {
      // next 5-minute boundary — "from right now"
      const nowMs = Date.now();
      const startIso = new Date(Math.ceil(nowMs / (5 * 60000)) * (5 * 60000)).toISOString();
      const res = await fetch('/api/appointments/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          source: 'walkin-kiosk',
          serviceId: service.id,
          staffId: 'any',
          startTime: startIso,
          flexible: true,
          flexWindowMin: 240,
          checkInStatus: 'arrived',
          client: { name: name.trim(), phone: phone.trim() || undefined },
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (d?.ok) {
        setResult(d);
        setStep('success');
      } else {
        setFailMessage(d?.error || 'We couldn’t find an opening right now.');
        setStep('full');
      }
    } catch {
      setFailMessage('Something hiccuped — please see the front desk and we’ll get you in.');
      setStep('full');
    }
  };

  // ── The consolation prize: a real waitlist row the front desk can act on ──
  // Goes through /api/waitlist (Admin SDK) because the waitlist collection is
  // staff-write-only in the security rules — the browser cannot write it directly.
  const joinWaitlist = async () => {
    if (joinLock.current || waitState === 'joining' || waitState === 'joined') return;
    joinLock.current = true;
    setWaitState('joining');
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          action: 'join',
          name: name.trim(),
          phone: phone.trim(),
          serviceId: service?.id,
          source: 'walkin-kiosk',
          note: 'Walked in — no chair was open.',
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (d?.ok) {
        setWaitMessage(
          d.alreadyOn
            ? 'You were already on the list — you’re all set.'
            : 'You’re on the list. We’ll reach out the moment a chair frees up.',
        );
        setWaitState('joined');
      } else {
        joinLock.current = false; // let them try again
        setWaitMessage(d?.error || 'We couldn’t save that — please see the front desk.');
        setWaitState('failed');
      }
    } catch {
      joinLock.current = false;
      setWaitMessage('We couldn’t save that — please see the front desk.');
      setWaitState('failed');
    }
  };

  const canJoinWaitlist = Boolean(name.trim() && phone.trim());

  const startsSoon = result?.startTime
    ? (new Date(result.startTime).getTime() - Date.now()) < 12 * 60000
    : false;

  const studioName = tenant?.name || 'the studio';

  return (
    <div className="min-h-dvh bg-gradient-to-b from-rose-50 via-white to-white text-slate-900 flex flex-col">
      {/* Header */}
      <header className="pt-8 pb-2 text-center">
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-slate-400">{studioName}</p>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-10 w-full max-w-lg mx-auto">

        {/* ── WELCOME ── */}
        {step === 'welcome' && (
          <button
            onClick={() => setStep('service')}
            disabled={loading}
            className="w-full text-center space-y-8 py-10 active:scale-[0.99] transition-transform"
          >
            <div className="w-24 h-24 rounded-[2rem] bg-rose-100 flex items-center justify-center mx-auto">
              <Sparkles className="w-12 h-12 text-rose-500" />
            </div>
            <div className="space-y-3">
              <h1 className="text-4xl font-semibold tracking-tight">Walk right in</h1>
              <p className="text-slate-500 text-lg">No appointment? No problem.<br />We’ll find you the next open chair.</p>
            </div>
            <div className="inline-flex items-center gap-2 h-16 px-10 rounded-2xl bg-slate-900 text-white text-lg font-semibold shadow-xl shadow-slate-900/15">
              {loading ? <Loader className="w-5 h-5 animate-spin" /> : <>Tap to start <ArrowRight className="w-5 h-5" /></>}
            </div>
          </button>
        )}

        {/* ── SERVICE PICK ── */}
        {step === 'service' && (
          <div className="w-full space-y-5">
            <div className="text-center space-y-1">
              <h2 className="text-2xl font-semibold tracking-tight">What are we doing today?</h2>
              <p className="text-sm text-slate-400">Tap a service</p>
            </div>
            <div className="space-y-2.5 max-h-[55dvh] overflow-y-auto pr-1">
              {services.length === 0 && (
                <p className="text-center text-sm text-slate-400 py-10 border border-dashed rounded-2xl">
                  No walk-in services are set up yet — please see the front desk.
                </p>
              )}
              {services.map((s: any) => (
                <button
                  key={s.id}
                  onClick={() => { setService(s); setStep('details'); }}
                  className="w-full flex items-center gap-4 p-5 rounded-2xl border-2 border-slate-100 bg-white text-left hover:border-rose-200 active:scale-[0.99] transition-all"
                >
                  <div className="w-11 h-11 rounded-xl bg-rose-50 text-rose-500 flex items-center justify-center shrink-0">
                    <Scissors className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-lg truncate">{s.name}</p>
                    <p className="text-sm text-slate-400">{s.duration ? `${s.duration} min` : ''}</p>
                  </div>
                  <span className="text-xl font-semibold text-slate-700 shrink-0">{fmtPrice(s.price)}</span>
                </button>
              ))}
            </div>
            <button onClick={reset} className="w-full text-sm text-slate-400 py-2 flex items-center justify-center gap-1.5">
              <ArrowLeft className="w-4 h-4" /> Start over
            </button>
          </div>
        )}

        {/* ── DETAILS ── */}
        {step === 'details' && service && (
          <div className="w-full space-y-6">
            <div className="text-center space-y-1">
              <h2 className="text-2xl font-semibold tracking-tight">Almost there</h2>
              <p className="text-sm text-slate-400">{service.name}{service.duration ? ` · ${service.duration} min` : ''}</p>
            </div>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-500 px-1">Your first & last name</label>
                <div className="relative">
                  <User className="w-5 h-5 text-slate-300 absolute left-4 top-1/2 -translate-y-1/2" />
                  <input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Jordan Lee"
                    autoComplete="off"
                    className="w-full h-16 pl-12 pr-4 rounded-2xl border-2 border-slate-200 bg-white text-xl font-medium focus:border-rose-300 focus:outline-none"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-500 px-1">Mobile number <span className="text-slate-300">(so we can text you)</span></label>
                <div className="relative">
                  <Phone className="w-5 h-5 text-slate-300 absolute left-4 top-1/2 -translate-y-1/2" />
                  <input
                    value={phone}
                    onChange={e => setPhone(e.target.value.replace(/[^\d() \-+]/g, '').slice(0, 18))}
                    placeholder="(555) 123-4567"
                    inputMode="tel"
                    autoComplete="off"
                    className="w-full h-16 pl-12 pr-4 rounded-2xl border-2 border-slate-200 bg-white text-xl font-medium tracking-wide focus:border-rose-300 focus:outline-none"
                  />
                </div>
                <p className="text-[11px] text-slate-400 px-1">Been here before? Use the same number and we’ll recognize you.</p>
              </div>
            </div>
            <button
              onClick={placeMe}
              disabled={!name.trim()}
              className="w-full h-16 rounded-2xl bg-slate-900 text-white text-lg font-semibold shadow-xl shadow-slate-900/15 disabled:opacity-30 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
            >
              Find my chair <ArrowRight className="w-5 h-5" />
            </button>
            <button onClick={() => setStep('service')} className="w-full text-sm text-slate-400 py-1 flex items-center justify-center gap-1.5">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
          </div>
        )}

        {/* ── PLACING ── */}
        {step === 'placing' && (
          <div className="text-center space-y-5 py-16">
            <Loader className="w-10 h-10 animate-spin text-rose-400 mx-auto" />
            <p className="text-lg font-medium text-slate-500">Finding your chair…</p>
          </div>
        )}

        {/* ── SUCCESS ── */}
        {step === 'success' && result && (
          <div className="w-full text-center space-y-7">
            <div className="w-24 h-24 rounded-[2rem] bg-emerald-50 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-12 h-12 text-emerald-500" />
            </div>
            <div className="space-y-2">
              <h2 className="text-3xl font-semibold tracking-tight">You’re in, {name.split(' ')[0]}!</h2>
              <p className="text-lg text-slate-500">
                {result.staffName ? <>You’re with <span className="font-semibold text-slate-800">{result.staffName.split(' ')[0]}</span></> : 'You’re booked'}
                {startsSoon
                  ? ' — head on back, they’re ready for you.'
                  : result.startTime ? <> at <span className="font-semibold text-slate-800">{format(new Date(result.startTime), 'h:mm a')}</span>. Have a seat — we’ll call you.</> : '.'}
              </p>
            </div>
            {result.shortCode && (
              <div className="inline-flex flex-col items-center gap-1 px-8 py-4 rounded-2xl border-2 border-slate-100 bg-white">
                <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-400">Your code</p>
                <p className="font-mono text-2xl font-bold tracking-[0.25em]">{String(result.shortCode).toUpperCase()}</p>
              </div>
            )}
            <div className="flex items-center justify-center gap-1.5 text-sm text-slate-400">
              <Clock className="w-4 h-4" />
              <span>This screen resets itself for the next guest</span>
            </div>
            <button onClick={reset} className="mx-auto flex items-center gap-2 h-12 px-6 rounded-xl border-2 border-slate-200 text-sm font-medium text-slate-500 active:scale-95 transition-all">
              <RotateCcw className="w-4 h-4" /> Done — next guest
            </button>
          </div>
        )}

        {/* ── FULLY BOOKED / ERROR ── */}
        {step === 'full' && (
          <div className="w-full text-center space-y-6">
            <div className="w-24 h-24 rounded-[2rem] bg-amber-50 flex items-center justify-center mx-auto">
              <Frown className="w-12 h-12 text-amber-500" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold tracking-tight">We’re slammed right now</h2>
              <p className="text-slate-500">{failMessage}</p>
              {waitState !== 'joined' && (
                <p className="text-sm text-slate-400">
                  {canJoinWaitlist
                    ? 'Want us to hold your place? We’ll text you the moment a chair opens.'
                    : 'The front desk can add you to the waitlist or book you for later.'}
                </p>
              )}
            </div>

            {/* Waitlist offer — only when we actually have a way to reach them */}
            {canJoinWaitlist && waitState !== 'joined' && (
              <button
                onClick={joinWaitlist}
                disabled={waitState === 'joining'}
                className="w-full h-16 rounded-2xl bg-slate-900 text-white text-lg font-semibold shadow-xl shadow-slate-900/15 disabled:opacity-40 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
              >
                {waitState === 'joining'
                  ? <><Loader className="w-5 h-5 animate-spin" /> Adding you…</>
                  : <><BellRing className="w-5 h-5" /> Add me to the waitlist</>}
              </button>
            )}

            {waitState === 'joined' && (
              <div className="w-full rounded-2xl border-2 border-emerald-100 bg-emerald-50/60 px-6 py-5 space-y-1.5">
                <div className="flex items-center justify-center gap-2 text-emerald-700 font-semibold">
                  <CheckCircle2 className="w-5 h-5" /> You’re on the waitlist
                </div>
                <p className="text-sm text-emerald-700/80">{waitMessage}</p>
              </div>
            )}

            {waitState === 'failed' && (
              <p className="text-sm text-amber-600 px-4">{waitMessage}</p>
            )}

            <button
              onClick={reset}
              className={cn(
                'mx-auto flex items-center gap-2 transition-all active:scale-95',
                waitState === 'joined' || (canJoinWaitlist && waitState !== 'failed')
                  ? 'h-12 px-6 rounded-xl border-2 border-slate-200 text-sm font-medium text-slate-500'
                  : 'h-14 px-8 rounded-2xl bg-slate-900 text-white font-semibold',
              )}
            >
              <RotateCcw className="w-4 h-4" /> {waitState === 'joined' ? 'Done — next guest' : 'Start over'}
            </button>
          </div>
        )}
      </main>

      <footer className="pb-6 text-center">
        <p className="text-[10px] text-slate-300">Walk-in kiosk · powered by ClarityFlow</p>
      </footer>
    </div>
  );
}
