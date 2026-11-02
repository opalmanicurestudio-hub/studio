'use client';
// src/components/booking/StudioFlow.tsx — THE BOOKING SHEET: how booking looks, for every way in.
//
// It slides up over the page (the page stays where it was underneath, so Back and Close are always obvious) in the
// business's color and mood, and walks through at most four steps under a progress line:
//   The service    only when there's something to choose on it: add-ons (switches, price beside them), where to meet
//   Choose a time  who and when on one screen; the soonest time said in words first; soft placeholders, never a spinner
//   Your details   filled in for a client this device knows; text reminders with the exact words agreed to; news and
//                  offers always off until the client turns them on; any forms the service needs
//   Review         everything said once: what, when, with whom, what it costs, what's due today, the cancel rule in a
//                  sentence; paying opens right there
// then the booked screen fills the sheet: a check that draws itself, the time in big type, calendar and directions,
// and the visit link explained. The phone's Back button steps back too. All the booking logic is BookingSheet's,
// handed in as `c`.

import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Controller, FormProvider } from 'react-hook-form';
import PhoneField from 'react-phone-number-input/react-hook-form-input';
import { addDays, addMonths, differenceInCalendarDays, endOfMonth, format, isBefore, isSameDay, isSameMonth, startOfDay, startOfMonth } from 'date-fns';
import { Calendar, Check, ChevronLeft, ChevronRight, Clock, MapPin, MessageSquare, Users, X } from 'lucide-react';
import { holdParam } from '@/lib/agent-hold-param';
import { ConfirmNumberCard } from '@/components/visit/VerifyCard';
import { PartyBuilder, partyHasMore } from '@/components/booking/PartyBuilder';
import { bookingPolicyLines, freeChangeLine } from '@/lib/policy-copy';
import { FormFieldRenderer } from '../consents/FormFieldRenderer';
import { PhotoMarkup } from './PhotoMarkup';
import { icsHref, googleHref } from '@/lib/ics';
import { graceHoursOf } from '@/lib/deposit-policy';
import { quietBonus, loyaltyOf } from '@/lib/loyalty';
import { PLACE_LABEL } from '@/lib/service-place';
import { tenantTimeZone, wallParts } from '@/lib/tenant-time';
import { PUBLIC_CSS, PUBLIC_FONT_HREF, moodStyle, money, minutes, type PublicMood } from '@/components/public/kit';

export type FlowLook = { accent: string; mood: PublicMood };

const KNOWN = new Set(['heading', 'paragraph', 'short-text', 'long-text', 'multiple-choice', 'checkboxes', 'image-upload', 'signature']);
const answered = (v: any) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);
const ymd = (d: Date) => format(d, 'yyyy-MM-dd');
const mins = (t: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };
const clockUp = (t: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); if (!m) return ''; const h = Number(m[1]); return `${h % 12 || 12}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`; };
const first = (name: any) => String(name || '').trim().split(/\s+/)[0] || '';
/** A day said from today: "Today", "Tomorrow", "Thursday", "Mon, Nov 9". */
const dayWords = (d: Date, today: Date) => { const n = differenceInCalendarDays(d, today); return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n > 1 && n < 7 ? format(d, 'EEEE') : format(d, 'EEE, MMM d'); };
const lower = (s: string) => (/^(Today|Tomorrow)$/.test(s) ? s.toLowerCase() : s);
/** The address on one line, whether it's kept as text or as its parts. */
function addressLine(a: any): string {
  if (!a) return '';
  if (typeof a === 'string') return a.trim();
  if (typeof a === 'object') return [a.line1 || a.street, a.line2 || a.suite, [a.city, [a.state || a.region, a.zip || a.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ')].map((x) => String(x || '').trim()).filter(Boolean).join(', ');
  return '';
}
const TIME_GROUPS: [string, (m: number) => boolean][] = [['Morning', (m) => m < 720], ['Afternoon', (m) => m >= 720 && m < 1020], ['Evening', (m) => m >= 1020]];

/** Bring a friend: what a new guest and the person booking them get, when the business's referrals allow it. */
const friendNoteOf = (tenant: any): string | null => { const r = tenant?.referrals || {}; if (r.on !== true || r.group === false) return null;
  const d = (c: any) => { const n = Number(c); return Number.isFinite(n) && n > 0 ? `$${n % 100 ? (n / 100).toFixed(2) : n / 100}` : ''; }; const f = d(r.friendCents ?? 1500), g = d(r.rewardCents ?? 1500);
  return f ? `New to us? Each new guest gets ${f} off their first visit${g ? `, and you get ${g} in credit after their visit` : ''}.` : null; };

// The row-shaped input the phone field types into. US numbers by default; starting with + takes any other country's.
const RowInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function RowInput(p, ref) { return <input ref={ref} {...p} className="cf-in" />; });

function Switch({ on }: { on: boolean }) { return <span aria-hidden className={`cf-sw ${on ? 'is-on' : ''}`}><span /></span>; }

/** A row that's a switch: the words it turns on, the full wording under them, and the switch. */
function SwitchRow({ on, onToggle, label, fine }: { on: boolean; onToggle: () => void; label: string; fine?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onToggle} className="cf-row cf-tap w-full text-left">
      <span className="min-w-0 flex-1 py-3"><span className="block text-[15.5px]">{label}</span>{fine && <span className="mt-1 block text-[12px] leading-snug" style={{ color: 'var(--muted)' }}>{fine}</span>}</span>
      <Switch on={on} />
    </button>
  );
}

function Avatar({ m, size = 28, any = false }: { m?: any; size?: number; any?: boolean }) {
  const photo = m?.avatarUrl || m?.photoUrl;
  if (photo) return <img src={photo} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  return <span aria-hidden className="cf-av shrink-0" style={{ width: size, height: size, fontSize: Math.round(size * 0.44) }}>{any ? <Users className="h-[55%] w-[55%]" /> : String(m?.name || '?').charAt(0).toUpperCase()}</span>;
}

export function StudioFlow({ c }: { c: any }) {
  const { service, tenant, steps, currentStep, currentStepIndex } = c;
  const mood: PublicMood = c.look?.mood || 'soft';
  const name = String(tenant?.name || '').trim();
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  const root = useRef<HTMLDivElement>(null); const body = useRef<HTMLDivElement>(null); const title = useRef<HTMLHeadingElement>(null);
  const done = currentStep === 'confirmation';
  const shown: string[] = steps.filter((s: string) => s !== 'confirmation');
  const canBack = !!c.canGoBack && !done;
  const close = () => c.onOpenChange(false);
  const closeRef = useRef(close); closeRef.current = close;
  const backRef = useRef<() => boolean>(() => false);
  // While a booking is on its way or a held time is being let go, Back waits (it stays on this step); otherwise it
  // steps back, or closes from the first.
  backRef.current = () => { if (c.confirming || c.leaving) return true; if (canBack) { void c.handlePrevStep(); return true; } return false; };

  // ── While open: the page underneath stays still; Escape closes; Tab stays inside; focus comes back after. ──
  useEffect(() => {
    const h = document.documentElement, b = document.body; const ho = h.style.overflow, bo = b.style.overflow;
    h.style.overflow = 'hidden'; b.style.overflow = 'hidden';
    const before = document.activeElement as HTMLElement | null;
    // The page behind is out of reach for screen readers and keyboards while the sheet is up.
    const behind = Array.from(document.body.children).filter((el) => el !== root.current && !el.contains(root.current) && !el.hasAttribute('inert')
      && el.tagName !== 'IFRAME' && el.tagName !== 'SCRIPT' && !/stripe/i.test(`${el.id} ${el.getAttribute('name') || ''} ${typeof el.className === 'string' ? el.className : ''}`)) as HTMLElement[];   // the payment form's own frames stay as they are
    behind.forEach((el) => el.setAttribute('inert', ''));
    // Focus inside another panel opened from here (the photo markup) belongs to that panel.
    const elsewhere = () => { const d = (document.activeElement as HTMLElement | null)?.closest?.('[role="dialog"]'); return !!d && d !== root.current; };
    const key = (e: KeyboardEvent) => {
      if (elsewhere()) return;
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); return; }
      if (e.key !== 'Tab' || !root.current) return;
      const f = Array.from(root.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),iframe,[tabindex]:not([tabindex="-1"])')).filter((el) => el.getClientRects().length > 0);
      if (!f.length) return;
      const a = f[0], z = f[f.length - 1];
      if (!root.current.contains(document.activeElement)) { e.preventDefault(); (e.shiftKey ? z : a).focus(); return; }
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); behind.forEach((el) => el.removeAttribute('inert')); h.style.overflow = ho; b.style.overflow = bo; try { before?.focus?.({ preventScroll: true }); } catch { /* gone */ } };
  }, []);

  // The phone's Back button steps back through the sheet, then closes it, instead of leaving the page.
  useEffect(() => {
    const mark = `cf${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    let live = true;
    try { window.history.pushState({ cfFlow: mark }, ''); } catch { live = false; }
    const pop = () => {
      if (!live) return;
      const at = (window.history.state || {}).cfFlow;
      if (at && at !== mark) return;   // an older sheet's own entry (opened and closed quickly): not this one's Back
      if (backRef.current()) { try { window.history.pushState({ cfFlow: mark }, ''); } catch { /* stays one step */ } return; }
      live = false; closeRef.current();
    };
    window.addEventListener('popstate', pop);
    return () => { window.removeEventListener('popstate', pop); if (live && (window.history.state || {}).cfFlow === mark) { live = false; try { window.history.back(); } catch { /* none */ } } };
  }, []);

  // Each step starts at its top, and says what it is to a screen reader.
  useEffect(() => { body.current?.scrollTo({ top: 0 }); const t = window.setTimeout(() => title.current?.focus({ preventScroll: true }), 30); return () => window.clearTimeout(t); }, [currentStep, ready]);

  // ── The time step's days ────────────────────────────────────────────────
  const today0 = useMemo(() => startOfDay(new Date()), []);
  const horizon = Number(tenant?.bookingHorizonDays) > 0 ? Math.floor(Number(tenant.bookingHorizonDays)) : null;
  const span = Math.max(1, Math.min(42, horizon !== null ? horizon + 1 : 28));
  const stripDays = useMemo(() => Array.from({ length: span }, (_, i) => addDays(today0, i)), [span, today0]);
  const pastStrip = differenceInCalendarDays(c.date, today0) >= span;
  const calendarOn = horizon === null || horizon + 1 > span;
  const [monthOpen, setMonthOpen] = useState(false); const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const touched = useRef(false);
  const pickDay = (d: Date) => { touched.current = true; c.setDate(d); c.setSelectedTime(null); setMonthOpen(false); };
  const monthDays = useMemo(() => { const f = startOfMonth(cursor); const lead = f.getDay(); const n = endOfMonth(cursor).getDate(); return [...Array(lead).fill(null), ...Array.from({ length: n }, (_, i) => addDays(f, i))]; }, [cursor]);
  const lastDay = horizon !== null ? addDays(today0, horizon) : null;

  // How many open times each day has (counts only, from the server), for the visit as chosen.
  const qkey = `${c.selectedStaffId}|${c.selectedTierId}|${(c.addOnIds || []).join(',')}|${c.clientExtra || 0}`;
  const [counts, setCounts] = useState<Record<string, number>>({});
  const asked = useRef(new Set<string>());
  const askDays = (from: Date, n: number) => {
    const start = isBefore(from, today0) ? today0 : from; const k = `${qkey}|${ymd(start)}|${n}`;
    if (!c.tenantId || !service?.id || asked.current.has(k)) return; asked.current.add(k);
    const key = qkey;
    fetch('/api/booking/public-data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: c.tenantId, action: 'days', from: ymd(start), days: n, serviceId: service.id, staffId: c.selectedStaffId, tierId: c.selectedTierId !== 'any' ? c.selectedTierId : undefined, providerId: c.providerId || undefined, addOnIds: c.addOnIds || [], extraMinutes: c.clientExtra || 0, holdId: holdParam() || undefined }) })
      .then((r) => r.json()).then((d) => { if (d?.ok) setCounts((p) => ({ ...p, ...Object.fromEntries((d.days || []).map((x: any) => [`${key}|${x.date}`, Number(x.count) || 0])) })); else asked.current.delete(k); })
      .catch(() => { asked.current.delete(k); });   // the counts are a nicety: asked again next time
  };
  useEffect(() => { if (currentStep === 'dateTime') askDays(today0, span); }, [qkey, currentStep, span]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (monthOpen) askDays(startOfMonth(cursor), 42); }, [monthOpen, cursor, qkey]); // eslint-disable-line react-hooks/exhaustive-deps
  const countFor = (d: Date): number | undefined => counts[`${qkey}|${ymd(d)}`];
  // The first open time of each day already seen, so the soonest can be said with its time.
  const [firsts, setFirsts] = useState<Record<string, string>>({});
  useEffect(() => { if (!c.availability.loading && c.timeSlots.length) setFirsts((p) => ({ ...p, [`${qkey}|${ymd(c.date)}`]: c.timeSlots[0] })); }, [c.timeSlots, c.availability.loading]); // eslint-disable-line react-hooks/exhaustive-deps
  const soonDay = stripDays.find((d) => (countFor(d) || 0) > 0) || null;
  const soonTime = soonDay ? firsts[`${qkey}|${ymd(soonDay)}`] : undefined;
  // Opening on a day with nothing open: straight to the soonest day that has times (until the client picks a day).
  useEffect(() => {
    if (touched.current || c.selectedTime || currentStep !== 'dateTime' || !soonDay) return;
    if (countFor(c.date) === 0 && !isSameDay(soonDay, c.date)) c.setDate(soonDay);
  }, [soonDay, counts, currentStep]); // eslint-disable-line react-hooks/exhaustive-deps
  // The chosen day stays in view in the strip.
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = strip.current?.querySelector<HTMLElement>('[aria-pressed="true"]'); if (el && strip.current) { const s = strip.current; s.scrollTo({ left: Math.max(0, el.offsetLeft - s.clientWidth / 2 + el.clientWidth / 2), behavior: 'smooth' }); } }, [c.date, currentStep]);

  // ── Words used across steps ─────────────────────────────────────────────
  const lockedStaff = c.lockedStaffId ? (c.qualifiedStaff || []).find((m: any) => m.id === c.lockedStaffId) || c.selectedStaff : null;
  const whoName = c.lockedStaffId ? first(lockedStaff?.name) : c.selectedStaffId === 'any' ? '' : first(c.selectedStaff?.name);
  const bookedName = first(c.bookedStaff?.name) || whoName;
  const addOnsOn = (c.addOns || []).filter((a: any) => (c.addOnIds || []).includes(a.id));
  const totalMin = (Number(service?.duration) || 0) + (Number(c.addOnMinutes) || 0);
  const priceText = c.priceRange ? `From ${money(c.priceRange.min)}` : money(c.price);
  const visitWhat = [service?.name, ...addOnsOn.map((a: any) => String(a.name || '').toLowerCase())].filter(Boolean).join(', ');
  const timeLine = c.selectedTime ? `${dayWords(c.date, today0)} · ${clockUp(c.selectedTime)}` : '';
  const isRequest = partyHasMore(c.party) || c.bookingPreview?.status === 'requested';
  const values = c.methods.getValues();
  const errors = c.methods.formState.errors || {};
  const reg = c.methods.register;
  const titles: Record<string, string> = { service: service?.name || 'Your visit', dateTime: 'Choose a time', details: 'Your details', review: isRequest ? 'Review your request' : (c.chargeDueNow && c.depositAmount > 0) || c.cardSetupDueNow ? 'Review and pay' : 'Review and book', confirmation: '' };

  // ── 1 · The service ─────────────────────────────────────────────────────
  const serviceStep = (
    <div className="space-y-5">
      {service?.imageUrl && <img src={service.imageUrl} alt="" className="h-[132px] w-full rounded-[18px] object-cover" />}
      <div>
        <p className="text-[22px] font-semibold leading-tight">{service?.name}</p>
        <p className="mt-1 text-[14px]" style={{ color: 'var(--muted)' }}>{[minutes(service?.duration), money(Number(service?.price) || 0), c.chargeDueNow && c.depositAmount > 0 ? `${money(c.depositAmount)} deposit` : ''].filter(Boolean).join(' · ')}</p>
        {service?.description && <p className="mt-3 whitespace-pre-line text-[14.5px] leading-relaxed" style={{ color: 'var(--muted)' }}>{service.description}</p>}
      </div>
      {(c.addOns || []).length > 0 && <section aria-label="Add to it">
        <p className="cf-lbl">Add to it</p>
        <div className="cf-grp">{c.addOns.map((a: any) => { const on = (c.addOnIds || []).includes(a.id); return (
          <button key={a.id} type="button" role="switch" aria-checked={on} onClick={() => c.toggleAddOn(a.id)} className="cf-row cf-tap w-full text-left">
            <span className="min-w-0 flex-1 truncate text-[15.5px]">{a.name}</span>
            <span className="shrink-0 text-[14px]" style={{ color: 'var(--muted)' }}>{[Number(a.price) > 0 ? `+${money(a.price)}` : '', Number(a.duration) > 0 ? `${a.duration} min` : ''].filter(Boolean).join(' · ')}</span>
            <Switch on={on} />
          </button>); })}</div>
      </section>}
      {(c.placeOpts || []).length > 1 && <section aria-label="Where">
        <p className="cf-lbl">How would you like to meet?</p>
        <div className="grid grid-cols-2 gap-2">{c.placeOpts.map((k: string) => <button key={k} type="button" aria-pressed={c.placeChoice === k} onClick={() => c.setPlaceChoice(k)} className="cf-chip cf-chip-full">{(PLACE_LABEL as any)[k] || k}</button>)}</div>
        {(c.placeChoice === 'online' || c.placeChoice === 'phone') && tenant?.depositsLive && tenant?.bookingPolicies?.remotePayInFull !== false && <p className="mt-2 text-[13px]" style={{ color: 'var(--muted)' }}>{c.placeChoice === 'online' ? 'Video calls' : 'Phone calls'} are paid in full when you book.</p>}
      </section>}
    </div>
  );

  // ── 2 · Choose a time ───────────────────────────────────────────────────
  const timeCell = (t: string) => {
    const on = c.selectedTime === t; const hot = c.hotSlotMap.get(t);
    const qb = !hot ? quietBonus(loyaltyOf(tenant), c.date.getDay(), mins(t), service?.id || null) : null;
    return (
      <button key={t} type="button" aria-pressed={on} onClick={() => c.setSelectedTime(on ? null : t)} className="cf-time pub-press">
        {clockUp(t)}
        {hot ? <span className="cf-badge cf-badge-new">Just opened</span> : qb ? <span className="cf-badge cf-badge-pts">+{qb.points} pts</span> : null}
      </button>
    );
  };
  const nextOpen = stripDays.find((d) => differenceInCalendarDays(d, c.date) > 0 && (countFor(d) || 0) > 0) || null;
  const waitlistHref = c.tenantId && !c.providerId ? `/w/${encodeURIComponent(c.tenantId)}?service=${encodeURIComponent(service?.id || '')}${c.selectedStaffId && c.selectedStaffId !== 'any' ? `&provider=${encodeURIComponent(c.selectedStaffId)}` : ''}` : null;
  const access = c.activeDaySchedule?.accessTier;
  const timeStep = (
    <div className="space-y-5">
      {c.rescheduleOf && <div className="cf-note" role="status"><Calendar className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><p><b style={{ color: 'var(--ink)', fontWeight: 600 }}>Moving your {c.rescheduleOf.serviceName || 'appointment'}.</b>{c.rescheduleOf.startTime ? ` It’s now ${format(new Date(c.rescheduleOf.startTime), 'EEEE, MMMM d')} at ${format(new Date(c.rescheduleOf.startTime), 'h:mm a')}, and that time stays yours until the new one is booked.` : ''}</p></div>}
      {c.holdNote && <div className="cf-note" role="status"><Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><p>{c.holdNote}</p></div>}
      {c.clientExtra > 0 && <div className="cf-note"><Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><p>Your visits usually take about {c.clientExtra} minutes longer, so these times leave enough room for you.</p></div>}
      {c.lockedStaffId ? lockedStaff && <div className="flex items-center gap-3"><Avatar m={lockedStaff} size={36} /><p className="text-[15px]">With <b style={{ fontWeight: 600 }}>{lockedStaff.name}</b></p></div>
        : (c.qualifiedStaff || []).length > 1 && <section aria-label="Who">
          <div className="cf-scroll -mx-4 flex gap-2 px-4 pb-1">{[{ id: 'any', name: 'Anyone' }, ...c.qualifiedStaff].map((m: any) => (
            <button key={m.id} type="button" aria-pressed={c.selectedStaffId === m.id} onClick={() => c.handleStaffSelect(m.id)} className="cf-chip pub-press"><Avatar m={m} any={m.id === 'any'} />{m.id === 'any' ? 'Anyone' : first(m.name)}</button>))}</div>
        </section>}
      {c.selectedStaffId === 'any' && (c.availableTiersForService || []).length > 0 && <section aria-label="Level">
        <p className="cf-lbl">Level</p>
        <div className="flex flex-wrap gap-2">{[{ id: 'any', name: 'Any' }, ...c.availableTiersForService].map((t: any) => <button key={t.id} type="button" aria-pressed={c.selectedTierId === t.id} onClick={() => { c.setSelectedTierId(t.id); c.setSelectedTime(null); }} className="cf-chip cf-chip-text pub-press">{t.name}{t.price ? ` · ${money(t.price)}` : ''}</button>)}</div>
      </section>}
      <section aria-label="Day">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-[14px] font-semibold">{format(c.date, 'MMMM yyyy')}</p>
          {calendarOn && <button type="button" onClick={() => { setCursor(startOfMonth(c.date)); setMonthOpen((o) => !o); }} aria-expanded={monthOpen} className="cf-link"><Calendar className="h-4 w-4" aria-hidden />{monthOpen ? 'Hide the month' : 'Pick a date'}</button>}
        </div>
        {monthOpen && <div className="cf-month mb-3" role="group" aria-label="Pick a date">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => setCursor((m) => addMonths(m, -1))} disabled={!isBefore(today0, startOfMonth(cursor))} aria-label="Previous month" className="cf-round"><span><ChevronLeft className="h-4 w-4" /></span></button>
            <p className="text-[15px] font-semibold">{format(cursor, 'MMMM yyyy')}</p>
            <button type="button" onClick={() => setCursor((m) => addMonths(m, 1))} disabled={!!lastDay && !isBefore(endOfMonth(cursor), lastDay)} aria-label="Next month" className="cf-round"><span><ChevronRight className="h-4 w-4" /></span></button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center text-[11px]" style={{ color: 'var(--muted)' }} aria-hidden>{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((x, i) => <span key={i}>{x}</span>)}</div>
          <div className="mt-1 grid grid-cols-7 gap-0.5">{monthDays.map((d, i) => { if (!d) return <span key={i} />; const off = isBefore(d, today0) || (!!lastDay && isBefore(lastDay, d)); const n = countFor(d); return (
            <button key={i} type="button" disabled={off} onClick={() => pickDay(d)} aria-pressed={isSameDay(d, c.date)} aria-label={`${format(d, 'EEEE, MMMM d')}${n === 0 ? ', nothing open' : ''}`} className={`cf-mday ${n === 0 ? 'is-dim' : ''}`}>{format(d, 'd')}</button>); })}</div>
          {!isSameMonth(cursor, today0) && <button type="button" onClick={() => setCursor(startOfMonth(today0))} className="cf-link mt-2">Back to this month</button>}
        </div>}
        <div ref={strip} className="cf-scroll -mx-4 flex gap-2 px-4 pb-1">
          {[...stripDays, ...(pastStrip ? [c.date] : [])].map((d) => { const n = countFor(d); return (
            <button key={ymd(d)} type="button" aria-pressed={isSameDay(d, c.date)} onClick={() => pickDay(d)} aria-label={`${format(d, 'EEEE, MMMM d')}${n === 0 ? ', nothing open' : ''}`} className={`cf-day pub-press ${n === 0 ? 'is-dim' : ''}`}>
              <span className="text-[12px] font-medium">{differenceInCalendarDays(d, today0) === 0 ? 'Today' : format(d, 'EEE')}</span><span className="mt-0.5 text-[18px] font-semibold leading-none">{format(d, 'd')}</span>
            </button>); })}
        </div>
      </section>
      {access && access !== 'all' && <p className="cf-note">That day is kept for {access === 'members' ? 'members and package holders' : 'returning clients'}.</p>}
      {soonDay && !(isSameDay(soonDay, c.date) && soonTime && c.selectedTime === soonTime) && (
        <button type="button" onClick={() => { touched.current = true; c.setDate(soonDay); if (soonTime) c.setSelectedTime(soonTime); }} className="cf-soon">
          <span className={isSameDay(soonDay, today0) ? 'pub-breathe' : 'cf-dot'} aria-hidden />
          <span>Soonest{whoName ? ` with ${whoName}` : ''}: {lower(dayWords(soonDay, today0))}{soonTime ? ` ${clockUp(soonTime)}` : ''}</span>
        </button>)}
      <p className="sr-only" role="status">{c.availability.loading ? `Finding times on ${format(c.date, 'EEEE, MMMM d')}` : `${c.timeSlots.length || 'No'} open time${c.timeSlots.length === 1 ? '' : 's'} on ${format(c.date, 'EEEE, MMMM d')}`}</p>
      <section aria-label={`Times on ${format(c.date, 'EEEE, MMMM d')}`} aria-busy={c.availability.loading}>
        {c.availability.loading ? <div className="grid grid-cols-3 gap-2">{Array.from({ length: 6 }, (_, i) => <span key={i} className="cf-ph" />)}</div>
          : c.timeSlots.length === 0 ? (
            <div className="pub-card space-y-3 p-5 text-center">
              <p className="text-[15px] font-semibold">Nothing open on {format(c.date, 'EEEE, MMMM d')}</p>
              {nextOpen && <button type="button" onClick={() => pickDay(nextOpen)} className="cf-quiet mx-auto">Next open: {dayWords(nextOpen, today0)}</button>}
              {waitlistHref && <a href={waitlistHref} className="cf-link mx-auto">Join the waitlist and we’ll text you when a time opens</a>}
              {c.availability.warnings?.[0] && <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>{c.availability.warnings[0]}</p>}
            </div>)
            : TIME_GROUPS.map(([label, test]) => { const ts = c.timeSlots.filter((t: string) => test(mins(t))); return ts.length ? (
              <div key={label} className="mb-4"><p className="cf-lbl">{label}</p><div className="grid grid-cols-3 gap-2">{ts.map(timeCell)}</div></div>) : null; })}
      </section>
    </div>
  );

  // ── 3 · Your details ────────────────────────────────────────────────────
  const forms: any[] = c.requiredForms || [];
  const referralsAsk = c.partyOk !== false && tenant?.referrals?.on === true && !(typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('ref'));
  const detailsStep = (
    <FormProvider {...c.methods}>
      <form id="cf-details" noValidate onSubmit={(e) => { e.preventDefault(); void c.handleNextStep(); }} className="space-y-5">
        {c.holdNote && <div className="cf-note" role="status"><Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><p>{c.holdNote}</p></div>}
        {c.known && <div className="pub-card flex items-center gap-3 p-4">
          <Avatar m={{ name: c.known }} size={38} />
          <div className="min-w-0 flex-1"><p className="text-[15px] font-semibold">Welcome back, {c.known}</p><p className="text-[13px]" style={{ color: 'var(--muted)' }}>We filled in what you used last time.</p></div>
          <button type="button" onClick={c.forgetMe} className="cf-link shrink-0">Not you?</button>
        </div>}
        <div>
          <div className="cf-grp">
            <label className="cf-row"><span className="cf-k">Name</span><input {...reg('clientName')} autoComplete="name" className="cf-in" placeholder="Your name" aria-invalid={!!errors.clientName} /></label>
            <div className="cf-row cf-phone" onClick={(e) => { const i = (e.currentTarget as HTMLElement).querySelector('input'); if (i && e.target !== i) i.focus(); }}>
              <span className="cf-k" id="cf-mobile">Mobile</span>
              <PhoneField name="clientPhone" control={c.methods.control} defaultCountry="US" inputComponent={RowInput as any} aria-labelledby="cf-mobile" placeholder="For text reminders" />
            </div>
            <label className="cf-row"><span className="cf-k">Email</span><input {...reg('clientEmail')} type="email" inputMode="email" autoComplete="email" className="cf-in" placeholder="you@example.com" aria-invalid={!!errors.clientEmail} /></label>
          </div>
          {(errors.clientName || errors.clientEmail) && <p className="cf-err mt-2 px-1" role="alert">{[errors.clientName?.message, errors.clientEmail?.message].filter(Boolean).map(String).join(' ')}</p>}
          {c.isResolvingIdentity && <p className="mt-2 px-1 text-[13px]" style={{ color: 'var(--muted)' }} role="status">Checking your details…</p>}
          {c.bannedClient && <p className="cf-note cf-warn mt-3" role="alert">{c.bannedClient.banMessage || `This booking can’t be made online. Please contact ${name || 'the business'} directly.`}</p>}
          {c.existingClientWithBalance && !c.bannedClient && <p className="cf-note cf-warn mt-3" role="alert">There’s an open balance on your account. Please settle it with {name || 'the business'} before booking online.</p>}
        </div>
        <section aria-label="Anything we should know">
          <p className="cf-lbl">Anything we should know?</p>
          <div className="cf-grp"><textarea {...reg('notes')} rows={3} className="cf-in cf-area" placeholder="Allergies, what you’re hoping for, anything at all" /></div>
          <p className="cf-lbl mt-4">Inspiration photos <span style={{ fontWeight: 400 }}>(optional)</span></p>
          <PhotoMarkup tenantId={c.tenantId} value={c.inspoPhotos} onChange={c.setInspoPhotos} accent="var(--accent)" />
        </section>
        <div className="cf-grp">
          <Controller name="smsConsent" control={c.methods.control} render={({ field: f }) => <SwitchRow on={!!f.value} onToggle={() => f.onChange(!f.value)} label="Text me reminders" fine={c.smsConsentWording(tenant?.name)} />} />
          <Controller name="smsMarketing" control={c.methods.control} render={({ field: f }) => <SwitchRow on={!!f.value} onToggle={() => f.onChange(!f.value)} label={`News and offers from ${name || 'us'}`} fine={c.smsMarketingWording(tenant?.name)} />} />
        </div>
        {referralsAsk && <details className="cf-more">
          <summary className="cf-link">Have a friend’s code, or did someone recommend us?</summary>
          <div className="cf-grp mt-3">
            <label className="cf-row"><span className="cf-k">Code</span><input {...reg('friendCode')} placeholder="Like HANNAH15" autoCapitalize="characters" className="cf-in uppercase" /></label>
            <label className="cf-row"><span className="cf-k">Their name</span><input {...reg('referrerFirst')} placeholder="First name" className="cf-in" /></label>
            <label className="cf-row"><span className="cf-k">Their mobile</span><input {...reg('referrerPhone')} placeholder="So we can thank them" inputMode="tel" className="cf-in" /></label>
          </div>
          <p className="mt-2 px-1 text-[12.5px]" style={{ color: 'var(--muted)' }}>A code, or their first name and mobile. Names are never shown to anyone.</p>
        </details>}
        {c.groupPol?.enabled && c.partyOk !== false && !c.rescheduleOf && !c.providerId && <PartyBuilder policy={c.groupPol} services={c.allServices || []} mainServiceId={service?.id} party={c.party} onChange={c.setParty} accent="var(--accent)" friendNote={friendNoteOf(tenant)} />}
        {forms.map((form: any) => {
          const qs = (form.fields || []).filter((f: any) => f.type !== 'heading' && f.type !== 'paragraph'); const n = qs.filter((f: any) => answered(c.formAnswers[form.id]?.[f.id])).length;
          const set = (fid: string, v: any) => c.setFormAnswers((p: any) => ({ ...p, [form.id]: { ...(p[form.id] || {}), [fid]: v } }));
          return (
            <section key={form.id} className="pub-card pub-ui space-y-4 p-5" aria-label={form.title}>
              <div className="flex items-start justify-between gap-3"><div><p className="text-[16px] font-semibold">{form.title}</p><p className="text-[13px]" style={{ color: 'var(--muted)' }}>Please answer every question.</p></div>
                <span className={`cf-count ${n === qs.length ? 'is-done' : ''}`}>{n === qs.length ? 'Done' : `${n} of ${qs.length}`}</span></div>
              <div className="space-y-5">{(form.fields || []).map((f: any) => KNOWN.has(f.type)
                ? <FormFieldRenderer key={f.id} field={f} value={c.formAnswers[form.id]?.[f.id]} onChange={(v: any) => set(f.id, v)} />
                : <label key={f.id} className="block space-y-1.5"><span className="text-[14px] font-medium">{f.label || 'Question'}</span><input value={c.formAnswers[form.id]?.[f.id] || ''} onChange={(e) => set(f.id, e.target.value)} className="cf-field" /></label>)}</div>
            </section>
          );
        })}
      </form>
    </FormProvider>
  );

  // ── 4 · Review ──────────────────────────────────────────────────────────
  // Paid right here: the booking is confirmed, whatever the moment before said.
  const o = c.bookingOutcome ? (c.paid && c.bookingOutcome.status === 'pending_payment' ? { ...c.bookingOutcome, status: 'confirmed' } : c.bookingOutcome) : null;
  const payOpen = !!(c.pay?.secret || c.pay?.error);
  const cardOnly = o ? o.status !== 'pending_payment' && !!o.cardOnFile : c.cardSetupDueNow;
  const dueCents = Number(o?.depositCents) > 0 ? Number(o.depositCents) : Math.round((Number(c.depositAmount) || 0) * 100);
  const deposit = c.chargeDueNow ? Number(c.depositAmount) || 0 : 0;
  const base = (Number(c.price) || 0) - addOnsOn.reduce((n: number, a: any) => n + (Number(a.price) || 0), 0);
  const zone = tenantTimeZone(tenant); const w = wallParts(new Date(), zone); const pad = (n: number) => String(n).padStart(2, '0');
  const nowWall = `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
  const rule = c.selectedTime ? freeChangeLine(tenant, service, `${ymd(c.date)}T${c.selectedTime}`, nowWall, Math.round(deposit * 100)) : '';
  const policyLines: string[] = useMemo(() => bookingPolicyLines(tenant, service, { depositCents: Math.round(deposit * 100) }), [tenant, service, deposit]);
  const row = (a: React.ReactNode, b: React.ReactNode, style?: React.CSSProperties) => <p className="flex gap-3 text-[14.5px]" style={style}><span className="min-w-0 flex-1">{a}</span><span className="shrink-0 tabular-nums">{b}</span></p>;
  const reviewStep = (
    <div className="space-y-4">
      <div className="pub-card p-4">
        <p className="text-[16px] font-semibold">{visitWhat}</p>
        <p className="mt-1 text-[14px]" style={{ color: 'var(--muted)' }}>{[timeLine, whoName ? `with ${whoName}` : c.selectedStaffId === 'any' ? 'with whoever is free' : '', minutes(totalMin)].filter(Boolean).join(' · ')}</p>
        {(c.placeOpts || []).length > 1 && <p className="mt-1 text-[14px]" style={{ color: 'var(--muted)' }}>{(PLACE_LABEL as any)[c.placeChoice] || c.placeChoice}</p>}
        {(Number(c.price) > 0 || c.priceRange) && <>
          <div className="cf-hr" />
          <div className="space-y-2">
            {row(service?.name, c.priceRange ? `From ${money(base)}` : money(base))}
            {addOnsOn.map((a: any) => <React.Fragment key={a.id}>{row(a.name, money(a.price))}</React.Fragment>)}
            {row(<b style={{ fontWeight: 600 }}>Total</b>, <b style={{ fontWeight: 600 }}>{priceText}</b>)}
            {deposit > 0 && row(deposit >= (Number(c.price) || 0) ? 'Paid today' : 'Deposit today', money(deposit), { color: 'var(--accent-text, var(--accent))', fontWeight: 600 })}
            {deposit > 0 && !c.priceRange && Number(c.price) - deposit > 0 && row('At your visit', money(Number(c.price) - deposit), { color: 'var(--muted)' })}
            {c.cardSetupDueNow && row('Today', 'Nothing charged', { color: 'var(--muted)' })}
          </div>
        </>}
      </div>
      {(c.previewLines || []).length > 0 && <div className="space-y-1 px-1">{c.previewLines.map((l: string) => <p key={l} className="text-[13.5px] leading-snug" style={{ color: 'var(--muted)' }}>{l}</p>)}</div>}
      {partyHasMore(c.party) && <p className="cf-note">Your guests and extra services go to {name || 'the business'} with this as one request. They confirm everything together, and nothing is charged until they do.</p>}
      {rule && <div className="cf-note"><Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><p>{rule}</p></div>}
      {policyLines.length > 0 && <details className="cf-more px-1">
        <summary className="text-[13.5px]" style={{ color: 'var(--muted)' }}>By {isRequest ? 'sending this' : 'booking'}, you agree to {name ? `${name}’s` : 'these'} policies. <span className="cf-link inline">Read them</span></summary>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[13px] leading-snug" style={{ color: 'var(--muted)' }}>{policyLines.map((l, i) => <li key={i}>{l}</li>)}</ul>
      </details>}
      {c.extraOffer && <div className="pub-card space-y-3 p-4" role="alertdialog" aria-label="A little more time">
        <p className="text-[15px] leading-relaxed">{c.extraOffer.text}</p>
        <div className="flex flex-wrap gap-2"><button type="button" ref={(el) => { if (el && !extraSeen.current) { extraSeen.current = true; el.focus(); } }} disabled={c.confirming} onClick={c.acceptExtra} className="cf-btn cf-btn-sm">Agree and book</button><button type="button" onClick={c.declineExtra} className="cf-quiet">Choose another time</button></div>
      </div>}
      {payOpen && <section className="space-y-3 pt-1" aria-label="Secure payment">
        <div className="px-1"><p className="text-[16px] font-semibold">{cardOnly ? 'Add a card' : dueCents / 100 >= (Number(c.price) || Infinity) ? `Pay ${money(dueCents / 100)}` : `Pay the ${money(dueCents / 100)} deposit`}</p>
          <p className="mt-0.5 text-[13.5px]" style={{ color: 'var(--muted)' }}>{cardOnly ? 'Nothing is charged today. It’s kept on file for this booking.' : dueCents / 100 >= (Number(c.price) || Infinity) ? 'Paid in full now.' : 'It comes off your total at your visit.'}</p></div>
        {c.pay.error ? <div className="cf-note cf-warn" role="alert"><p className="flex-1">{c.pay.error}</p><button type="button" onClick={c.pay.retry} className="cf-link shrink-0">Try again</button></div> : <>
          {c.pay.gift}
          <div className="cf-payframe"><span className="cf-paywait" aria-hidden>Opening the secure form…</span><div ref={c.pay.mountRef} className="relative" /></div>
        </>}
        <p className="text-center text-[12px]" style={{ color: 'var(--muted)' }}>Payments are handled securely by Stripe.</p>
      </section>}
      {payOpen && c.flowNote && <p className={`cf-note ${c.flowNote.tone === 'warn' ? 'cf-warn' : ''}`} role={c.flowNote.tone === 'warn' ? 'alert' : 'status'}>{c.flowNote.text}</p>}
    </div>
  );

  // ── Booked ──────────────────────────────────────────────────────────────
  const outcome = o || { status: 'confirmed', notice: '' };
  const req = outcome.status === 'requested'; const pending = outcome.status === 'pending_payment';
  const you = first(values.clientName); const email = String(values.clientEmail || '').trim();
  const texted = !!values.smsConsent && String(values.clientPhone || '').replace(/\D/g, '').length >= 10;
  const where = addressLine(tenant?.address);
  const startIso = c.selectedTime ? new Date(`${ymd(c.date)}T${c.selectedTime}:00`).toISOString() : null;
  const ev = startIso ? { title: `${service?.name || 'Appointment'}${name ? ` at ${name}` : ''}`, start: startIso, end: new Date(Date.parse(startIso) + ((totalMin + (Number(c.clientExtra) || 0)) || 60) * 60000).toISOString(), location: where || null, details: req ? 'Requested, not confirmed yet.' : null } : null;
  const [calOpen, setCalOpen] = useState(false);
  const extraSeen = useRef(false); if (!c.extraOffer) extraSeen.current = false;
  const diff = differenceInCalendarDays(c.date, today0);
  const doneStep = (
    <div className="mx-auto max-w-md space-y-5 pt-4 text-center">
      <span className="cf-check" aria-hidden>{req ? <MessageSquare className="h-8 w-8" strokeWidth={2.2} /> : <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path className="cf-draw" d="m5 12.5 4.5 4.5L19 7.5" /></svg>}</span>
      <div>
        <h2 ref={title} tabIndex={-1} className="cf-h1" style={{ outline: 'none' }}>{req ? <>Request <b>sent</b></> : pending ? <>Almost <b>there</b></> : <>You’re booked{you ? <>, <b>{you}</b></> : null}</>}</h2>
        {!(outcome.earlier && !req && !pending) && <p className="mx-auto mt-2 max-w-sm text-[14.5px] leading-relaxed" style={{ color: 'var(--muted)' }}>
          {req ? `${name || 'The business'} will look at it and get back to you. Nothing is booked until they do.`
            : pending ? (outcome.notice || 'Your time is held. Check your email to finish booking.')
              : outcome.earlier ? '' : email ? `We sent the details to ${email}${texted ? ' and by text' : ''}.` : 'We’ve sent your confirmation.'}
        </p>}
        {!pending && outcome.notice && <p className="mx-auto mt-2 max-w-sm text-[13.5px] leading-relaxed" style={{ color: 'var(--muted)' }}>{outcome.notice}</p>}
      </div>
      {c.selectedTime && !outcome.earlier && <div className="pub-card p-5 text-left">
        <p className="pub-accent-text text-[13px] font-semibold" style={{ letterSpacing: '.06em', textTransform: 'uppercase' }}>{diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : format(c.date, 'EEE, MMM d')}</p>
        <p className="mt-0.5 text-[28px] font-semibold leading-tight tracking-tight">{clockUp(c.selectedTime)}</p>
        <p className="mt-1.5 text-[14.5px]" style={{ color: 'var(--muted)' }}>{[visitWhat, bookedName ? `with ${bookedName}` : '', minutes(totalMin)].filter(Boolean).join(' · ')}</p>
        {where && <p className="mt-3 flex items-center gap-1.5 text-[13.5px]" style={{ color: 'var(--muted)' }}><MapPin className="h-4 w-4 shrink-0" aria-hidden />{where}</p>}
      </div>}
      {(ev && !req && !pending && !outcome.earlier) || where ? <div className="flex gap-2.5">
        {ev && !req && !pending && !outcome.earlier && <button type="button" aria-expanded={calOpen} onClick={() => setCalOpen((v) => !v)} className="cf-quiet flex-1">Add to calendar</button>}
        {where && <a href={`https://maps.google.com/?q=${encodeURIComponent(where)}`} target="_blank" rel="noreferrer" className="cf-quiet flex-1">Getting here</a>}
      </div> : null}
      {calOpen && ev && <div className="cf-grp text-left">
        <a href={icsHref(ev)} download="appointment.ics" className="cf-row cf-tap"><span className="flex-1">Apple or Outlook calendar</span><ChevronRight className="h-4 w-4" aria-hidden /></a>
        <a href={googleHref(ev)} target="_blank" rel="noreferrer" className="cf-row cf-tap"><span className="flex-1">Google Calendar</span><ChevronRight className="h-4 w-4" aria-hidden /></a>
      </div>}
      {req && <section className="pub-card space-y-2 p-5 text-left" aria-label="What happens next">
        <p className="text-[15px] font-semibold">What happens next</p>
        <ol className="space-y-2 text-[14px]">
          {outcome.cardOnFile && <li className="flex gap-2.5"><span className="cf-num is-on"><Check className="h-3 w-3" strokeWidth={3} aria-hidden /></span>Your card is saved securely. Nothing is charged now.</li>}
          <li className="flex gap-2.5"><span className="cf-num">1</span>{name || 'The business'} looks at your request and gets back to you.</li>
          <li className="flex gap-2.5"><span className="cf-num">2</span>{outcome.depositCents > 0
            ? (outcome.cardOnFile ? `If it’s accepted, the ${money(outcome.depositCents / 100)} deposit is charged to your card and you’re booked.` : `If it’s accepted, we’ll send a link to pay the ${money(outcome.depositCents / 100)} deposit to lock it in.`)
            : 'If it’s accepted, you’re booked, and we’ll confirm by email.'}</li>
          {outcome.depositCents > 0 && <li className="flex gap-2.5"><span className="cf-num">3</span>{outcome.cardOnFile ? `If your card declines, you’ll get a link to pay within ${graceHoursOf(tenant)} hours. Otherwise the time is released.` : `Pay within ${graceHoursOf(tenant)} hours of it being accepted, or the time is released.`}</li>}
        </ol>
      </section>}
      {outcome.visitUrl && !req && !pending && <a href={outcome.visitUrl} className="pub-card pub-press flex items-center gap-3 p-4 text-left">
        <span className="cf-tile"><MessageSquare className="h-5 w-5" aria-hidden /></span>
        <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold">Your visit link</span><span className="block text-[13px] leading-snug" style={{ color: 'var(--muted)' }}>Check in, say you’re running late, or change the time. It’s in the {texted && !outcome.earlier ? 'text and email' : 'email'} we sent too.</span></span>
        <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
      </a>}
      {outcome.prepUrl && !pending && <a href={outcome.prepUrl} className="pub-card pub-press block p-4 text-left"><span className="block text-[15px] font-semibold">A few quick questions</span><span className="block text-[13px]" style={{ color: 'var(--muted)' }}>Answer now so we can plan the right time for you. It takes about a minute, and we’ll remind you before your visit.</span></a>}
      <div className="text-left"><ConfirmNumberCard verify={outcome.verify} businessName={tenant?.name} /></div>
      <button type="button" onClick={close} className="cf-btn">Done</button>
    </div>
  );

  // ── The bar at the bottom ───────────────────────────────────────────────
  const primary = currentStep === 'service' ? { label: 'Choose a time', sub: [minutes(totalMin), priceText].filter(Boolean).join(' · '), disabled: false }
    : currentStep === 'dateTime' ? { label: 'Continue', sub: c.selectedTime ? `${timeLine}${whoName ? ` with ${whoName}` : ''}` : '', disabled: !c.selectedTime }
      : currentStep === 'details' ? { label: 'Continue', sub: '', disabled: !!c.bannedClient || !!c.existingClientWithBalance }
        : currentStep === 'review' && !payOpen ? { label: c.confirming ? (isRequest ? 'Sending…' : 'Booking…') : isRequest ? (c.cardSetupDueNow ? 'Add a card and send' : 'Send request') : deposit > 0 ? `Pay ${money(deposit)} and book` : c.cardSetupDueNow ? 'Add a card and book' : 'Book', sub: deposit > 0 && Number(c.price) > deposit ? `${priceText} in all · ${money(deposit)} today` : '', disabled: c.confirming || !!c.leaving || !!c.extraOffer }
          : null;

  const content = currentStep === 'service' ? serviceStep : currentStep === 'dateTime' ? timeStep : currentStep === 'details' ? detailsStep : currentStep === 'review' ? reviewStep : doneStep;
  const logo = tenant?.logoUrl;
  if (!ready) return null;
  return createPortal(
    <div ref={root} className="pub cf-root" data-mood={mood} style={moodStyle(c.look?.accent || '#16171a', mood) as any} role="dialog" aria-modal="true" aria-labelledby="cf-title">
      <style>{PUBLIC_CSS}{FLOW_CSS}</style>
      <link rel="stylesheet" href={PUBLIC_FONT_HREF} />
      <div className="cf-scrim pub-scrim" onClick={() => { if (currentStep === 'service' || currentStep === 'dateTime' || done) close(); }} aria-hidden />
      <div className={`cf-panel pub-sheet ${done ? 'is-done' : ''}`}>
        {done ? (
          <div className="cf-bar">
            {logo ? <img src={logo} alt="" className="h-9 w-9 shrink-0 rounded-xl object-contain" style={{ background: '#fff' }} /> : <span className="cf-mark" aria-hidden>{(name[0] || '·').toUpperCase()}</span>}
            <p id="cf-title" className="min-w-0 flex-1 truncate text-[16px] font-semibold">{name || 'Booked'}</p>
            <button type="button" onClick={close} aria-label="Close" className="cf-round"><span><X className="h-4 w-4" /></span></button>
          </div>
        ) : <>
          <div className="cf-grab" aria-hidden />
          <div className="cf-head">
            {canBack ? <button type="button" onClick={c.handlePrevStep} aria-label="Back" className="cf-round"><span><ChevronLeft className="h-5 w-5" /></span></button> : <span className="w-11 shrink-0" />}
            <h2 id="cf-title" ref={title} tabIndex={-1} className="min-w-0 flex-1 truncate text-center text-[16px]" style={{ fontWeight: 600, letterSpacing: 0, outline: 'none' }}>{titles[currentStep]}</h2>
            <button type="button" onClick={close} aria-label="Close" className="cf-round"><span><X className="h-4 w-4" /></span></button>
          </div>
          {shown.length > 1 && <div className="cf-prog" role="progressbar" aria-label={`Step ${currentStepIndex + 1} of ${shown.length}`} aria-valuemin={1} aria-valuemax={shown.length} aria-valuenow={currentStepIndex + 1}>
            {shown.map((s, i) => <span key={s} className={i <= currentStepIndex ? 'is-on' : ''} />)}</div>}
        </>}
        <div ref={body} className="cf-body">
          <div key={currentStep} className={`cf-step ${c.direction === 'back' ? 'is-back' : ''}`}>{content}</div>
        </div>
        {primary && <div className="cf-foot">
          {c.flowNote && <p className={`cf-note mb-3 ${c.flowNote.tone === 'warn' ? 'cf-warn' : ''}`} role={c.flowNote.tone === 'warn' ? 'alert' : 'status'}>{c.flowNote.text}</p>}
          {primary.sub && <p className="mb-2.5 truncate text-center text-[13px]" style={{ color: 'var(--muted)' }}>{primary.sub}</p>}
          <button key={currentStep} type={currentStep === 'details' ? 'submit' : 'button'} form={currentStep === 'details' ? 'cf-details' : undefined} disabled={primary.disabled} onClick={currentStep === 'details' ? undefined : () => void c.handleNextStep()} className="cf-btn pub-press">{primary.label}</button>
        </div>}
      </div>
    </div>,
    document.body,
  );
}

// The sheet's own look, on top of the kit: every color is the mood's (paper, card, ink, muted, line), so Soft, Crisp
// and Night all follow; Crisp tightens the corners. 44px or more for everything tapped.
const FLOW_CSS = String.raw`
.cf-root{position:fixed;inset:0;z-index:100;display:flex;align-items:flex-end;justify-content:center;background:transparent!important}
.cf-scrim{position:absolute;inset:0;background:rgba(28,25,23,.34);touch-action:none}
.cf-grab,.cf-head,.cf-prog,.cf-bar{touch-action:none}
.pub[data-mood=night] .cf-scrim{background:rgba(0,0,0,.62)}
.cf-panel{position:relative;display:flex;flex-direction:column;width:100%;height:calc(100% - env(safe-area-inset-top,0px) - 40px);background:var(--paper);color:var(--ink);border-radius:28px 28px 0 0;overflow:hidden;box-shadow:0 -16px 48px -24px rgba(0,0,0,.4);transition:height .38s cubic-bezier(.32,.72,0,1),border-radius .38s}
.cf-panel.is-done{height:100%;border-radius:0}
@media (min-width:640px){.cf-root{align-items:center;padding:24px}.cf-panel,.cf-panel.is-done{max-width:520px;height:min(880px,100%);border-radius:28px;box-shadow:0 30px 80px -30px rgba(0,0,0,.5)}}
.pub[data-mood=crisp] .cf-panel{border-radius:16px 16px 0 0}.pub[data-mood=crisp] .cf-panel.is-done{border-radius:0}
@media (min-width:640px){.pub[data-mood=crisp] .cf-panel,.pub[data-mood=crisp] .cf-panel.is-done{border-radius:16px}}
.pub[data-mood=night] .cf-panel{box-shadow:inset 0 0 0 1px rgba(255,255,255,.07),0 -16px 48px -24px rgba(0,0,0,.6)}
.cf-grab{flex:none;width:38px;height:5px;border-radius:9px;background:var(--line);margin:8px auto 0}
@media (min-width:640px){.cf-grab{display:none}}
.cf-head{flex:none;display:flex;align-items:center;gap:6px;padding:4px 6px 0}
@media (min-width:640px){.cf-head{padding-top:10px}}
.cf-bar{flex:none;display:flex;align-items:center;gap:10px;min-height:58px;padding:0 6px 0 16px;border-bottom:1px solid var(--line)}
@media (max-width:639px){.cf-panel.is-done .cf-bar{padding-top:env(safe-area-inset-top,0px)}}
.cf-mark{width:36px;height:36px;border-radius:11px;background:var(--accent);color:#fff;display:grid;place-items:center;font-weight:700;font-size:16px;flex:none}
.pub[data-mood=crisp] .cf-mark{border-radius:8px}
.cf-round{width:44px;height:44px;flex:none;display:grid;place-items:center;border-radius:999px;color:var(--ink)}
.cf-round>span{width:36px;height:36px;border-radius:999px;display:grid;place-items:center;background:rgba(127,127,127,.14);background:color-mix(in srgb,var(--ink) 7%,transparent);transition:background .2s}
.cf-round:active>span{background:color-mix(in srgb,var(--ink) 14%,transparent)}
.cf-round:disabled{opacity:.3}
.cf-prog{flex:none;display:flex;gap:5px;padding:10px 16px 0}
.cf-prog>span{flex:1;height:3px;border-radius:9px;background:var(--line);transition:background .45s}
.cf-prog>span.is-on{background:var(--accent-text,var(--accent))}
.cf-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:18px 16px 28px}
.cf-foot{position:relative;flex:none;padding:12px 16px calc(14px + env(safe-area-inset-bottom,0px));background:var(--paper)}
.cf-foot::before{content:'';position:absolute;left:0;right:0;bottom:100%;height:28px;background:linear-gradient(to bottom,transparent,var(--paper));pointer-events:none}
@keyframes cfIn{from{opacity:0;transform:translateX(16px)}to{opacity:1;transform:none}}
@keyframes cfInBack{from{opacity:0;transform:translateX(-16px)}to{opacity:1;transform:none}}
.cf-step{animation:cfIn .36s cubic-bezier(.2,.8,.2,1) both}.cf-step.is-back{animation-name:cfInBack}
.cf-lbl{font-size:13px;font-weight:600;color:var(--muted);padding:0 4px 8px}
.cf-grp{background:var(--card);border-radius:18px;overflow:hidden;box-shadow:0 1px 2px rgba(28,25,23,.05),0 8px 24px -18px rgba(28,25,23,.25)}
.pub[data-mood=crisp] .cf-grp{border-radius:12px;box-shadow:inset 0 0 0 1px var(--line)}
.pub[data-mood=night] .cf-grp{box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)}
.cf-row{display:flex;align-items:center;gap:12px;min-height:52px;padding:0 16px;border-top:1px solid var(--line);color:var(--ink)}
.cf-row:first-child{border-top:0}
.cf-tap{transition:background .15s}.cf-tap:active{background:color-mix(in srgb,var(--ink) 5%,transparent)}
.cf-row:focus-within{box-shadow:inset 3px 0 0 var(--accent-text,var(--accent))}
.cf-k{width:74px;flex:none;font-size:14px;color:var(--muted)}
.cf-in{flex:1;min-width:0;height:50px;background:transparent;border:0;outline:none;font-size:16px;color:var(--ink);font-family:inherit}
.cf-in::placeholder{color:var(--muted);opacity:.75}
.pub .cf-in:focus-visible{outline:none}
.cf-area{display:block;width:100%;height:auto;min-height:92px;padding:14px 16px;resize:vertical;line-height:1.45}
.cf-field{height:48px;width:100%;border-radius:14px;border:1px solid var(--line);background:var(--card);padding:0 14px;font-size:16px;color:var(--ink)}
.cf-btn{display:flex;width:100%;height:52px;align-items:center;justify-content:center;border-radius:999px;background:var(--accent);color:#fff;font-size:16px;font-weight:600;box-shadow:0 10px 24px -14px rgba(0,0,0,.45)}
.cf-btn:disabled{opacity:.42;box-shadow:none}
.cf-btn-sm{width:auto;height:46px;padding:0 20px;font-size:15px}
.pub[data-mood=crisp] .cf-btn{border-radius:12px}
.pub[data-mood=night] .cf-btn{box-shadow:inset 0 0 0 1px rgba(255,255,255,.28)}
.cf-quiet{display:inline-flex;min-height:48px;align-items:center;justify-content:center;gap:8px;padding:0 18px;border-radius:999px;background:var(--card);color:var(--ink);font-size:15px;font-weight:500;box-shadow:0 1px 2px rgba(28,25,23,.06),inset 0 0 0 1px var(--line)}
.pub[data-mood=crisp] .cf-quiet{border-radius:12px}
.cf-link{display:inline-flex;min-height:44px;align-items:center;gap:6px;font-size:14px;font-weight:600;color:var(--accent-text,var(--accent))}
.cf-link.inline{min-height:0;display:inline;text-decoration:underline;text-underline-offset:3px}
.cf-scroll{position:relative;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;scroll-padding:0 16px}.cf-scroll::-webkit-scrollbar{display:none}
.cf-chip{display:inline-flex;flex:none;align-items:center;gap:8px;height:44px;padding:0 16px 0 7px;border-radius:999px;background:var(--card);color:var(--ink);font-size:14.5px;font-weight:500;box-shadow:0 1px 2px rgba(28,25,23,.07)}
.cf-chip-text,.cf-chip-full{padding:0 16px}.cf-chip-full{justify-content:center;width:100%}
.cf-chip[aria-pressed=true]{background:var(--ink);color:var(--paper);box-shadow:none}
.cf-av{display:grid;place-items:center;border-radius:999px;font-weight:700;background:color-mix(in srgb,var(--accent) 16%,var(--card));color:var(--accent-text,var(--accent))}
.cf-chip[aria-pressed=true] .cf-av{background:rgba(255,255,255,.18);color:inherit}
.pub[data-mood=night] .cf-chip[aria-pressed=true] .cf-av{background:rgba(0,0,0,.12)}
.cf-day{flex:none;width:56px;height:66px;border-radius:16px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--card);color:var(--ink);box-shadow:0 1px 2px rgba(28,25,23,.07);transition:opacity .2s,background .2s}
.cf-day[aria-pressed=true]{background:var(--ink);color:var(--paper);box-shadow:none}
.cf-day.is-dim:not([aria-pressed=true]){opacity:.42}
.cf-time{position:relative;height:48px;border-radius:14px;background:var(--card);color:var(--ink);font-size:15px;font-weight:500;box-shadow:0 1px 2px rgba(28,25,23,.07)}
.cf-time[aria-pressed=true]{background:var(--accent);color:#fff;box-shadow:0 8px 18px -10px rgba(0,0,0,.45)}
.pub[data-mood=night] .cf-time[aria-pressed=true]{box-shadow:inset 0 0 0 1px rgba(255,255,255,.28)}
.pub[data-mood=crisp] :is(.cf-day,.cf-time){border-radius:10px;box-shadow:inset 0 0 0 1px var(--line)}
.pub[data-mood=crisp] .cf-chip{border-radius:10px;box-shadow:inset 0 0 0 1px var(--line)}
.pub[data-mood=crisp] :is(.cf-day,.cf-chip)[aria-pressed=true],.pub[data-mood=crisp] .cf-time[aria-pressed=true]{box-shadow:none}
.pub[data-mood=night] :is(.cf-day,.cf-time,.cf-chip,.cf-quiet){box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)}
.cf-badge{position:absolute;top:-7px;right:4px;border-radius:999px;padding:1px 6px;font-size:10px;font-weight:600;line-height:1.5}
.cf-badge-new{background:#fdf0dc;color:#8a4508}.cf-badge-pts{background:var(--good-soft);color:var(--good)}
.cf-month{border-radius:18px;background:var(--card);padding:10px 6px;box-shadow:inset 0 0 0 1px var(--line)}
.cf-mday{height:44px;min-width:44px;border-radius:12px;font-size:14.5px;color:var(--ink)}
.cf-mday[aria-pressed=true]{background:var(--ink);color:var(--paper);font-weight:600}
.cf-mday:disabled{opacity:.25}.cf-mday.is-dim:not([aria-pressed=true]){opacity:.42}
.cf-soon{display:flex;align-items:center;gap:8px;min-height:44px;font-size:14.5px;font-weight:600;color:var(--good);text-align:left}
.cf-dot{display:inline-block;width:8px;height:8px;border-radius:999px;background:var(--good);flex-shrink:0}
@keyframes cfPulse{0%,100%{opacity:1}50%{opacity:.5}}
.cf-ph{height:48px;border-radius:14px;background:rgba(127,127,127,.12);background:color-mix(in srgb,var(--ink) 6%,transparent);animation:cfPulse 1.4s ease-in-out infinite}
.cf-note{display:flex;gap:10px;padding:13px 15px;border-radius:16px;background:rgba(127,127,127,.1);background:color-mix(in srgb,var(--ink) 5%,transparent);font-size:13.5px;line-height:1.45;color:var(--muted)}
.cf-warn{background:#fdf3e7;color:#8a4508}
.pub[data-mood=night] .cf-warn{background:rgba(180,83,9,.2);color:#f5c08a}
.cf-err{font-size:13px;color:#b45309}.pub[data-mood=night] .cf-err{color:#f0b27a}
.cf-hr{height:1px;background:var(--line);margin:14px 0}
.cf-more>summary{cursor:pointer;list-style:none;min-height:44px;display:flex;flex-wrap:wrap;align-items:center;gap:4px}
.cf-more>summary::-webkit-details-marker{display:none}
.cf-count{flex:none;border-radius:999px;padding:4px 10px;font-size:12px;font-weight:600;background:color-mix(in srgb,var(--ink) 6%,transparent);color:var(--muted)}
.cf-count.is-done{background:var(--good-soft);color:var(--good)}
.cf-sw{position:relative;flex:none;width:51px;height:31px;border-radius:99px;background:#e7e5e4;transition:background .22s}
.pub[data-mood=night] .cf-sw{background:#3a3b40}
.cf-sw>span{position:absolute;top:2px;left:2px;width:27px;height:27px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .24s cubic-bezier(.2,.8,.2,1)}
.cf-sw.is-on{background:var(--accent)}.cf-sw.is-on>span{transform:translateX(20px)}
.cf-payframe{position:relative;min-height:340px;border-radius:18px;background:#fff;overflow:hidden;box-shadow:inset 0 0 0 1px var(--line)}
.cf-paywait{position:absolute;inset:0;display:grid;place-items:center;font-size:14px;color:#6d7075}
.cf-h1{font-size:30px;line-height:1.15;letter-spacing:-.02em;font-weight:300;outline:none}.cf-h1 b{font-weight:650}
@keyframes cfPopIn{from{opacity:0;transform:scale(.7)}to{opacity:1;transform:none}}
@keyframes cfDraw{to{stroke-dashoffset:0}}
.cf-check{width:76px;height:76px;border-radius:50%;background:var(--good-soft);color:var(--good);display:inline-grid;place-items:center;animation:cfPopIn .5s cubic-bezier(.2,.8,.2,1) both}
.cf-check .cf-draw{stroke-dasharray:24;stroke-dashoffset:24;animation:cfDraw .55s .25s cubic-bezier(.65,0,.35,1) forwards}
.cf-tile{width:42px;height:42px;flex:none;border-radius:12px;display:grid;place-items:center;background:color-mix(in srgb,var(--accent) 12%,var(--card));color:var(--accent-text,var(--accent))}
.cf-num{display:inline-grid;place-items:center;flex:none;width:20px;height:20px;border-radius:999px;font-size:11px;font-weight:600;background:color-mix(in srgb,var(--ink) 8%,transparent)}
.cf-num.is-on{background:var(--accent);color:#fff}
@media (prefers-reduced-motion:reduce){.cf-step,.cf-check,.cf-ph{animation:none}.cf-check .cf-draw{animation:none;stroke-dashoffset:0}.cf-panel,.cf-sw,.cf-sw>span{transition:none}}
`;
