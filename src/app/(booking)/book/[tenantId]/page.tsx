'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useCallback } from 'react';
import { getFirestore } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import { doc, setDoc, getDoc, getDocs, addDoc, collection, query, orderBy, where } from 'firebase/firestore';
import { type PageSection, type PageBuilderConfig } from '@/lib/data';
import { tenantTimeZone, todayIn } from '@/lib/tenant-time';
import { resolveBookingPlan } from '@/lib/deposit-policy';
import { X as XIcon, ArrowRight } from 'lucide-react';
import { linkHref, LINK_KINDS, livePageSections, cleanBrand, onAccent } from '@/lib/renter-identity';
import { policyText } from '@/lib/package-credits';
import { horizonDaysFor, releaseSentence } from '@/lib/booking-release';
import { BookingSheet } from '@/components/booking/BookingSheet';
import {
  ANIM_CSS, STACKS, GFONTS,
  StyleConfig, PageData,
  DS, ac, hf, bf, br, hexToHsl, injectFonts,
  SectionWrapper, SectionRenderer, Footer,
  isBuilderConfig, buildDefaults,
} from '@/lib/booking-sections';

// ─── Font loading ─────────────────────────────────────────────────────────────
const GFONTS_HREF = `https://fonts.googleapis.com/css2?${
  Object.values(GFONTS).map(f => `family=${f}`).join('&')
}&display=swap`;

function usePageFonts() {
  useEffect(() => {
    if (document.getElementById('cf-page-gfonts')) return;
    const pre = document.createElement('link');
    pre.rel = 'preconnect'; pre.href = 'https://fonts.googleapis.com';
    document.head.appendChild(pre);
    const pre2 = document.createElement('link');
    pre2.rel = 'preconnect'; pre2.href = 'https://fonts.gstatic.com';
    pre2.crossOrigin = 'anonymous'; document.head.appendChild(pre2);
    const link = document.createElement('link');
    link.id = 'cf-page-gfonts'; link.rel = 'stylesheet'; link.href = GFONTS_HREF;
    document.head.appendChild(link);
  }, []);
}

// ─── Result type returned by handleConfirm ────────────────────────────────────
type ConfirmResult =
  | { requiresPayment: false }
  | { requiresPayment: true; clientSecret: string; stripeAccountId?: string }
  | { requiresPayment: true; error: string };

/**
 * Recursively removes any keys with undefined values from an object.
 * The Firestore client SDK (unlike Admin SDK) throws on undefined values.
 */
const sanitizeForFirestore = (obj: any): any => {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeForFirestore);
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([_, v]) => v !== undefined)
      .map(([k, v]) => [k, sanitizeForFirestore(v)])
  );
};

// ─── Main component ────────────────────────────────────────────────────────────
function BookingPageContent({ tenantId }: { tenantId: string }) {
  usePageFonts();

  /* What the server actually made of the last booking — read by the sheet's
   * confirmation screen so it never claims "confirmed" for a request. */
  const [bookingOutcome, setBookingOutcome] = useState<{ status: string; notice: string; depositCents: number } | null>(null);
  const [tenant,          setTenant]          = useState<any>(null);
  const [services,        setServices]        = useState<any[]>([]);
  const [staff,           setStaff]           = useState<any[]>([]);
  // Independent-provider mode: /book/{tenant}?provider={staffId} shows ONLY
  // that renter's own menu at their own prices. Read post-mount from
  // window.location for the same reason the applicants page does — useSearchParams
  // forces a Suspense boundary this page doesn't have.
  const [providerId,      setProviderId]      = useState('');
  // ?reschedule=<appointmentId> — arrived from the "Reschedule" link in a
  // confirmation. Loads the visit (the id is the bearer, same as /cancel),
  // opens the booking sheet on that service with the client's details
  // prefilled, and releases the OLD visit only after the NEW one is booked —
  // never the other way round, so a client can't end up with nothing.
  const [reschedule, setReschedule] = useState<{ id: string; clientName: string | null; clientEmail: string | null; clientPhone: string | null; serviceId: string | null; serviceName: string; startTime: string } | null>(null);
  const [rescheduleNote, setRescheduleNote] = useState('');
  const [rescheduleOpened, setRescheduleOpened] = useState(false);
  useEffect(() => {
    if (!reschedule || rescheduleOpened || services.length === 0) return;
    const svc = services.find((x: any) => x.id === reschedule.serviceId) || services.find((x: any) => x.name === reschedule.serviceName);
    if (!svc) { setRescheduleNote(`Rescheduling your ${reschedule.serviceName} — pick it from the menu below to choose a new time.`); setRescheduleOpened(true); return; }
    setRescheduleNote(`Rescheduling your ${reschedule.serviceName} from ${new Date(reschedule.startTime).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} — pick a new time. The old time is released once the new one is booked.`);
    setDialogService(svc); setDialogOpen(true); setRescheduleOpened(true);
  }, [reschedule, rescheduleOpened, services]);
  const [awayProvider,    setAwayProvider]    = useState<any>(null);
  const [elsewhere,       setElsewhere]       = useState<any[]>([]);
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search).get('provider') || '';
      if (p) setProviderId(p);
      const rs = new URLSearchParams(window.location.search).get('reschedule') || '';
      if (rs) {
        fetch(`/api/appointments/self-cancel?tenantId=${encodeURIComponent(tenantId)}&appointmentId=${encodeURIComponent(rs)}`)
          .then((r) => r.json()).then((d) => {
            if (d?.ok && d.appointment && d.appointment.status !== 'cancelled') setReschedule({ id: rs, ...d.appointment });
            else setRescheduleNote('That visit can no longer be rescheduled online — just book a new time below.');
          }).catch(() => setRescheduleNote('Could not load the visit to reschedule — book a new time below.'));
      }
    } catch { /* no-op */ }
  }, []);
  const [events,          setEvents]          = useState<any[]>([]);
  const [appointments,    setAppointments]    = useState<any[]>([]);
  const [scheduleProfiles,setScheduleProfiles]= useState<any[]>([]);
  const [pricingTiers,    setPricingTiers]    = useState<any[]>([]);
  const [consentForms,    setConsentForms]    = useState<any[]>([]);
  // The blocking sources. `events` above is the studio's marketing events on
  // the page itself — these are the calendar blocks, a different collection.
  const [shifts,          setShifts]          = useState<any[]>([]);
  const [staffBlocks,     setStaffBlocks]     = useState<any[]>([]);
  const [dayOffBlocks,    setDayOffBlocks]    = useState<any[]>([]);
  const [resources,       setResources]       = useState<any[]>([]);
  const [maintTickets,    setMaintTickets]    = useState<any[]>([]);
  const [maintenancePlans,setMaintenancePlans]= useState<any[]>([]);
  const [calendarEvents,  setCalendarEvents]  = useState<any[]>([]);
  const [savedConfig,     setSavedConfig]     = useState<PageBuilderConfig|null>(null);
  const [configReady,     setConfigReady]     = useState(false);
  const [dialogOpen,      setDialogOpen]      = useState(false);
  const [dialogService,   setDialogService]   = useState<any>(null);
  const [showPicker,      setShowPicker]      = useState(false);

  const [loadingStyle] = useState<StyleConfig>(() => {
    try {
      if (typeof window === 'undefined') return DS;
      const raw = localStorage.getItem(`cf-style-${tenantId}`);
      if (raw) return { ...DS, ...JSON.parse(raw) };
    } catch {}
    return DS;
  });

  const getDb = useCallback(() => {
    try { return getFirestore(getApp()); } catch { return null; }
  }, []);

  // Inject animation keyframes
  useEffect(() => {
    if (!document.getElementById('cf-anim')) {
      const s = document.createElement('style');
      s.id = 'cf-anim'; s.textContent = ANIM_CSS;
      document.head.appendChild(s);
    }
  }, []);

  // Phase 1: Load tenant + saved page config
  useEffect(() => {
    if (!tenantId) { setConfigReady(true); return; }
    let cancelled = false;
    const run = async () => {
      const db = getDb();
      if (!db) { setConfigReady(true); return; }
      try {
        const tSnap = await getDoc(doc(db, 'tenants', tenantId));
        if (!cancelled && tSnap.exists()) {
          const t = { id: tSnap.id, ...tSnap.data() } as any;
          setTenant(t);
          const pc = t?.bookingPageSettings?.cfPageConfig;
          if (isBuilderConfig(pc)) {
            setSavedConfig(pc as PageBuilderConfig);
            try {
              localStorage.setItem(`cf-style-${tenantId}`, JSON.stringify({
                accentColor: pc.accentColor, bgColor: pc.bgColor,
                headingFont: pc.headingFont, bodyFont: pc.bodyFont,
                borderRadius: pc.borderRadius, buttonStyle: pc.buttonStyle,
                density: pc.density,
              }));
            } catch {}
          }
        }
      } catch (e) { console.warn('[booking:config]', e); }
      if (!cancelled) setConfigReady(true);
    };
    run();
    return () => { cancelled = true; };
  }, [tenantId, getDb]);

  // Phase 2: Load services, staff, events (non-blocking)
  useEffect(() => {
    if (!tenantId || !configReady) return;
    let cancelled = false;
    const run = async () => {
      const db = getDb(); if (!db) return;
      // THE LOWER BOUND ON EVERY "from today" QUERY BELOW.
      // It used to be the VISITOR's day. That is the wrong direction of wrong:
      // when the browser is a day AHEAD of the studio — anyone booking in the
      // evening from further east — these queries silently excluded today's
      // appointments, shifts and blocks, so the availability engine on this
      // page could not see a slot that was already taken and offered it. The
      // booking route then refused it at the last step. Same inputs on both
      // sides, same answer: the studio's day. Phase 1 sets `tenant` and
      // `configReady` in the same pass, so this closure has the tenant doc;
      // if that fetch failed it degrades to UTC, exactly as before.
      const fromDay = todayIn(tenantTimeZone(tenant));
      const eventsFromDay = todayIn(tenantTimeZone(tenant), new Date(Date.now() - 31 * 86400000));
      try {
        const [svSnap,stSnap,evSnap,aptSnap,spSnap,ptSnap,cfSnap,shSnap,sbSnap,doSnap,rsSnap,tkSnap,mpSnap,ceSnap,rsvSnap] = await Promise.all([
          getDocs(collection(db, `tenants/${tenantId}/services`)),
          getDocs(collection(db, `tenants/${tenantId}/staff`)),
          getDocs(query(collection(db, `tenants/${tenantId}/studioEvents`), orderBy('date','asc'))).catch(() => getDocs(collection(db, `tenants/${tenantId}/studioEvents`))),
          getDocs(query(collection(db, `tenants/${tenantId}/appointments`), where('startTime','>=',fromDay))).catch(() => ({ docs: [] })),
          getDocs(collection(db, `tenants/${tenantId}/scheduleProfiles`)).catch(() => ({ docs: [] })),
          getDocs(collection(db, `tenants/${tenantId}/pricingTiers`)).catch(() => ({ docs: [] })),
          getDocs(collection(db, `tenants/${tenantId}/consentForms`)).catch(() => ({ docs: [] })),
          // v21 — the other seven blocking sources. Without these the public
          // page only knew about other appointments, so it happily offered a
          // slot on an approved day off, outside the published roster, or in a
          // pedicure chair with an urgent maintenance ticket on it. The booking
          // route checks all of them, so every one of those offers came back
          // refused at the last step. Same inputs on both sides, same answer.
          getDocs(query(collection(db, `tenants/${tenantId}/shifts`), where('date', '>=', fromDay))).catch(() => ({ docs: [] })),
          getDocs(query(collection(db, `tenants/${tenantId}/staffBlocks`), where('startTime', '>=', fromDay))).catch(() => ({ docs: [] })),
          getDocs(query(collection(db, `tenants/${tenantId}/shiftDayOffBlocks`), where('date', '>=', fromDay))).catch(() => ({ docs: [] })),
          getDocs(collection(db, `tenants/${tenantId}/resources`)).catch(() => ({ docs: [] })),
          getDocs(query(collection(db, `tenants/${tenantId}/tickets`), where('status', 'in', ['open', 'in_progress']))).catch(() => ({ docs: [] })),
          getDocs(collection(db, `tenants/${tenantId}/maintenancePlans`)).catch(() => ({ docs: [] })),
          getDocs(query(collection(db, `tenants/${tenantId}/events`), where('startTime', '>=', eventsFromDay))).catch(() => ({ docs: [] })),
          getDocs(collection(db, `tenants/${tenantId}/renterServices`)).catch(() => ({ docs: [] })),
        ]);
        if (!cancelled) {
          const everyStaff = stSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter((s: any) => s.isActive !== false);
          // A renter running their own booking system is not bookable here.
          // Left in, they would show as a provider whose every date is empty —
          // a dead end that reads like a broken page rather than a choice.
          const allStaff = everyStaff.filter((m: any) => !(m.isRenter && m.bookingOptOut === true));
          setElsewhere(everyStaff.filter((m: any) =>
            m.isRenter && m.bookingOptOut === true && m.listExternally === true && m.externalBookingUrl));
          const houseServices = svSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter((s: any) => s.isActive !== false);
          const optedOut: any = providerId
            ? everyStaff.find((m: any) => m.id === providerId && m.isRenter && m.bookingOptOut === true)
            : null;
          if (optedOut) setAwayProvider(optedOut);
          const provider: any = providerId ? allStaff.find((m: any) => m.id === providerId && m.isRenter) : null;
          if (provider) {
            // Their menu, their prices, their durations — never mixed with the
            // house list, so a client never sees one service priced two ways.
            const mine = (rsvSnap as any).docs
              .map((d: any) => ({ id: d.id, ...d.data() }))
              .filter((sv: any) => sv.isActive !== false && sv.staffId === provider.id)
              .map((sv: any) => ({
                ...sv,
                collectsOwnPayment: true,
                providerName: provider.name || 'your provider',
                staffIds: [provider.id],
                // Deposits are possible only when THEIR Stripe can charge.
                renterChargesEnabled: provider.stripeChargesEnabled === true,
                renterDepositAmount: sv.depositMode === 'percent'
                  ? Math.round((Number(sv.price) || 0) * (Number(sv.depositPercent) || 0)) / 100
                  : Number(sv.depositAmount) || 0,
                renterProviderId: provider.id,
              }));
            setServices(mine);
            setStaff([provider]);
          } else {
            setServices(houseServices);
            setStaff(allStaff);
          }
          setEvents(evSnap.docs.map(d => ({ id: d.id, ...d.data() })));
          setAppointments((aptSnap as any).docs.map((d: any) => ({ id: d.id, ...d.data() })));
          setScheduleProfiles((spSnap as any).docs.map((d: any) => ({ id: d.id, ...d.data() })));
          setPricingTiers((ptSnap as any).docs.map((d: any) => ({ id: d.id, ...d.data() })));
          setConsentForms((cfSnap as any).docs.map((d: any) => ({ id: d.id, ...d.data() })));
          setShifts((shSnap as any).docs.map((d: any) => ({ id: d.id, ...d.data() })));
          setStaffBlocks((sbSnap as any).docs.map((d: any) => ({ id: d.id, ...d.data() })));
          setDayOffBlocks((doSnap as any).docs.map((d: any) => ({ id: d.id, ...d.data() })));
          setResources((rsSnap as any).docs.map((d: any) => ({ id: d.id, ...d.data() })));
          setMaintTickets((tkSnap as any).docs.map((d: any) => ({ id: d.id, ...d.data() })));
          setMaintenancePlans((mpSnap as any).docs.map((d: any) => ({ id: d.id, ...d.data() })));
          setCalendarEvents((ceSnap as any).docs.map((d: any) => ({ id: d.id, ...d.data() })));
        }
      } catch (e) { console.warn('[booking:data]', e); }
    };
    run();
    return () => { cancelled = true; };
  }, [tenantId, configReady, getDb, providerId]);

  // Booking events
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.service) { setDialogService(d.service); setDialogOpen(true); }
      else { if (services.length === 1) { setDialogService(services[0]); setDialogOpen(true); } else setShowPicker(true); }
    };
    window.addEventListener('cf-book', h);
    return () => window.removeEventListener('cf-book', h);
  }, [services]);

  // Derive resolved config and style
  const sections: PageSection[] = savedConfig?.sections ?? buildDefaults();
  const resolvedStyle: StyleConfig = {
    accentColor:  savedConfig?.accentColor  ?? DS.accentColor,
    bgColor:      savedConfig?.bgColor      ?? DS.bgColor,
    headingFont:  savedConfig?.headingFont  ?? DS.headingFont,
    bodyFont:     savedConfig?.bodyFont     ?? DS.bodyFont,
    borderRadius: savedConfig?.borderRadius ?? DS.borderRadius,
    buttonStyle:  savedConfig?.buttonStyle  ?? DS.buttonStyle,
    density:      savedConfig?.density      ?? DS.density,
  };

  // Only render sections that are enabled AND not hidden from visitors
  const activeSections = sections
    .filter(s => s.enabled && s.visible !== false)
    .sort((a, b) => a.order - b.order);

  useEffect(() => { injectFonts(resolvedStyle.headingFont, resolvedStyle.bodyFont); }, [resolvedStyle.headingFont, resolvedStyle.bodyFont]);
  // The renter's page: splash-then-app state, and their typeface loaded the
  // same way the studio's is. Declared here, above every early return, so
  // hook order never depends on which page renders.
  const [providerEntered, setProviderEntered] = useState(false);
  const [providerTab, setProviderTab] = useState<'book' | 'work' | 'about' | 'reviews'>('book');
  // The service a client is LOOKING AT, before they decide to book it.
  const [providerPeek, setProviderPeek] = useState<any | null>(null);
  const [providerPackages, setProviderPackages] = useState<any[]>([]);
  const [providerMemberships, setProviderMemberships] = useState<any[]>([]);
  // The purchase form: which product, and the buyer's details. Replaces
  // two browser prompts with a sheet that matches the page.
  const [buying, setBuying] = useState<{ kind: 'package' | 'membership'; item: any } | null>(null);
  const [buyer, setBuyer] = useState({ name: '', email: '', phone: '', existing: false });
  const [memberThanks, setMemberThanks] = useState(false);
  // "I'm a member" — an email check against the renter's active members.
  // Unlocks the member booking window on this page; the server re-checks the
  // same email at confirm, so it is a convenience, not the gate.
  const [memberEmail, setMemberEmail] = useState('');
  // Studio members: same idea on the studio's own page — a member unlocks
  // their earlier release and members-only services. The server checks the
  // same thing at confirm; this only changes what the calendar shows.
  const [studioMemberOk, setStudioMemberOk] = useState<boolean | null>(null);
  const [studioMemberInput, setStudioMemberInput] = useState('');
  const [studioMemberBusy, setStudioMemberBusy] = useState(false);
  const checkStudioMember = async () => {
    const v = studioMemberInput.trim(); if (!v) return;
    setStudioMemberBusy(true);
    try {
      const res = await fetch('/api/booking/member-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, contact: v }) });
      const d = await res.json().catch(() => ({}));
      setStudioMemberOk(!!d?.member);
    } catch { setStudioMemberOk(false); } finally { setStudioMemberBusy(false); }
  };
  const [memberOk, setMemberOk] = useState<boolean | null>(null);
  const [memberChecking, setMemberChecking] = useState(false);
  const checkMember = async () => {
    const e = memberEmail.trim().toLowerCase(); if (!e || !providerId) return;
    setMemberChecking(true);
    try {
      const db = getDb(); if (!db) return;
      const snap = await getDocs(query(collection(db, `tenants/${tenantId}/renterMemberSubscriptions`), where('staffId', '==', providerId), where('clientEmail', '==', e)));
      setMemberOk(snap.docs.some((d) => (d.data() as any)?.status === 'active'));
    } catch { setMemberOk(false); } finally { setMemberChecking(false); }
  };
  const [pkgBuying, setPkgBuying] = useState('');
  const [pkgErr, setPkgErr] = useState('');
  const [pkgThanks, setPkgThanks] = useState(false);
  useEffect(() => {
    if (!providerId || !tenantId) { setProviderPackages([]); return; }
    try { const q = new URLSearchParams(window.location.search); if (q.get('package') === 'thanks') setPkgThanks(true); if (q.get('member') === 'thanks') setMemberThanks(true); } catch { /* no-op */ }
    (async () => {
      try {
        const db = getDb(); if (!db) return;
        const [ps, ms] = await Promise.all([
          getDocs(query(collection(db, `tenants/${tenantId}/renterPackages`), where('staffId', '==', providerId))),
          getDocs(query(collection(db, `tenants/${tenantId}/renterMemberships`), where('staffId', '==', providerId))),
        ]);
        setProviderPackages(ps.docs.map((d) => ({ id: d.id, ...(d.data() as any) })).filter((p: any) => p.isActive !== false).sort((a: any, b: any) => (a.priceCents || 0) - (b.priceCents || 0)));
        setProviderMemberships(ms.docs.map((d) => ({ id: d.id, ...(d.data() as any) })).filter((m: any) => m.isActive !== false).sort((a: any, b: any) => (a.priceCents || 0) - (b.priceCents || 0)));
      } catch { setProviderPackages([]); setProviderMemberships([]); }
    })();
  }, [providerId, tenantId, getDb]);
  const buyPackage = (pkg: any) => { setPkgErr(''); setBuying({ kind: 'package', item: pkg }); };
  const joinMembership = (m: any) => { setPkgErr(''); setBuying({ kind: 'membership', item: m }); };
  const submitPurchase = async () => {
    if (!buying) return;
    if (!buyer.name.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(buyer.email.trim())) { setPkgErr('A name and a valid email are needed — the receipt and your credits go there.'); return; }
    setPkgBuying(buying.item.id); setPkgErr('');
    try {
      const url = buying.kind === 'package' ? '/api/stripe/renter-package' : '/api/stripe/renter-membership';
      const idKey = buying.kind === 'package' ? 'packageId' : 'membershipId';
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, [idKey]: buying.item.id, clientName: buyer.name.trim(), clientEmail: buyer.email.trim().toLowerCase(), clientPhone: buyer.phone.trim() }) });
      const d = await res.json().catch(() => ({}));
      if (d?.ok && d.url) { window.location.href = d.url; return; }
      setPkgErr(d?.error || 'Could not start checkout.');
    } finally { setPkgBuying(''); }
  };
  const providerBrandFont = providerId ? cleanBrand((staff.find((m: any) => m.id === providerId && m.isRenter) as any)?.brand).font : null;
  useEffect(() => { if (providerBrandFont) injectFonts(providerBrandFont, 'jakarta'); }, [providerBrandFont]);
  useEffect(() => {
    const root = document.documentElement;
    /* Fallbacks point at the app's own typeface, so an unknown or missing
     * font id degrades INTO the house style rather than out of it. */
    root.style.setProperty('--booking-heading-font', STACKS[resolvedStyle.headingFont] || STACKS.jakarta);
    root.style.setProperty('--booking-body-font',    STACKS[resolvedStyle.bodyFont]    || STACKS.jakarta);
    root.style.setProperty('--radius', `${resolvedStyle.borderRadius}px`);
    try { root.style.setProperty('--primary', hexToHsl(resolvedStyle.accentColor)); } catch {}
  }, [resolvedStyle]);

  const data: PageData = {
    tenant,
    // Members-only services stay off the studio's page until a member unlocks.
    services: services.filter((sv: any) => sv.membersOnly !== true || studioMemberOk === true),
    staff, events, tenantId,
    // Everything the booking sheet needs to reach the same verdict as the
    // server. Passed through in one object so there is exactly one place to
    // keep in step when a new blocking source is added.
    appointments, scheduleProfiles, shifts, staffBlocks, dayOffBlocks,
    resources, tickets: maintTickets, maintenancePlans, calendarEvents,
    pricingTiers, consentForms,
  };

  /* ── THIS HOOK MUST STAY ABOVE EVERY `return` ─────────────────────────
   * It was placed further down, below the loading-spinner early return. On
   * the first render — while config is still loading — that return fires and
   * this hook never runs, so React sees a different number of hooks between
   * renders and throws. The whole booking site died with "a client-side
   * exception has occurred", which is the generic face of exactly this
   * mistake.
   *
   * Opening the flow scrolls to the top: without it the page keeps whatever
   * offset the service list had, and the flow's first screen starts halfway
   * down looking like a blank panel. */
  useEffect(() => {
    if (dialogOpen) window.scrollTo({ top: 0, behavior: 'auto' });
  }, [dialogOpen]);

  // Loading spinner
  if (!configReady) {
    return (
      <div className="w-full min-h-dvh flex items-center justify-center" style={{ background: loadingStyle.bgColor }}>
        <div className="w-7 h-7 border-2 border-t-transparent rounded-full animate-spin"
             style={{ borderColor: loadingStyle.accentColor }}/>
      </div>
    );
  }

  // ── handleConfirm ────────────────────────────────────────────────────────────
  // No deposit: creates the appointment immediately and tells the sheet to show
  // the confirmation screen.
  // Deposit required: creates the bookingRequest, asks Stripe for an EMBEDDED
  // checkout session, and returns the clientSecret to BookingSheet so it can
  // mount Stripe's checkout UI directly inside the sheet. The guest never
  // leaves the page. The connect-webhook converts the bookingRequest into a
  // real appointment once Stripe confirms payment.
  const handleConfirm = async (
    formData: { clientName: string; clientEmail: string; clientPhone?: string; notes?: string },
    apptDetails: any, signedForms: any[], setStep: (s: string) => void,
  ): Promise<ConfirmResult> => {
    try {
      const db = getFirestore(getApp());

      // BookingSheet sends `depositAmount` in dollars, not `depositAmountCents`
      const depositDollars = Number(apptDetails?.depositAmount) || 0;
      const depositCents   = Math.round(depositDollars * 100);

      // No deposit required → create the real appointment immediately, no payment gate needed
      if (depositCents <= 0) {
        const { depositAmount, depositStatus, ...restDetails } = apptDetails || {};

        // v12 — race-proof path: the shared booking engine checks conflicts
        // server-side inside a transaction, so two guests can't grab the
        // same slot. Falls back to the legacy direct write while the API
        // isn't deployed (404) or errors.
        try {
          if (restDetails?.serviceId && restDetails?.startTime) {
            const bookRes = await fetch('/api/appointments/book', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                tenantId,
                source: 'booking-page',
                serviceId: restDetails.serviceId,
                addOnIds: restDetails.addOnIds || [],
                staffId: restDetails.staffId || 'any',
                startTime: restDetails.startTime,
                client: { name: formData.clientName, email: formData.clientEmail, phone: formData.clientPhone,
                  // Consent was captured on the sheet and then dropped here —
                  // the route never saw it. It now travels with the booking.
                  smsConsent: ((restDetails as any).smsConsent ?? (formData as any).smsConsent) === true, smsConsentText: (restDetails as any).smsConsentText || null,
                  smsMarketing: ((restDetails as any).smsMarketing ?? (formData as any).smsMarketing) === true, smsMarketingText: (restDetails as any).smsMarketingText || null },
                notes: formData.notes,
              }),
            });
            if (bookRes.status !== 404) {
              const out = await bookRes.json().catch(() => null);
              if (out?.ok) {
                if (Array.isArray(signedForms) && signedForms.length > 0) {
                  try {
                    await setDoc(doc(db, `tenants/${tenantId}/appointments`, out.appointmentId),
                      sanitizeForFirestore({ signedForms }), { merge: true });
                  } catch { /* forms are secondary — the booking already exists */ }
                }
                /* The SERVER decides what this booking became — instant,
                 * held for a deposit, or a request awaiting approval. The
                 * confirmation screen must say the same thing the server
                 * wrote and the email repeats, or the shop tells the client
                 * three different stories about the same booking. */
                setBookingOutcome({
                  status: String(out.status || 'confirmed'),
                  notice: String(out.clientNotice || ''),
                  depositCents: Number(out.depositCents) || 0,
                });

                /* THE CARD IS COLLECTED AGAINST A REAL CLIENT RECORD, so the
                 * booking is written first and the card step runs against the
                 * clientId the server just returned. The existing connect
                 * webhook vaults on client_reference_id, so there is no second
                 * write path to keep in step with this one. */
                if (out.requiresCardOnFile && out.clientId) {
                  try {
                    const cardRes = await fetch('/api/stripe/booking-card', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        tenantId,
                        clientId: out.clientId,
                        clientEmail: formData.clientEmail,
                        clientName: formData.clientName,
                        serviceName: restDetails?.serviceName || '',
                      }),
                    });
                    const cardOut = await cardRes.json().catch(() => null);
                    if (cardOut?.clientSecret) {
                      return {
                        requiresPayment: true,
                        clientSecret: cardOut.clientSecret,
                        stripeAccountId: cardOut.stripeAccountId,
                      };
                    }
                  } catch {
                    /* The booking stands. Accepting it will send a pay link
                     * instead of charging — worse, but never lost. */
                  }
                }

                // Rescheduling: the new visit is booked; now release the old one,
                // quietly — the client already has the new confirmation.
                if (reschedule?.id) {
                  try {
                    await fetch('/api/appointments/self-cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, appointmentId: reschedule.id, clientReason: 'Rescheduled online', rescheduledToId: out?.appointmentId || null }) });
                  } catch { /* the new booking stands; the old one can still be cancelled from its own link */ }
                  setReschedule(null);
                }
                setStep('confirmation');
                return { requiresPayment: false };
              }
              // v21 — ANY answered refusal is final. This used to return only
              // on 409 and fall through to the unchecked legacy write for
              // every other status, so when the server said "that's outside
              // working hours" or "that chair is out of service" the page
              // wrote the appointment anyway — a booking the studio could not
              // honour, with no conflict check behind it. The route is the
              // authority now; the only reason to fall through is that it
              // isn't there (404) or the network never reached it.
              return {
                requiresPayment: true,
                error: out?.error
                  || (bookRes.status === 409
                    ? 'That time was just taken — pick another slot.'
                    : 'We could not hold that time. Please pick another slot.'),
              };
            }
          }
        } catch { /* network never reached the route — fall through to the legacy write */ }

        /* ── THE FALLBACK MUST OBEY THE SHOP'S BOOKING MODE ────────────────
         * This path used to hardcode `status: 'confirmed'`. It runs whenever
         * the route was unreachable OR the details lacked a serviceId/
         * startTime — and in that case a studio running approval mode got a
         * confirmed appointment dropped straight onto the calendar with no
         * request to answer. The setting was on; the booking ignored it.
         *
         * resolveBookingPlan is a pure function, so the same decision the
         * server makes can be made here. The legacy write is now a slower
         * road to the same destination rather than a hole in the policy. */
        const fallbackPlan = resolveBookingPlan({
          tenant,
          service: services.find((sv: any) => sv.id === restDetails?.serviceId) || {},
          price: Number(restDetails?.price ?? 0),
          client: null,
          byStaff: false,
        });
        const aptRef = doc(collection(db, `tenants/${tenantId}/appointments`));
        await setDoc(aptRef, sanitizeForFirestore({
          id: aptRef.id,
          tenantId,
          ...formData, ...restDetails, signedForms,
          status: fallbackPlan.status,
          bookingMode: fallbackPlan.mode,
          bookingReason: `${fallbackPlan.reason} (offline path)`,
          ...(fallbackPlan.status === 'requested' ? {
            requestedAt: new Date().toISOString(),
            requestExpiresAt: fallbackPlan.approvalExpiryHours > 0
              ? new Date(Date.now() + fallbackPlan.approvalExpiryHours * 3600000).toISOString()
              : null,
          } : {}),
          depositAmountCents: 0,
          depositStatus: 'none',
          checkInStatus: 'pending',
          createdAt: new Date().toISOString(),
        }));
        setBookingOutcome({
          status: fallbackPlan.status,
          notice: fallbackPlan.clientNotice,
          depositCents: 0,
        });
        setStep('confirmation');
        return { requiresPayment: false };
      }

      // Deposit required → hold as a pending booking request while the guest pays
      const ref = await addDoc(collection(db, `tenants/${tenantId}/bookingRequests`), sanitizeForFirestore({
        ...formData, ...apptDetails, signedForms,
        status: 'pending', source: 'booking-page', createdAt: new Date(),
      }));

      // Ask for an EMBEDDED checkout session — mounted inline, no redirect
      const svc = services.find((s: any) => s.id === apptDetails?.serviceId);
      const res = await fetch('/api/stripe/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          bookingRequestId: ref.id,
          depositAmount: depositDollars,
          clientName:  formData.clientName,
          clientEmail: formData.clientEmail,
          serviceName: svc?.name || '',
          // Independent-provider bookings collect on THEIR account.
          ...(svc?.collectsOwnPayment && svc?.renterProviderId
            ? { renterProviderId: svc.renterProviderId } : {}),
        }),
      });
      const out = await res.json().catch(() => null);

      if (out?.clientSecret) {
        /* setBookingOutcome lived only in the no-deposit branches, so a
         * booking that went through checkout reached the confirmation screen
         * with the outcome still null — and null renders "You're All Set!"
         * for a request the studio has not answered. Resolved here so the
         * screen says the same thing the server wrote, whichever way the
         * client got there. */
        const paidPlan = resolveBookingPlan({
          tenant: tenant as any,
          service: (services || []).find((sv: any) => sv.id === apptDetails?.serviceId) as any,
          price: Number(apptDetails?.price ?? 0),
          byStaff: false,
        });
        setBookingOutcome({
          status: paidPlan.status,
          notice: paidPlan.clientNotice || '',
          depositCents: paidPlan.depositCents || 0,
        });
        return { requiresPayment: true, clientSecret: out.clientSecret, stripeAccountId: out.stripeAccountId };
      }

      // Payment couldn't be started — the request is already saved as pending,
      // so the guest isn't lost. Surface the error to the sheet so it can show
      // a retry option instead of looking unresponsive.
      console.error('[deposit-checkout]', out?.error || 'No client secret returned');
      return { requiresPayment: true, error: out?.error || 'Could not start secure checkout. Please try again.' };
    } catch (e: any) {
      console.error('[booking-confirm]', e);
      const detail = e?.message || e?.code || String(e);
      return { requiresPayment: true, error: `Booking error: ${detail}` };
    }
  };

  /* When the flow is open it OWNS the screen — the marketing page underneath
   * is not rendered at all. Leaving it mounted meant the customer could
   * scroll past the end of the booking form into the studio's hero section,
   * which reads as the form having ended prematurely. */
  if (dialogOpen && dialogService) {
    return (
      <div className="w-full min-h-dvh overflow-x-hidden"
           style={{ background: resolvedStyle.bgColor, fontFamily: STACKS[resolvedStyle.bodyFont] || STACKS.jakarta }}>
        <BookingSheet
          lockedStaffId={providerId && staff.some((m: any) => m.id === providerId && m.isRenter) ? providerId : undefined}
          prefillClient={reschedule ? { clientName: reschedule.clientName, clientEmail: reschedule.clientEmail, clientPhone: reschedule.clientPhone } : null}
          open
          onOpenChange={o => { if (!o) { setDialogOpen(false); setDialogService(null); } }}
          service={dialogService}
          staff={staff}
          pricingTiers={pricingTiers}
          appointments={appointments}
          events={events}
          scheduleProfiles={scheduleProfiles}
          services={services}
          consentForms={consentForms}
          tenant={(() => {
            // Renter's release settings on their own page — rolling or monthly —
            // for a member once identified, otherwise the public window. The
            // same function the server enforces with, so the calendar never
            // shows a day the booking would then refuse.
            const prov: any = providerId ? staff.find((m: any) => m.id === providerId && m.isRenter) : null;
            const days = prov
              ? horizonDaysFor(prov.renterBooking || null, memberOk === true, new Date(), tenant?.timezone || 'America/New_York')
              : horizonDaysFor((tenant as any)?.bookingRelease || null, studioMemberOk === true, new Date(), tenant?.timezone || 'America/New_York');
            return days !== null && days > 0 ? { ...tenant, bookingHorizonDays: days } : tenant;
          })()}
          shifts={shifts}
          staffBlocks={staffBlocks}
          dayOffBlocks={dayOffBlocks}
          resources={resources}
          tickets={maintTickets}
          maintenancePlans={maintenancePlans}
          calendarEvents={calendarEvents}
          onConfirm={handleConfirm}
          bookingOutcome={bookingOutcome}
          variant="page"
        />
      </div>
    );
  }

  // Someone followed a personal link belonging to a renter who books
  // elsewhere. Sending them their real link is the whole point — the
  // alternative is a client who came looking for a specific person and
  // leaves thinking the studio is broken.
  // ── A renter's link opens THEIR page ─────────────────────────────────
  // A SPLASH, then an APP. The splash is one full screen — their cover or
  // their colour, their name in their typeface, a tagline, one gesture in.
  // The app is fixed to the viewport: a slim header, four panes (Book · Work
  // · About · Reviews) that scroll INSIDE themselves, a bottom bar, and a
  // "Book" bar that never moves. Nothing here is the studio's theme; the
  // renter's brand — accent, light or dark, cover, face — is the whole look,
  // with calm defaults when they have set nothing. Luxury is restraint:
  // hairline rules, tracking, light weights, space.
  const linkedProvider: any = providerId ? staff.find((m: any) => m.id === providerId && m.isRenter) : null;
  if (linkedProvider && !awayProvider) {
    const p = linkedProvider;
    const brand = cleanBrand(p.brand);
    const dark = brand.tone === 'dark';
    const bg = dark ? '#0c0a09' : '#faf9f7';
    const ink = dark ? '#fafaf9' : '#1c1917';
    const mute = dark ? '#c8c2ba' : '#78716c';
    const line = dark ? 'rgba(250,250,249,0.12)' : 'rgba(28,25,23,0.10)';
    const card = dark ? 'rgba(250,250,249,0.05)' : 'rgba(255,255,255,0.7)';
    // Night mode: the default accent is near-black, so on a dark page every
    // accent-coloured element — eyebrows, prices, the tab indicator, stars —
    // disappeared, and thin light type at 10px on dark was hard to read. On
    // dark: lift a too-dark accent toward white until it clears the page,
    // brighten the muted grey, and don't go below 400 weight.
    const lift = (hex: string): string => {
      const m = /^#([0-9a-f]{6})$/i.exec(hex); if (!m) return hex;
      const n = parseInt(m[1], 16); const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      if (lum > 0.45) return hex;
      const t = 0.72; const mix = (c: number) => Math.round(c + (255 - c) * t);
      return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
    };
    const accent = dark ? lift(brand.accent) : brand.accent;
    const onAcc = onAccent(accent);
    const lightWeight = dark ? 400 : 300;
    const face = STACKS[brand.font] || STACKS.cormorant;
    const body = STACKS.jakarta;
    const first = String(p.name || '').split(' ')[0] || 'them';
    const photo = p.avatarUrl || p.photoUrl || '';
    const cover = brand.coverUrl || photo || '';
    const links: any[] = Array.isArray(p.links) ? p.links : [];
    const igOnly = p.instagram && !links.some((l) => l.kind === 'instagram');
    const rows: { label: string; href: string }[] = [
      ...(igOnly ? [{ label: 'Instagram', href: linkHref({ kind: 'instagram', value: p.instagram }) }] : []),
      ...links.map((l) => ({ label: l.label || (LINK_KINDS.find((k) => k.kind === l.kind)?.label ?? 'Link'), href: linkHref(l) })).filter((r) => r.href),
    ];
    const addr = [tenant?.address?.street || tenant?.address?.line1, tenant?.address?.city].filter(Boolean).join(', ');
    const sections = livePageSections(p.page);
    const gallery = sections.find((x) => x.kind === 'gallery');
    const about = sections.find((x) => x.kind === 'about');
    const faq = sections.find((x) => x.kind === 'faq');
    const policies = sections.find((x) => x.kind === 'policies');
    const reviews: any[] = Array.isArray(p.reviews) ? p.reviews : [];
    const policyLines = policies?.text ? String(policies.text).split(/\n+/).map((t) => t.replace(/^[-•]\s*/, '').trim()).filter(Boolean).slice(0, 10) : [];
    const cats = Array.from(new Set(services.map((sv: any) => String(sv.category || '').trim()).filter(Boolean)));
    const tabs = [
      ['book', 'Book'],
      ...((gallery?.photos || []).length ? [['work', 'Work']] : []),
      ...((about || faq || policyLines.length || rows.length) ? [['about', 'About']] : []),
      ...(reviews.length ? [['reviews', 'Reviews']] : []),
    ] as [string, string][];
    // globals.css flips the .uppercase utility to lowercase for the app's
    // soft look; this page wants true small caps, so the transform is inline.
    const caps: React.CSSProperties = { textTransform: 'uppercase', letterSpacing: '0.35em' };
    const eyebrow = (t: string) => <p className="text-[10px] font-medium" style={{ ...caps, color: accent, fontFamily: body }}>{t}</p>;
    const hour = new Date().getHours();
    const greeting = hour < 5 ? 'Welcome' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const sameName = String(tenant?.name || '').trim().toLowerCase() === String(p.name || '').trim().toLowerCase();
    const studioLine = tenant?.name && !sameName ? `at ${tenant.name}` : '';
    const rule = <div className="h-px w-full" style={{ background: line }} />;

    if (!providerEntered) {
      return (
        <div className="fixed inset-0 overflow-hidden" data-tone={dark ? 'dark' : 'light'} style={{ background: bg, fontFamily: body }}>
          <style>{`[data-tone="dark"] .font-light { font-weight: 400; }`}</style>
          {cover && <img src={cover} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ opacity: dark ? 0.55 : 0.9 }} />}
          <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, ${dark ? 'rgba(12,10,9,0.15)' : 'rgba(250,249,247,0.05)'} 0%, ${bg} 78%)` }} />
          <div className="absolute inset-x-0 bottom-0 px-8 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
            {eyebrow(greeting)}
            <h1 className="mt-3 text-[56px] font-light leading-[0.9] tracking-tight" style={{ fontFamily: face, color: ink }}>{p.name || 'Provider'}</h1>
            {brand.tagline && <p className="mt-3 text-[15px] font-light leading-relaxed" style={{ color: mute }}>{brand.tagline}</p>}
            {reviews.length > 0 && p.reviewAverage ? <p className="mt-3 text-[11px]" style={{ ...caps, letterSpacing: '0.25em', color: mute }}>{p.reviewAverage} ★ · {p.reviewCount || reviews.length} reviews</p> : null}
            <button type="button" onClick={() => setProviderEntered(true)}
              className="mt-8 flex h-14 w-full items-center justify-between px-6 text-[11px] font-medium transition-transform active:scale-[0.98]"
              style={{ ...caps, letterSpacing: '0.3em', background: accent, color: onAcc, borderRadius: 999 }}>
              Enter <span aria-hidden>→</span>
            </button>
            {studioLine && <p className="mt-4 text-center text-[9px]" style={{ ...caps, color: mute, opacity: 0.7 }}>{studioLine}</p>}
          </div>
        </div>
      );
    }

    const pane = 'absolute inset-x-0 top-14 bottom-[calc(7.5rem+env(safe-area-inset-bottom))] overflow-y-auto overscroll-contain px-6 pt-4 pb-6';
    return (
      <div className="fixed inset-0 overflow-hidden" data-tone={dark ? 'dark' : 'light'} style={{ background: bg, color: ink, fontFamily: body }}>
        <style>{`[data-tone="dark"] .font-light { font-weight: 400; } [data-tone="dark"] .text-\\[10px\\] { font-size: 11px; }`}</style>
        <header className="absolute inset-x-0 top-0 z-10 flex h-14 items-center gap-3 px-6" style={{ background: bg, borderBottom: `1px solid ${line}` }}>
          {photo ? <img src={photo} alt="" className="h-8 w-8 rounded-full object-cover" /> : <span className="h-8 w-8 rounded-full" style={{ background: accent }} />}
          <span className="min-w-0 truncate text-[17px] font-light" style={{ fontFamily: face }}>{p.name || 'Provider'}</span>
          <button type="button" onClick={() => setProviderEntered(false)} aria-label="Back to the cover" className="ml-auto text-[10px]" style={{ ...caps, letterSpacing: '0.25em', color: mute }}>Cover</button>
        </header>

        {providerTab === 'book' && (
          <div className={pane}>
            {rescheduleNote && <p className="mb-4 rounded-2xl px-4 py-3 text-[13px]" style={{ background: card, color: ink, border: `1px solid ${accent}`, fontWeight: lightWeight }}>{rescheduleNote}</p>}
            {pkgThanks && <p className="mb-4 rounded-2xl px-4 py-3 text-[13px]" style={{ background: accent, color: onAcc, fontWeight: lightWeight }}>Thank you — your package is ready. Your credits come off each visit; just book as usual.</p>}
            {memberThanks && <p className="mb-4 rounded-2xl px-4 py-3 text-[13px]" style={{ background: accent, color: onAcc, fontWeight: lightWeight }}>Welcome — you&apos;re a member. Your included visits and perks apply from your next booking.</p>}
            {providerMemberships.length > 0 && (
              <div className="mb-8">
                {eyebrow('Membership')}
                <div className="mt-3 space-y-3">
                  {providerMemberships.map((m: any) => (
                    <div key={m.id} className="rounded-2xl p-4" style={{ background: card, border: `1px solid ${line}` }}>
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-[19px] leading-tight" style={{ fontFamily: face, fontWeight: lightWeight }}>{m.name}</p>
                        <p className="shrink-0 text-[15px] tabular-nums" style={{ color: accent, fontWeight: lightWeight }}>${(m.priceCents / 100).toFixed(0)}<span className="text-[11px]" style={{ color: mute }}>/mo</span></p>
                      </div>
                      {m.description && <p className="mt-1 text-[13px] leading-snug" style={{ color: mute, fontWeight: lightWeight }}>{m.description}</p>}
                      <ul className="mt-3 space-y-1">
                        {m.includedVisits > 0 && <li className="flex gap-2 text-[13px]" style={{ fontWeight: lightWeight }}><span style={{ color: accent }}>✓</span>{m.includedVisits} visit{m.includedVisits === 1 ? '' : 's'} included every month</li>}
                        {m.discountPct > 0 && <li className="flex gap-2 text-[13px]" style={{ fontWeight: lightWeight }}><span style={{ color: accent }}>✓</span>{m.discountPct}% off every other service</li>}
                        {(m.perks || []).map((p: string, i: number) => <li key={i} className="flex gap-2 text-[13px]" style={{ fontWeight: lightWeight }}><span style={{ color: accent }}>✓</span>{p}</li>)}
                      </ul>
                      <p className="mt-2 text-[10px]" style={{ color: mute }}>{policyText(m)} Cancel any time.</p>
                      <button type="button" onClick={() => joinMembership(m)} className="mt-3 w-full rounded-full py-3 text-[11px] font-medium" style={{ ...caps, letterSpacing: '0.25em', background: accent, color: onAcc }}>Become a member</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {providerPackages.length > 0 && (
              <div className="mb-8">
                {eyebrow('Packages')}
                <div className="mt-3 space-y-2">
                  {providerPackages.map((pkg: any) => (
                    <div key={pkg.id} className="flex items-center justify-between gap-3 py-3" style={{ borderTop: `1px solid ${line}`, borderBottom: `1px solid ${line}` }}>
                      <div className="min-w-0 flex-1">
                        <p className="text-[17px] font-light leading-tight" style={{ fontFamily: face }}>{pkg.name}</p>
                        <p className="mt-0.5 text-[12px] font-light" style={{ color: mute }}>{pkg.credits} visit{pkg.credits === 1 ? '' : 's'}{pkg.serviceName ? ` · ${pkg.serviceName}` : ''} · ${(pkg.priceCents / pkg.credits / 100).toFixed(0)} each · valid {pkg.validDays} days</p>
                        {pkg.description && <p className="mt-1 text-[12px] font-light leading-snug" style={{ color: mute }}>{pkg.description}</p>}
                        <p className="mt-1 text-[10px] font-light" style={{ color: mute, opacity: 0.8 }}>{policyText(pkg)}</p>
                      </div>
                      <button type="button" disabled={pkgBuying === pkg.id} onClick={() => buyPackage(pkg)} className="shrink-0 rounded-full px-4 py-2 text-[11px] font-medium disabled:opacity-50" style={{ ...caps, letterSpacing: '0.2em', background: accent, color: onAcc }}>
                        {pkgBuying === pkg.id ? '…' : `$${(pkg.priceCents / 100).toFixed(0)}`}
                      </button>
                    </div>
                  ))}
                </div>
                {pkgErr && <p className="mt-2 text-[12px]" style={{ color: '#b91c1c' }}>{pkgErr}</p>}
              </div>
            )}
            {(() => {
              const rel = (linkedProvider as any)?.renterBooking || null;
              const sent = releaseSentence(rel, new Date(), tenant?.timezone || 'America/New_York');
              const anyMembersOnly = services.some((x: any) => x.membersOnly === true);
              const memberPerk = !!sent.members || anyMembersOnly;
              const hasRelease = !!rel && (rel.mode || 'off') !== 'off';
              if (!hasRelease && !anyMembersOnly) return null;
              return (
                <div className="mb-6 rounded-2xl p-3" style={{ background: card, border: `1px solid ${memberOk ? accent : line}` }}>
                  {memberOk ? (
                    <p className="text-[12px]" style={{ color: ink }}>✓ Member{sent.members ? ` — ${sent.members.replace(/^Members /, 'you ')}` : ''}{anyMembersOnly ? ' Members-only services are unlocked below.' : ''}</p>
                  ) : (
                    <>
                      <p className="text-[12px]" style={{ color: ink }}>{sent.everyone}{sent.members ? ` ${sent.members}` : ''}{anyMembersOnly ? ' Some services are members only.' : ''}</p>
                      {(sent.members || anyMembersOnly) && (
                        <div className="mt-2 flex gap-2">
                          <input value={memberEmail} onChange={(e) => { setMemberEmail(e.target.value); setMemberOk(null); }} inputMode="email" placeholder="Member? Your email" aria-label="Member email" className="h-10 min-w-0 flex-1 rounded-xl px-3 text-[13px]" style={{ background: bg, color: ink, border: `1px solid ${line}` }} />
                          <button type="button" disabled={memberChecking} onClick={checkMember} className="h-10 shrink-0 rounded-xl px-3 text-[10px] font-medium disabled:opacity-50" style={{ ...caps, letterSpacing: '0.2em', background: accent, color: onAcc }}>{memberChecking ? '…' : 'Unlock'}</button>
                        </div>
                      )}
                      {memberOk === false && <p className="mt-1 text-[11px]" style={{ color: mute }}>No active membership under that email.</p>}
                    </>
                  )}
                </div>
              );
            })()}
            {eyebrow('Services')}
            <p className="mt-2 text-[32px] font-light leading-none" style={{ fontFamily: face }}>Menu</p>
            {addr && <p className="mt-2 text-[12px] font-light" style={{ color: mute }}>{addr}</p>}
            <div className="mt-6">
              {services.length === 0 && <p className="text-sm font-light" style={{ color: mute }}>No services listed yet.</p>}
              {(cats.length ? cats : ['']).map((cat) => (
                <div key={cat || 'all'} className="mb-6">
                  {cat && <p className="mb-2 text-[10px]" style={{ ...caps, letterSpacing: '0.3em', color: mute }}>{cat}</p>}
                  {services.filter((sv: any) => (cat ? String(sv.category || '').trim() === cat : true) && (sv.membersOnly !== true || memberOk === true)).map((sv: any, i: number, arr: any[]) => (
                    <button key={sv.id} onClick={() => setProviderPeek(sv)} className="group flex w-full items-start gap-4 py-4 text-left" style={{ borderTop: i === 0 ? `1px solid ${line}` : undefined, borderBottom: `1px solid ${line}` }}>
                      {sv.imageUrl && <img src={sv.imageUrl} alt="" className="h-16 w-16 shrink-0 object-cover" style={{ borderRadius: 2 }} />}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="text-[19px] font-light leading-tight" style={{ fontFamily: face }}>{sv.name}{sv.membersOnly ? <span className="ml-2 align-middle text-[9px]" style={{ ...caps, letterSpacing: '0.2em', color: accent }}>Members</span> : null}</p>
                          {sv.price != null && <span className="shrink-0 text-[15px] font-light tabular-nums" style={{ color: accent }}>${sv.price}</span>}
                        </div>
                        {sv.description && <p className="mt-1 text-[13px] font-light leading-snug line-clamp-2" style={{ color: mute }}>{sv.description}</p>}
                        <p className="mt-1.5 text-[10px]" style={{ ...caps, letterSpacing: '0.25em', color: mute }}>{sv.duration ? `${sv.duration} min` : ''}{sv.renterChargesEnabled && sv.renterDepositAmount > 0 ? ` · $${Number(sv.renterDepositAmount).toFixed(0)} deposit` : ''}{sv.videoUrl ? <span style={{ color: accent }}> · ▶ video</span> : null}</p>
                      </div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {providerTab === 'work' && gallery && (
          <div className={pane}>
            {eyebrow(gallery.title || 'My work')}
            <div className="mt-4 columns-2 gap-2 [&>*]:mb-2">
              {(gallery.photos || []).map((u, i) => (
                <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="block overflow-hidden" style={{ borderRadius: 2, breakInside: 'avoid' }}>
                  <img src={u} alt={`${p.name || 'Work'} — ${i + 1}`} loading={i < 4 ? 'eager' : 'lazy'} className="w-full object-cover" style={{ aspectRatio: i % 3 === 0 ? '4 / 5' : '1 / 1' }} />
                </a>
              ))}
            </div>
          </div>
        )}

        {providerTab === 'about' && (
          <div className={pane}>
            {p.bio && <p className="text-[22px] font-light leading-snug" style={{ fontFamily: face }}>{p.bio}</p>}
            {about?.text && (<div className="mt-6">{eyebrow(about.title || 'About')}<p className="mt-2 text-[15px] font-light leading-relaxed whitespace-pre-wrap" style={{ color: ink }}>{about.text}</p></div>)}
            {rows.length > 0 && (
              <div className="mt-8">{eyebrow('Find me')}<div className="mt-3 divide-y" style={{ borderColor: line }}>
                {rows.map((r, i) => (
                  <a key={i} href={r.href} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between py-3 text-[14px] font-light" style={{ borderTop: i === 0 ? `1px solid ${line}` : undefined, borderBottom: `1px solid ${line}` }}>{r.label}<span style={{ color: accent }}>↗</span></a>
                ))}
              </div></div>
            )}
            {policyLines.length > 0 && (
              <div className="mt-8">{eyebrow(policies?.title || 'Policies')}
                <ol className="mt-3 space-y-3">
                  {policyLines.map((t, i) => (
                    <li key={i} className="flex gap-4 text-[14px] font-light leading-relaxed"><span className="shrink-0 tabular-nums" style={{ color: accent }}>{String(i + 1).padStart(2, '0')}</span><span>{t}</span></li>
                  ))}
                </ol>
              </div>
            )}
            {faq && (faq.items || []).length > 0 && (
              <div className="mt-8">{eyebrow(faq.title || 'Good to know')}
                <div className="mt-3">
                  {(faq.items || []).map((it, i) => (
                    <details key={i} className="group py-3" style={{ borderTop: i === 0 ? `1px solid ${line}` : undefined, borderBottom: `1px solid ${line}` }}>
                      <summary className="flex cursor-pointer list-none items-center justify-between text-[15px] font-light">{it.q}<span className="ml-3 transition-transform group-open:rotate-45" style={{ color: accent }}>+</span></summary>
                      <p className="mt-2 text-[14px] font-light leading-relaxed whitespace-pre-wrap" style={{ color: mute }}>{it.a}</p>
                    </details>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {providerTab === 'reviews' && (
          <div className={pane}>
            {eyebrow('What clients say')}
            {p.reviewAverage ? <p className="mt-2 text-[32px] font-light leading-none" style={{ fontFamily: face }}>{p.reviewAverage} <span className="text-[18px]" style={{ color: accent }}>★</span> <span className="text-[13px] font-light" style={{ color: mute }}>from {p.reviewCount || reviews.length}</span></p> : null}
            <div className="mt-6 space-y-6">
              {reviews.map((r: any, i: number) => (
                <figure key={i}>
                  {rule}
                  <blockquote className="mt-4 text-[17px] font-light leading-relaxed" style={{ fontFamily: face }}>“{r.text || 'Loved it.'}”</blockquote>
                  <figcaption className="mt-2 flex items-center justify-between text-[10px]" style={{ ...caps, letterSpacing: '0.25em', color: mute }}><span>{r.name || 'Client'}{r.service ? ` · ${r.service}` : ''}</span><span style={{ color: accent }}>{'★'.repeat(Math.max(1, Math.min(5, Number(r.rating) || 5)))}</span></figcaption>
                </figure>
              ))}
            </div>
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 z-10 px-6 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3" style={{ background: bg, borderTop: `1px solid ${line}` }}>
          {providerTab !== 'book' && services.length > 0 && (
            <button type="button" onClick={() => setProviderTab('book')} className="mb-3 flex h-12 w-full items-center justify-center text-[11px] font-medium" style={{ ...caps, letterSpacing: '0.3em', background: accent, color: onAcc, borderRadius: 999 }}>Book an appointment</button>
          )}
          <nav className="flex items-center justify-between" aria-label="Sections">
            {tabs.map(([k, l]) => (
              <button key={k} type="button" onClick={() => setProviderTab(k as any)} aria-pressed={providerTab === k} className="relative flex-1 py-2 text-[10px] transition-opacity" style={{ ...caps, letterSpacing: '0.3em', color: providerTab === k ? ink : mute, opacity: providerTab === k ? 1 : 0.7 }}>
                {l}
                {providerTab === k && <span className="absolute inset-x-6 -bottom-0.5 h-px" style={{ background: accent }} />}
              </button>
            ))}
          </nav>
          <a href={`/book/${tenantId}`} className="mt-2 block text-center text-[8px]" style={{ ...caps, letterSpacing: '0.3em', color: mute, opacity: 0.5 }}>Partnered with {tenant?.name || 'the studio'}</a>
        </div>

        {buying && (
          <div className="fixed inset-0 z-30 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label="Your details">
            <button type="button" aria-label="Close" onClick={() => setBuying(null)} className="absolute inset-0" style={{ background: dark ? 'rgba(0,0,0,0.6)' : 'rgba(28,25,23,0.35)' }} />
            <div className="relative max-h-[88dvh] overflow-y-auto overscroll-contain px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5" style={{ background: bg, color: ink, borderTopLeftRadius: 24, borderTopRightRadius: 24 }}>
              {eyebrow(buying.kind === 'package' ? 'Buy a package' : 'Become a member')}
              <p className="mt-2 text-[24px] leading-tight" style={{ fontFamily: face, fontWeight: lightWeight }}>{buying.item.name}</p>
              <p className="mt-1 text-[13px]" style={{ color: mute, fontWeight: lightWeight }}>{buying.kind === 'package' ? `${buying.item.credits} visit${buying.item.credits === 1 ? '' : 's'} · $${(buying.item.priceCents / 100).toFixed(0)} once` : `$${(buying.item.priceCents / 100).toFixed(0)} a month · cancel any time`}</p>
              <div className="mt-4 space-y-2">
                <button type="button" aria-pressed={buyer.existing} onClick={() => setBuyer((b) => ({ ...b, existing: !b.existing }))} className="w-full rounded-xl px-3 py-2.5 text-left text-[12px]" style={{ border: `1px solid ${buyer.existing ? accent : line}`, color: ink, fontWeight: lightWeight }}>
                  {buyer.existing ? `✓ I already book with ${first} — use the email on my record` : `Already a client of ${first}? Tap here`}
                </button>
                <input value={buyer.name} onChange={(e) => setBuyer((b) => ({ ...b, name: e.target.value.slice(0, 120) }))} placeholder="Your name" aria-label="Your name" className="h-12 w-full rounded-xl px-4 text-[15px]" style={{ background: card, color: ink, border: `1px solid ${line}` }} />
                <input value={buyer.email} onChange={(e) => setBuyer((b) => ({ ...b, email: e.target.value.slice(0, 160) }))} inputMode="email" placeholder={buyer.existing ? 'The email you book with' : 'Email — receipt and credits go here'} aria-label="Email" className="h-12 w-full rounded-xl px-4 text-[15px]" style={{ background: card, color: ink, border: `1px solid ${line}` }} />
                <input value={buyer.phone} onChange={(e) => setBuyer((b) => ({ ...b, phone: e.target.value.slice(0, 40) }))} inputMode="tel" placeholder="Mobile (optional)" aria-label="Mobile" className="h-12 w-full rounded-xl px-4 text-[15px]" style={{ background: card, color: ink, border: `1px solid ${line}` }} />
              </div>
              <p className="mt-2 text-[11px]" style={{ color: mute }}>{buyer.existing ? `We match by email, so this lands on your existing record with ${first} — your history and credits in one place.` : `Paid securely through ${first}'s Stripe. Your ${buying.kind === 'package' ? 'credits' : 'membership'} are recorded under this email.`}</p>
              {pkgErr && <p className="mt-2 text-[12px]" style={{ color: '#ef4444' }}>{pkgErr}</p>}
              <button type="button" disabled={!!pkgBuying} onClick={submitPurchase} className="mt-4 flex h-14 w-full items-center justify-center text-[11px] font-medium disabled:opacity-50" style={{ ...caps, letterSpacing: '0.3em', background: accent, color: onAcc, borderRadius: 999 }}>
                {pkgBuying ? 'Opening checkout…' : buying.kind === 'package' ? `Pay $${(buying.item.priceCents / 100).toFixed(0)}` : `Start · $${(buying.item.priceCents / 100).toFixed(0)}/mo`}
              </button>
            </div>
          </div>
        )}
        {providerPeek && (() => {
          const sv = providerPeek;
          const yt = /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]+)/.exec(String(sv.videoUrl || ''));
          const file = !yt && /\.(mp4|mov|webm)(\?.*)?$/i.test(String(sv.videoUrl || '')) ? sv.videoUrl : '';
          return (
            <div className="fixed inset-0 z-20 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label={sv.name}>
              <button type="button" aria-label="Close" onClick={() => setProviderPeek(null)} className="absolute inset-0" style={{ background: dark ? 'rgba(0,0,0,0.6)' : 'rgba(28,25,23,0.35)' }} />
              <div className="relative max-h-[88dvh] overflow-y-auto overscroll-contain" style={{ background: bg, color: ink, borderTopLeftRadius: 24, borderTopRightRadius: 24 }}>
                {yt ? (
                  <div className="w-full" style={{ aspectRatio: '16 / 9' }}>
                    <iframe src={`https://www.youtube-nocookie.com/embed/${yt[1]}?rel=0&modestbranding=1`} title={sv.name} className="h-full w-full" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowFullScreen />
                  </div>
                ) : file ? (
                  <video src={file} controls playsInline className="w-full" style={{ aspectRatio: '4 / 5', objectFit: 'cover', background: '#000' }} />
                ) : sv.imageUrl ? (
                  <img src={sv.imageUrl} alt={sv.name} className="w-full object-cover" style={{ aspectRatio: '4 / 5' }} />
                ) : null}
                <div className="px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5">
                  <div className="flex items-baseline justify-between gap-4">
                    <p className="text-[28px] font-light leading-tight" style={{ fontFamily: face }}>{sv.name}</p>
                    {sv.price != null && <span className="shrink-0 text-[20px] font-light tabular-nums" style={{ color: accent }}>${sv.price}</span>}
                  </div>
                  <p className="mt-1 text-[10px]" style={{ ...caps, letterSpacing: '0.25em', color: mute }}>
                    {sv.duration ? `${sv.duration} min` : ''}{sv.category ? ` · ${sv.category}` : ''}{sv.renterChargesEnabled && sv.renterDepositAmount > 0 ? ` · $${Number(sv.renterDepositAmount).toFixed(0)} deposit to hold` : ''}
                  </p>
                  {sv.description && <p className="mt-4 text-[15px] font-light leading-relaxed whitespace-pre-wrap">{sv.description}</p>}
                  {sv.imageUrl && (yt || file) && <img src={sv.imageUrl} alt="" className="mt-4 w-full object-cover" style={{ aspectRatio: '4 / 3', borderRadius: 2 }} />}
                  <button type="button" onClick={() => { setProviderPeek(null); setDialogService(sv); setDialogOpen(true); }}
                    className="mt-6 flex h-14 w-full items-center justify-center text-[11px] font-medium" style={{ ...caps, letterSpacing: '0.3em', background: accent, color: onAcc, borderRadius: 999 }}>
                    Book this
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    );
  }

  if (awayProvider) {
    return (
      <div className="w-full min-h-dvh flex items-center justify-center p-6"
           style={{ background: resolvedStyle.bgColor, fontFamily: STACKS[resolvedStyle.bodyFont] || STACKS.jakarta }}>
        <div className="w-full max-w-sm bg-white p-8 text-center space-y-4"
             style={{ borderRadius: br(resolvedStyle), border: `2px solid ${ac(resolvedStyle)}25` }}>
          {awayProvider.photoUrl && (
            <img src={awayProvider.photoUrl} alt={awayProvider.name || 'Provider'}
                 className="w-20 h-20 rounded-full object-cover mx-auto" />
          )}
          <div>
            <p className="text-xl font-light" style={{ fontFamily: hf(resolvedStyle), color: ac(resolvedStyle) }}>
              {awayProvider.name || 'This provider'}
            </p>
            <p className="text-[11px] font-black uppercase tracking-widest mt-1" style={{ color: ac(resolvedStyle) + '80' }}>
              Books on their own site
            </p>
          </div>
          {awayProvider.bio && <p className="text-sm text-slate-600">{awayProvider.bio}</p>}
          {awayProvider.externalBookingUrl ? (
            <a href={awayProvider.externalBookingUrl} target="_blank" rel="noopener noreferrer"
               className="block w-full py-4 text-white text-[11px] font-black uppercase tracking-widest"
               style={{ background: ac(resolvedStyle), borderRadius: br(resolvedStyle) }}>
              Book with {String(awayProvider.name || '').split(' ')[0] || 'them'}
            </a>
          ) : (
            <p className="text-sm text-slate-600">
              They take bookings directly — contact the studio and we&apos;ll point you their way.
            </p>
          )}
          <a href={`/book/${tenantId}`} className="block text-[10px] font-black uppercase tracking-widest text-slate-400">
            See everyone else here
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-h-dvh overflow-x-hidden"
         style={{ background: resolvedStyle.bgColor, fontFamily: STACKS[resolvedStyle.bodyFont] || STACKS.jakarta }}>

      {showPicker && (
        <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowPicker(false)}/>
          <div className="relative w-full sm:max-w-lg sm:mx-4 bg-white overflow-hidden"
               style={{ borderRadius: '24px 24px 0 0', maxHeight: '80dvh' }}>
            <div className="flex items-center justify-between px-5 py-4 border-b"
                 style={{ borderColor: ac(resolvedStyle) + '20' }}>
              <p className="font-black text-sm uppercase tracking-widest"
                 style={{ fontFamily: bf(resolvedStyle), color: ac(resolvedStyle) }}>Select a Service</p>
              <button onClick={() => setShowPicker(false)}
                      className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                <XIcon className="w-4 h-4"/>
              </button>
            </div>
            <div className="overflow-y-auto p-4 space-y-2" style={{ maxHeight: '60dvh' }}>
              {services.map((s: any) => (
                <button key={s.id}
                        onClick={() => { setDialogService(s); setShowPicker(false); setDialogOpen(true); }}
                        className="w-full flex items-center justify-between p-4 text-left hover:shadow-md transition-all"
                        style={{ borderRadius: br(resolvedStyle), border: `2px solid ${ac(resolvedStyle)}25`, background: 'white' }}>
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-sm uppercase tracking-tight text-slate-900 truncate"
                       style={{ fontFamily: bf(resolvedStyle) }}>{s.name}</p>
                    {s.duration && <p className="text-[10px] font-black uppercase tracking-widest mt-0.5"
                                      style={{ color: ac(resolvedStyle) + '80' }}>{s.duration} min</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-4">
                    {s.price && <span className="text-xl font-light"
                                      style={{ fontFamily: hf(resolvedStyle), color: ac(resolvedStyle) }}>${s.price}</span>}
                    <ArrowRight className="w-4 h-4 text-slate-300"/>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {(() => {
        const rel = (tenant as any)?.bookingRelease || null;
        const hasRelease = !!rel && (rel.mode || 'off') !== 'off';
        const anyMembersOnly = services.some((sv: any) => sv.membersOnly === true);
        if (!hasRelease && !anyMembersOnly) return null;
        const sent = releaseSentence(rel, new Date(), (tenant as any)?.timezone || 'America/New_York');
        const memberPerk = !!sent.members || anyMembersOnly;
        return (
          <div className="mx-auto w-full max-w-3xl px-4 pt-4">
            <div className="rounded-2xl border px-4 py-3" style={{ borderColor: studioMemberOk ? 'currentColor' : 'rgba(120,113,108,0.3)' }}>
              {studioMemberOk ? (
                <p className="text-[13px]">✓ Member — {sent.members ? sent.members.replace(/^Members /, 'you ') : 'welcome back.'}{anyMembersOnly ? ' Members-only services are unlocked below.' : ''}</p>
              ) : (
                <>
                  <p className="text-[13px]">{hasRelease ? sent.everyone : ''}{sent.members ? ` ${sent.members}` : ''}{anyMembersOnly ? ' Some services are members only.' : ''}</p>
                  {memberPerk && (
                    <div className="mt-2 flex gap-2">
                      <input value={studioMemberInput} onChange={(e) => { setStudioMemberInput(e.target.value); setStudioMemberOk(null); }} placeholder="Member? Email or phone" aria-label="Member email or phone" className="h-10 min-w-0 flex-1 rounded-xl border bg-transparent px-3 text-[13px]" />
                      <button type="button" disabled={studioMemberBusy} onClick={checkStudioMember} className="h-10 shrink-0 rounded-xl bg-slate-900 px-4 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-50">{studioMemberBusy ? '…' : 'Unlock'}</button>
                    </div>
                  )}
                  {studioMemberOk === false && <p className="mt-1 text-[11px] opacity-70">No active membership under that — check the email or phone on your membership.</p>}
                </>
              )}
            </div>
          </div>
        );
      })()}
      {activeSections.map(section => (
        <SectionWrapper key={section.id} section={section} isPreview={false}
          onEdit={() => {}} onFieldTap={() => {}}>
          <SectionRenderer section={section} style={resolvedStyle} data={data}
            isPreview={false} onFieldTap={() => {}}/>
        </SectionWrapper>
      ))}

      {elsewhere.length > 0 && (
        <div className="px-5 py-8 max-w-lg mx-auto w-full">
          <p className="text-[10px] font-black uppercase tracking-widest text-center mb-3"
             style={{ color: ac(resolvedStyle) + '80' }}>Also at this studio</p>
          <div className="space-y-2">
            {elsewhere.map((m: any) => (
              <a key={m.id} href={m.externalBookingUrl} target="_blank" rel="noopener noreferrer"
                 className="flex items-center gap-3 p-4 bg-white hover:shadow-md transition-all"
                 style={{ borderRadius: br(resolvedStyle), border: `2px solid ${ac(resolvedStyle)}25` }}>
                {m.photoUrl
                  ? <img src={m.photoUrl} alt={m.name || ''} className="w-10 h-10 rounded-full object-cover shrink-0" />
                  : <div className="w-10 h-10 rounded-full bg-slate-100 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="font-black text-sm text-slate-900 truncate">{m.name}</p>
                  <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: ac(resolvedStyle) + '80' }}>
                    Books on their own site
                  </p>
                </div>
                <ArrowRight className="w-4 h-4 text-slate-300 shrink-0"/>
              </a>
            ))}
          </div>
        </div>
      )}

      <Footer tenant={tenant} style={resolvedStyle}/>
    </div>
  );
}

export default function BookingPage({ params }: { params: { tenantId: string } }) {
  return <BookingPageContent tenantId={params.tenantId}/>;
}
