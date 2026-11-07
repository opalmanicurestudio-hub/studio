'use client';

export const dynamic = 'force-dynamic';

import { BookingRewards } from '@/components/loyalty/BookingRewards';
import { giftCentsFor } from '@/lib/gift-visit';
import { GiftCoverBar } from '@/components/gift/GiftCoverBar';
import { channelFrom, catSlug } from '@/lib/share-links';
import { holdKeyOf, payForHeld, releaseHeld, KEPT_HOLD, EARLIER_PAID, type HeldPay } from '@/lib/booking/engine-confirm';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getFirestore } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import { doc, setDoc, getDoc, getDocs, addDoc, collection, query, orderBy, where } from 'firebase/firestore';
import { type PageBuilderConfig } from '@/lib/data';
import { tenantTimeZone, todayIn } from '@/lib/tenant-time';
import { resolveBookingPlan } from '@/lib/deposit-policy';
import { linkHref, LINK_KINDS, livePageSections, cleanBrand, onAccent } from '@/lib/renter-identity';
import { policyText } from '@/lib/package-credits';
import { horizonDaysFor, releaseSentence } from '@/lib/booking-release';
import { brandColor, studioPage, lifted, readable } from '@/lib/studio-page';
import { StudioBookingPage } from '@/components/booking/StudioBookingPage';
import { privacyOf } from '@/lib/health-privacy';
import { PublicFrame } from '@/components/public/kit';
import { BookingSheet } from '@/components/booking/BookingSheet';
import {
  ANIM_CSS, STACKS, GFONTS,
  StyleConfig,
  DS, hexToHsl, injectFonts,
  isBuilderConfig,
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
  | { requiresPayment: true; clientSecret: string; stripeAccountId?: string; appointmentId?: string }
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
  const [bookingOutcome, setBookingOutcome] = useState<{ status: string; notice: string; depositCents: number; cardOnFile?: boolean; prepUrl?: string | null; visitUrl?: string | null; earlier?: boolean; verify?: { tenantId: string; apptId: string; k: string } | null; stillNeeded?: string[]; photosLeftOut?: number } | null>(null);
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
  const [campaignRef, setCampaignRef] = useState<{ campaignId: string | null; code: string | null } | null>(null);
  const [oppRef] = useState<string | null>(() => { try { const v = new URLSearchParams(window.location.search).get('opp') || ''; return /^[A-Za-z0-9_-]{6,60}$/.test(v) ? v : null; } catch { return null; } });
  // The offer the client is booking with — shown to them, checked on the server.
  const [offerShown, setOfferShown] = useState<{ code: string; line: string; amount?: string; until?: string | null; oncePer?: boolean; from?: string } | null>(null);
  // ?ref=<their link> — a friend sent them (lib/referrals). The welcome offer shows like any offer; the server decides.
  const [refCampaign] = useState<string | null>(() => { try { const v = new URLSearchParams(window.location.search).get('cp') || ''; return /^[a-z0-9]{2,40}\.[a-z0-9]{2,40}$/i.test(v) ? v : null; } catch { return null; } });
  const [refSlug] = useState<string | null>(() => { try { const v = new URLSearchParams(window.location.search).get('ref') || ''; return /^[a-z0-9-]{3,40}$/.test(v) ? v : null; } catch { return null; } });
  useEffect(() => { if (!refSlug || !tenantId) return;
    fetch('/api/referrals/public', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'info', tenantId, code: refSlug }) }).then((r) => r.json()).then((r) => {
      if (r?.ok && r.offerCents > 0) setOfferShown({ code: r.code || 'WELCOME', line: `$${Math.round(r.offerCents / 100)} off your first visit`, amount: `$${Math.round(r.offerCents / 100)} off your first visit`, until: null, from: r.firstName || undefined }); }).catch(() => {}); }, [refSlug, tenantId]);
  const [offerInput, setOfferInput] = useState('');
  const [offerErr, setOfferErr] = useState('');
  const [offerOpen, setOfferOpen] = useState(false);
  // Checks an offer code; says why it didn't work (null when it did), for the page that asked.
  const checkOffer = async (code: string, quiet = false): Promise<string | null> => {
    setOfferErr('');
    try {
      // On a renter's page the code is checked against THAT renter's offers.
      const r = await fetch('/api/offers/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, code, ...(providerId ? { provider: providerId } : {}) }) });
      const d = await r.json().catch(() => null);
      if (d?.ok) { setOfferShown({ code: d.code, line: d.line, amount: d.amount, until: d.until, oncePer: d.oncePer }); setCampaignRef((x) => ({ campaignId: x?.campaignId || null, code: d.code })); setOfferOpen(false); return null; }
      const why = d?.error || 'That code didn’t work.';
      if (!quiet) setOfferErr(why); if (quiet) setCampaignRef((x) => (x ? { ...x, code: null } : x));
      return why;
    } catch { if (!quiet) setOfferErr('Couldn’t check that code right now.'); return 'Couldn’t check that code right now. Try again in a moment.'; }
  };
  useEffect(() => { if (campaignRef?.code && !offerShown) void checkOffer(campaignRef.code, true); }, [campaignRef?.code]); // eslint-disable-line react-hooks/exhaustive-deps
  // A renter link (?provider=) that matches nobody (they left, or the link was mistyped): the business's own page, with
  // a note saying so, rather than an empty or broken one.
  const [staleProvider, setStaleProvider] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);   // the provider (or '') the loaded data is for
  // The menu couldn't be loaded (a slow or failed answer): the page says so, with Try again, never "coming soon".
  const [loadFailed, setLoadFailed] = useState(false); const [loadTry, setLoadTry] = useState(0);
  const [studioStaffId, setStudioStaffId] = useState<string | undefined>(undefined);
  // The appointment we're holding for a deposit — a retry pays for THIS one
  // instead of booking the same time again.
  const heldPay = useRef<HeldPay | null>(null);
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
      // From a campaign's Book button: which campaign, and its offer code —
      // carried with the booking so checkout applies it without anyone typing.
      try {
        const q = new URLSearchParams(window.location.search);
        const cid = (q.get('c') || '').slice(0, 64); const code = (q.get('code') || '').slice(0, 40);
        if (cid || code) setCampaignRef({ campaignId: cid || null, code: code || null });
      } catch { /* no-op */ }
      const rs = new URLSearchParams(window.location.search).get('reschedule') || '';
      if (rs) {
        const rk = new URLSearchParams(window.location.search).get('k') || '';
        fetch(`/api/appointments/self-cancel?tenantId=${encodeURIComponent(tenantId)}&appointmentId=${encodeURIComponent(rs)}&k=${encodeURIComponent(rk)}`)
          .then((r) => r.json()).then((d) => {
            if (d?.ok && d.appointment && d.appointment.status !== 'cancelled') setReschedule({ id: rs, key: rk, ...d.appointment });
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
  const [giftCents, setGiftCents] = useState(0);   // came from their gift card (lib/gift-visit) — mark what it covers
  useEffect(() => { setGiftCents(giftCentsFor(String(tenantId || ''))); }, [tenantId]);

  // While the page loads: the paper and color this business's page had last time on this device (the same look Find
  // my booking remembers), so the first thing a returning visitor sees is already theirs.
  // (Read after the first paint, so the server's page and the browser's agree.)
  const [look, setLook] = useState<{ accent: string; paper: string } | null>(null);
  useEffect(() => {
    try {
      const k = JSON.parse(localStorage.getItem(`cf.look.${tenantId}`) || 'null'); if (!k?.accent) return;
      const night = k.mood === 'night'; const accent = String(k.accent);
      setLook({ accent: night ? lifted(accent) : accent, paper: night ? '#16171a' : k.mood === 'crisp' ? '#ffffff' : '#faf8f5' });
    } catch { /* none */ }
  }, [tenantId]);
  useEffect(() => { if (!tenant || !tenantId) return; try { localStorage.setItem(`cf.look.${tenantId}`, JSON.stringify({ name: tenant.name || '', accent: brandColor(tenant), mood: studioPage(tenant).mood, logoUrl: tenant.logoUrl || null })); } catch { /* none */ } }, [tenant, tenantId]);

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
          if (isBuilderConfig(pc)) setSavedConfig(pc as PageBuilderConfig);   // a renter's booking flow still takes its look from it
        }
      } catch (e) { console.warn('[booking:config]', e); }
      if (!cancelled) setConfigReady(true);
    };
    run();
    return () => { cancelled = true; };
  }, [tenantId, getDb]);

  // Phase 2: Load services, staff, events (non-blocking)
  useEffect(() => {
    if (!configReady) return;
    if (!tenantId) { setLoadedFor(providerId); return; }
    let cancelled = false;
    // Never more than a few seconds of waiting, for the answer and its body alike; a page that's left (or a provider
    // that changes) stops its load.
    const ctl = new AbortController(); let giveUp = 0; let doneFor = providerId;
    const run = async () => {
      const db = getDb(); if (!db) { if (!cancelled) setLoadedFor(providerId); return; }
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
        // Loaded on the SERVER (/api/booking/public-data): visitors who aren't
        // signed in may not read the team, appointments, shifts or days off
        // directly — the route returns only what they may see (busy times,
        // never other clients' details). Same shape as before, so the page's
        // availability logic is unchanged.
        giveUp = window.setTimeout(() => ctl.abort(), 8000);
        const res = await fetch('/api/booking/public-data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId }), signal: ctl.signal });
        const pd: any = await res.json().catch(() => null);
        window.clearTimeout(giveUp);
        if (!pd?.ok) throw new Error(pd?.error || 'Could not load the booking page.');
        const asSnap = (arr: any[]) => ({ docs: (arr || []).map((x: any) => { const { id, ...rest } = x || {}; return { id, data: () => rest }; }) });
        const [svSnap, stSnap, evSnap, aptSnap, spSnap, ptSnap, cfSnap, shSnap, sbSnap, doSnap, rsSnap, tkSnap, mpSnap, ceSnap, rsvSnap] =
          [pd.services, pd.staff, pd.studioEvents, pd.appointments, pd.scheduleProfiles, pd.pricingTiers, pd.consentForms, pd.shifts, pd.staffBlocks, pd.dayOffBlocks, pd.resources, pd.tickets, pd.maintenancePlans, pd.events, pd.renterServices].map(asSnap);
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
          if (providerId && !provider && !optedOut) {
            setStaleProvider(true); setProviderId(''); doneFor = '';   // the business's own data is loaded below already: show it now
            try { const u = new URL(window.location.href); u.searchParams.delete('provider'); window.history.replaceState(window.history.state, '', u.toString()); } catch { /* the note still shows */ }
          }
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
          setLoadFailed(false);
        }
      } catch (e) { console.warn('[booking:data]', e); if (!cancelled) setLoadFailed(true); }
      window.clearTimeout(giveUp);
      if (!cancelled) setLoadedFor(doneFor);   // loaded or not, never left waiting
    };
    run();
    return () => { cancelled = true; window.clearTimeout(giveUp); ctl.abort(); };
  }, [tenantId, configReady, getDb, providerId, loadTry]);

  // Booking events
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.service) { if (memberLocked(d.service)) setMemberAsk({ service: d.service, at: Date.now() }); else { setDialogService(d.service); setDialogOpen(true); } }
      else if (services.length === 1) { if (memberLocked(services[0])) setMemberAsk({ service: services[0], at: Date.now() }); else { setDialogService(services[0]); setDialogOpen(true); } }
      else { const el = document.getElementById('services'); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 120 }); }   // no service named: the menu, under the header
    };
    window.addEventListener('cf-book', h);
    return () => window.removeEventListener('cf-book', h);
  }, [services]);
  // ?hold=…&k=… — a time an assistant held for this client (lib/agent-holds): open straight on it, details filled in.
  const [agentHold, setAgentHold] = useState<{ id: string; key: string; live: boolean; date: string; time: string; staffId: string | null; expiresAt: string; client: { name: string; phone: string; email: string } } | null>(null);
  useEffect(() => { if (!tenantId) return; try { const q = new URLSearchParams(window.location.search); const id = q.get('hold') || '', k = q.get('k') || ''; if (!id || !k) return;
    fetch(`/api/agents/${encodeURIComponent(tenantId)}/hold?id=${encodeURIComponent(id)}&k=${encodeURIComponent(k)}`).then((x) => x.json()).then((h) => { if (h?.ok) setAgentHold({ id, key: k, live: !!h.live, date: h.date, time: h.time, staffId: h.staffId || null, expiresAt: h.expiresAt, client: h.client || {} }); }).catch(() => {}); } catch { /* no hold */ } }, [tenantId]);
  // A link to one service (e.g. the school website's clinic menu:
  // /book/{t}?service={id}) opens the booking sheet for it — once.
  const openedServiceLink = useRef(false);
  // ?category=… from a shared link → scroll straight to that part of the menu.
  useEffect(() => { try { const c = new URLSearchParams(window.location.search).get('category'); if (!c || !services.length) return;
    setTimeout(() => document.getElementById(`cat-${c}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300); } catch { /* no-op */ } }, [services.length]);
  useEffect(() => {
    if (openedServiceLink.current || !services.length) return;
    try {
      const want = new URLSearchParams(window.location.search).get('service');
      const hit = want ? services.find((sv: any) => sv.id === want) : null;
      // ?staff=… with it (a "book with Ana again" link): that person is chosen in the booking sheet.
      const who = new URLSearchParams(window.location.search).get('staff'); if (hit && who && /^[A-Za-z0-9_-]{1,80}$/.test(who)) setStudioStaffId(who);
      // A members-only one waits for the client to sign in (the page shows it, with its Members label).
      if (hit) { openedServiceLink.current = true; if (memberLocked(hit)) setMemberAsk({ service: hit, at: Date.now() }); else { setDialogService(hit); setDialogOpen(true); } }
    } catch { /* no-op */ }
  }, [services]);

  // Derive resolved config and style
  const studioPageRef = useRef(false);
  // Every business's page is the Studio page. Only a renter's own link shows their page (or, when they book on their
  // own site, where to find them), in their own look.
  const renterLink = !!providerId && (!!awayProvider || staff.some((m: any) => m.id === providerId && m.isRenter));
  const studioDesign = !renterLink;
  studioPageRef.current = studioDesign;
  const resolvedStyle: StyleConfig = {
    accentColor:  savedConfig?.accentColor  ?? DS.accentColor,
    bgColor:      savedConfig?.bgColor      ?? DS.bgColor,
    headingFont:  savedConfig?.headingFont  ?? DS.headingFont,
    bodyFont:     savedConfig?.bodyFont     ?? DS.bodyFont,
    borderRadius: savedConfig?.borderRadius ?? DS.borderRadius,
    buttonStyle:  savedConfig?.buttonStyle  ?? DS.buttonStyle,
    density:      savedConfig?.density      ?? DS.density,
  };

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
  // The same answer, readable at once: the page books right after a sign-in, before the state above has re-rendered.
  const studioMemberRef = useRef<boolean | null>(null);
  // On the Studio page, a members-only service waits for the client to sign in as a member: tapped on the page, from a
  // link or from a website button, the page asks them to sign in and then carries on (the booking re-checks on the
  // server). Renters' pages keep their own member checks.
  const memberLocked = (sv: any) => studioPageRef.current && sv?.membersOnly === true && studioMemberRef.current !== true;
  const [memberAsk, setMemberAsk] = useState<{ service: any; at: number } | null>(null);
  // Back from paying for a membership or package (?offer_paid=…): finish it (once; Stripe's notice does the same) and say so.
  const [bought, setBought] = useState<{ kind: 'membership' | 'package'; name: string; outcome: 'given' | 'refunded' | 'pending' | 'failed' | 'slow'; reason?: string; told?: boolean } | null>(null);
  useEffect(() => {
    if (!tenantId) return; let sid = ''; try { sid = new URLSearchParams(window.location.search).get('offer_paid') || ''; } catch { /* no-op */ }
    if (!/^cs_[A-Za-z0-9_]{6,200}$/.test(sid)) return;
    try { const u = new URL(window.location.href); u.searchParams.delete('offer_paid'); window.history.replaceState(null, '', u.toString()); } catch { /* no-op */ }
    // Asked a few times while it's being finished (or after a hiccup); then said plainly that it's taking longer.
    let tries = 0; let live = true; let timer: any = null;
    const again = (d?: any) => { if (!live) return; if (++tries < 8) { timer = setTimeout(ask, Math.min(8000, 2000 + tries * 1000)); setBought((b) => b || { kind: d?.kind || 'membership', name: d?.name || 'your purchase', outcome: 'pending' }); }
      else setBought((b) => ({ kind: d?.kind || b?.kind || 'membership', name: d?.name || b?.name || 'your purchase', outcome: 'slow' })); };
    const ask = () => fetch('/api/booking/offers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, action: 'finish', session: sid }) })
      .then((r) => r.json()).then((d) => { if (!live) return;
        if (d?.ok && d.outcome !== 'pending') setBought({ kind: d.kind, name: d.name, outcome: d.outcome, reason: d.reason });
        else if (d?.ok) again(d);
        else if (d?.error === 'needs_attention') setBought({ kind: d.kind || 'membership', name: d.name || 'your purchase', outcome: 'failed', told: d.told !== false });
        else if (d?.error !== 'not_found') again(d); })
      .catch(() => again());
    void ask(); return () => { live = false; if (timer) clearTimeout(timer); };
  }, [tenantId]);
  // A loyalty tier that books early: the client's own rewards link says how many extra days (components/loyalty/BookingRewards).
  const [earlyDays, setEarlyDays] = useState(0);
  useEffect(() => { const on = (e: any) => setEarlyDays(Math.max(0, Number(e?.detail) || 0)); window.addEventListener('cf-early-days', on); return () => window.removeEventListener('cf-early-days', on); }, []);
  const [studioMemberInput, setStudioMemberInput] = useState('');
  const [studioMemberBusy, setStudioMemberBusy] = useState(false);
  const [studioMemberErr, setStudioMemberErr] = useState('');   // the check couldn't be made (not the same as "not a member")
  // Is there an active membership behind this email or phone? (yes or no only; the booking re-checks.)
  // Throws 'throttled' (too many tries) or 'unavailable' (couldn't check) rather than calling either a "no".
  const memberCheck = async (contact: string): Promise<boolean> => {
    let d: any = null;
    try { const res = await fetch('/api/booking/member-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, contact }) }); d = await res.json().catch(() => null); }
    catch { throw new Error('unavailable'); }
    if (d?.throttled) throw new Error('throttled');
    if (!d || d.ok !== true) throw new Error('unavailable');
    studioMemberRef.current = !!d.member; setStudioMemberOk(!!d.member); return !!d.member;
  };
  const checkStudioMember = async () => {
    const v = studioMemberInput.trim(); if (!v) return;
    setStudioMemberBusy(true);
    setStudioMemberErr('');
    try { await memberCheck(v); } catch (e: any) { studioMemberRef.current = null; setStudioMemberOk(null); setStudioMemberErr(e?.message === 'throttled' ? 'Too many tries for now. Please try again in an hour.' : 'Couldn’t check right now. Try again in a moment.'); } finally { setStudioMemberBusy(false); }
  };
  const [memberOk, setMemberOk] = useState<boolean | null>(null);
  // A renter selling their own gift cards on their page (lib/gift-shop) — asked once; shown as a link when open.
  const [renterGift, setRenterGift] = useState(false);
  useEffect(() => { if (!providerId || !tenantId) return; fetch(`/api/gift-cards/shop?tenantId=${encodeURIComponent(tenantId)}&provider=${encodeURIComponent(providerId)}`).then((r) => r.json()).then((x) => setRenterGift(!!(x?.ok && x.open))).catch(() => {}); }, [providerId, tenantId]);
  const [memberChecking, setMemberChecking] = useState(false);
  const checkMember = async () => {
    const e = memberEmail.trim().toLowerCase(); if (!e || !providerId) return;
    setMemberChecking(true);
    try {
      const r = await fetch('/api/booking/public-data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, action: 'renter-member', providerId, email: e }) });
      const d = await r.json().catch(() => ({}));
      setMemberOk(!!d?.member);
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
        const r = await fetch('/api/booking/public-data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, action: 'renter-products', providerId }) });
        const d: any = await r.json().catch(() => ({}));
        setProviderPackages((d?.packages || []).filter((p: any) => p.isActive !== false).sort((a: any, b: any) => (a.priceCents || 0) - (b.priceCents || 0)));
        setProviderMemberships((d?.memberships || []).filter((m: any) => m.isActive !== false).sort((a: any, b: any) => (a.priceCents || 0) - (b.priceCents || 0)));
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
    // The Studio page and its flow paint with the business color from Settings › Booking page; a renter's flow keeps theirs.
    // A reschedule always opens the Studio flow, so it takes the business color too.
    const studioFlow = studioDesign || (!!reschedule && !providerId);
    try { root.style.setProperty('--primary', hexToHsl(studioFlow ? brandColor(tenant) : resolvedStyle.accentColor)); } catch {}
  }, [resolvedStyle, studioDesign, tenant, reschedule, providerId]);



  // Loading: the business's own paper, and (only if it takes a moment) a soft dot in their color, never a spinner. The
  // page waits for its services and team, so it never says "coming soon" for a moment, and a renter's link never
  // flashes the business's page before theirs.
  if (!configReady || loadedFor !== providerId) {
    return (
      <div className="flex min-h-dvh w-full items-center justify-center" style={{ background: look?.paper || '#faf8f5' }} aria-busy="true">
        <style>{`@keyframes cfWaitIn{from{opacity:0}to{opacity:1}}@keyframes cfWait{0%,100%{transform:scale(1);opacity:.9}50%{transform:scale(.7);opacity:.45}}
.cf-wait{width:10px;height:10px;border-radius:999px;animation:cfWaitIn .3s ease-out .4s both,cfWait 1.4s ease-in-out .4s infinite}@media (prefers-reduced-motion:reduce){.cf-wait{animation:cfWaitIn .3s ease-out .4s both}}`}</style>
        <span className="cf-wait" style={{ background: look?.accent || '#16171a' }} />
        <span className="sr-only">Loading</span>
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
  // ── handleConfirm ────────────────────────────────────────────────
  // ONE PATH (5a). Every online booking goes to the server first; the SERVER
  // decides what it is — a request awaiting approval, a hold waiting for a
  // deposit, or confirmed — and creates the appointment right away, so it
  // always shows in Requests or the planner. Signed forms travel with it.
  //   • hold for a deposit → Stripe opens for THAT appointment (the amount is
  //     read on the server); the webhook confirms the same appointment.
  //   • request (approval mode) → nothing is charged now; the client hears back.
  // (Was: the page chose its road by the deposit AMOUNT alone — in approval
  // mode that created a hidden bookingRequest + a payment the client was told
  // they didn't need, so the booking vanished; and paying skipped approval.)
  // A held booking that turned out to be paid (or needs nothing more): the booked screen, for that booking.
  // earlier: it was paid before they changed it, so that one (not what they changed to) is theirs.
  const bookedHeld = (h: HeldPay, earlier = false) => setBookingOutcome({ status: 'confirmed', notice: earlier ? EARLIER_PAID : '', depositCents: 0, cardOnFile: false, visitUrl: h.k ? `/check-in/${encodeURIComponent(h.k)}` : null, earlier, stillNeeded: h.left || [] });
  const handleConfirm = async (
    formData: { clientName: string; clientEmail: string; clientPhone?: string; notes?: string },
    apptDetails: any, signedForms: any[], setStep: (s: string) => void,
  ): Promise<ConfirmResult> => {
    try {
      const { depositAmount, depositStatus, ...restDetails } = apptDetails || {};
      void depositAmount; void depositStatus; // the server decides deposits now
      if (!restDetails?.serviceId || !restDetails?.startTime) {
        return { requiresPayment: true, error: 'Please pick a service and a time first.' };
      }
      // GUESTS OR MORE SERVICES → one request through the engine (all or nothing); the studio confirms, then asks for any deposit.
      const party: any = (restDetails as any).party;
      if (party && ((party.guests || []).length || (party.extras || []).length)) {
        // A time still held from paying a deposit a moment ago is let go first (paid meanwhile: that's their booking).
        if (heldPay.current) { const h = heldPay.current; const went = await releaseHeld(tenantId, heldPay);
          if (went === 'kept') return { requiresPayment: true, error: KEPT_HOLD };
          if (went === 'paid') { bookedHeld(h, true); setStep('confirmation'); return { requiresPayment: false }; } }
        const durOf = (id: string) => Number((services || []).find((x: any) => x.id === id)?.duration) || 60;
        const parts: any[] = [{ serviceId: restDetails.serviceId, staffId: restDetails.staffId || 'any', startTime: restDetails.startTime, addOnIds: restDetails.addOnIds || [] }];
        let after = new Date(restDetails.endTime || new Date(Date.parse(restDetails.startTime) + durOf(restDetails.serviceId) * 60000).toISOString()).getTime();
        for (const x of party.extras || []) { if (!x.serviceId) continue; if (x.when === 'after') { parts.push({ serviceId: x.serviceId, staffId: 'any', startTime: new Date(after).toISOString() }); after += durOf(x.serviceId) * 60000; } else parts.push({ serviceId: x.serviceId, staffId: 'any', startTime: restDetails.startTime }); }
        for (const g of party.guests || []) { if (!g.serviceId) continue; parts.push({ serviceId: g.serviceId, staffId: 'any', startTime: restDetails.startTime, guest: { name: g.name, email: g.email || '', phone: g.phone || '' } }); }
        const gr = await fetch('/api/appointments/book-group', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, parts, notes: formData.notes, signedForms: Array.isArray(signedForms) ? signedForms : [],
          channel: channelFrom(new URLSearchParams(window.location.search).get('src')), ...(refSlug ? { referralCode: refSlug } : {}), ...(refCampaign ? { referralCampaign: refCampaign } : {}), ...((restDetails as any).referredBy ? { referredBy: (restDetails as any).referredBy } : {}), ...((restDetails as any).referralTypedCode ? { referralTypedCode: (restDetails as any).referralTypedCode } : {}), organizer: { name: formData.clientName, email: formData.clientEmail, phone: formData.clientPhone, smsConsent: ((restDetails as any).smsConsent ?? (formData as any).smsConsent) === true, smsConsentText: (restDetails as any).smsConsentText || null,
            smsMarketing: (restDetails as any).smsMarketing === true, smsMarketingText: (restDetails as any).smsMarketing === true ? (restDetails as any).smsMarketingText || null : null },
          ...((restDetails as any).place ? { place: (restDetails as any).place } : {}), ...(Array.isArray((restDetails as any).inspirationPhotos) ? { inspirationPhotos: (restDetails as any).inspirationPhotos } : {}), ...((restDetails as any).nowPhoto ? { nowPhoto: (restDetails as any).nowPhoto } : {}) }) }).then((x) => x.json()).catch(() => null);
        if (!gr?.ok) return { requiresPayment: true, error: gr?.error || 'We couldn’t send that request — please try again. Nothing was booked.' };
        setBookingOutcome({ status: 'requested', notice: String(gr.clientNotice || ''), depositCents: Number(gr.depositCents) || 0, cardOnFile: false, photosLeftOut: Number(gr.photosLeftOut) || 0 } as any);
        return { requiresPayment: false };
      }
      const holdKey = holdKeyOf({ ...restDetails, notes: formData.notes }, { name: formData.clientName, email: formData.clientEmail, phone: formData.clientPhone }, signedForms);
      // Asked again for exactly the same booking while it holds its time for the deposit: pay for that one (and if it
      // turns out there's nothing left to pay, it's booked). Anything changed, or the hold ended: the held one is let
      // go and this is booked fresh.
      if (heldPay.current && heldPay.current.key === holdKey) {
        const h = heldPay.current; const again = await payForHeld(tenantId, h.appointmentId);
        if (again.settled) { heldPay.current = null; bookedHeld(h); setStep('confirmation'); return { requiresPayment: false }; }
        if (!again.ended) return again as ConfirmResult;
        heldPay.current = null;
      } else if (heldPay.current) {
        const h = heldPay.current; const went = await releaseHeld(tenantId, heldPay);
        if (went === 'kept') return { requiresPayment: true, error: KEPT_HOLD };
        if (went === 'paid') { bookedHeld(h, true); setStep('confirmation'); return { requiresPayment: false }; }
      }
      let bookRes: Response;
      try {
        bookRes = await fetch('/api/appointments/book', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId,
            source: 'booking-page',
            ...(agentHold?.live ? { holdId: agentHold.id, holdKey: agentHold.key } : {}),
            channel: channelFrom(new URLSearchParams(window.location.search).get('src')),   // where the link lived (website, instagram, google, qr…)
            ...(campaignRef ? { campaignId: campaignRef.campaignId, promoCode: campaignRef.code } : {}),
            ...(oppRef ? { opportunityId: oppRef } : {}),
            ...(refSlug ? { referralCode: refSlug } : {}),
            ...(refCampaign ? { referralCampaign: refCampaign } : {}),
            ...((restDetails as any).referredBy ? { referredBy: (restDetails as any).referredBy } : {}),
            ...((restDetails as any).referralTypedCode ? { referralTypedCode: (restDetails as any).referralTypedCode } : {}),
            serviceId: restDetails.serviceId,
            ...(Number((restDetails as any).acceptExtraCents) > 0 ? { acceptExtraCents: Number((restDetails as any).acceptExtraCents) } : {}),
            ...((restDetails as any).place ? { place: (restDetails as any).place } : {}),
            addOnIds: restDetails.addOnIds || [],
            staffId: restDetails.staffId || 'any',
            startTime: restDetails.startTime,
            client: { name: formData.clientName, email: formData.clientEmail, phone: formData.clientPhone,
              smsConsent: ((restDetails as any).smsConsent ?? (formData as any).smsConsent) === true, smsConsentText: (restDetails as any).smsConsentText || null,
              smsMarketing: ((restDetails as any).smsMarketing ?? (formData as any).smsMarketing) === true, smsMarketingText: (restDetails as any).smsMarketingText || null },
            notes: formData.notes,
            inspirationPhotoUrl: (restDetails as any).inspirationPhotoUrl || undefined,
            inspirationPhotos: Array.isArray((restDetails as any).inspirationPhotos) ? (restDetails as any).inspirationPhotos : undefined,
            nowPhoto: (restDetails as any).nowPhoto || undefined,
            signedForms: Array.isArray(signedForms) ? signedForms : [],
            // A reschedule: the old visit is released once this one is booked (or, with a deposit, paid for).
            ...(reschedule?.id ? { replacesAppointmentId: reschedule.id } : {}),
          }),
        });
      } catch {
        return { requiresPayment: true, error: 'We couldn’t reach the booking system — check your connection and try again. Nothing was booked yet.' };
      }
      const out = await bookRes.json().catch(() => null);
      if (!out?.ok) {
        if (out?.code === 'confirm_extra') return { requiresPayment: true, error: out.error, code: 'confirm_extra', extraMinutes: Number(out.extraMinutes) || 0, extraCents: Number(out.extraCents) || 0, line: String(out.line || '') } as any;
        if (out?.code === 'needs_longer') return { requiresPayment: true, error: out.error, code: 'needs_longer', extraMinutes: Number(out.extraMinutes) || 0 } as any;
        return { requiresPayment: true, error: out?.error || (bookRes.status === 409 ? 'That time was just taken — pick another slot.' : 'We could not hold that time. Please pick another slot.') };
      }
      // "Welcome back" next time on this device (the studio's own page only): their first name, the service and who did
      // it. Kept on the device, never sent anywhere; "Not Dana?" on the page forgets it.
      if (!providerId && studioPage(tenant).bookAgain && !privacyOf(tenant).discreet) { try { const who: any = (staff || []).find((m: any) => m.id === (out.staffId || restDetails.staffId));
        const first = String(formData.clientName || '').trim().split(/\s+/)[0].replace(/[^\p{L}\p{M}'-]/gu, '').slice(0, 40);
        if (first) localStorage.setItem(`cf.lastVisit.${tenantId}`, JSON.stringify({ first: first[0].toUpperCase() + first.slice(1), serviceId: restDetails.serviceId, staffId: who?.id || null, at: String(out.startTime || restDetails.startTime || '') })); } catch { /* private browsing: nothing kept */ } }
      /* The SERVER decided what this booking became; the screen, the email
       * and the text all say the same thing. */
      setBookingOutcome({ status: String(out.status || 'confirmed'), notice: String(out.clientNotice || ''), depositCents: Number(out.depositCents) || 0, cardOnFile: !!out.requiresCardOnFile,
        // "Confirm your number" (optional) on the confirmation screen, for a new client or a phone never confirmed.
        verify: out.phoneUnconfirmed && out.appointmentId && out.checkInToken ? { tenantId, apptId: String(out.appointmentId), k: String(out.checkInToken) } : null, prepUrl: typeof out.prepUrl === 'string' ? out.prepUrl : null,
        // The visit link (the one in every message about this visit), so the booked screen can open it.
        visitUrl: out.checkInToken ? `/check-in/${encodeURIComponent(String(out.checkInToken))}` : null,
        stillNeeded: Array.isArray(out.stillNeeded) ? out.stillNeeded.map(String).slice(0, 5) : [], photosLeftOut: Number(out.photosLeftOut) || 0 });

      // A deposit is due now → pay against THIS appointment.
      if (out.status === 'pending_payment' && Number(out.depositCents) > 0 && out.appointmentId) {
        heldPay.current = { key: holdKey, appointmentId: out.appointmentId, k: out.checkInToken || null, left: Array.isArray(out.stillNeeded) ? out.stillNeeded.map(String).slice(0, 5) : [] };
        const d: any = await payForHeld(tenantId, out.appointmentId);
        if (d?.clientSecret) {
          // A reschedule that needs a deposit: the payment webhook releases the
          // OLD visit once this one is paid for (same client only).
          return d;
        }
        return d;
      }

                if (out.requiresCardOnFile && out.clientId) {
                  try {
                    const cardRes = await fetch('/api/stripe/booking-card', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        tenantId,
                        clientId: out.clientId,
                        appointmentId: out.appointmentId,   // the server checks this booking is the client's own
                        checkInToken: out.checkInToken,
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
                    await fetch('/api/appointments/self-cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, appointmentId: reschedule.id, k: (reschedule as any).key || '', clientReason: 'Rescheduled online', rescheduledToId: out?.appointmentId || null }) });
                  } catch { /* the new booking stands; the old one can still be cancelled from its own link */ }
                  setReschedule(null);
                }
                setStep('confirmation');
                return { requiresPayment: false };
    } catch (e: any) {
      console.error('[booking-confirm]', e);
      return { requiresPayment: true, error: `Booking error: ${e?.message || e?.code || String(e)}` };
    }
  };

  // The booking sheet opens OVER the page: the page stays where it was underneath, so closing the sheet lands the client
  // back where they were. It comes in the page's own look: on a renter's link their color, light or dark; everywhere
  // else the business's color and mood.
  const sheetRenter: any = providerId ? staff.find((m: any) => m.id === providerId && m.isRenter) : null;
  const sheetLook = sheetRenter
    ? { accent: readable(cleanBrand(sheetRenter.brand).accent), mood: (cleanBrand(sheetRenter.brand).tone === 'dark' ? 'night' : 'soft') as 'night' | 'soft' }
    : { accent: brandColor(tenant), mood: studioPage(tenant).mood };
  const sheet = dialogOpen && dialogService ? (
        <BookingSheet
          tenantId={tenantId}
          look={sheetLook}
          holdNote={agentHold ? (agentHold.live ? `We’re holding this time for you until ${new Date(agentHold.expiresAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}. Check your details and book it.` : 'The time your assistant held has been released. Please choose a time.') : null}
          initialStaffId={studioStaffId}
          rescheduleOf={reschedule ? { serviceName: reschedule.serviceName, startTime: reschedule.startTime } : null}
          lockedStaffId={sheetRenter ? providerId : undefined}
          prefillClient={reschedule ? { clientName: reschedule.clientName, clientEmail: reschedule.clientEmail, clientPhone: reschedule.clientPhone } : agentHold ? { clientName: agentHold.client.name, clientEmail: agentHold.client.email, clientPhone: agentHold.client.phone } : null}
          initialSlot={agentHold?.live ? { date: agentHold.date, time: agentHold.time, staffId: agentHold.staffId } : null}
          open
          onOpenChange={o => { if (!o) { setDialogOpen(false); setDialogService(null); setStudioStaffId(undefined); } }}
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
            const days = sheetRenter
              ? horizonDaysFor(sheetRenter.renterBooking || null, memberOk === true, new Date(), tenant?.timezone || 'America/New_York')
              : horizonDaysFor((tenant as any)?.bookingRelease || null, studioMemberOk === true, new Date(), tenant?.timezone || 'America/New_York');
            return days !== null && days > 0 ? { ...tenant, bookingHorizonDays: days + (sheetRenter ? 0 : earlyDays) } : tenant;
          })()}
          onConfirm={handleConfirm}
          onReleaseHold={() => releaseHeld(tenantId, heldPay)}
          onSettled={() => { heldPay.current = null; }}
          bookingOutcome={bookingOutcome}
        />
  ) : null;

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
      ...(renterGift ? [{ label: 'Gift cards', href: `/gift/${encodeURIComponent(tenantId)}?provider=${encodeURIComponent(p.id)}` }] : []),
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
          {sheet}
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
            {offerShown ? (
              <div className="glass relative mb-6 overflow-hidden rounded-[1.5rem] p-4" style={{ border: `1px solid ${line}` }} role="status">
                <div aria-hidden className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full blur-2xl" style={{ background: accent, opacity: 0.25 }} />
                <div className="relative flex items-center gap-3">
                  <div className="glass flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-xl" aria-hidden>🎁</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] uppercase tracking-[0.22em]" style={{ color: mute }}>Your offer</p>
                    <p className="text-[24px] leading-tight" style={{ fontFamily: face, fontWeight: lightWeight }}>{offerShown.amount || offerShown.line}</p>
                    <p className="text-[12px]" style={{ color: mute }}>{offerShown.until ? `Until ${offerShown.until} · ` : ''}{offerShown.from ? `From ${offerShown.from}` : `code ${offerShown.code}`} · taken off at your visit</p>
                  </div>
                </div>
              </div>
            ) : offerOpen ? (
              <div className="mb-6 flex gap-2">
                <input value={offerInput} onChange={(e) => { setOfferInput(e.target.value.toUpperCase()); setOfferErr(''); }} onKeyDown={(e) => { if (e.key === 'Enter') void checkOffer(offerInput); }} placeholder="Offer code" aria-label="Offer code" autoFocus
                  className="h-11 min-w-0 flex-1 rounded-full px-4 font-mono text-sm tracking-[0.12em] outline-none" style={{ background: card, border: `1px solid ${line}`, color: ink }} />
                <button type="button" onClick={() => checkOffer(offerInput)} className="h-11 shrink-0 rounded-full px-5 text-[11px] uppercase tracking-[0.18em]" style={{ background: accent, color: onAcc }}>Apply</button>
                {offerErr && <p className="sr-only" role="alert">{offerErr}</p>}
              </div>
            ) : (
              <button type="button" onClick={() => setOfferOpen(true)} className="mb-6 text-[12px] underline" style={{ color: mute }}>🎁 Have an offer code?</button>
            )}
            {offerOpen && offerErr && <p className="-mt-4 mb-6 text-[12px]" style={{ color: mute }}>{offerErr}</p>}
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
        {sheet}
      </div>
    );
  }

  if (awayProvider) {
    // A renter who takes bookings on their own site: where to find them, in the business's page look.
    const first = String(awayProvider.name || '').split(' ')[0] || 'them';
    return (
      <PublicFrame accent={brandColor(tenant)} mood={studioPage(tenant).mood}>
        <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
          <div className="pub-card pub-rise space-y-4 p-7 text-center">
            {awayProvider.photoUrl && <img src={awayProvider.photoUrl} alt="" className="mx-auto h-20 w-20 rounded-full object-cover" />}
            <div>
              <h1 className="text-[26px] leading-tight">{awayProvider.name || 'This provider'}</h1>
              <p className="mt-1 text-[14px] text-stone-500">Books on their own site{tenant?.name ? ` · at ${tenant.name}` : ''}</p>
            </div>
            {awayProvider.bio && <p className="text-[15px] text-stone-600">{awayProvider.bio}</p>}
            {awayProvider.externalBookingUrl
              ? <a href={awayProvider.externalBookingUrl} target="_blank" rel="noopener noreferrer" className="pub-press inline-flex h-12 w-full items-center justify-center rounded-full px-6 text-[15px] font-medium text-white shadow-sm" style={{ background: 'var(--accent)' }}>Book with {first}<span className="sr-only"> (opens their booking site)</span></a>
              : <div className="space-y-2"><p className="text-[15px] text-stone-600">{first} takes bookings directly, not on this page.{tenant?.email || tenant?.phone ? ` ${tenant?.name || 'The studio'} can put you in touch:` : ''}</p>
                {(tenant?.email || tenant?.phone) && <p className="flex flex-wrap justify-center gap-x-5">
                  {tenant?.email && <a href={`mailto:${tenant.email}`} className="inline-flex min-h-11 items-center text-[15px] underline underline-offset-4">{tenant.email}</a>}
                  {tenant?.phone && <a href={`tel:${String(tenant.phone).replace(/[^\d+]/g, '')}`} className="inline-flex min-h-11 items-center text-[15px] underline underline-offset-4">{tenant.phone}</a>}</p>}</div>}
            <a href={`/book/${encodeURIComponent(tenantId)}`} className="inline-flex min-h-11 items-center text-[15px] font-medium" style={{ color: 'var(--accent-text, var(--accent))' }}>See everyone else here</a>
          </div>
        </main>
      </PublicFrame>
    );
  }

  // Shown small in Settings › Booking page: the real page, but nothing can be booked from it.
  const previewOnly = (() => { try { return new URLSearchParams(window.location.search).get('preview') === '1'; } catch { return false; } })();
  return (<>
    <StudioBookingPage tenant={tenant} accent={brandColor(tenant)} preview={previewOnly}
      focus={(() => { try { const id = new URLSearchParams(window.location.search).get('service'); return id ? services.find((sv: any) => sv.id === id) || null : null; } catch { return null; } })()}
      services={services} staff={staff} giftCents={giftCents} events={events} renters={elsewhere}
      offer={offerShown} onOfferCode={previewOnly ? undefined : (code) => checkOffer(code)}
      member={studioMemberOk} onMember={previewOnly ? undefined : memberCheck} askFor={memberAsk} bought={bought}
      loadFailed={loadFailed} onRetry={() => { setLoadFailed(false); setLoadedFor(null); setLoadTry((n) => n + 1); }}
      note={staleProvider ? 'The booking link you used isn’t active anymore, so here’s everyone you can book with.' : rescheduleNote || null}
      onBook={(svc, staffId) => { if (previewOnly || memberLocked(svc)) return; setStudioStaffId(staffId); setDialogService(svc); setDialogOpen(true); }} />
    {sheet}</>
  );
}

export default function BookingPage({ params }: { params: { tenantId: string } }) {
  return <><BookingRewards tenantId={params.tenantId} /><BookingPageContent tenantId={params.tenantId}/></>;
}
