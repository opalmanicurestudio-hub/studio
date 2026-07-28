'use client';

// src/app/walk-in/[tenantId]/page.tsx
//
// v14 — WALK-IN KIOSK. Everything a guest standing at the counter needs, in the
// order a person actually needs it.
//
// v13 could do one thing: put a name in the line. It could not print a ticket,
// could not recognise a returning guest, could not let anyone ask for their
// provider by name, and collected consent nowhere — so a guest who needed a
// waiver was assigned a chair first and asked to sign afterwards, which is the
// wrong way round. It also had no way to show a guest their own waiting page.
//
// v14, in the order the screens appear:
//
//   1. NUMBER FIRST. The very first thing asked is the mobile number, because
//      it is the one field that can answer every other question. POST
//      action:'lookup' comes back with their first name, their usual service,
//      the provider they had last time, and — importantly — whether they are
//      ALREADY standing in this line, which is a far better answer than letting
//      them join twice.
//
//   2. "WELCOME BACK, ANN." One tap on "Gel manicure with Maya, same as last
//      time?" carries the service AND the provider forward. If Maya is free the
//      provider screen is skipped entirely: that is the one-tap rebook.
//
//   3. ASK FOR YOUR PROVIDER. Every provider who can do this service, each with
//      their own honest wait. Pick someone who is mid-service and the choice is
//      made explicit on screen, never guessed at:
//         "Wait for Maya — about 40 minutes"  vs  "Next available — about 10"
//      Asking for someone by name does not cost that provider their turn in the
//      rotation; the route handles that, this screen just offers the choice.
//
//   4. CONSENT BEFORE THE CHAIR. Required forms are signed HERE, at the kiosk,
//      before a spot is granted. A guest who cannot finish a waiver no longer
//      holds a chair while they work it out. The forms are rendered with the
//      same FormFieldRenderer the check-in portal uses, so the wording is
//      whatever the studio actually wrote. A service needing a patch test gets
//      its own screen — told plainly, never a countdown, never a dead end.
//
//   5. A REAL TICKET. Joining mints a checkInToken and a short code, so the
//      guest now has exactly what a booked client has: a printable ticket with
//      a scannable code, and a QR that opens their own live waiting page where
//      they can order from the lounge and see what else the studio offers. The
//      QR is drawn on screen too, so a guest can scan it with their phone even
//      if the printer is out of paper.
//
// Waits are always softened — "about 25 minutes", rounded, never a countdown.
// A clock that ticks down in a lobby only ever creates a conversation at the
// desk about why it lied.
//
// Unchanged from v13 because it worked: the kiosk is OFF until the owner turns
// it on (tenants/{id}.walkInKiosk.enabled), the owner controls it from a bar on
// this page, kiosk mode hides that bar on this device and five taps on the
// studio name brings it back, giant touch targets everywhere, and the screen
// resets itself between guests.

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { getApp } from 'firebase/app';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, getDoc, getDocs, updateDoc, collection } from 'firebase/firestore';
import { cn } from '@/lib/utils';
import { FormFieldRenderer } from '@/components/consents/FormFieldRenderer';
import { printAppointmentTicket } from '@/lib/appointment-ticket';
import { qrSvg } from '@/lib/scan-codes';
import {
  Sparkles, ArrowRight, ArrowLeft, Loader, CheckCircle2,
  Phone, User, Clock, Scissors, RotateCcw, Frown, BellRing,
  Users, Power, Lock, Moon, Star, Printer, ShieldCheck, PenLine,
  AlertTriangle, UserCheck, Check, Ticket, Hourglass, ChevronRight, Coffee,
  Mail,
} from 'lucide-react';

type Step =
  | 'welcome'
  | 'phone'
  | 'looking'
  | 'recognize'
  | 'service'
  | 'options'
  | 'provider'
  | 'details'
  | 'consent'
  | 'patch'
  | 'placing'
  | 'success'
  | 'full';

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

type ProviderOption = {
  id: string;
  name: string;
  firstName: string;
  avatarUrl: string;
  title: string;
  readyNow: boolean;
  estWaitMin: number;
};

const IDLE_RESET_MS = 90 * 1000;
// The consent screen is the one place a guest is genuinely reading, and reading
// is not typing — an idle timer that cannot tell the difference would wipe a
// half-signed waiver out from under them.
const CONSENT_IDLE_RESET_MS = 6 * 60 * 1000;
const SUCCESS_RESET_MS = 40 * 1000;
const FLOOR_POLL_MS = 30 * 1000;
const GROUP_CHOICES = [1, 2, 3, 4, 5, 6];

const lockKey = (tenantId: string) => `cf-walkin-kiosk-mode-${tenantId}`;

const fmtPrice = (p: any) => {
  const n = Number(p);
  return Number.isFinite(n) && n > 0 ? `$${n.toFixed(0)}` : '';
};

const firstNameOf = (v: any) => String(v || '').trim().split(/\s+/)[0] || '';

const digitsOf = (v: any) => String(v || '').replace(/\D/g, '');

/**
 * Is this worth saving as an email address?
 *
 * Deliberately loose — one @, something before it, a dot after it, no spaces.
 * A kiosk is not the place to argue with a guest about their own address, but a
 * half-typed one is worse than none: it lands on the client record and quietly
 * bounces every receipt and reminder after that.
 */
const looksLikeEmail = (v: any): boolean => {
  const s = String(v || '').trim();
  return s.length >= 6 && s.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
};

/**
 * Every wait this page shows, in words.
 *
 * Rounded to the nearest five minutes and prefixed with "about", because the
 * number is an estimate built from an average service length and it should look
 * like one. A guest told "12 minutes" starts watching a clock; a guest told
 * "about 15 minutes" waits.
 */
const softWait = (mins: any): string => {
  const n = Number(mins);
  if (!Number.isFinite(n) || n <= 0) return 'Ready for you now';
  if (n < 5) return 'A few minutes';
  const rounded = Math.round(n / 5) * 5;
  return `About ${rounded} minutes`;
};

/** The short form, for chips and cards where a sentence will not fit. */
const shortWait = (mins: any): string => {
  const n = Number(mins);
  if (!Number.isFinite(n) || n <= 0) return 'Free now';
  if (n < 5) return '~5 min';
  return `~${Math.round(n / 5) * 5} min`;
};

const lastVisitLabel = (iso: any): string => {
  const ms = Date.parse(String(iso || ''));
  if (!Number.isFinite(ms)) return '';
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days < 0) return '';
  if (days === 0) return 'earlier today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.max(1, Math.round(days / 30))} months ago`;
};

/** Prettifies a 10-digit number as the guest types, and leaves anything else alone. */
const formatPhone = (raw: string): string => {
  const d = digitsOf(raw).slice(0, 11);
  const n = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  if (n.length <= 3) return n;
  if (n.length <= 6) return `(${n.slice(0, 3)}) ${n.slice(3)}`;
  return `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6, 10)}`;
};

/** A consent field is only blocking when the studio marked it required. */
const isBlank = (v: any): boolean => {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'boolean') return v === false;
  return false;
};

export default function WalkInKioskPage() {
  const params = useParams();
  const tenantId = params?.tenantId as string;

  const [tenant, setTenant] = useState<any>(null);
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [floor, setFloor] = useState<Floor | null>(null);

  const [step, setStep] = useState<Step>('welcome');

  // Identity
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  // Email. /api/walkins has ALWAYS been able to store this — it dedupes a client
  // on email as well as phone, stamps clientEmail on the check-in record and on
  // bookingCompletions — and this screen never asked for it, so every one of
  // those fields sat empty. A walk-in with no email cannot be sent a receipt, a
  // rebooking reminder, or a review request. It is optional on purpose: nobody
  // should be blocked from a haircut over a typo.
  const [email, setEmail] = useState('');
  const [lookup, setLookup] = useState<any>(null);

  // What they're having, and who with
  const [service, setService] = useState<any>(null);
  const [options, setOptions] = useState<any>(null);
  const [chosen, setChosen] = useState<ProviderOption | null>(null);
  const [preferredStaffId, setPreferredStaffId] = useState('');
  const [waitForPreferred, setWaitForPreferred] = useState(false);
  const [groupSize, setGroupSize] = useState(1);

  // Requirements
  const [forms, setForms] = useState<any[]>([]);
  const [answers, setAnswers] = useState<Record<string, Record<string, any>>>({});
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [guardians, setGuardians] = useState<Record<string, { name: string; relationship: string }>>({});
  const [signature, setSignature] = useState('');
  const [consentError, setConsentError] = useState('');
  const [patchInfo, setPatchInfo] = useState<{ validityMonths: number } | null>(null);

  // Outcome
  const [result, setResult] = useState<any>(null);
  const [failMessage, setFailMessage] = useState('');
  const [waitState, setWaitState] = useState<WaitState>('idle');
  const [waitMessage, setWaitMessage] = useState('');
  const [printError, setPrintError] = useState('');
  const [printed, setPrinted] = useState(false);

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
    setStep('welcome');
    setPhone(''); setName(''); setEmail(''); setLookup(null);
    setService(null); setOptions(null); setChosen(null);
    setPreferredStaffId(''); setWaitForPreferred(false); setGroupSize(1);
    setForms([]); setAnswers({}); setAccepted({}); setGuardians({});
    setSignature(''); setConsentError(''); setPatchInfo(null);
    setResult(null); setFailMessage('');
    setWaitState('idle'); setWaitMessage('');
    setPrintError(''); setPrinted(false);
    joinLock.current = false;
  }, []);

  const idleTimer = useRef<any>(null);
  useEffect(() => {
    if (step === 'welcome') return;
    // The "full" screen asks the guest to make one more decision, so it keeps
    // the full idle window until they have answered it; once they're on the
    // waitlist it clears itself as quickly as the success screen does.
    const settled = step === 'success' || (step === 'full' && waitState === 'joined');
    const reading = step === 'consent' || step === 'patch';
    const ms = settled ? SUCCESS_RESET_MS : reading ? CONSENT_IDLE_RESET_MS : IDLE_RESET_MS;
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(reset, ms);
    return () => clearTimeout(idleTimer.current);
  }, [step, name, phone, service, groupSize, waitState, chosen, signature, answers, accepted, reset]);

  const post = useCallback(async (payload: any) => {
    const res = await fetch('/api/walkins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, ...payload }),
    });
    return await res.json().catch(() => ({} as any));
  }, [tenantId]);

  // ── 1. The number ─────────────────────────────────────────────────────────
  const submitPhone = async () => {
    if (digitsOf(phone).length < 7) return;
    setStep('looking');
    try {
      const d = await post({ action: 'lookup', phone });
      setLookup(d?.ok ? d : null);
      // Already standing in this line? Show them their spot instead of letting
      // them take a second one.
      if (d?.ok && d.found && d.alreadyInLine?.walkInId) {
        setResult({
          alreadyInLine: true,
          position: Number(d.alreadyInLine.position) || 1,
          estWaitMin: Number(d.alreadyInLine.estWaitMin) || 0,
          checkInToken: d.alreadyInLine.checkInToken || '',
          shortCode: d.alreadyInLine.shortCode || '',
          serviceName: d.alreadyInLine.serviceName || '',
          staffName: '',
          clientName: d.firstName || '',
        });
        setName(d.firstName || '');
        setStep('success');
        return;
      }
      if (d?.ok && d.found) {
        setName(d.firstName || '');
        setStep(d.usual?.serviceId ? 'recognize' : 'service');
        return;
      }
      setStep('service');
    } catch {
      // A failed lookup is not a failed visit — carry on as a new guest.
      setLookup(null);
      setStep('service');
    }
  };

  // ── 2/3. Service, then who takes them ─────────────────────────────────────
  const chooseService = async (svc: any, preferredId?: string | null) => {
    if (!svc?.id) return;
    setService(svc);
    setOptions(null);
    setChosen(null);
    setPreferredStaffId('');
    setWaitForPreferred(false);
    setStep('options');
    try {
      const d = await post({ action: 'options', serviceId: svc.id, phone });
      if (!d?.ok) {
        setFailMessage(d?.error || 'That service is not available for walk-ins right now.');
        setStep('full');
        return;
      }
      setOptions(d);
      setForms(Array.isArray(d.consent?.forms) ? d.consent.forms : []);

      const list: ProviderOption[] = Array.isArray(d.providers) ? d.providers : [];
      if (!list.length) {
        setFailMessage('Nobody is taking walk-ins for that service at the moment.');
        setStep('full');
        return;
      }
      // The one-tap rebook: they asked for the provider they had last time and
      // that provider is free right now, so there is nothing left to decide.
      if (preferredId) {
        const p = list.find(x => String(x.id) === String(preferredId)) || null;
        if (p) {
          setChosen(p);
          if (p.readyNow) {
            setPreferredStaffId(p.id);
            setWaitForPreferred(false);
            setStep('details');
            return;
          }
          // Busy — the choice gets made on screen, in words, on the next step.
          setStep('provider');
          return;
        }
      }
      setStep('provider');
    } catch {
      setFailMessage('Something hiccuped — please see the front desk and we’ll get you in.');
      setStep('full');
    }
  };

  const takeNextAvailable = () => {
    setPreferredStaffId('');
    setWaitForPreferred(false);
    setChosen(null);
    setStep('details');
  };

  const confirmWaitFor = (p: ProviderOption) => {
    setPreferredStaffId(p.id);
    setWaitForPreferred(true);
    setStep('details');
  };

  const pickProvider = (p: ProviderOption) => {
    setChosen(p);
    if (p.readyNow) {
      setPreferredStaffId(p.id);
      setWaitForPreferred(false);
      setStep('details');
    }
    // Not ready: stay on this step and let the two-way choice panel render.
  };

  // ── 4. What still has to happen before a chair ────────────────────────────
  const outstandingFormIds: string[] = useMemo(
    () => (Array.isArray(options?.consent?.formIds) ? options.consent.formIds.map((s: any) => String(s)) : []),
    [options],
  );
  const patchNeeded = !!options?.consent?.patchTestRequired && !options?.consent?.patchTestOnFile;

  const afterDetails = () => {
    if (outstandingFormIds.length) { setStep('consent'); return; }
    if (patchNeeded) { setStep('patch'); return; }
    void join(false);
  };

  const submitConsent = () => {
    setConsentError('');
    if (!signature.trim() || signature.trim().length < 2) {
      setConsentError('Please type your name to sign.');
      return;
    }
    for (const f of forms) {
      if (!accepted[f.id]) {
        setConsentError('Please agree to each form before continuing.');
        return;
      }
      const missing = (Array.isArray(f.fields) ? f.fields : []).some(
        (fl: any) => fl?.required === true && isBlank(answers[f.id]?.[fl.id]),
      );
      if (missing) {
        setConsentError('Please answer every required question.');
        return;
      }
      if (f.requiresGuardianSignature && !String(guardians[f.id]?.name || '').trim()) {
        setConsentError('A parent or guardian needs to sign this one.');
        return;
      }
    }
    if (patchNeeded) { setStep('patch'); return; }
    void join(false);
  };

  // ── 5. Joining the line ───────────────────────────────────────────────────
  const join = async (acknowledgePatchTest: boolean) => {
    if (!service || !name.trim() || !phone.trim()) return;
    if (joinLock.current) return;
    joinLock.current = true;
    setStep('placing');

    const signedForms = forms.map((f: any) => ({
      formId: f.id,
      formTitle: f.title || '',
      formData: {
        ...(answers[f.id] || {}),
        signedName: signature.trim(),
        signedVia: 'walk-in kiosk',
      },
      ...(f.requiresGuardianSignature
        ? {
            guardianName: String(guardians[f.id]?.name || '').trim(),
            guardianRelationship: String(guardians[f.id]?.relationship || '').trim(),
          }
        : {}),
    }));

    try {
      const d = await post({
        action: 'join',
        name: name.trim(),
        phone: phone.trim(),
        // Only sent when it looks like an address. An empty string or a typo
        // like "jordan@" would otherwise be written onto the client record and
        // then bounce every receipt from that day forward.
        ...(looksLikeEmail(email) ? { email: email.trim() } : {}),
        serviceId: service.id,
        groupSize,
        preferredStaffId,
        waitForPreferred,
        acknowledgePatchTest,
        ...(signedForms.length ? { signedForms } : {}),
      });
      joinLock.current = false;

      // The route re-checks requirements at join time, which is the only check
      // that counts — the options call happened a minute and several taps ago.
      if (d && d.ok === false && d.consentRequired) {
        setForms(Array.isArray(d.forms) ? d.forms : forms);
        setConsentError(d.error || 'Please finish the consent form for this service.');
        setStep('consent');
        return;
      }
      if (d && d.ok === false && d.patchTestRequired) {
        setPatchInfo({ validityMonths: Number(d.validityMonths) || 6 });
        setStep('patch');
        return;
      }
      if (d?.ok) {
        setResult(d);
        setStep('success');
        refreshFloor();
        return;
      }
      if (d?.closed) {
        setFailMessage('Walk-ins have just been switched off — please see the front desk.');
      } else {
        setFailMessage(d?.error || 'Nobody is free to take you right now.');
      }
      setStep('full');
      refreshFloor();
    } catch {
      joinLock.current = false;
      setFailMessage('Something hiccuped — please see the front desk and we’ll get you in.');
      setStep('full');
    }
  };

  // ── The ticket ────────────────────────────────────────────────────────────
  // The walk-in row carries a checkInToken and a short code exactly like a
  // booked appointment, so the same printer this studio already uses at the
  // front desk produces the same ticket — a scannable studio copy and a guest
  // stub whose QR opens their own waiting page.
  const printTicket = useCallback((): boolean => {
    if (!result?.checkInToken && !result?.shortCode) return false;
    const t: any = tenant || {};
    const svcName = result.serviceName || service?.name || '';
    const dollars = Number(service?.price);
    const opened = printAppointmentTicket(
      {
        id: result.walkInId || null,
        clientName: result.clientName || name || null,
        checkInToken: result.checkInToken || null,
        shortCode: result.shortCode || null,
        status: 'confirmed',
        checkInStatus: 'arrived',
      },
      {
        kind: 'walkin',
        queuePosition: Number(result.position) || 0,
        queueWaitMinutes: (result.assigned || result.needsFrontDesk) ? 0 : Number(result.estWaitMin) || 0,
        queueNote: result.assigned
          ? `${firstNameOf(result.staffName) || 'Your provider'} is ready for you now`
          // No tech qualifies for this service on the floor right now, so the
          // ticket must not print a wait time we cannot stand behind. Send them
          // to a human instead.
          : result.needsFrontDesk
            ? 'Please check in at the front desk'
            : result.waitingForRequested
            ? `Waiting for ${firstNameOf(result.staffName) || 'your provider'} · ${softWait(result.estWaitMin)}`
            : '',
        studioName: t.name || null,
        studioPhone: t.phone || null,
        studioEmail: t.email || null,
        studioAddress: t.address || null,
        clientName: result.clientName || name || null,
        clientPhone: phone || null,
        serviceName: svcName || null,
        staffName: result.staffName || null,
        priceCents: Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : null,
        origin: typeof window !== 'undefined' ? window.location.origin : null,
        footerNote: groupSize > 1 ? `Party of ${groupSize}` : null,
      },
    );
    return opened;
  }, [result, tenant, service, name, phone, groupSize]);

  const handlePrint = () => {
    const opened = printTicket();
    setPrinted(opened);
    setPrintError(
      opened
        ? ''
        : 'Your browser blocked the ticket window. Allow popups for this site, then tap Print again.',
    );
  };

  // One quiet automatic attempt, so a kiosk with a printer beside it does the
  // obvious thing. A blocked popup is NOT surfaced here — the guest did not ask
  // for it yet, and a scary red banner on a success screen is worse than no
  // paper. The button below is the one that reports failures.
  const autoPrinted = useRef('');
  useEffect(() => {
    if (step !== 'success') return;
    const token = String(result?.checkInToken || result?.shortCode || '');
    if (!token || autoPrinted.current === token) return;
    autoPrinted.current = token;
    if (result?.alreadyInLine) return;
    try { if (printTicket()) setPrinted(true); } catch { /* the button is still there */ }
  }, [step, result, printTicket]);

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

  const providerList: ProviderOption[] = useMemo(
    () => (Array.isArray(options?.providers) ? options.providers : []),
    [options],
  );
  const nextAvail = options?.nextAvailable || null;

  const checkInUrl = useMemo(() => {
    const token = String(result?.checkInToken || '').trim();
    if (!token) return '';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return origin ? `${origin}/check-in/${token}` : '';
  }, [result]);

  const qrMarkup = useMemo(() => {
    if (!checkInUrl) return '';
    try { return qrSvg(checkInUrl, 132) || ''; } catch { return ''; }
  }, [checkInUrl]);

  const waitLine = useMemo(() => {
    if (result?.assigned) return 'Ready for you now';
    // needsFrontDesk means the route put her in the queue but could not find a
    // tech the service rules allow — usually a required skill or certification
    // nobody's profile lists. There is no honest estimate to give, so we do not
    // invent one. "See the desk" is the true answer.
    if (result?.needsFrontDesk) return 'See the desk';
    return softWait(result?.estWaitMin);
  }, [result]);

  const needsName = !lookup?.found;

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

      <main className="flex-1 flex flex-col items-center justify-center px-5 sm:px-6 pb-10 w-full max-w-lg mx-auto">

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
            onClick={() => setStep('phone')}
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
                    ? `${floor.queueLength} ahead of you · ${softWait(floor.estWaitMin || 5).toLowerCase()}`
                    : 'No wait right now'}
                </span>
              </div>
            )}
            <div className="inline-flex items-center gap-2 h-16 min-h-[44px] px-10 rounded-2xl bg-slate-900 text-white text-lg font-semibold shadow-xl shadow-slate-900/15">
              {loading ? <Loader className="w-5 h-5 animate-spin" /> : <>Tap to start <ArrowRight className="w-5 h-5" /></>}
            </div>
          </button>
        )}

        {/* ── PHONE FIRST ── one field, and it unlocks everything else ── */}
        {!kioskOff && step === 'phone' && (
          <div className="w-full space-y-6">
            <div className="text-center space-y-1.5">
              <div className="w-16 h-16 rounded-2xl bg-rose-50 flex items-center justify-center mx-auto mb-3">
                <Phone className="w-8 h-8 text-rose-500" />
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">What’s your mobile number?</h2>
              <p className="text-sm text-slate-400">
                Been here before? We’ll pull up your usual. New here? This is how we’ll reach you when it’s your turn.
              </p>
            </div>
            <div className="relative">
              <input
                value={phone}
                onChange={e => setPhone(formatPhone(e.target.value))}
                onKeyDown={e => { if (e.key === 'Enter') submitPhone(); }}
                placeholder="(555) 123-4567"
                inputMode="tel"
                autoComplete="off"
                autoFocus
                className="w-full h-20 min-h-[44px] px-5 rounded-2xl border-2 border-slate-200 bg-white text-center text-3xl font-semibold tracking-wide focus:border-rose-300 focus:outline-none"
              />
            </div>
            <button
              onClick={submitPhone}
              disabled={digitsOf(phone).length < 7}
              className="w-full h-16 min-h-[44px] rounded-2xl bg-slate-900 text-white text-lg font-semibold shadow-xl shadow-slate-900/15 disabled:opacity-30 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
            >
              Continue <ArrowRight className="w-5 h-5" />
            </button>
            <button onClick={reset} className="w-full min-h-[44px] text-sm text-slate-400 py-1 flex items-center justify-center gap-1.5">
              <ArrowLeft className="w-4 h-4" /> Start over
            </button>
          </div>
        )}

        {/* ── LOOKING / LOADING OPTIONS ── */}
        {!kioskOff && (step === 'looking' || step === 'options') && (
          <div className="text-center space-y-5 py-16">
            <Loader className="w-10 h-10 animate-spin text-rose-400 mx-auto" />
            <p className="text-lg font-medium text-slate-500">
              {step === 'looking' ? 'One moment…' : 'Checking who’s free…'}
            </p>
          </div>
        )}

        {/* ── WELCOME BACK ── the one-tap rebook ── */}
        {!kioskOff && step === 'recognize' && lookup?.usual && (
          <div className="w-full space-y-6">
            <div className="text-center space-y-1.5">
              <div className="w-16 h-16 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-3">
                <UserCheck className="w-8 h-8 text-emerald-600" />
              </div>
              <h2 className="text-3xl font-semibold tracking-tight">
                Welcome back{lookup.firstName ? `, ${lookup.firstName}` : ''}
              </h2>
              <p className="text-sm text-slate-400">
                {lookup.usual.lastVisit
                  ? `You were in ${lastVisitLabel(lookup.usual.lastVisit)}.`
                  : 'Good to see you again.'}
              </p>
            </div>

            <button
              onClick={() => {
                const svc = services.find((s: any) => s.id === lookup.usual.serviceId)
                  || { id: lookup.usual.serviceId, name: lookup.usual.serviceName, duration: lookup.usual.durationMin };
                chooseService(svc, lookup.usual.staffAvailableToday ? lookup.usual.staffId : null);
              }}
              className="w-full text-left p-5 rounded-2xl border-2 border-slate-900 bg-slate-900 text-white active:scale-[0.99] transition-all"
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Same as last time</p>
              <p className="text-xl font-semibold mt-1.5">{lookup.usual.serviceName || 'Your usual'}</p>
              {lookup.usual.staffFirstName && (
                <p className="text-sm text-slate-300 mt-1 flex items-center gap-1.5">
                  <Star className="w-3.5 h-3.5" />
                  with {lookup.usual.staffFirstName}
                  {lookup.usual.staffAvailableToday === false && ' — not in today, we’ll find you someone'}
                </p>
              )}
              <span className="mt-4 inline-flex items-center gap-2 text-sm font-semibold">
                Yes, that please <ArrowRight className="w-4 h-4" />
              </span>
            </button>

            <button
              onClick={() => setStep('service')}
              className="w-full min-h-[44px] h-14 rounded-2xl border-2 border-slate-200 bg-white text-base font-semibold text-slate-700 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
            >
              Something else today <ChevronRight className="w-4 h-4" />
            </button>
            <button onClick={reset} className="w-full min-h-[44px] text-sm text-slate-400 py-1 flex items-center justify-center gap-1.5">
              <ArrowLeft className="w-4 h-4" /> Not you? Start over
            </button>
          </div>
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
                  onClick={() => chooseService(s, null)}
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

        {/* ── WHO TAKES THEM ── */}
        {!kioskOff && step === 'provider' && (
          <div className="w-full space-y-5">
            <div className="text-center space-y-1">
              <h2 className="text-2xl font-semibold tracking-tight">Anyone in mind?</h2>
              <p className="text-sm text-slate-400">
                {options?.serviceName || service?.name}
                {options?.durationMin ? ` · about ${options.durationMin} min` : ''}
              </p>
            </div>

            {/* The explicit two-way choice. This panel is the whole point: a
                guest who asks for someone mid-service is told what waiting for
                them actually costs, in minutes, and offered the alternative in
                the same breath. Nothing is decided for them. */}
            {chosen && !chosen.readyNow && (
              <div className="w-full rounded-2xl border-2 border-amber-200 bg-amber-50/70 p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <Hourglass className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">
                      {chosen.firstName} is with someone right now
                    </p>
                    <p className="text-sm text-slate-600 mt-0.5">
                      You can wait for {chosen.firstName}, or take whoever is free first. Either way you keep your place in line.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => confirmWaitFor(chosen)}
                  className="w-full min-h-[44px] h-16 rounded-2xl bg-slate-900 text-white font-semibold active:scale-[0.99] transition-all flex items-center justify-between px-5"
                >
                  <span className="flex items-center gap-2"><Star className="w-4 h-4" /> Wait for {chosen.firstName}</span>
                  <span className="text-sm font-medium text-slate-300">{softWait(chosen.estWaitMin)}</span>
                </button>
                <button
                  onClick={takeNextAvailable}
                  className="w-full min-h-[44px] h-16 rounded-2xl border-2 border-slate-300 bg-white font-semibold text-slate-800 active:scale-[0.99] transition-all flex items-center justify-between px-5"
                >
                  <span className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-rose-500" /> Next available</span>
                  <span className="text-sm font-medium text-slate-400">
                    {nextAvail?.readyNow ? 'Ready now' : softWait(nextAvail?.estWaitMin)}
                  </span>
                </button>
                <button
                  onClick={() => setChosen(null)}
                  className="w-full min-h-[44px] text-sm text-slate-500 py-1 flex items-center justify-center gap-1.5"
                >
                  <ArrowLeft className="w-4 h-4" /> Pick someone else
                </button>
              </div>
            )}

            {!chosen && (
              <>
                <button
                  onClick={takeNextAvailable}
                  className="w-full flex items-center gap-4 p-5 rounded-2xl border-2 border-slate-900 bg-slate-900 text-white text-left active:scale-[0.99] transition-all min-h-[44px]"
                >
                  <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-lg">Next available</p>
                    <p className="text-sm text-slate-300">
                      {nextAvail?.readyNow
                        ? `${nextAvail.providerFirstName || 'Someone'} can take you now`
                        : softWait(nextAvail?.estWaitMin)}
                    </p>
                  </div>
                  <ArrowRight className="w-5 h-5 shrink-0" />
                </button>

                {providerList.length > 0 && (
                  <p className="text-center text-xs font-medium uppercase tracking-[0.18em] text-slate-400 pt-1">
                    Or ask for someone
                  </p>
                )}

                <div className="space-y-2.5 max-h-[42dvh] overflow-y-auto pr-1">
                  {providerList.map((p: ProviderOption) => {
                    const isUsual = !!lookup?.usual?.staffId && String(lookup.usual.staffId) === String(p.id);
                    return (
                      <button
                        key={p.id}
                        onClick={() => pickProvider(p)}
                        className="w-full min-h-[44px] flex items-center gap-4 p-4 rounded-2xl border-2 border-slate-100 bg-white text-left hover:border-rose-200 active:scale-[0.99] transition-all"
                      >
                        <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center shrink-0 overflow-hidden">
                          {p.avatarUrl
                            ? <img src={p.avatarUrl} alt="" className="w-full h-full object-cover" />
                            : <span className="text-base font-semibold">{(p.firstName || '?').slice(0, 1)}</span>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-lg truncate flex items-center gap-1.5">
                            {p.firstName || p.name}
                            {isUsual && <Star className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                          </p>
                          <p className="text-sm text-slate-400 truncate">
                            {p.readyNow ? 'Free now' : `Busy · ${shortWait(p.estWaitMin)}`}
                            {p.title ? ` · ${p.title}` : ''}
                          </p>
                        </div>
                        {p.readyNow
                          ? <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1 shrink-0">Free</span>
                          : <span className="text-sm font-medium text-slate-400 shrink-0">{shortWait(p.estWaitMin)}</span>}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            <button onClick={() => setStep('service')} className="w-full min-h-[44px] text-sm text-slate-400 py-1 flex items-center justify-center gap-1.5">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
          </div>
        )}

        {/* ── DETAILS ── name only if we don't already know them ── */}
        {!kioskOff && step === 'details' && service && (
          <div className="w-full space-y-6">
            <div className="text-center space-y-1">
              <h2 className="text-2xl font-semibold tracking-tight">Almost there</h2>
              <p className="text-sm text-slate-400">
                {options?.serviceName || service.name}
                {chosen?.firstName ? ` · with ${chosen.firstName}` : ''}
              </p>
            </div>

            {!needsName && (
              <div className="rounded-2xl border-2 border-emerald-100 bg-emerald-50/60 px-5 py-4 flex items-center gap-3">
                <UserCheck className="w-5 h-5 text-emerald-600 shrink-0" />
                <p className="text-sm text-emerald-800">
                  We have you as <span className="font-semibold">{name || 'a returning guest'}</span>.
                </p>
              </div>
            )}

            <div className="space-y-4">
              {needsName && (
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
              )}
              {/* Email — optional, and it says so, because the tap-through rate
                  on a required email at a kiosk is where guests give up and walk
                  out. The Continue button below is NOT gated on it. */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-500 px-1">
                  Email <span className="text-slate-300 font-normal">— optional, for your receipt</span>
                </label>
                <div className="relative">
                  <Mail className="w-5 h-5 text-slate-300 absolute left-4 top-1/2 -translate-y-1/2" />
                  <input
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@email.com"
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    className="w-full h-16 min-h-[44px] pl-12 pr-12 rounded-2xl border-2 border-slate-200 bg-white text-lg font-medium focus:border-rose-300 focus:outline-none"
                  />
                  {/* A quiet tick once it parses. No red error state — nagging a
                      guest about a field they were told was optional is rude. */}
                  {looksLikeEmail(email) && (
                    <Check className="w-5 h-5 text-emerald-500 absolute right-4 top-1/2 -translate-y-1/2" />
                  )}
                </div>
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

            {outstandingFormIds.length > 0 && (
              <div className="rounded-2xl border-2 border-slate-100 bg-slate-50 px-5 py-4 flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-slate-500 shrink-0 mt-0.5" />
                <p className="text-sm text-slate-600">
                  One quick form to sign next — it takes a moment and then you’re in line.
                </p>
              </div>
            )}

            <button
              onClick={afterDetails}
              disabled={!name.trim()}
              className="w-full h-16 min-h-[44px] rounded-2xl bg-slate-900 text-white text-lg font-semibold shadow-xl shadow-slate-900/15 disabled:opacity-30 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
            >
              {outstandingFormIds.length > 0 ? 'Next' : 'Put me in line'} <ArrowRight className="w-5 h-5" />
            </button>
            <button
              onClick={() => setStep('provider')}
              className="w-full min-h-[44px] text-sm text-slate-400 py-1 flex items-center justify-center gap-1.5"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
          </div>
        )}

        {/* ── CONSENT, BEFORE A CHAIR IS GIVEN AWAY ── */}
        {!kioskOff && step === 'consent' && (
          <div className="w-full space-y-5">
            <div className="text-center space-y-1.5">
              <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-2">
                <ShieldCheck className="w-8 h-8 text-slate-600" />
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">
                {forms.length > 1 ? 'A couple of quick forms' : 'One quick form'}
              </h2>
              <p className="text-sm text-slate-400">
                {options?.serviceName || service?.name} needs this on file before we start.
              </p>
            </div>

            <div className="space-y-4 max-h-[52dvh] overflow-y-auto pr-1">
              {forms.map((f: any) => (
                <div key={f.id} className="rounded-2xl border-2 border-slate-100 bg-white p-5 space-y-4">
                  <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
                    <PenLine className="w-4 h-4 text-rose-500 shrink-0" />
                    <h3 className="text-base font-semibold leading-tight">{f.title}</h3>
                  </div>

                  {(Array.isArray(f.fields) ? f.fields : []).map((fl: any) => (
                    <FormFieldRenderer
                      key={fl.id}
                      field={fl}
                      value={answers[f.id]?.[fl.id]}
                      onChange={(val: any) =>
                        setAnswers(prev => ({ ...prev, [f.id]: { ...(prev[f.id] || {}), [fl.id]: val } }))
                      }
                    />
                  ))}

                  {f.requiresGuardianSignature && (
                    <div className="pt-3 border-t border-dashed border-slate-200 space-y-2.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700">
                        Parent or guardian
                      </p>
                      <input
                        value={guardians[f.id]?.name || ''}
                        onChange={e =>
                          setGuardians(prev => ({
                            ...prev,
                            [f.id]: { name: e.target.value, relationship: prev[f.id]?.relationship || '' },
                          }))
                        }
                        placeholder="Guardian full name"
                        className="w-full h-14 min-h-[44px] px-4 rounded-xl border-2 border-slate-200 bg-white text-base focus:border-rose-300 focus:outline-none"
                      />
                      <input
                        value={guardians[f.id]?.relationship || ''}
                        onChange={e =>
                          setGuardians(prev => ({
                            ...prev,
                            [f.id]: { name: prev[f.id]?.name || '', relationship: e.target.value },
                          }))
                        }
                        placeholder="Relationship to guest"
                        className="w-full h-14 min-h-[44px] px-4 rounded-xl border-2 border-slate-200 bg-white text-base focus:border-rose-300 focus:outline-none"
                      />
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => setAccepted(prev => ({ ...prev, [f.id]: !prev[f.id] }))}
                    className={cn(
                      'w-full min-h-[44px] flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all active:scale-[0.99]',
                      accepted[f.id] ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white',
                    )}
                  >
                    <span
                      className={cn(
                        'w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 mt-0.5',
                        accepted[f.id] ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300',
                      )}
                    >
                      {accepted[f.id] && <Check className="w-4 h-4" />}
                    </span>
                    <span className="text-sm font-medium text-slate-700">
                      I have read and agree to {f.title}.
                    </span>
                  </button>
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-500 px-1">Type your name to sign</label>
              <input
                value={signature}
                onChange={e => setSignature(e.target.value)}
                placeholder={name || 'Your full name'}
                autoComplete="off"
                className="w-full h-16 min-h-[44px] px-4 rounded-2xl border-2 border-slate-200 bg-white text-xl focus:border-rose-300 focus:outline-none"
                style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
              />
              <p className="text-[11px] text-slate-400 px-1">
                Signed today at the kiosk. Valid for 18 months, so you won’t be asked again next time.
              </p>
            </div>

            {consentError && (
              <p className="text-sm text-rose-600 flex items-center gap-1.5 px-1">
                <AlertTriangle className="w-4 h-4 shrink-0" /> {consentError}
              </p>
            )}

            <button
              onClick={submitConsent}
              className="w-full h-16 min-h-[44px] rounded-2xl bg-slate-900 text-white text-lg font-semibold shadow-xl shadow-slate-900/15 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
            >
              Sign and get in line <ArrowRight className="w-5 h-5" />
            </button>
            <button onClick={() => setStep('details')} className="w-full min-h-[44px] text-sm text-slate-400 py-1 flex items-center justify-center gap-1.5">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
          </div>
        )}

        {/* ── PATCH TEST ── told plainly, not a dead end ── */}
        {!kioskOff && step === 'patch' && (
          <div className="w-full space-y-6">
            <div className="text-center space-y-2">
              <div className="w-20 h-20 rounded-[1.75rem] bg-amber-50 flex items-center justify-center mx-auto">
                <AlertTriangle className="w-10 h-10 text-amber-500" />
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">This one needs a patch test</h2>
              <p className="text-slate-500">
                {options?.serviceName || service?.name} needs a patch test at least 24 hours beforehand, and we don’t
                have a recent one on file for you.
              </p>
              <p className="text-sm text-slate-400">
                If you’ve had one done here in the last {patchInfo?.validityMonths || 6} months, the front desk can
                confirm it and we’ll get you straight in.
              </p>
            </div>

            <button
              onClick={() => join(true)}
              className="w-full h-16 min-h-[44px] rounded-2xl bg-slate-900 text-white text-lg font-semibold shadow-xl shadow-slate-900/15 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
            >
              I’ve had one — get in line <ArrowRight className="w-5 h-5" />
            </button>
            <p className="text-center text-[11px] text-slate-400 px-4">
              Your provider will confirm this with you before starting.
            </p>
            <button onClick={() => setStep('service')} className="w-full min-h-[44px] h-14 rounded-2xl border-2 border-slate-200 bg-white text-base font-semibold text-slate-700 flex items-center justify-center gap-2 active:scale-[0.99] transition-all">
              Pick a different service
            </button>
            <button onClick={reset} className="w-full min-h-[44px] text-sm text-slate-400 py-1 flex items-center justify-center gap-1.5">
              <ArrowLeft className="w-4 h-4" /> Start over
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

        {/* ── SUCCESS ── ticket, code, and the QR that opens their waiting page ── */}
        {!kioskOff && step === 'success' && result && (
          <div className="w-full text-center space-y-6">
            <div className="w-24 h-24 rounded-[2rem] bg-emerald-50 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-12 h-12 text-emerald-500" />
            </div>
            <div className="space-y-2">
              <h2 className="text-3xl font-semibold tracking-tight">
                You’re in line{firstNameOf(name) ? `, ${firstNameOf(name)}` : ''}
              </h2>
              <p className="text-lg text-slate-500">
                {result.alreadyInLine
                  ? 'You were already on the list — you’re all set.'
                  : result.needsFrontDesk
                  ? 'You’re on the list. Please say hello at the front desk so we can match you with the right provider.'
                  : result.waitingForRequested
                    ? <><span className="font-semibold text-slate-800">{firstNameOf(result.staffName)}</span> will come get you as soon as they’re free.</>
                    : result.staffName
                      ? <><span className="font-semibold text-slate-800">{firstNameOf(result.staffName)}</span> has you — have a seat and they’ll come get you.</>
                      : 'Have a seat — the next provider free will come get you.'}
              </p>
            </div>

            {/* The old behaviour here was the bug Jessica hit head-on: a service
                with a required skill nobody's profile listed produced zero
                eligible providers, the route refused the join, and the kiosk's
                only remaining offer was the WAITLIST — "we'll call you" — while
                three techs stood on the floor. She is in the queue now, and this
                is the one honest sentence to show her. */}
            {result.needsFrontDesk && (
              <p className="text-sm text-slate-700 bg-slate-50 border-2 border-slate-200 rounded-xl px-4 py-3 flex items-start gap-2 text-left">
                <User className="w-4 h-4 shrink-0 mt-0.5" />
                You’re in the queue. A team member will assign your provider in person, so we
                haven’t put a time on this one yet.
              </p>
            )}
            {result.preferredUnavailable && (
              <p className="text-sm text-amber-700 bg-amber-50 border-2 border-amber-100 rounded-xl px-4 py-3">
                The provider you asked for isn’t taking walk-ins right now, so we’ve put you with the next available.
              </p>
            )}
            {result.patchTestWarning && (
              <p className="text-sm text-amber-700 bg-amber-50 border-2 border-amber-100 rounded-xl px-4 py-3 flex items-start gap-2 text-left">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                Your provider will check the patch test with you before starting.
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border-2 border-slate-100 bg-white px-4 py-5">
                <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-400">Your spot</p>
                <p className="text-3xl font-semibold mt-1">#{Number(result.position) || 1}</p>
                <p className="text-xs text-slate-400 mt-0.5">in line</p>
              </div>
              <div className="rounded-2xl border-2 border-slate-100 bg-white px-4 py-5">
                <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-400">Wait</p>
                <p className="text-xl font-semibold mt-1 leading-tight">{waitLine}</p>
                {/* "Ready for you now · roughly" reads like a hedge on something
                    that is not an estimate at all. Only soften a real estimate. */}
                {waitLine !== 'Ready for you now' && (
                  <p className="text-xs text-slate-400 mt-0.5">roughly</p>
                )}
              </div>
            </div>

            {/* Their code, and the QR that opens their own waiting page — where
                they can order from the lounge and see what else is on offer.
                Shown on screen as well as printed, so an empty paper tray is an
                inconvenience rather than a dead end. */}
            {(result.shortCode || qrMarkup) && (
              <div className="rounded-2xl border-2 border-slate-900 bg-white p-5 space-y-4">
                {result.shortCode && (
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-400">Your code</p>
                    <p className="text-3xl font-semibold tracking-[0.2em] mt-1 font-mono">
                      {String(result.shortCode).toUpperCase()}
                    </p>
                  </div>
                )}
                {qrMarkup && (
                  <>
                    <div
                      className="flex items-center justify-center"
                      aria-hidden="true"
                      dangerouslySetInnerHTML={{ __html: qrMarkup }}
                    />
                    <p className="text-sm text-slate-500 flex items-center justify-center gap-2 flex-wrap">
                      <Coffee className="w-4 h-4 text-rose-500 shrink-0" />
                      Scan to follow your visit and order from the lounge
                    </p>
                  </>
                )}
              </div>
            )}

            <button
              onClick={handlePrint}
              className="w-full h-16 min-h-[44px] rounded-2xl border-2 border-slate-900 bg-white text-lg font-semibold text-slate-900 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
            >
              <Printer className="w-5 h-5" /> {printed ? 'Print again' : 'Print my ticket'}
            </button>
            {printError && (
              <p className="text-sm text-rose-600 flex items-start gap-1.5 text-left px-1">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {printError}
              </p>
            )}
            {checkInUrl && (
              <a
                href={checkInUrl}
                className="w-full h-14 min-h-[44px] rounded-2xl bg-slate-900 text-white font-semibold flex items-center justify-center gap-2 active:scale-[0.99] transition-all"
              >
                <Ticket className="w-5 h-5" /> Open my waiting screen
              </a>
            )}

            {groupSize > 1 && (
              <p className="text-sm text-slate-400">Party of {groupSize} — let the front desk know if that changes.</p>
            )}

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
