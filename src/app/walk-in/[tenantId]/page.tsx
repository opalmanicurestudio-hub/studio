'use client';

// src/app/walk-in/[tenantId]/page.tsx
//
// v13 — WALK-IN KIOSK, rebuilt onto the walk-in QUEUE.
//
// What v12 did wrong: it POSTed to /api/appointments/book and created a hard
// appointment for a person who was standing at the counter. That silently
// bypassed the turn board your providers actually watch, ignored each
// provider's "accepting walk-ins" switch, and — when the engine found no
// opening — dumped a physically-present guest onto the WAITLIST, which is the
// list for "the day you wanted is full, we'll call you," not for someone in
// your lobby.
//
// v13:
//   · POSTs to /api/walkins, which writes a real row into tenants/{id}/walkIns.
//     The guest appears on the turn board, in rotation, like every other
//     walk-in. No appointment is created — the provider taps Start Service.
//   · THE KIOSK IS OFF UNTIL THE OWNER TURNS IT ON. A tenant-level switch,
//     tenants/{id}.walkInKiosk.enabled. Off shows a clean "not taking walk-ins
//     right now" screen with a link to the booking page.
//   · The owner controls it from this page. Sign in as the owner and a control
//     bar appears at the top with the on/off switch and a live floor count.
//     "Start kiosk mode" hides that bar on this device so a guest never sees
//     it; five taps on the studio name brings it back.
//   · Providers who switched off "accepting walk-ins" are never assigned one —
//     the route enforces it, this page just reflects it.
//   · The waitlist is now only the FALLBACK: when nobody on the floor is
//     accepting, the guest is offered "we'll call you when we open up."
//
// UX unchanged where it worked: giant touch targets, auto-reset after 90s
// (25s once settled), nothing for staff to do between guests.

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { getApp } from 'firebase/app';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, getDoc, getDocs, updateDoc, collection } from 'firebase/firestore';
import { cn } from '@/lib/utils';
import {
  Sparkles, ArrowRight, ArrowLeft, Loader, CheckCircle2,
  Phone, User, Clock, Scissors, RotateCcw, Frown, BellRing,
  Users, Power, Lock, Moon,
} from 'lucide-react';

type Step = 'welcome' | 'service' | 'details' | 'placing' | 'success' | 'full';

// The "nobody is free" screen is not a dead end. The guest has already typed
// their name and number seconds earlier, so joining the waitlist is one tap
// with nothing to re-enter.
type WaitState = 'idle' | 'joining' | 'joined' | 'failed';

type Floor = {
  enabled: boolean;
  open: boolean;
  acceptingCount: number;
  queueLength: number;
  estWaitMin: number;
};

const IDLE_RESET_MS = 90 * 1000;
const SUCCESS_RESET_MS = 25 * 1000;
const FLOOR_POLL_MS = 30 * 1000;
const GROUP_CHOICES = [1, 2, 3, 4, 5, 6];

const lockKey = (tenantId: string) => `cf-walkin-kiosk-mode-${tenantId}`;

const fmtPrice = (p: any) => {
  const n = Number(p);
  return Number.isFinite(n) && n > 0 ? `$${n.toFixed(0)}` : '';
};

const firstName = (v: any) => String(v || '').trim().split(/\s+/)[0] || '';

export default function WalkInKioskPage() {
  const params = useParams();
  const tenantId = params?.tenantId as string;

  const [tenant, setTenant] = useState<any>(null);
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [floor, setFloor] = useState<Floor | null>(null);

  const [step, setStep] = useState<Step>('welcome');
  const [service, setService] = useState<any>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [groupSize, setGroupSize] = useState(1);
  const [result, setResult] = useState<any>(null);
  const [failMessage, setFailMessage] = useState('');
  const [waitState, setWaitState] = useState<WaitState>('idle');
  const [waitMessage, setWaitMessage] = useState('');

  // Owner controls
  const [isOwner, setIsOwner] = useState(false);
  const [kioskMode, setKioskMode] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState('');
  const tapTimes = useRef<number[]>([]);

  // ── Load tenant + walk-in-able services (the same public reads the booking page uses) ──
  useEffect(() => {
    if (!tenantId) return;
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
      } catch { /* the closed/welcome screen still renders; joining surfaces errors */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [tenantId]);

  // ── Floor status: is the kiosk on, is anyone accepting, how long is the line ──
  // Public GET, no personal data. Polled so a provider flipping their switch off
  // in the back room is reflected out front within half a minute.
  const refreshFloor = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await fetch(`/api/walkins?tenantId=${encodeURIComponent(tenantId)}`);
      const d = await res.json().catch(() => ({} as any));
      if (d?.ok) {
        setFloor({
          enabled: !!d.enabled,
          open: !!d.open,
          acceptingCount: Number(d.acceptingCount) || 0,
          queueLength: Number(d.queueLength) || 0,
          estWaitMin: Number(d.estWaitMin) || 0,
        });
      }
    } catch { /* keep the last known status rather than flashing a closed sign */ }
  }, [tenantId]);

  useEffect(() => {
    refreshFloor();
    const t = setInterval(refreshFloor, FLOOR_POLL_MS);
    return () => clearInterval(t);
  }, [refreshFloor]);

  // ── Is the person holding this iPad the owner? ──
  // Only the owner can flip the switch: firestore.rules lets isOwner(tenantId)
  // update the tenant doc, and an admin is NOT an owner for that rule. Showing
  // an admin a switch that will always fail would be worse than hiding it.
  useEffect(() => {
    if (!tenantId) return;
    let unsub: any = null;
    try {
      const auth = getAuth(getApp());
      unsub = onAuthStateChanged(auth, async (u: any) => {
        if (!u) { setIsOwner(false); return; }
        try {
          const db = getFirestore(getApp());
          const tSnap = await getDoc(doc(db, 'tenants', tenantId));
          if (tSnap.exists() && (tSnap.data() as any)?.userId === u.uid) { setIsOwner(true); return; }
          const sSnap = await getDoc(doc(db, `tenants/${tenantId}/staff`, u.uid));
          setIsOwner(sSnap.exists() && (sSnap.data() as any)?.role === 'owner');
        } catch { setIsOwner(false); }
      });
    } catch { setIsOwner(false); }
    return () => { try { unsub?.(); } catch { /* noop */ } };
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    try { setKioskMode(window.localStorage.getItem(lockKey(tenantId)) === '1'); } catch { /* noop */ }
  }, [tenantId]);

  const setKiosk = (on: boolean) => {
    setKioskMode(on);
    try {
      if (on) window.localStorage.setItem(lockKey(tenantId), '1');
      else window.localStorage.removeItem(lockKey(tenantId));
    } catch { /* private browsing — the bar just won't persist its state */ }
  };

  // Five taps on the studio name within three seconds brings the owner bar back
  // on a locked device. A no-op for anyone who isn't signed in as the owner, so
  // a curious guest tapping the header gets nothing.
  const tapStudioName = () => {
    if (!kioskMode) return;
    const now = Date.now();
    tapTimes.current = [...tapTimes.current, now].filter(t => now - t < 3000).slice(-5);
    if (tapTimes.current.length >= 5 && isOwner) {
      tapTimes.current = [];
      setKiosk(false);
    }
  };

  const toggleKioskEnabled = async () => {
    if (toggling) return;
    setToggling(true);
    setToggleError('');
    const next = !(floor?.enabled ?? false);
    try {
      const db = getFirestore(getApp());
      await updateDoc(doc(db, 'tenants', tenantId), { 'walkInKiosk.enabled': next });
      // The write succeeded, so this is the truth — show it immediately and let
      // the 30-second poll reconcile. Deliberately NOT re-fetching here: a
      // read that raced the write, or a poll that failed, would snap the switch
      // back and make the owner think the toggle didn't take.
      setFloor(prev => (prev ? { ...prev, enabled: next, open: next && prev.acceptingCount > 0 } : prev));
    } catch {
      setToggleError('Could not save that. Check you are signed in as the studio owner.');
    } finally {
      setToggling(false);
    }
  };

  // A ref, not just the state flag: two taps inside a single frame would both
  // read the same state snapshot and both fire. A kiosk gets jabbed.
  const joinLock = useRef(false);

  // ── Idle auto-reset — a kiosk must never be left mid-flow for the next guest ──
  const reset = useCallback(() => {
    setStep('welcome'); setService(null); setName(''); setPhone('');
    setGroupSize(1); setResult(null); setFailMessage('');
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
  }, [step, name, phone, service, groupSize, waitState, reset]);

  // ── Joining the line ──
  const joinQueue = async () => {
    if (!service || !name.trim() || !phone.trim()) return;
    if (joinLock.current) return;
    joinLock.current = true;
    setStep('placing');
    try {
      const res = await fetch('/api/walkins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          action: 'join',
          name: name.trim(),
          phone: phone.trim(),
          serviceId: service.id,
          groupSize,
        }),
      });
      const d = await res.json().catch(() => ({} as any));
      joinLock.current = false;
      if (d?.ok) {
        setResult(d);
        setStep('success');
        refreshFloor();
      } else if (d?.closed) {
        setFailMessage('Walk-ins have just been switched off — please see the front desk.');
        setStep('full');
        refreshFloor();
      } else {
        setFailMessage(d?.error || 'Nobody is free to take you right now.');
        setStep('full');
        refreshFloor();
      }
    } catch {
      joinLock.current = false;
      setFailMessage('Something hiccuped — please see the front desk and we’ll get you in.');
      setStep('full');
    }
  };

  // ── The fallback: a real waitlist row the front desk can act on ──
  // Goes through /api/waitlist (Admin SDK) because the waitlist collection is
  // staff-write-only in the security rules — the browser cannot write it.
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
          note: 'Walked in — nobody was free to take them.',
        }),
      });
      const d = await res.json().catch(() => ({} as any));
      if (d?.ok) {
        setWaitMessage(
          d.alreadyOn
            ? 'You were already on the list — you’re all set.'
            : 'You’re on the list. We’ll reach out the moment someone opens up.',
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
  const studioName = tenant?.name || 'the studio';

  // Only treat the kiosk as off once we have actually heard from the server —
  // a slow network must not flash a closed sign at a real guest.
  const kioskOff = floor !== null && !floor.enabled;
  const showOwnerBar = isOwner && !kioskMode;

  const waitLine = useMemo(() => {
    const n = Number(result?.estWaitMin) || 0;
    if (result?.assigned) return 'Ready for you now';
    return n > 0 ? `About ${n} min` : 'Just a few minutes';
  }, [result]);

  return (
    <div className="min-h-dvh bg-gradient-to-b from-rose-50 via-white to-white text-slate-900 flex flex-col">

      {/* ── OWNER CONTROL BAR ── only for a signed-in owner, hidden in kiosk mode ── */}
      {showOwnerBar && (
        <div className="w-full bg-slate-900 text-white">
          <div className="max-w-3xl mx-auto px-4 py-3 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[9rem]">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Owner controls</p>
                <p className="text-sm font-semibold">
                  {floor?.enabled ? 'Kiosk is live' : 'Kiosk is off'}
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <Users className="w-4 h-4" />
                <span>{floor?.acceptingCount ?? 0} taking walk-ins</span>
                <span className="text-slate-600">·</span>
                <span>{floor?.queueLength ?? 0} in line</span>
              </div>
            </div>
            {/* Stacked on a phone, side by side on the tablet this usually runs
                on — the labels are full sentences and must never wrap. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                onClick={toggleKioskEnabled}
                disabled={toggling}
                className={cn(
                  'w-full h-11 min-h-[44px] px-3 rounded-xl text-sm font-semibold whitespace-nowrap flex items-center justify-center gap-2 transition-all active:scale-[0.99] disabled:opacity-50',
                  floor?.enabled ? 'bg-emerald-500 text-white' : 'bg-white text-slate-900',
                )}
              >
                {toggling ? <Loader className="w-4 h-4 shrink-0 animate-spin" /> : <Power className="w-4 h-4 shrink-0" />}
                {floor?.enabled ? 'Turn walk-ins off' : 'Turn walk-ins on'}
              </button>
              <button
                onClick={() => setKiosk(true)}
                className="w-full h-11 min-h-[44px] px-3 rounded-xl border border-slate-700 text-sm font-semibold whitespace-nowrap flex items-center justify-center gap-2 active:scale-[0.99] transition-all"
              >
                <Lock className="w-4 h-4 shrink-0" /> Start kiosk mode
              </button>
            </div>
            {toggleError && <p className="text-xs text-rose-300">{toggleError}</p>}
            <p className="text-[11px] text-slate-400">
              Kiosk mode hides this bar on this device. Tap the studio name five times to bring it back.
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="pt-8 pb-2 text-center">
        <button
          type="button"
          onClick={tapStudioName}
          className="inline-flex items-center justify-center min-h-[44px] text-[11px] font-medium uppercase tracking-[0.25em] text-slate-400 px-4"
        >
          {studioName}
        </button>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-10 w-full max-w-lg mx-auto">

        {/* ── KIOSK SWITCHED OFF ── */}
        {kioskOff && (
          <div className="w-full text-center space-y-6">
            <div className="w-24 h-24 rounded-[2rem] bg-slate-100 flex items-center justify-center mx-auto">
              <Moon className="w-12 h-12 text-slate-400" />
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight">Not taking walk-ins</h1>
              <p className="text-slate-500 text-lg">
                {studioName} isn’t accepting walk-ins right now. You can still book a time online.
              </p>
            </div>
            <a
              href={`/book/${tenantId}`}
              className="inline-flex items-center justify-center gap-2 h-16 min-h-[44px] px-10 rounded-2xl bg-slate-900 text-white text-lg font-semibold shadow-xl shadow-slate-900/15"
            >
              Book an appointment <ArrowRight className="w-5 h-5" />
            </a>
          </div>
        )}

        {/* ── WELCOME ── */}
        {!kioskOff && step === 'welcome' && (
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
              <p className="text-slate-500 text-lg">No appointment? No problem.<br />Get in line and we’ll take you in turn.</p>
            </div>
            {floor && floor.open && (
              <div className="inline-flex items-center gap-2 text-sm text-slate-400">
                <Clock className="w-4 h-4" />
                <span>
                  {floor.queueLength > 0
                    ? `${floor.queueLength} ahead of you · about ${floor.estWaitMin || 5} min`
                    : 'No wait right now'}
                </span>
              </div>
            )}
            <div className="inline-flex items-center gap-2 h-16 min-h-[44px] px-10 rounded-2xl bg-slate-900 text-white text-lg font-semibold shadow-xl shadow-slate-900/15">
              {loading ? <Loader className="w-5 h-5 animate-spin" /> : <>Tap to start <ArrowRight className="w-5 h-5" /></>}
            </div>
          </button>
        )}

        {/* ── SERVICE PICK ── */}
        {!kioskOff && step === 'service' && (
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
                  className="w-full min-h-[44px] flex items-center gap-4 p-5 rounded-2xl border-2 border-slate-100 bg-white text-left hover:border-rose-200 active:scale-[0.99] transition-all"
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
            <button onClick={reset} className="w-full min-h-[44px] text-sm text-slate-400 py-2 flex items-center justify-center gap-1.5">
              <ArrowLeft className="w-4 h-4" /> Start over
            </button>
          </div>
        )}

        {/* ── DETAILS ── */}
        {!kioskOff && step === 'details' && service && (
          <div className="w-full space-y-6">
            <div className="text-center space-y-1">
              <h2 className="text-2xl font-semibold tracking-tight">Almost there</h2>
              <p className="text-sm text-slate-400">{service.name}{service.duration ? ` · ${service.duration} min` : ''}</p>
            </div>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-500 px-1">Your first &amp; last name</label>
                <div className="relative">
                  <User className="w-5 h-5 text-slate-300 absolute left-4 top-1/2 -translate-y-1/2" />
                  <input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Jordan Lee"
                    autoComplete="off"
                    className="w-full h-16 min-h-[44px] pl-12 pr-4 rounded-2xl border-2 border-slate-200 bg-white text-xl font-medium focus:border-rose-300 focus:outline-none"
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
                    className="w-full h-16 min-h-[44px] pl-12 pr-4 rounded-2xl border-2 border-slate-200 bg-white text-xl font-medium tracking-wide focus:border-rose-300 focus:outline-none"
                  />
                </div>
                <p className="text-[11px] text-slate-400 px-1">Been here before? Use the same number and we’ll recognize you.</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-500 px-1">How many in your party?</label>
                {/* A fixed six-column grid, not flex-wrap: wrapping would let a
                    lone "6" stretch to the full width and look like a mistake. */}
                <div className="grid grid-cols-6 gap-1.5">
                  {GROUP_CHOICES.map(n => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setGroupSize(n)}
                      className={cn(
                        'h-14 min-h-[44px] rounded-2xl border-2 text-lg font-semibold transition-all active:scale-95',
                        groupSize === n
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-200 bg-white text-slate-600',
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <button
              onClick={joinQueue}
              disabled={!name.trim() || !phone.trim()}
              className="w-full h-16 min-h-[44px] rounded-2xl bg-slate-900 text-white text-lg font-semibold shadow-xl shadow-slate-900/15 disabled:opacity-30 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
            >
              Put me in line <ArrowRight className="w-5 h-5" />
            </button>
            <button onClick={() => setStep('service')} className="w-full min-h-[44px] text-sm text-slate-400 py-1 flex items-center justify-center gap-1.5">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
          </div>
        )}

        {/* ── PLACING ── */}
        {!kioskOff && step === 'placing' && (
          <div className="text-center space-y-5 py-16">
            <Loader className="w-10 h-10 animate-spin text-rose-400 mx-auto" />
            <p className="text-lg font-medium text-slate-500">Adding you to the line…</p>
          </div>
        )}

        {/* ── SUCCESS ── */}
        {!kioskOff && step === 'success' && result && (
          <div className="w-full text-center space-y-7">
            <div className="w-24 h-24 rounded-[2rem] bg-emerald-50 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-12 h-12 text-emerald-500" />
            </div>
            <div className="space-y-2">
              <h2 className="text-3xl font-semibold tracking-tight">
                You’re in line{firstName(name) ? `, ${firstName(name)}` : ''}!
              </h2>
              <p className="text-lg text-slate-500">
                {result.alreadyInLine
                  ? 'You were already on the list — you’re all set.'
                  : result.staffName
                    ? <><span className="font-semibold text-slate-800">{firstName(result.staffName)}</span> has you — have a seat and they’ll come get you.</>
                    : 'Have a seat — the next provider free will come get you.'}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border-2 border-slate-100 bg-white px-4 py-5">
                <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-400">Your spot</p>
                <p className="text-3xl font-semibold mt-1">#{Number(result.position) || 1}</p>
                <p className="text-xs text-slate-400 mt-0.5">in line</p>
              </div>
              <div className="rounded-2xl border-2 border-slate-100 bg-white px-4 py-5">
                <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-400">Wait</p>
                <p className="text-3xl font-semibold mt-1">{result.assigned ? 'Now' : `${Number(result.estWaitMin) || 5}`}</p>
                <p className="text-xs text-slate-400 mt-0.5">{result.assigned ? 'ready for you' : 'minutes, roughly'}</p>
              </div>
            </div>

            {groupSize > 1 && (
              <p className="text-sm text-slate-400">Party of {groupSize} — let the front desk know if that changes.</p>
            )}
            <p className="sr-only">{waitLine}</p>

            <div className="flex items-center justify-center gap-1.5 text-sm text-slate-400">
              <Clock className="w-4 h-4" />
              <span>This screen resets itself for the next guest</span>
            </div>
            <button onClick={reset} className="mx-auto flex items-center gap-2 h-12 min-h-[44px] px-6 rounded-xl border-2 border-slate-200 text-sm font-medium text-slate-500 active:scale-95 transition-all">
              <RotateCcw className="w-4 h-4" /> Done — next guest
            </button>
          </div>
        )}

        {/* ── NOBODY FREE / ERROR ── */}
        {!kioskOff && step === 'full' && (
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
                    ? 'Want us to call you the moment someone opens up?'
                    : 'The front desk can add you to the waitlist or book you for later.'}
                </p>
              )}
            </div>

            {/* Waitlist offer — only when we actually have a way to reach them */}
            {canJoinWaitlist && waitState !== 'joined' && (
              <button
                onClick={joinWaitlist}
                disabled={waitState === 'joining'}
                className="w-full h-16 min-h-[44px] rounded-2xl bg-slate-900 text-white text-lg font-semibold shadow-xl shadow-slate-900/15 disabled:opacity-40 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
              >
                {waitState === 'joining'
                  ? <><Loader className="w-5 h-5 animate-spin" /> Adding you…</>
                  : <><BellRing className="w-5 h-5" /> Call me when you open up</>}
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
                'mx-auto flex items-center gap-2 min-h-[44px] transition-all active:scale-95',
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
