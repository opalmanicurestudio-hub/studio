'use client';
// src/components/booking/StudioBookingPage.tsx
//
// THE BOOKING PAGE — one design for every business, in the same warm look as the school website (shared kit:
// src/components/public/kit.tsx). What makes it theirs comes from Settings › Bookings › Booking page (lib/studio-page):
// their color, the headline and cover photo, which sections show and in what order, and the photos, about words and
// questions in a few of them. Services by category, classes and events, the team, real reviews only, the rules a new
// client most needs (from the same settings every message uses), and "Visit us" with hours worked out from the team's
// actual schedules (so they always agree with the times clients can book). A section with nothing in it stays hidden.
// A bar of the sections that show follows the page. Offer codes, member sign-in and members-only services work here
// the same as everywhere else; booking itself is the same flow, with deposits, forms, text consent, memberships and
// packages unchanged.

import { GiftCoverBar } from '@/components/gift/GiftCoverBar';
import { BoothListingsSection } from '@/components/shared/BoothListingsSection';
import { spacesListings } from '@/lib/spaces-section';
import { GiftCardShowcase } from '@/components/gift/GiftCardShowcase';
import { PublicSheet } from '@/components/public/PublicSheet';
import { catSlug } from '@/lib/share-links';
import { usePublicReviewData } from '@/lib/booking-sections';
import { studioPage, headlineParts, sectionShows, comingEvents, eventCapacity, eventToday, type SectionId } from '@/lib/studio-page';
import { bookingPolicyLines, pagePolicies, liveDeposits } from '@/lib/policy-copy';
import { publicService } from '@/lib/agent-access';
import { resolvePolicy } from '@/lib/booking-policies';
import { releaseSentence, cleanRelease } from '@/lib/booking-release';
import { tenantTimeZone } from '@/lib/tenant-time';
import { moduleEnabled } from '@/lib/modules';
import { privacyOf } from '@/lib/health-privacy';
import { StudioSplash, useSplash } from '@/components/booking/StudioSplash';
import { Car, ChevronRight, Clock, DoorOpen, Mail, MapPin, Minus, PlayCircle, Phone, Plus, RotateCcw, Tag } from 'lucide-react';
import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PublicFrame, Section, PrimaryButton, QuietButton, money, minutes } from '@/components/public/kit';

const DAYS: [string, string][] = [['monday', 'Mon'], ['tuesday', 'Tue'], ['wednesday', 'Wed'], ['thursday', 'Thu'], ['friday', 'Fri'], ['saturday', 'Sat'], ['sunday', 'Sun']];
/** The address on one line, whether it's kept as text or as its parts. */
function addressLine(a: any): string {
  if (!a) return '';
  if (typeof a === 'string') return a.trim();
  if (typeof a === 'object') return [a.line1 || a.street, a.line2 || a.suite, [a.city, a.state || a.region].filter(Boolean).join(', '), a.zip || a.postalCode].map((x) => String(x || '').trim()).filter(Boolean).join(', ');
  return '';
}
const clock = (t: string) => { const [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'pm' : 'am'; const hh = h % 12 || 12; return m ? `${hh}:${String(m).padStart(2, '0')}${ap}` : `${hh}${ap}`; };
const clockUp = (t: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); if (!m) return ''; const h = Number(m[1]); return `${h % 12 || 12}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`; };
/** "$20 deposit" or "50% deposit" on a service that takes one (the same rule the booking charges by). */
const depositWords = (tenant: any, s: any) => { if (tenant?.depositsLive !== true) return ''; const d = resolvePolicy(tenant, s).deposit; if (!d.required.value) return ''; const a = Number(d.amount.value) || 0;
  return d.kind.value === 'flat' && a > 0 ? `${money(a)} deposit` : d.kind.value === 'percent' && a > 0 ? `${a}% deposit` : d.kind.value === 'full' ? 'paid when you book' : 'deposit'; };
const mins = (t: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
/** When an open time is, in words: "today 3:30 PM", "tomorrow 10:00 AM", "Thu 11:00 AM", "Mon, Nov 9 2:00 PM". */
const whenWords = (date: string, label: string, today: string) => {
  const d = new Date(`${date}T12:00:00`), t0 = new Date(`${today}T12:00:00`); const days = Math.round((d.getTime() - t0.getTime()) / 86400000);
  const day = days <= 0 ? 'today' : days === 1 ? 'tomorrow' : days < 7 ? d.toLocaleDateString('en-US', { weekday: 'short' }) : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return `${day} ${label}`;
};
/** Who booked on this device last ("Welcome back"): first name, the service and who did it. Kept on the device only. */
type LastVisit = { first: string; serviceId: string; staffId: string | null; at: string };
const lastVisitKey = (tenantId: string) => `cf.lastVisit.${tenantId}`;
/** Five stars, filled to the nearest whole star (the number beside them is exact). */
const Stars = ({ of }: { of: number }) => { const n = Math.max(0, Math.min(5, Math.round(of))); return <span aria-hidden style={{ color: 'var(--accent-text, var(--accent))' }}>{'★'.repeat(n)}<span style={{ opacity: 0.3 }}>{'★'.repeat(5 - n)}</span></span>; };
/** The words in the bar of sections, shorter than the section titles. */
const CHIP: Partial<Record<SectionId, string>> = { services: 'Services', offers: 'Memberships', events: 'Events', team: 'Team', work: 'Our work', reviews: 'Reviews', about: 'About', policies: 'Good to know', faqs: 'Questions', gifts: 'Gift cards', visit: 'Visit us' };
/** Where each section sits on the page. */
const ANCHOR: Partial<Record<SectionId, string>> = { faqs: 'questions', gifts: 'gift-cards' };
const anchor = (id: SectionId) => ANCHOR[id] || id;

export type PageOffer = { code: string; line: string; amount?: string; until?: string | null; oncePer?: boolean; from?: string };

export function StudioBookingPage({ tenant, services, staff, accent, onBook, focus, giftCents = 0, preview = false, events = [], renters = [], offer = null, onOfferCode, member = null, onMember, note = null, loadFailed = false, onRetry, askFor = null, bought = null }: {
  tenant: any; services: any[]; staff: any[]; accent: string;
  preview?: boolean;     // shown small in Settings: nothing fixed to the screen, no reviews fetched
  giftCents?: number;   // came from their gift card: the bar on top, and "Covered by your gift card" on the services it covers
  onBook: (service: any, staffId?: string) => void;
  focus?: any | null;   // a shared link to ONE service → the page is about that service (from a website, a QR code, a bio)
  events?: any[];       // the business's public classes and events
  renters?: any[];      // renters here who take bookings on their own site ("Also here")
  offer?: PageOffer | null;                                  // the offer they're booking with (a link, a campaign, a code)
  onOfferCode?: (code: string) => Promise<string | null>;    // checks a typed code: null when it worked, else what to say
  member?: boolean | null;                                   // signed in as a member: members-only services open
  onMember?: (contact: string) => Promise<boolean>;          // signs in by the email or phone on their membership (throws 'throttled' or when it can't check)
  askFor?: { service: any; at: number } | null;              // a members-only service asked for from outside the page: sign in for it
  bought?: { kind: 'membership' | 'package'; name: string; outcome: 'given' | 'refunded' | 'pending' | 'failed' | 'slow'; reason?: string; told?: boolean } | null;   // back from paying for one
  note?: string | null;                                      // something to say about how they arrived (a link that's no longer active)
  loadFailed?: boolean; onRetry?: () => void;                // the menu couldn't be loaded: say so, with Try again
}) {
  const name = tenant?.name || 'Book an appointment';
  const page = useMemo(() => studioPage(tenant), [tenant]);
  const [plain, bold] = headlineParts(page.headline);
  // Clients' own reviews the business chose to show (Reviews → Visits); the ones typed in the old page builder until then.
  const rv = usePublicReviewData((page.on.reviews || page.showRating) && !preview ? tenant?.id : undefined);
  const real = rv.reviews;
  const reviews = page.on.reviews ? (real.length ? real.slice(0, 6) : page.typedReviews) : [];
  const bookable = useMemo(() => services.filter(publicService), [services]);
  const groups = useMemo(() => {
    const m = new Map<string, any[]>(); const ordered = [...bookable].sort((a: any, b: any) => (Number.isFinite(a.menuOrder) ? a.menuOrder : 1e9) - (Number.isFinite(b.menuOrder) ? b.menuOrder : 1e9) || String(a.name).localeCompare(String(b.name)));   // the owner's menu order
    for (const s of ordered) { const k = s.category || 'Services'; m.set(k, [...(m.get(k) || []), s]); } return [...m.entries()];
  }, [bookable]);
  const team = staff.filter((m) => m.showOnPublicPage !== false && !(m.isRenter && m.bookingOptOut) && !m.isStudent);
  // Hours from the team's own weekly schedules: earliest start – latest finish per day.
  const hours = DAYS.map(([k, label]) => {
    const spans = team.map((m) => m.availability?.week?.[k]).filter((d: any) => d?.enabled && d.start && d.end);
    if (!spans.length) return { label, text: 'Closed' };
    const start = spans.map((d: any) => d.start).sort()[0], end = spans.map((d: any) => d.end).sort().pop();
    return { label, text: `${clock(start)} – ${clock(end)}` };
  });
  const hasHours = hours.some((h) => h.text !== 'Closed');
  // Hours in the business's own words, social links and a quote link (Settings › Booking page › Visit us; until then,
  // what their old page showed).
  const extras = { hours: page.visit.hours || '', social: page.visit.social || [], quoteUrl: page.visit.quote || '' };
  const photo = page.cover?.url || null;
  // The opening splash (first open only); the top of the page rises in as it lifts.
  const [splash, endSplash0] = useSplash(preview ? undefined : tenant?.id, page.splash);
  const splashAt = useRef(typeof performance !== 'undefined' ? performance.now() : 0);
  const [lift, setLift] = useState(splash ? 0.6 : 0);
  const endSplash = () => { const gone = (performance.now() - splashAt.current) / 1000; if (gone < 0.6) setLift(gone); endSplash0(); };
  const addr = addressLine(tenant?.address);
  const [allWork, setAllWork] = useState(false);
  const [openFaq, setOpenFaq] = useState(0);
  // Scrolls a section to just under the header and the bar of sections.
  const top = useRef<HTMLElement>(null);
  const go = (id: string) => {
    const el = document.getElementById(id); if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - (top.current?.offsetHeight || 64) - 8, behavior: reduce ? 'auto' : 'smooth' });
  };
  const bookTop = () => go('services');
  // "Book with Jessica": remember her while the client chooses a service.
  const [withId, setWithId] = useState<string | null>(null);
  const withWho = withId ? team.find((m: any) => m.id === withId) : null;

  // Welcome back: who booked on this device last, while the business shows it and the service is still offered.
  const [last, setLast] = useState<LastVisit | null>(null);
  // Not shown by a business that keeps things discreet (a shared phone shouldn't show someone's last treatment), and
  // forgotten after a year and a half.
  const discreet = privacyOf(tenant).discreet;
  useEffect(() => { if (!tenant?.id || preview) return; try { const k = lastVisitKey(tenant.id); const v = JSON.parse(localStorage.getItem(k) || 'null'); if (!v) return;
    if (!discreet && page.bookAgain && v.serviceId && v.first && Date.now() - Date.parse(v.at || '') < 548 * 86400000) setLast(v); else localStorage.removeItem(k);   // not kept on the device once it won't be shown
  } catch { /* none */ } }, [tenant?.id, preview, discreet, page.bookAgain]);
  const forget = () => { try { localStorage.removeItem(lastVisitKey(tenant.id)); } catch { /* none */ } setLast(null); };
  const againService = last && page.bookAgain ? bookable.find((s: any) => s.id === last.serviceId) || null : null;
  const againWho = againService && last?.staffId ? team.find((m: any) => m.id === last.staffId) || null : null;

  // The soonest open time for each service, for the team, and for "Book again" (over the next two weeks).
  const [soon, setSoon] = useState<{ today: string; soonest: Record<string, { date: string; time: string; label: string }> } | null>(null);
  // Asked for in the order the menu shows (the first twelve), and for each person their shortest service they can do.
  const teamPairs = useMemo(() => {
    const menu = groups.flatMap(([, list]) => list).filter((s: any) => s.membersOnly !== true);
    return team.slice(0, 4).map((m: any) => { const svc = [...menu].filter((s: any) => (s.requiredSkills || []).every((k: string) => (m.skillSet || []).includes(k)) && (!(s.certifiedStaffIds || []).length || s.certifiedStaffIds.includes(m.id)))
      .sort((a: any, b: any) => (Number(a.duration) || 60) - (Number(b.duration) || 60))[0]; return svc ? { staffId: m.id, serviceId: svc.id } : null; }).filter(Boolean) as { staffId: string; serviceId: string }[];
  }, [groups, team]);
  const soonAsk = useMemo(() => {
    if (!page.soonest || preview || !tenant?.id) return null;
    const serviceIds = groups.flatMap(([, list]) => list).filter((s: any) => s.membersOnly !== true).slice(0, 12).map((s: any) => s.id);
    const pairs: { serviceId: string; staffId: string }[] = [];
    if (againService && againWho) pairs.push({ serviceId: againService.id, staffId: againWho.id });
    for (const p of teamPairs) if (!pairs.some((x) => x.serviceId === p.serviceId && x.staffId === p.staffId)) pairs.push(p);
    if (!serviceIds.length && !pairs.length) return null;   // nothing loaded yet: nothing to ask
    return JSON.stringify({ serviceIds, pairs: pairs.slice(0, 6) });
  }, [page.soonest, preview, tenant?.id, groups, teamPairs, againService, againWho]);
  useEffect(() => {
    if (!soonAsk) { setSoon(null); return; } let live = true;
    fetch('/api/booking/public-data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: tenant.id, action: 'soonest', ...JSON.parse(soonAsk) }) })
      .then((r) => r.json()).then((d) => { if (live && d?.ok) setSoon({ today: d.today, soonest: d.soonest || {} }); }).catch(() => {});
    return () => { live = false; };
  }, [soonAsk]); // eslint-disable-line react-hooks/exhaustive-deps
  const nextFor = (key: string) => { const x = soon?.soonest?.[key]; return x ? whenWords(x.date, x.label, soon!.today) : ''; };
  // A small dot breathes beside a time that's today.
  const isToday = (key: string) => { const x = soon?.soonest?.[key]; return !!x && x.date <= soon!.today; };
  const soonLine = (k: string, className: string, children: React.ReactNode) =>   // a plain call, so the dot keeps breathing across renders
    <span className={`flex items-center gap-1.5 font-medium ${className}`} style={{ color: 'var(--good)' }}>{isToday(k) && <span className="pub-breathe" aria-hidden />}{children}</span>;
  const teamNext = (m: any) => { const p = teamPairs.find((x) => x.staffId === m.id); return p ? nextFor(`${p.serviceId}|${p.staffId}`) : ''; };

  // Getting here: the business's own notes on parking, the entrance and a short video of the way in.
  const visitNotes = page.visit;
  const [here, setHere] = useState(false);

  // Classes and events still to come, soonest first (the business's own day, so today's stays up all day).
  const today = eventToday(tenant);
  const coming = useMemo(() => comingEvents(events, today), [events, today]);
  const [seats, setSeats] = useState<Record<string, number>>({});
  const seatIds = coming.filter((e: any) => eventCapacity(e) > 0).map((e: any) => e.id).join(',');
  useEffect(() => {
    if (!tenant?.id || !seatIds || preview) return; let live = true;
    fetch('/api/booking/public-data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: tenant.id, action: 'event-seats', ids: seatIds.split(',') }) })
      .then((r) => r.json()).then((d) => { if (live && d?.ok && d.seats) setSeats(d.seats); }).catch(() => {});
    return () => { live = false; };
  }, [tenant?.id, seatIds, preview]);

  // Reserving a place at an event, right here (it lands on the event's guest list).
  const [reserve, setReserve] = useState<any | null>(null);
  const [rsv, setRsv] = useState({ name: '', email: '', phone: '', places: 1, rsv_ref: '' }); const [rsvBusy, setRsvBusy] = useState(false); const [rsvErr, setRsvErr] = useState(''); const [rsvDone, setRsvDone] = useState<string | null>(null);
  const openReserve = (e: any) => { setRsvErr(''); setRsvDone(null); setRsv((r) => ({ ...r, places: 1, rsv_ref: '' })); setReserve(e); };
  const reserveNow = async () => {
    if (!reserve || rsvBusy) return; if (!rsv.name.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rsv.email.trim())) { setRsvErr('Add your name and email.'); document.getElementById(!rsv.name.trim() ? 'rsv-name' : 'rsv-email')?.focus(); return; }
    setRsvBusy(true); setRsvErr('');
    try {
      const r = await fetch('/api/booking/public-data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: tenant.id, action: 'event-reserve', eventId: reserve.id, name: rsv.name, email: rsv.email, phone: rsv.phone, places: rsv.places, rsv_ref: rsv.rsv_ref }) });
      const d = await r.json().catch(() => null);
      // How many places are left now: the choice of places follows it, so what's shown is what's sent.
      const now = d?.full ? 0 : typeof d?.left === 'number' ? d.left : undefined;
      if (now !== undefined) { setSeats((x) => ({ ...x, [reserve.id]: now })); setRsv((x) => ({ ...x, places: Math.max(1, Math.min(x.places, now)) })); }
      if (!d?.ok) { setRsvErr(d?.error || 'That didn’t go through. Try again in a moment.'); return; }
      // Said the same for a new reservation and one already made (to change places, the business does it).
      setRsvDone('You’re on the list. See you there. To change how many are coming, contact the business.');
      fetch('/api/booking/public-data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: tenant.id, action: 'event-seats', ids: [reserve.id] }) })
        .then((x) => x.json()).then((x) => { if (x?.ok && x.seats && typeof x.seats[reserve.id] === 'number') setSeats((y) => ({ ...y, [reserve.id]: x.seats[reserve.id] })); }).catch(() => {});
    } catch { setRsvErr('That didn’t go through. Try again in a moment.'); } finally { setRsvBusy(false); }
  };

  // Memberships and packages the business sells openly, bought here (lib/offer-sale; checkout on their own account).
  const [offers, setOffers] = useState<{ online: boolean; memberships: any[]; packages: any[] } | null>(null);
  useEffect(() => {
    if (!tenant?.id || !page.on.offers) { setOffers(null); return; } let live = true;
    fetch('/api/booking/offers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: tenant.id, action: 'list' }) })
      .then((r) => r.json()).then((d) => { if (live && d?.ok) setOffers({ online: !!d.online, memberships: d.memberships || [], packages: d.packages || [] }); }).catch(() => {});
    return () => { live = false; };
  }, [tenant?.id, page.on.offers]);
  const [buying, setBuying] = useState<{ kind: 'membership' | 'package'; item: any } | null>(null);
  const [buyer, setBuyer] = useState({ name: '', email: '', phone: '' }); const [buyBusy, setBuyBusy] = useState(false); const [buyErr, setBuyErr] = useState('');
  const openBuy = (kind: 'membership' | 'package', item: any) => { setBuyErr(''); setBuying({ kind, item }); };
  const buyNow = async () => {
    if (!buying || buyBusy) return;
    if (!buyer.name.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(buyer.email.trim())) { setBuyErr('Add your name and email.'); document.getElementById(!buyer.name.trim() ? 'buy-name' : 'buy-email')?.focus(); return; }
    setBuyBusy(true); setBuyErr('');
    try {
      const r = await fetch('/api/booking/offers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: tenant.id, action: 'start', kind: buying.kind, id: buying.item.id, name: buyer.name, email: buyer.email, phone: buyer.phone }) });
      const d = await r.json().catch(() => null);
      if (d?.ok && d.url) { window.location.href = d.url; return; }
      setBuyErr(d?.error || 'Checkout didn’t open. Try again in a moment.');
    } catch { setBuyErr('Checkout didn’t open. Try again in a moment.'); }
    setBuyBusy(false);
  };
  const per = (m: any) => (m.interval === 'yearly' ? 'a year' : 'a month');
  // Back from checkout with the browser's Back button: the panel isn't left stuck on "Opening checkout".
  useEffect(() => { const back = (e: PageTransitionEvent) => { if (e.persisted) setBuyBusy(false); }; window.addEventListener('pageshow', back); return () => window.removeEventListener('pageshow', back); }, []);

  // Before you book: the few rules a new client most needs, and every word of them a tap away.
  const rules = useMemo(() => pagePolicies(tenant, bookable), [tenant, bookable]);
  const [fullPolicy, setFullPolicy] = useState(false);

  // Members: members-only services show with a label, and booking one asks them to sign in first.
  const membersOnly = bookable.some((s: any) => s.membersOnly === true);
  const release = useMemo(() => releaseSentence(tenant?.bookingRelease || null, new Date(), tenantTimeZone(tenant)), [tenant]);
  const memberPerk = !!onMember && (membersOnly || !!release.members);
  const [signIn, setSignIn] = useState<{ then?: any } | null>(null);
  const [contact, setContact] = useState(''); const [signBusy, setSignBusy] = useState(false); const [signErr, setSignErr] = useState('');
  // Each opening of the sign-in is its own attempt: an answer that arrives after it was closed (or opened again for
  // another service) opens nothing.
  const attempt = useRef(0);
  const askSignIn = (then?: any) => { attempt.current += 1; setSignErr(''); setSignIn(then ? { then } : {}); };
  const signInNow = async () => {
    const v = contact.trim(); if (!v || !onMember || signBusy) return;
    const mine = attempt.current; const then = signIn?.then;
    setSignBusy(true); setSignErr('');
    let ok = false;
    try { ok = await onMember(v); }
    catch (e: any) { setSignBusy(false); if (mine === attempt.current) setSignErr(e?.message === 'throttled' ? 'Too many tries for now. Please try again in an hour.' : 'We couldn’t check right now. Try again in a moment.'); return; }
    setSignBusy(false);
    if (mine !== attempt.current) return;   // closed, or opened again for something else, while checking
    if (!ok) { setSignErr('We couldn’t find an active membership under that. Check the email or phone on your membership.'); return; }
    attempt.current += 1; setSignIn(null);
    if (then && !preview) onBook(then, withId || undefined);
  };
  // Asked from outside (a link or a website button for a members-only service): the sign-in opens for it.
  useEffect(() => { if (askFor?.service && onMember) askSignIn(askFor.service); }, [askFor]); // eslint-disable-line react-hooks/exhaustive-deps
  const book = (s: any, who?: string) => { if (s.membersOnly === true && member !== true && onMember) { if (who) setWithId(who); askSignIn(s); return; } onBook(s, who || withId || undefined); };

  // An offer code typed on the page.
  const [codeOpen, setCodeOpen] = useState(false); const [code, setCode] = useState(''); const [codeErr, setCodeErr] = useState(''); const [codeBusy, setCodeBusy] = useState(false);
  const applyCode = async () => {
    const v = code.trim(); if (!v || !onOfferCode) return;
    setCodeBusy(true); setCodeErr('');
    try { const err = await onOfferCode(v); if (err) setCodeErr(err); else { setCodeOpen(false); setCode(''); } } finally { setCodeBusy(false); }
  };

  // Each section of the page, shown only when switched on and with something in it.
  const giftsOn = !!(tenant?.id && tenant?.giftCardSettings?.online && tenant.giftCardSettings.onBooking !== false);
  const counts: Partial<Record<SectionId, number>> = { offers: offers ? offers.memberships.length + offers.packages.length : 0, team: team.length, reviews: reviews.length, gifts: giftsOn ? 1 : 0, spaces: preview ? 0 : spacesListings(tenant).length, events: coming.length, policies: rules.length,
    waitlist: tenant?.id ? 1 : 0, visit: addr || tenant?.phone || tenant?.email || hasHours || extras.hours || extras.social.length || extras.quoteUrl ? 1 : 0 };
  const shows = (id: SectionId) => sectionShows(page, id, counts, (m) => moduleEnabled(tenant, m as any));

  // The bar of sections: the ones that show, in the page's order; the one being read is marked.
  const chips = useMemo(() => (focus ? [] : (['services', ...page.order.filter((id) => id !== 'services')] as SectionId[]).filter((id) => CHIP[id] && (id === 'services' || (shows(id) && !(preview && id === 'gifts'))))), // eslint-disable-line react-hooks/exhaustive-deps
    [page, focus, preview, offers, team.length, reviews.length, giftsOn, coming.length, rules.length, addr, hasHours]);
  const [current, setCurrent] = useState<SectionId>('services');
  const chipRow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (chips.length < 2) return; let raf = 0;
    const read = () => { raf = 0; const line = (top.current?.offsetHeight || 64) + 24; let on: SectionId = chips[0];
      for (const id of chips) { const el = document.getElementById(anchor(id)); if (el && el.getBoundingClientRect().top <= line) on = id; }
      setCurrent((c) => (c === on ? c : on)); };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(read); };
    read(); window.addEventListener('scroll', onScroll, { passive: true }); window.addEventListener('resize', onScroll);
    return () => { if (raf) cancelAnimationFrame(raf); window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); };
  }, [chips]);
  useEffect(() => {   // keeps the marked chip in view inside the bar, without moving the page
    const row = chipRow.current; const el = row?.querySelector<HTMLElement>(`[data-chip="${current}"]`); if (!row || !el) return;
    const left = el.offsetLeft - 16, right = el.offsetLeft + el.offsetWidth + 16; const behavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    if (left < row.scrollLeft) row.scrollTo({ left, behavior }); else if (right > row.scrollLeft + row.clientWidth) row.scrollTo({ left: right - row.clientWidth, behavior });
  }, [current]);

  const rentersHere = renters.filter((m: any) => m?.externalBookingUrl && /^https?:\/\//i.test(String(m.externalBookingUrl)));
  const alsoHere = rentersHere.length > 0 && <div className="mt-3 space-y-3">{rentersHere.map((m: any) => (
    <a key={m.id} href={m.externalBookingUrl} target="_blank" rel="noopener noreferrer" className="pub-card flex min-h-16 items-center gap-3 p-4">
      {m.photoUrl || m.avatarUrl ? <img src={m.photoUrl || m.avatarUrl} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" /> : <span className="pub-round h-11 w-11 shrink-0 rounded-full" style={{ background: 'color-mix(in srgb, var(--accent) 18%, #fff)' }} aria-hidden />}
      <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-semibold">Also here: {m.name}{(m.specialties || [])[0] ? `, ${String(m.specialties[0]).toLowerCase()}` : ''}</span>
        <span className="block text-[13px] text-stone-500">Books on their own site</span></span>
      <ChevronRight className="h-4 w-4 shrink-0 text-stone-400" aria-hidden /><span className="sr-only">(opens their booking site)</span>
    </a>))}</div>;

  const part = (id: SectionId): React.ReactNode => {
    if (!shows(id)) return null;
    if (id === 'spaces') { const listings = tenant?.id && !preview ? spacesListings(tenant) : [];   // what the owner set in Settings, and anything from the old page
      return listings.length ? <div id="spaces" className="pub-plate">{listings.map((c, i) => <BoothListingsSection key={i} tenantId={tenant.id} config={c} />)}</div> : null; }
    if (id === 'offers' && offers) return <Section id="offers" eyebrow="Memberships and packages" title={<>Come back for <b>less</b></>}>
      <div className="grid gap-3 sm:grid-cols-2">{[...offers.memberships.map((m) => ({ kind: 'membership' as const, item: m, price: `${money(m.price)} ${per(m)}`, words: m.description, perks: m.perks || [], cta: 'Join' })),
        ...offers.packages.map((p) => ({ kind: 'package' as const, item: p, price: money(p.price), words: p.description, perks: [] as string[], cta: 'Buy' }))].map(({ kind, item, price, words, perks, cta }) => (
        <div key={`${kind}-${item.id}`} className="pub-card flex flex-col gap-3 p-5">
          <div><p className="text-[17px] font-semibold">{item.name}</p><p className="mt-0.5 text-[22px] font-light">{price}</p></div>
          {words && <p className="text-[14px] leading-relaxed text-stone-600">{words}</p>}
          {perks.length > 0 && <ul className="space-y-1 text-[14px] text-stone-600">{perks.map((x: string) => <li key={x} className="flex gap-2"><span className="pub-round mt-2 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: 'var(--accent)' }} aria-hidden />{x}</li>)}</ul>}
          <div className="mt-auto pt-1">{offers.online && !preview
            ? <button type="button" onClick={() => openBuy(kind, item)} className="inline-flex h-11 items-center rounded-full px-6 text-[15px] font-medium text-white" style={{ background: 'var(--accent)' }}>{cta}<span className="sr-only"> {item.name}</span></button>
            : preview ? <span className="inline-flex h-11 items-center rounded-full px-6 text-[15px] font-medium text-white" style={{ background: 'var(--accent)' }}>{cta}</span>
            : <p className="text-[14px] text-stone-500">Ask about it at your next visit.</p>}</div>
        </div>))}</div>
    </Section>;
    if (id === 'events') return <Section id="events" eyebrow="Classes and events" title={<>Coming <b>up</b></>}>
      <div className="grid max-w-3xl gap-3">{coming.map((e: any) => {
        const d = new Date(`${e.date}T12:00:00`); const start = mins(e.time), end = mins(e.endTime);
        const left = seats[e.id]; const full = left === 0;
        const meta = [clockUp(e.time), start !== null && end !== null && end > start ? minutes(end - start) : '', e.venue ? String(e.venue) : '', left !== undefined && left > 0 ? `${left} ${left === 1 ? 'place' : 'places'} left` : ''].filter(Boolean).join(' · ');
        return (
          <div key={e.id} className="pub-card flex items-center gap-4 p-4">
            <div className="w-12 shrink-0 text-center" aria-hidden><p className="text-[12px] font-semibold tracking-wide" style={{ color: 'var(--accent-text, var(--accent))', textTransform: 'uppercase' }}>{d.toLocaleDateString('en-US', { month: 'short' })}</p><p className="text-[24px] font-light leading-none">{d.getDate()}</p></div>
            <div className="min-w-0 flex-1"><p className="text-[16px] font-semibold"><span className="sr-only">{d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}: </span>{e.title || e.name || 'Event'}</p>{meta && <p className="mt-0.5 text-[13px] text-stone-500">{meta}</p>}</div>
            {full ? <span className="shrink-0 rounded-full bg-stone-100 px-3.5 py-2 text-[13px] font-medium text-stone-500">Full</span>
              : preview ? <span className="shrink-0 rounded-full px-3.5 py-2 text-[13px] font-medium text-white" style={{ background: 'var(--accent)' }}>Reserve</span>
              : <button type="button" onClick={() => openReserve(e)} className="inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-[13px] font-medium text-white" style={{ background: 'var(--accent)' }}>Reserve<span className="sr-only"> a place at {e.title || e.name || 'this event'}</span></button>}
          </div>); })}</div>
    </Section>;
    if (id === 'team') return <Section id="team" eyebrow="The team" title={<>Meet the <b>people</b></>}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{team.map((m: any) => (
        <div key={m.id} className="pub-card space-y-3 p-5">
          <div className="flex items-center gap-3">{m.avatarUrl ? <img src={m.avatarUrl} alt="" className="h-14 w-14 rounded-full object-cover" /> : <span className="pub-round flex h-14 w-14 items-center justify-center rounded-full text-lg font-semibold text-white" style={{ background: 'var(--accent)' }} aria-hidden>{String(m.name || '?').slice(0, 1)}</span>}
            <div className="min-w-0"><p className="font-semibold">{m.name}</p>{(m.specialties || []).length > 0 && <p className="truncate text-[13px] text-stone-500">{m.specialties.slice(0, 3).join(' · ')}</p>}</div></div>
          {m.bio && <p className="line-clamp-3 text-[14px] text-stone-600">{m.bio}</p>}
          {teamNext(m) && (() => { const p = teamPairs.find((x) => x.staffId === m.id); return soonLine(p ? `${p.serviceId}|${p.staffId}` : '', 'text-[14px]', <>Next opening: {teamNext(m)}</>); })()}
          <button type="button" onClick={() => { setWithId(m.id); bookTop(); }} className="inline-flex min-h-11 items-center text-[14px] font-medium underline underline-offset-4" style={{ color: 'var(--accent-text, var(--accent))' }}>Book with {String(m.name || '').split(' ')[0]}</button>
        </div>
      ))}</div>
    </Section>;
    if (id === 'work') return <Section id="work" eyebrow="Our work" title={<>Recent <b>work</b></>}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{(allWork ? page.work : page.work.slice(0, 4)).map((w, i) => (
        <figure key={w.url + i} className="relative overflow-hidden rounded-[1.25rem] bg-white">
          <img src={w.url} alt={w.caption ? `${w.caption}, by ${name}` : `Work by ${name}, photo ${i + 1}`} loading="lazy" className="aspect-square w-full object-cover" />
          {w.caption && <figcaption className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] truncate rounded-full bg-white/90 px-2.5 py-1 text-[12px] font-medium text-stone-800">{w.caption}</figcaption>}
        </figure>
      ))}</div>
      {page.work.length > 4 && <button type="button" onClick={() => setAllWork((v) => !v)} className="mt-3 inline-flex min-h-11 items-center text-[14px] font-medium" style={{ color: 'var(--accent-text, var(--accent))' }}>{allWork ? 'Show fewer' : `See all ${page.work.length} photos`}</button>}
    </Section>;
    if (id === 'reviews') return <Section id="reviews" eyebrow="Kind words" title={<>What clients <b>say</b></>}>
      {real.length > 0 && rv.count >= 3 && rv.average > 0 && <p className="-mt-2 mb-4 text-[15px] text-stone-600"><Stars of={rv.average} /> <b className="text-stone-800">{rv.average.toFixed(1)}</b> · {rv.count} reviews</p>}
      <div className="grid gap-3 sm:grid-cols-3">{reviews.map((r, i) => (
        <figure key={i} className="pub-card space-y-3 p-5"><p aria-label={`${r.rating} out of 5 stars`} style={{ color: 'var(--accent-text, var(--accent))' }}>{'★'.repeat(Math.max(1, Math.min(5, Number(r.rating) || 5)))}</p><blockquote className="text-[15px] text-stone-700">“{r.text}”</blockquote><figcaption className="text-[14px] font-semibold">{r.name}</figcaption></figure>
      ))}</div>
    </Section>;
    if (id === 'about') return <Section id="about" eyebrow="About us" title={<>About <b>{name}</b></>}>
      <div className="grid items-start gap-6 md:grid-cols-2">
        {page.about.photo?.url && <img src={page.about.photo.url} alt="" loading="lazy" className="aspect-[4/3] w-full rounded-[1.5rem] object-cover" />}
        <div className="space-y-4 text-[16px] leading-relaxed text-stone-700">{page.about.text.split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>)}</div>
      </div>
    </Section>;
    if (id === 'policies') return <Section id="policies" eyebrow="Before you book" title={<>Good to <b>know</b></>}>
      <div className="pub-card max-w-3xl px-5 py-2">
        <dl className="divide-y divide-stone-200">{rules.map((r) => <div key={r.title} className="py-3"><dt className="text-[15px] font-semibold">{r.title}</dt><dd className="mt-0.5 text-[14px] leading-relaxed text-stone-600">{r.text}</dd></div>)}</dl>
        <div className="border-t border-stone-200 py-2"><button type="button" onClick={() => setFullPolicy(true)} className="inline-flex min-h-11 items-center text-[14px] font-medium" style={{ color: 'var(--accent-text, var(--accent))' }}>Read our full policy</button></div>
      </div>
    </Section>;
    if (id === 'faqs') return <Section id="questions" eyebrow="Questions" title={<>Asked <b>often</b></>}>
      <div className="max-w-3xl divide-y divide-stone-200 border-y border-stone-200">{page.faqs.map((f, i) => { const open = openFaq === i; return (
        <div key={i}>
          <h3><button type="button" aria-expanded={open} aria-controls={`faq-${i}`} onClick={() => setOpenFaq(open ? -1 : i)} className="flex min-h-14 w-full items-center justify-between gap-4 py-3 text-left text-[16px] font-medium">
            <span>{f.q}</span>{open ? <Minus className="h-4 w-4 shrink-0 text-stone-500" aria-hidden /> : <Plus className="h-4 w-4 shrink-0 text-stone-500" aria-hidden />}</button></h3>
          <p id={`faq-${i}`} hidden={!open} className="pb-4 text-[15px] leading-relaxed text-stone-600">{f.a}</p>
        </div>); })}</div>
    </Section>;
    if (id === 'gifts') return giftsOn && !preview ? <Section id="gift-cards" eyebrow="Gift cards" title={<>Give the gift of a <b>visit</b></>}>
      <GiftCardShowcase tenantId={tenant.id} brand={{ name, logo: tenant?.logoUrl || null, accent }} items={tenant.giftCardSettings.showcase || null} services={bookable} offered={tenant.giftCardSettings.designs || null} ink="var(--ink)" muted="var(--muted)" line="var(--line)" surface="var(--card)" />
    </Section> : null;
    if (id === 'visit') return <Section id="visit" eyebrow="Visit us" title={<>Find <b>us</b></>}>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="pub-card space-y-3 p-5 text-[15px]">
          {addr && <p className="flex gap-3"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-stone-500" aria-hidden /><span>{addr}<br /><a href={`https://maps.google.com/?q=${encodeURIComponent(addr)}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-[14px] font-medium underline underline-offset-4" style={{ color: 'var(--accent-text, var(--accent))' }}>Get directions</a></span></p>}
          {tenant?.phone && <p className="flex items-center gap-3"><Phone className="h-4 w-4 shrink-0 text-stone-500" aria-hidden /><a href={`tel:${String(tenant.phone).replace(/[^\d+]/g, '')}`} className="inline-flex min-h-11 items-center underline underline-offset-4">{tenant.phone}</a></p>}
          {tenant?.email && <p className="flex items-center gap-3"><Mail className="h-4 w-4 shrink-0 text-stone-500" aria-hidden /><a href={`mailto:${tenant.email}`} className="inline-flex min-h-11 items-center underline underline-offset-4">{tenant.email}</a></p>}
          {extras.quoteUrl && !preview && <p><a href={extras.quoteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-[15px] font-medium" style={{ color: 'var(--accent-text, var(--accent))' }}>Request a quote<span className="sr-only"> (opens in a new tab)</span></a></p>}
          {extras.social.length > 0 && <p className="flex flex-wrap gap-x-5">{extras.social.map((x) => <a key={x.url} href={x.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center underline underline-offset-4">{x.label}<span className="sr-only"> (opens in a new tab)</span></a>)}</p>}
          {(addr || visitNotes.parking || visitNotes.entrance || visitNotes.video) && <button type="button" onClick={() => setHere(true)} className="inline-flex h-11 w-full items-center justify-center rounded-full text-[15px] font-medium" style={{ background: 'color-mix(in srgb, var(--ink) 7%, transparent)' }}>Getting here</button>}
        </div>
        {extras.hours ? <div className="pub-card p-5"><p className="mb-2 flex items-center gap-2 font-semibold"><Clock className="h-4 w-4 text-stone-500" aria-hidden />Hours</p><p className="whitespace-pre-line text-[15px]">{extras.hours}</p></div>
        : hasHours && <div className="pub-card p-5"><p className="mb-2 flex items-center gap-2 font-semibold"><Clock className="h-4 w-4 text-stone-500" aria-hidden />Hours</p><dl className="grid grid-cols-[3.5rem_1fr] gap-y-1 text-[15px]">{hours.map((h) => <div key={h.label} className="contents"><dt className="text-stone-500">{h.label}</dt><dd className={h.text === 'Closed' ? 'text-stone-400' : ''}>{h.text}</dd></div>)}</dl></div>}
      </div>
      {alsoHere}
    </Section>;
    if (id === 'waitlist') return <p className="mx-auto max-w-6xl px-4 py-6 text-center text-[15px] text-stone-600">Can’t find a time? {preview ? <span className="font-medium" style={{ color: 'var(--accent-text, var(--accent))' }}>Join the waitlist</span> : <a href={`/w/${encodeURIComponent(tenant.id)}`} className="inline-flex min-h-11 items-center font-medium underline-offset-4 hover:underline" style={{ color: 'var(--accent-text, var(--accent))' }}>Join the waitlist</a>}</p>;
    return null;
  };

  const rating = page.showRating && rv.count >= 3 && rv.average > 0;
  // Back from paying for a membership or package: what happened, in plain words.
  const boughtCard = bought && <div className="pub-card max-w-xl p-4" role="status">
    <p className="text-[16px] font-semibold" style={{ color: bought.outcome === 'given' ? 'var(--good)' : undefined }}>{
      bought.outcome === 'given' ? (bought.kind === 'membership' ? `Welcome to ${bought.name}` : `${bought.name} is yours`)
      : bought.outcome === 'pending' || bought.outcome === 'slow' ? 'Your payment is being confirmed' : bought.outcome === 'refunded' ? 'Your payment was refunded' : 'We’re looking into your payment'}</p>
    <p className="mt-0.5 text-[14px] text-stone-600">{
      bought.outcome === 'given' ? (bought.kind === 'membership' ? 'Your membership is ready. Book as usual; your perks are applied at your visit.' : 'Your visits are ready. Book as usual; each one comes off at your visit.')
      : bought.outcome === 'pending' ? 'It’ll be ready in a moment. You can book now; it’s applied at your visit.'
      : bought.outcome === 'slow' ? 'It’s taking a little longer than usual. You’ll get a confirmation once it’s ready, and you can book now.'
      : bought.outcome === 'refunded' ? (bought.reason === 'already_member' ? `You already have a membership here, so ${bought.name} couldn’t be added and the payment is on its way back to you.`
        : bought.reason === 'blocked' ? `We couldn’t add ${bought.name} online, so the payment is on its way back to you. Please contact the business.`
        : `${bought.name} is no longer available, so the payment is on its way back to you.`)
      : `Your payment went through, but something needs a look on our side. ${bought.told === false ? 'Please contact the business so they can sort it out with you.' : 'The business has been told and will sort it out with you.'}`}</p>
  </div>;
  // The offer they're booking with (from a link, a campaign or a code they typed), taken off at the visit.
  const offerCard = offer && <div className="pub-card flex max-w-xl items-start gap-3 p-4" role="status">
    <Tag className="mt-0.5 h-5 w-5 shrink-0" style={{ color: 'var(--accent-text, var(--accent))' }} aria-hidden />
    <div className="min-w-0"><p className="text-[16px] font-semibold">{offer.amount || offer.line}</p>
      <p className="text-[13.5px] text-stone-500">{[offer.from ? `From ${offer.from}’s link` : `Code ${offer.code}`, offer.until ? `until ${offer.until}` : '', offer.oncePer ? 'one per client' : ''].filter(Boolean).join(' · ')}. Taken off at your visit.</p></div>
  </div>;
  return (
    <PublicFrame accent={accent} mood={page.mood}>
      {splash && <StudioSplash name={name} city={typeof tenant?.address === 'object' ? String(tenant.address?.city || '') : ''} logoUrl={tenant?.logoUrl} onDone={endSplash} />}
      <header ref={top} className="pub-bar sticky top-0 z-30 border-b border-stone-200/70 backdrop-blur" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-2.5">{tenant?.logoUrl && <img src={tenant.logoUrl} alt="" className="h-9 w-9 rounded-xl object-contain" />}<span className="truncate text-[17px] font-semibold">{name}</span></div>
          <div className="flex shrink-0 items-center gap-2">{tenant?.giftCardSettings?.online && tenant?.id && <a href={giftsOn && shows('gifts') ? '#gift-cards' : `/gift/${tenant.id}`} onClick={(e) => { if (giftsOn && shows('gifts')) { e.preventDefault(); go('gift-cards'); } }} className="inline-flex h-11 items-center rounded-full px-4 text-sm font-medium text-stone-700 hover:bg-stone-100">Gift cards</a>}
          <PrimaryButton onClick={bookTop} className="h-10 px-5 text-sm">Book</PrimaryButton></div>
        </div>
        {chips.length > 1 && <nav aria-label="Sections of this page" className="border-t border-stone-200/60">
          <div ref={chipRow} className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {chips.map((id) => { const on = current === id; return (
              <a key={id} data-chip={id} href={`#${anchor(id)}`} aria-current={on ? 'location' : undefined} onClick={(e) => { e.preventDefault(); setCurrent(id); go(anchor(id)); }} className="inline-flex h-11 shrink-0 items-center">
                <span className="pub-press inline-flex h-9 items-center rounded-full px-4 text-[14px] font-medium"
                  style={on ? { background: 'var(--ink)', color: 'var(--paper)' } : { background: 'var(--card)', color: 'var(--muted)', boxShadow: 'inset 0 0 0 1px var(--line)' }}>{CHIP[id]}</span></a>); })}
          </div>
        </nav>}
      </header>

      <main id="main">
        {note && <div className="mx-auto max-w-6xl px-4 pt-6"><p className="pub-card max-w-xl px-5 py-4 text-[15px] text-stone-700" role="status">{note}</p></div>}
        {focus ? (
          <section className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-12 sm:py-20 md:grid-cols-2" aria-label={`Book ${focus.name}`}>
            <div className="pub-rise space-y-5" style={{ animationDelay: `${lift}s` }}>
              <p className="text-sm uppercase tracking-wide text-stone-500">{focus.category || 'Service'} · {name}</p>
              <h1 className="text-4xl leading-[1.08] sm:text-6xl">{focus.name}</h1>
              <p className="text-lg text-stone-700">{focus.duration ? `${focus.duration} min · ` : ''}{(focus.priceIsFrom || (focus.serviceTiers || []).length ? 'from ' : '')}${(Number(focus.price) || 0).toFixed(0)}</p>
              {focus.description && <p className="max-w-xl text-lg text-stone-600">{focus.description}</p>}
              <div className="flex flex-wrap items-center gap-3"><PrimaryButton onClick={() => book(focus)}>Book {focus.name}</PrimaryButton><QuietButton onClick={bookTop}>See all services</QuietButton></div>
            </div>
            {(focus.imageUrl || photo) && <div className="pub-rise pub-card overflow-hidden" style={{ animationDelay: `${lift + 0.1}s` }}><img src={focus.imageUrl || photo} alt="" className="aspect-[4/3] w-full object-cover" /></div>}
          </section>
        ) : (
        <section className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-12 sm:py-20 md:grid-cols-2">
          <div className="pub-rise space-y-5" style={{ animationDelay: `${lift}s` }}>
            <h1 className="text-4xl leading-[1.08] sm:text-6xl">{page.headline ? <>{plain}{bold && <> <b>{bold}</b></>}</> : <>Welcome to <b>{name}</b></>}</h1>
            {rating && <p className="text-[15px] text-stone-600">{shows('reviews') ? <a href="#reviews" onClick={(e) => { e.preventDefault(); go('reviews'); }} className="inline-flex min-h-11 items-center gap-1.5"><Stars of={rv.average} /><b className="text-stone-800">{rv.average.toFixed(1)}</b> · {rv.count} reviews</a>
              : <span className="inline-flex items-center gap-1.5"><Stars of={rv.average} /><b className="text-stone-800">{rv.average.toFixed(1)}</b> · {rv.count} reviews</span>}</p>}
            <p className="max-w-xl text-lg text-stone-600">{page.description || 'Book your next visit online in under a minute: pick a service, a time, and you’re done.'}</p>
            <div className="flex flex-wrap gap-3"><PrimaryButton onClick={bookTop}>Book an appointment</PrimaryButton>{team.length > 0 && shows('team') && <QuietButton onClick={() => go('team')}>Meet the team</QuietButton>}</div>
            {(!preview || memberPerk) && <p className="flex flex-wrap gap-x-6">
              {!preview && tenant?.id && <a href={`/book/${encodeURIComponent(tenant.id)}/find`} className="inline-flex min-h-11 items-center text-[15px] font-medium" style={{ color: 'var(--accent-text, var(--accent))' }}>Find my booking</a>}
              {memberPerk && member !== true && <button type="button" onClick={() => askSignIn()} className="inline-flex min-h-11 items-center text-[15px] font-medium" style={{ color: 'var(--accent-text, var(--accent))' }}>Member? Sign in</button>}</p>}
            {againService && last && <div className="pub-card max-w-xl p-4">
              <div className="flex items-start gap-3"><RotateCcw className="mt-1 h-4 w-4 shrink-0 text-stone-500" aria-hidden />
                <div className="min-w-0"><p className="text-[16px] font-semibold">Welcome back, {last.first}</p>
                  <p className="text-[14px] text-stone-600">{againService.name}{againWho ? ` with ${String(againWho.name || '').split(' ')[0]}` : ''}{last.at && Date.parse(last.at) < Date.now() ? <> · <span className="whitespace-nowrap">last booked for {new Date(last.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tenantTimeZone(tenant) })}</span></> : null}</p>
                  {(againWho ? nextFor(`${againService.id}|${againWho.id}`) : nextFor(againService.id)) && soonLine(againWho ? `${againService.id}|${againWho.id}` : againService.id, 'text-[14px]', <>{againWho ? `${String(againWho.name || '').split(' ')[0]}’s next opening` : 'Next opening'}: {againWho ? nextFor(`${againService.id}|${againWho.id}`) : nextFor(againService.id)}</>)}</div></div>
              <div className="mt-3 flex flex-wrap items-center gap-3"><PrimaryButton onClick={() => book(againService, againWho?.id)} className="h-11 px-5">Book again</PrimaryButton>
                <button type="button" onClick={forget} aria-label={`Not ${last.first}? Forget the visit saved on this device`} className="inline-flex min-h-11 items-center text-[14px] text-stone-500">Not {last.first}?</button></div>
            </div>}
            {member === true && <p className="text-[15px] font-medium" style={{ color: 'var(--good)' }} role="status">Signed in as a member{membersOnly ? ': members-only services are open' : ''}.</p>}
            {offer && offerCard}
            {boughtCard}
          </div>
          <div className="pub-rise pub-card relative order-first overflow-hidden md:order-none" style={{ animationDelay: `${lift + 0.1}s` }}>
            {photo ? <img src={photo} alt="" className="aspect-[16/10] w-full object-cover md:aspect-[4/3]" />
              : <div className="relative aspect-[16/10] md:aspect-[4/3]" aria-hidden>
                <span className="absolute -inset-[30%]" style={{ background: 'radial-gradient(40% 45% at 30% 40%, color-mix(in srgb, var(--accent) 50%, transparent), transparent 70%), radial-gradient(35% 40% at 72% 55%, color-mix(in srgb, var(--accent) 32%, transparent), transparent 70%)' }} />
                <span className="absolute inset-0 grid place-items-center">
                  {tenant?.logoUrl ? <span className="grid h-20 w-20 place-items-center overflow-hidden rounded-3xl p-2 shadow-sm" style={{ background: '#fff' }}><img src={tenant.logoUrl} alt="" className="h-full w-full object-contain" /></span>
                    : <span className="grid h-20 w-20 place-items-center rounded-3xl text-[34px] font-bold text-white" style={{ background: 'var(--accent)' }}>{(name.trim()[0] || '·').toUpperCase()}</span>}
                </span>
              </div>}
          </div>
        </section>)}

        {offer && focus && <div className="mx-auto max-w-6xl px-4">{offerCard}</div>}
        {bought && focus && <div className="mx-auto max-w-6xl px-4">{boughtCard}</div>}

        <Section id="services" eyebrow="Services" title={<>Choose your <b>service</b></>}>
          {release.everyone && cleanRelease(tenant?.bookingRelease).mode !== 'off' && <p className="-mt-2 mb-5 max-w-xl text-[15px] text-stone-600">{release.everyone.replace(/\b(C|c)lients can book\b/g, (_m, c) => (c === 'C' ? 'You can book' : 'you can book'))}</p>}
          {withWho && <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white px-4 py-3 text-[15px] shadow-sm" role="status"><span>Booking with <b>{withWho.name}</b>: choose a service</span><button type="button" onClick={() => setWithId(null)} className="inline-flex min-h-11 items-center text-[14px] underline underline-offset-4">Anyone is fine</button></div>}
          {giftCents > 0 && <div className="mb-5"><GiftCoverBar studio cents={giftCents} services={bookable.filter((s: any) => s.membersOnly !== true || member === true)} accent={accent} onPick={(s) => book(s)} /></div>}
          {bookable.length === 0 ? (loadFailed
            ? <div className="pub-card max-w-xl space-y-3 p-5" role="alert"><p className="text-[15px] text-stone-700">We couldn’t load the services just now. It’s usually a moment’s hiccup.</p>
              {onRetry && <button type="button" onClick={onRetry} className="pub-press inline-flex h-11 items-center rounded-full px-5 text-[15px] font-medium text-white" style={{ background: 'var(--accent)' }}>Try again</button>}</div>
            : <p className="text-stone-600">Online booking is coming soon. Please check back shortly.</p>) : (
            <div className="space-y-8">{groups.map(([cat, list]) => (
              <div key={cat} id={`cat-${catSlug(cat)}`} className="space-y-3 scroll-mt-32">
                {groups.length > 1 && <h3 className="text-lg font-semibold">{cat}</h3>}
                <div className="grid gap-3 sm:grid-cols-2">{list.map((s: any, i: number) => { const locked = s.membersOnly === true && member !== true; return (
                  <button key={s.id} type="button" onClick={() => book(s)} className="pub-stagger pub-press pub-card flex w-full items-center gap-4 p-4 text-left" style={{ ['--i' as any]: i }} aria-label={`Book ${s.name}${locked ? ', for members' : ''}`}>
                    {s.imageUrl && <img src={s.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-2xl object-cover" />}
                    <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="text-[16px] font-semibold">{s.name}</span>{s.membersOnly === true && <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-[12px] font-medium text-stone-600">Members</span>}</span>
                      <span className="mt-0.5 block text-[13px] text-stone-500">{[minutes(s.duration), money(s.price) && `${s.priceIsFrom || (s.serviceTiers || []).length ? 'from ' : ''}${money(s.price)}`, depositWords(tenant, s)].filter(Boolean).join(' · ')}</span>
                      {giftCents > 0 && Number(s.price) > 0 && Number(s.price) * 100 <= giftCents && <span className="mt-1 inline-block rounded-full px-2.5 py-0.5 text-[12px] font-medium" style={{ background: 'var(--good-soft)', color: 'var(--good)' }}>Covered by your gift card</span>}
                      {nextFor(s.id) && soonLine(s.id, 'mt-1 text-[13px]', <>Next: {nextFor(s.id)}</>)}
                      {s.description && <span className="mt-1 line-clamp-2 block text-[13px] text-stone-600">{s.description}</span>}</span>
                    <span className="shrink-0 rounded-full px-3.5 py-2 text-[13px] font-medium text-white" style={{ background: 'var(--accent)' }}>Book</span>
                  </button>); })}</div>
              </div>
            ))}</div>
          )}
          {onOfferCode && !offer && <div className="mt-6">
            {!codeOpen ? <button type="button" onClick={() => setCodeOpen(true)} className="inline-flex min-h-11 items-center gap-2 text-[15px] font-medium" style={{ color: 'var(--accent-text, var(--accent))' }}><Tag className="h-4 w-4" aria-hidden />Have an offer code?</button>
              : <div className="max-w-md">
                <label htmlFor="offer-code" className="mb-1.5 block text-[14px] font-medium">Offer code</label>
                <div className="flex gap-2">
                  <input id="offer-code" value={code} autoFocus autoComplete="off" autoCapitalize="characters" onChange={(e) => { setCode(e.target.value.toUpperCase()); setCodeErr(''); }} onKeyDown={(e) => { if (e.key === 'Enter') void applyCode(); }}
                    aria-invalid={!!codeErr} aria-describedby={codeErr ? 'offer-code-err' : undefined} className="h-12 min-w-0 flex-1 rounded-2xl border border-stone-200 bg-white px-4 text-[15px] tracking-[0.08em]" />
                  <button type="button" disabled={codeBusy || !code.trim()} onClick={() => void applyCode()} className="h-12 shrink-0 rounded-full px-5 text-[15px] font-medium text-white disabled:opacity-50" style={{ background: 'var(--accent)' }}>{codeBusy ? 'Checking…' : 'Apply'}</button>
                </div>
                {codeErr && <p id="offer-code-err" className="mt-2 text-[14px] text-stone-700" role="alert">{codeErr}</p>}
              </div>}
          </div>}
        </Section>
        {page.order.filter((id) => id !== 'services').map((id) => <React.Fragment key={id}>{part(id)}</React.Fragment>)}
        {!shows('visit') && alsoHere && <div className="mx-auto max-w-6xl px-4 pb-6">{alsoHere}</div>}
      </main>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 px-4 pb-28 pt-8 text-[13px] text-stone-500 md:pb-10">
        <span>© {new Date().getFullYear()} {name} · Online booking by ClarityFlow</span>
        <a href="/legal/privacy" target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center underline underline-offset-4">Privacy</a>
        <a href="/legal/sms" target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center underline underline-offset-4">Text message terms</a>
      </footer>
      {!preview && <div className="pub-safe-bottom pub-bar fixed inset-x-0 bottom-0 z-30 border-t border-stone-200/70 px-4 pt-3 backdrop-blur md:hidden">
        <PrimaryButton onClick={bookTop} className="w-full">Book an appointment</PrimaryButton>
      </div>}

      <PublicSheet open={fullPolicy} onClose={() => setFullPolicy(false)} title="Our policies">
        <div className="space-y-3 pb-2 text-[15px] leading-relaxed text-stone-700">{bookingPolicyLines(tenant, undefined, { anyDeposit: liveDeposits(tenant, bookable).length > 0 }).map((l, i) => <p key={i}>{l}</p>)}</div>
      </PublicSheet>
      <PublicSheet open={!!signIn} onClose={() => { attempt.current += 1; setSignIn(null); }} title="Member sign-in">
        <div className="space-y-3 pb-2">
          <p className="text-[15px] text-stone-600">{signIn?.then ? `${signIn.then.name} is for members. ` : ''}Enter the email or phone on your membership{membersOnly ? ' to open members-only services' : ''}.{release.members ? ` ${release.members}` : ''}</p>
          <label htmlFor="member-contact" className="block text-[14px] font-medium">Email or phone</label>
          <input id="member-contact" value={contact} onChange={(e) => { setContact(e.target.value); setSignErr(''); }} onKeyDown={(e) => { if (e.key === 'Enter') void signInNow(); }} autoComplete="email"
            aria-invalid={!!signErr} aria-describedby={signErr ? 'member-err' : undefined} className="h-12 w-full rounded-2xl border border-stone-200 bg-white px-4 text-[15px]" />
          {signErr && <p id="member-err" className="text-[14px] text-stone-700" role="alert">{signErr}</p>}
          <PrimaryButton onClick={() => void signInNow()} className={`w-full ${signBusy ? 'pointer-events-none opacity-60' : ''}`}>{signBusy ? 'Checking…' : 'Sign in'}</PrimaryButton>
        </div>
      </PublicSheet>
      <PublicSheet open={here} onClose={() => setHere(false)} title="Getting here">
        <div className="space-y-4 pb-2">
          {addr && <><p className="flex gap-3 text-[15px]"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-stone-500" aria-hidden />{addr}</p>
          <div className="grid grid-cols-2 gap-3">
            <a href={`https://maps.apple.com/?q=${encodeURIComponent(addr)}`} target="_blank" rel="noreferrer" className="inline-flex h-12 items-center justify-center rounded-full bg-white text-[15px] font-medium shadow-sm">Apple Maps</a>
            <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`} target="_blank" rel="noreferrer" className="inline-flex h-12 items-center justify-center rounded-full bg-white text-[15px] font-medium shadow-sm">Google Maps</a>
          </div></>}
          {(visitNotes.parking || visitNotes.entrance || visitNotes.video) && <div className="pub-card divide-y divide-stone-200 px-5 py-1">
            {visitNotes.parking && <div className="flex gap-3 py-3"><Car className="mt-0.5 h-4 w-4 shrink-0 text-stone-500" aria-hidden /><div><p className="text-[15px] font-semibold">Parking</p><p className="whitespace-pre-line text-[14px] text-stone-600">{visitNotes.parking}</p></div></div>}
            {visitNotes.entrance && <div className="flex gap-3 py-3"><DoorOpen className="mt-0.5 h-4 w-4 shrink-0 text-stone-500" aria-hidden /><div><p className="text-[15px] font-semibold">The entrance</p><p className="whitespace-pre-line text-[14px] text-stone-600">{visitNotes.entrance}</p></div></div>}
            {visitNotes.video && <a href={visitNotes.video} target="_blank" rel="noopener noreferrer" className="flex min-h-11 gap-3 py-3"><PlayCircle className="mt-0.5 h-4 w-4 shrink-0 text-stone-500" aria-hidden /><div><p className="text-[15px] font-semibold">Watch the way in</p><p className="text-[14px] text-stone-600">A short video from the street to the door.</p></div></a>}
          </div>}
        </div>
      </PublicSheet>
      <PublicSheet open={!!buying} onClose={() => { if (!buyBusy) setBuying(null); }} title={`${buying?.kind === 'membership' ? 'Join' : 'Buy'} ${buying?.item?.name || ''}`.trim()}>
        {buying && <form className="space-y-3 pb-2" noValidate onSubmit={(e) => { e.preventDefault(); void buyNow(); }}>
          <p className="text-[15px] text-stone-600"><b className="text-stone-800">{buying.item.name}</b>, {buying.kind === 'membership' ? `${money(buying.item.price)} ${per(buying.item)}, renewing each ${buying.item.interval === 'yearly' ? 'year' : 'month'} on the card you pay with until it’s canceled. To cancel, ask the business any time.` : `${money(buying.item.price)}. ${buying.item.description}`}</p>
          <label htmlFor="buy-name" className="block text-[14px] font-medium">Your name</label>
          <input id="buy-name" value={buyer.name} onChange={(e) => setBuyer((b) => ({ ...b, name: e.target.value }))} autoComplete="name" aria-invalid={!!buyErr && !buyer.name.trim()} aria-describedby={buyErr ? 'buy-err' : undefined} className="h-12 w-full rounded-2xl border border-stone-200 bg-white px-4 text-[15px]" />
          <label htmlFor="buy-email" className="block text-[14px] font-medium">Email</label>
          <input id="buy-email" type="email" value={buyer.email} onChange={(e) => setBuyer((b) => ({ ...b, email: e.target.value }))} autoComplete="email" aria-invalid={!!buyErr && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(buyer.email.trim())} aria-describedby={buyErr ? 'buy-err' : undefined} className="h-12 w-full rounded-2xl border border-stone-200 bg-white px-4 text-[15px]" />
          <label htmlFor="buy-phone" className="block text-[14px] font-medium">Phone <span className="font-normal text-stone-500">(optional)</span></label>
          <input id="buy-phone" type="tel" value={buyer.phone} onChange={(e) => setBuyer((b) => ({ ...b, phone: e.target.value }))} autoComplete="tel" className="h-12 w-full rounded-2xl border border-stone-200 bg-white px-4 text-[15px]" />
          <p className="text-[13px] text-stone-500">Use the email you book with, so it’s added to your visits.</p>
          {buyErr && <p id="buy-err" className="text-[14px] text-stone-700" role="alert">{buyErr}</p>}
          <button type="submit" disabled={buyBusy} className="inline-flex h-12 w-full items-center justify-center rounded-full px-6 text-[15px] font-medium text-white shadow-sm transition active:scale-[.98] disabled:opacity-60" style={{ background: 'var(--accent)' }}>{buyBusy ? 'Opening checkout…' : 'Continue to payment'}</button>
        </form>}
      </PublicSheet>
      <PublicSheet open={!!reserve} onClose={() => setReserve(null)} title={rsvDone ? 'Reserved' : 'Reserve a place'}>
        {reserve && <div className="space-y-3 pb-2">
          <p className="text-[15px] text-stone-600"><b className="text-stone-800">{reserve.title || reserve.name || 'Event'}</b>, {new Date(`${reserve.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}{reserve.time ? ` at ${clockUp(reserve.time)}` : ''}.</p>
          {rsvDone ? <><p className="text-[15px] font-medium" style={{ color: 'var(--good)' }} role="status">{rsvDone}</p><PrimaryButton onClick={() => setReserve(null)} className="w-full">Done</PrimaryButton></>
          : seats[reserve.id] === 0 ? <><p className="text-[15px] text-stone-700" role="alert">This event is full.</p><PrimaryButton onClick={() => setReserve(null)} className="w-full">Close</PrimaryButton></>
          : <form className="space-y-3" noValidate onSubmit={(e) => { e.preventDefault(); void reserveNow(); }}>
            <label htmlFor="rsv-name" className="block text-[14px] font-medium">Your name</label>
            <input id="rsv-name" value={rsv.name} onChange={(e) => setRsv((r) => ({ ...r, name: e.target.value }))} autoComplete="name" aria-invalid={!!rsvErr && !rsv.name.trim()} aria-describedby={rsvErr ? 'rsv-err' : undefined} className="h-12 w-full rounded-2xl border border-stone-200 bg-white px-4 text-[15px]" />
            <label htmlFor="rsv-email" className="block text-[14px] font-medium">Email</label>
            <input id="rsv-email" type="email" value={rsv.email} onChange={(e) => setRsv((r) => ({ ...r, email: e.target.value }))} autoComplete="email" aria-invalid={!!rsvErr && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rsv.email.trim())} aria-describedby={rsvErr ? 'rsv-err' : undefined} className="h-12 w-full rounded-2xl border border-stone-200 bg-white px-4 text-[15px]" />
            <label htmlFor="rsv-phone" className="block text-[14px] font-medium">Phone <span className="font-normal text-stone-500">(optional)</span></label>
            <input id="rsv-phone" type="tel" value={rsv.phone} onChange={(e) => setRsv((r) => ({ ...r, phone: e.target.value }))} autoComplete="tel" className="h-12 w-full rounded-2xl border border-stone-200 bg-white px-4 text-[15px]" />
            <label htmlFor="rsv-places" className="block text-[14px] font-medium">Places</label>
            <select id="rsv-places" value={rsv.places} onChange={(e) => setRsv((r) => ({ ...r, places: Number(e.target.value) }))} className="h-12 w-full rounded-2xl border border-stone-200 bg-white px-4 text-[15px]">
              {[1, 2, 3, 4].filter((n) => seats[reserve.id] === undefined || n <= seats[reserve.id]).map((n) => <option key={n} value={n}>{n === 1 ? 'Just me' : `Me and ${n - 1} ${n === 2 ? 'guest' : 'guests'}`}</option>)}
            </select>
            <input name="rsv_ref" value={rsv.rsv_ref} onChange={(e) => setRsv((r) => ({ ...r, rsv_ref: e.target.value }))} tabIndex={-1} autoComplete="off" inputMode="none" aria-hidden className="absolute -left-[9999px] h-px w-px opacity-0" />
            {rsvErr && <p id="rsv-err" className="text-[14px] text-stone-700" role="alert">{rsvErr}</p>}
            <button type="submit" disabled={rsvBusy} className="inline-flex h-12 w-full items-center justify-center rounded-full px-6 text-[15px] font-medium text-white shadow-sm transition active:scale-[.98] disabled:opacity-60" style={{ background: 'var(--accent)' }}>{rsvBusy ? 'Reserving…' : 'Reserve'}</button>
          </form>}
        </div>}
      </PublicSheet>
    </PublicFrame>
  );
}
