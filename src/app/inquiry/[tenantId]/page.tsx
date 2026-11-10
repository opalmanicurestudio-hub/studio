'use client';
// src/app/inquiry/[tenantId]/page.tsx — ASK FOR A QUOTE: the public form someone planning an event fills in, in six
// short steps (about you, the event, what you'd like, where and when, budget and timing, anything else). Saved through
// the server (api/inquiry), which checks and tidies every answer and names and prices services from the business's
// own list. Inspiration pictures go up through api/inquiry/upload-image. No sign-in.

import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { guestLogo } from '@/lib/brand';
import { brandColor } from '@/lib/studio-page';
import { INQUIRY_EVENT_TYPES, INQUIRY_BUDGETS, INQUIRY_TIMELINES, INQUIRY_HEARD_FROM } from '@/lib/inquiry-intake';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', AMBER = '#b45309', AMBER_TINT = '#fff7ed';

const getDb = () => {
  if (getApps().length === 0) {
    initializeApp({
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY, authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET, messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID, appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    });
  }
  return getFirestore();
};

type Step = 'contact' | 'event' | 'services' | 'logistics' | 'budget' | 'final' | 'done';
const STEPS: Step[] = ['contact', 'event', 'services', 'logistics', 'budget', 'final'];
const STEP_LABEL: Record<Step, string> = { contact: 'About you', event: 'The event', services: 'What you’d like', logistics: 'Where and when', budget: 'Budget and timing', final: 'Anything else', done: '' };

const CONTACT_METHODS = [{ id: 'email', label: 'Email' }, { id: 'phone', label: 'A call' }, { id: 'text', label: 'A text' }];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TIME_SLOTS = ['Morning (9am–12pm)', 'Afternoon (12pm–5pm)', 'Evening (5pm–8pm)', 'Anytime'];
const PLACES = (business: string) => [
  { id: 'at_business', label: `At ${business}` }, { id: 'on_site', label: 'At my place or venue' },
  { id: 'destination', label: 'Somewhere farther away' }, { id: 'unsure', label: 'Not sure yet' },
];

const input = 'mt-1.5 h-[52px] w-full min-w-0 rounded-2xl border border-[#ececee] bg-white px-4 text-[16px] text-[#16171a] outline-none focus:border-[#16171a] focus:ring-2 focus:ring-[#16171a]/20 aria-[invalid=true]:focus:ring-[#b45309]/50 placeholder:text-[#6d7075] scroll-mt-28 scroll-mb-28';
const ring = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';

/** A labeled field, with its problem (if any) read out with it. */
function Field({ label, hint, error, id, children }: { label: string; hint?: string; error?: string; id: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="block text-[14.5px] font-medium" style={{ color: INK }}>{label}</label>
      {children}
      {hint && !error && <p className="mt-1.5 text-[13.5px]" style={{ color: MUTED }}>{hint}</p>}
      {error && <p id={`${id}-err`} role="alert" className="mt-1.5 text-[13.5px] font-medium" style={{ color: AMBER }}>{error}</p>}
    </div>
  );
}

/** A choice to tap: one of a group (radio) or one of many (checkbox). */
function Choice({ on, onClick, children, multi, className = '', label }: { on: boolean; onClick: () => void; children: React.ReactNode; multi?: boolean; className?: string; label?: string }) {
  return (
    <button type="button" role={multi ? 'checkbox' : 'radio'} aria-checked={on} aria-label={label} onClick={onClick}
      className={`min-h-[48px] rounded-2xl px-4 py-2.5 text-left text-[15px] font-medium transition-colors ${ring} ${className}`}
      style={on ? { background: INK, color: '#fff', border: `1px solid ${INK}` } : { background: '#fff', color: INK, border: `1px solid ${LINE}` }}>
      {children}
    </button>
  );
}

const MAX_PHOTOS = 8;   // what the server keeps (lib/inquiry-intake)
function Uploader({ tenantId, value, onChange, onBusy }: { tenantId: string; value: string[]; onChange: React.Dispatch<React.SetStateAction<string[]>>; onBusy: (b: boolean) => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true); onBusy(true); setErr(''); const got: string[] = [];
    for (const f of Array.from(files)) {
      if (value.length + got.length >= MAX_PHOTOS) { setErr(`Up to ${MAX_PHOTOS} pictures.`); break; }
      if (!f.type.startsWith('image/')) continue;
      if (f.size > 10 * 1024 * 1024) { setErr(`${f.name} is larger than 10 MB.`); continue; }
      const fd = new FormData(); fd.append('file', f); fd.append('tenantId', tenantId);
      try {
        const r = await fetch('/api/inquiry/upload-image', { method: 'POST', body: fd }); const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.url) { setErr(d.error || 'That picture didn’t upload. Please try again.'); continue; }
        got.push(d.url);
      } catch { setErr('No connection. Check your signal and try again.'); }
    }
    if (got.length) onChange((prev) => [...prev, ...got]);
    setBusy(false); onBusy(false); if (ref.current) ref.current.value = '';
  };
  return (
    <div className="mt-1.5 space-y-3">
      <input ref={ref} id="inq-photos" type="file" multiple accept="image/*" tabIndex={-1} className="sr-only" onChange={(e) => add(e.target.files)} />
      {value.length < MAX_PHOTOS && <button type="button" disabled={busy} onClick={() => ref.current?.click()} onDrop={(e) => { e.preventDefault(); add(e.dataTransfer.files); }} onDragOver={(e) => e.preventDefault()}
        className={`flex w-full flex-col items-center justify-center gap-1 rounded-2xl border border-dashed bg-white px-4 py-6 text-center ${ring}`} style={{ borderColor: '#c9cbcf' }}>
        <span className="text-[15px] font-medium" style={{ color: INK }}>{busy ? 'Uploading…' : 'Add pictures'}</span>
        <span className="text-[13px]" style={{ color: MUTED }}>Up to {MAX_PHOTOS} photos, 10 MB each</span>
      </button>}
      {err && <p role="alert" className="text-[13.5px] font-medium" style={{ color: AMBER }}>{err}</p>}
      {value.length > 0 && <ul className="grid grid-cols-3 gap-2">{value.map((u, i) => (
        <li key={u} className="relative overflow-hidden rounded-xl border" style={{ borderColor: LINE }}>
          <img src={u} alt={`Picture ${i + 1}`} className="aspect-square w-full object-cover" />
          <button type="button" onClick={() => onChange((prev) => prev.filter((x) => x !== u))} aria-label={`Remove picture ${i + 1}`} className={`absolute bottom-1 right-1 min-h-[44px] rounded-full bg-white/95 px-3 text-[13px] font-medium ${ring}`} style={{ color: INK }}>Remove</button>
        </li>))}</ul>}
    </div>
  );
}

export default function QuoteInquiryPage() {
  const { tenantId } = useParams() as { tenantId: string };
  const [tenant, setTenant] = useState<any>(null);
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>('contact');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const heading = useRef<HTMLHeadingElement | null>(null);

  const [firstName, setFirstName] = useState(''); const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState(''); const [phone, setPhone] = useState('');
  const [preferredContact, setPreferredContact] = useState('email');
  const [bestDays, setBestDays] = useState<string[]>([]); const [bestTimeSlot, setBestTimeSlot] = useState('');
  const [eventType, setEventType] = useState(''); const [eventName, setEventName] = useState('');
  const [eventDate, setEventDate] = useState(''); const [eventDate2, setEventDate2] = useState('');
  const [guestCount, setGuestCount] = useState(''); const [partySize, setPartySize] = useState('');
  const [picked, setPicked] = useState<string[]>([]); const [customServiceNote, setCustomServiceNote] = useState('');
  const [venueType, setVenueType] = useState(''); const [venueName, setVenueName] = useState(''); const [venueStreet, setVenueStreet] = useState('');
  const [venueCity, setVenueCity] = useState(''); const [venueState, setVenueState] = useState(''); const [venueZip, setVenueZip] = useState('');
  const [startTime, setStartTime] = useState(''); const [endTime, setEndTime] = useState('');
  const [budgetRange, setBudgetRange] = useState(''); const [timeline, setTimeline] = useState(''); const [hasDeposit, setHasDeposit] = useState<boolean | null>(null);
  const [referralSource, setReferralSource] = useState(''); const [referralCode, setReferralCode] = useState('');
  const [specialRequests, setSpecialRequests] = useState(''); const [photos, setPhotos] = useState<string[]>([]); const [uploading, setUploading] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [cfHp, setCfHp] = useState('');   // a field only robots fill in (api/inquiry drops those)
  const startedAt = useRef(Date.now());

  useEffect(() => {
    if (!tenantId) return;
    (async () => {
      try {
        const db = getDb();
        const t = await getDoc(doc(db, `tenants/${tenantId}`)); if (t.exists()) setTenant(t.data());
        const s = await getDocs(collection(db, `tenants/${tenantId}/services`));
        setServices(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })).filter((x: any) => x.type !== 'addon' && x.status !== 'archived')
          .sort((a: any, b: any) => String(a.name || '').localeCompare(String(b.name || ''))));
      } catch (e) { console.error(e); } finally { setLoading(false); }
    })();
  }, [tenantId]);
  useEffect(() => { window.scrollTo({ top: 0 }); heading.current?.focus({ preventScroll: true }); }, [step]);
  /** A problem goes away as soon as that answer is being fixed (it's all checked again on Continue). */
  const fix = (k: string) => { setSendError(''); setErrors((e) => { if (!e[k]) return e; const n = { ...e }; delete n[k]; return n; }); };
  /** What an answer's input carries: whether it has a problem, and where that problem is said. */
  const err = (k: string, id: string) => ({ 'aria-invalid': !!errors[k], 'aria-describedby': errors[k] ? `${id}-err` : undefined, style: errors[k] ? { borderColor: AMBER } : undefined });
  const todayLocal = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

  const accent = brandColor(tenant);
  const logo = guestLogo(tenant);
  const business = tenant?.name || tenant?.businessName || 'the business';
  const at = STEPS.indexOf(step);

  const check = (): boolean => {
    const e: Record<string, string> = {};
    if (step === 'contact') {
      if (!firstName.trim()) e.firstName = 'Add your first name.';
      if (!lastName.trim()) e.lastName = 'Add your last name.';
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) e.email = email.trim() ? 'Check your email address.' : 'Add your email.';
      if (!phone.trim()) e.phone = 'Add your phone number.';
    }
    if (step === 'event') {
      if (!eventType) e.eventType = 'Choose what kind of event it is.';
      if (!eventDate) e.eventDate = 'Add the date you have in mind.';
      else if (eventDate < todayLocal) e.eventDate = 'Choose a date that hasn’t passed.';
      if (eventDate2 && eventDate2 < todayLocal) e.eventDate2 = 'Choose a date that hasn’t passed.';
      if (!guestCount) e.guestCount = 'Add roughly how many people.';
    }
    if (step === 'services' && !picked.length && !customServiceNote.trim()) e.services = 'Choose something, or describe what you’d like.';
    if (step === 'budget') {
      if (!budgetRange) e.budgetRange = 'Choose a budget, or “Not sure yet”.';
      if (!timeline) e.timeline = 'Choose when you need it.';
    }
    if (step === 'final' && !agreed) e.terms = `Agree to hear from ${business} about this, so they can send your quote.`;
    setErrors(e);
    // The first answer with a problem gets the focus, so it's clear where to look.
    if (Object.keys(e).length) setTimeout(() => (document.querySelector('[aria-invalid="true"]') as HTMLElement | null)?.focus(), 0);
    return !Object.keys(e).length;
  };
  const next = () => { if (check()) setStep(STEPS[at + 1]); };
  const back = () => { setErrors({}); if (at > 0) setStep(STEPS[at - 1]); };

  const send = async () => {
    if (uploading) { setSendError('Your pictures are still uploading. One moment.'); return; }
    if (!check()) return;
    setSending(true); setSendError('');
    try {
      // Saved on the server (api/inquiry): checked, tidied and priced from the business's own list there.
      const res = await fetch('/api/inquiry', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId, cf_hp: cfHp, tookMs: Date.now() - startedAt.current,
          firstName, lastName, email, phone, preferredContact, bestDays, bestTimeSlot,
          eventType, eventName, eventDate, alternateDateA: eventDate2, guestCount, partySize,
          interestedServiceIds: picked, customServiceNote,
          venueType, venueName, venueStreet, venueCity, venueState, venueZip, startTime, endTime,
          budgetRange, timeline, readyToDeposit: hasDeposit,
          referralSource, referralCode, specialRequests, inspirationImages: photos,
          agreedToContact: agreed,
        }),
      });
      const d = await res.json().catch(() => ({ ok: false }));
      if (d.ok) setStep('done'); else setSendError(d.error || 'Your request didn’t go through. Please try again in a moment.');
    } catch { setSendError('No connection. Check your signal and try again.'); } finally { setSending(false); }
  };

  if (loading) return <div className="min-h-dvh" style={{ background: SOFT }} aria-busy="true" />;

  const h1 = (title: string, sub: string) => (
    <div className="space-y-1.5">
      <h1 ref={heading} tabIndex={-1} className="text-[28px] font-semibold leading-tight tracking-[-0.02em] outline-none" style={{ color: INK }}>{title}</h1>
      <p className="text-[16px]" style={{ color: MUTED }}>{sub}</p>
    </div>
  );
  const card = 'rounded-3xl border bg-white p-5 space-y-5';

  return (
    <div className="min-h-dvh" style={{ background: SOFT, color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <header className="sticky top-0 z-20 border-b bg-white" style={{ borderColor: LINE }}>
        <div className="mx-auto max-w-xl px-4 py-3.5 space-y-3">
          <div className="flex items-center gap-3">
            {logo ? <img src={logo} alt="" className="h-10 w-10 rounded-xl object-cover" />
              : <span className="flex h-10 w-10 items-center justify-center rounded-xl text-[15px] font-semibold text-white" style={{ background: accent }} aria-hidden>{String(business).slice(0, 1)}</span>}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[16px] font-semibold">{business}</p>
              <p className="text-[13.5px]" style={{ color: MUTED }}>{step === 'done' ? 'Request sent' : `Ask for a quote · Step ${at + 1} of ${STEPS.length}: ${STEP_LABEL[step]}`}</p>
            </div>
          </div>
          {step !== 'done' && <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${STEPS.length}, minmax(0, 1fr))` }} aria-hidden>
            {STEPS.map((s, i) => <span key={s} className="h-1.5 rounded-full transition-colors" style={{ background: i <= at ? accent : LINE }} />)}
          </div>}
        </div>
      </header>

      <form noValidate onSubmit={(e) => { e.preventDefault(); if (step === 'final') void send(); else if (step !== 'done') next(); }}>
      <main className="mx-auto max-w-xl px-4 pb-36 pt-6 space-y-6">
        {step === 'contact' && <>
          {h1('Let’s get to know you', `${business} will use this to send your quote.`)}
          <div className={card} style={{ borderColor: LINE }}>
            <div className="grid grid-cols-2 gap-3">
              <Field id="inq-first" label="First name" error={errors.firstName}><input id="inq-first" value={firstName} onChange={(e) => { setFirstName(e.target.value); fix('firstName'); }} autoComplete="given-name" className={input} {...err('firstName', 'inq-first')} /></Field>
              <Field id="inq-last" label="Last name" error={errors.lastName}><input id="inq-last" value={lastName} onChange={(e) => { setLastName(e.target.value); fix('lastName'); }} autoComplete="family-name" className={input} {...err('lastName', 'inq-last')} /></Field>
            </div>
            <Field id="inq-email" label="Email" error={errors.email}><input id="inq-email" type="email" inputMode="email" value={email} onChange={(e) => { setEmail(e.target.value); fix('email'); }} autoComplete="email" className={input} {...err('email', 'inq-email')} /></Field>
            <Field id="inq-phone" label="Phone" error={errors.phone}><input id="inq-phone" type="tel" value={phone} onChange={(e) => { setPhone(e.target.value); fix('phone'); }} autoComplete="tel" className={input} {...err('phone', 'inq-phone')} placeholder="(555) 000-0000" /></Field>
          </div>
          <div className={card} style={{ borderColor: LINE }}>
            <div><p className="text-[14.5px] font-medium">How should they reach you?</p>
              <div role="radiogroup" aria-label="How should they reach you?" className="mt-2 grid grid-cols-3 gap-2">{CONTACT_METHODS.map((m) => <Choice key={m.id} on={preferredContact === m.id} onClick={() => setPreferredContact(m.id)} className="text-center">{m.label}</Choice>)}</div></div>
            <div><p className="text-[14.5px] font-medium">Best days <span className="font-normal" style={{ color: MUTED }}>Optional</span></p>
              <div role="group" aria-label="Best days" className="mt-2 flex flex-wrap gap-2">{DAYS.map((d) => <Choice key={d} multi label={d} on={bestDays.includes(d)} onClick={() => setBestDays((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d]))}>{d.slice(0, 3)}</Choice>)}</div></div>
            <div><p className="text-[14.5px] font-medium">Best time of day <span className="font-normal" style={{ color: MUTED }}>Optional</span></p>
              <div role="radiogroup" aria-label="Best time of day" className="mt-2 grid grid-cols-2 gap-2">{TIME_SLOTS.map((t) => <Choice key={t} on={bestTimeSlot === t} onClick={() => setBestTimeSlot(bestTimeSlot === t ? '' : t)}>{t}</Choice>)}</div></div>
          </div>
        </>}

        {step === 'event' && <>
          {h1('Tell them about the event', 'The more they know, the closer the quote.')}
          <div className={card} style={{ borderColor: LINE }}>
            <div><p className="text-[14.5px] font-medium">What kind of event?</p>
              <div role="radiogroup" aria-label="What kind of event?" tabIndex={-1} aria-invalid={!!errors.eventType} aria-describedby={errors.eventType ? 'inq-type-err' : undefined} className="mt-2 grid grid-cols-2 gap-2 outline-none">{INQUIRY_EVENT_TYPES.map((t) => <Choice key={t.id} on={eventType === t.id} onClick={() => { setEventType(t.id); fix('eventType'); }}>{t.label}</Choice>)}</div>
              {errors.eventType && <p id="inq-type-err" role="alert" className="mt-1.5 text-[13.5px] font-medium" style={{ color: AMBER }}>{errors.eventType}</p>}</div>
            <Field id="inq-name" label="What should they call it?" hint="Optional. For example: Sam’s 30th, or the spring team day"><input id="inq-name" value={eventName} onChange={(e) => setEventName(e.target.value)} className={input} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="inq-date" label="Date" error={errors.eventDate}><input id="inq-date" type="date" min={todayLocal} value={eventDate} onChange={(e) => { setEventDate(e.target.value); fix('eventDate'); }} className={input} {...err('eventDate', 'inq-date')} /></Field>
              <Field id="inq-date2" label="Or this date" hint="Optional" error={errors.eventDate2}><input id="inq-date2" type="date" min={todayLocal} value={eventDate2} onChange={(e) => { setEventDate2(e.target.value); fix('eventDate2'); }} className={input} {...err('eventDate2', 'inq-date2')} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field id="inq-guests" label="How many people?" error={errors.guestCount}><input id="inq-guests" type="number" inputMode="numeric" min={1} value={guestCount} onChange={(e) => { setGuestCount(e.target.value); fix('guestCount'); }} className={input} {...err('guestCount', 'inq-guests')} placeholder="40" /></Field>
              <Field id="inq-party" label="How many it’s for" hint="If only some of them"><input id="inq-party" type="number" inputMode="numeric" min={1} value={partySize} onChange={(e) => setPartySize(e.target.value)} className={input} placeholder="6" /></Field>
            </div>
          </div>
        </>}

        {step === 'services' && <>
          {h1('What would you like?', 'Choose everything that fits. They’ll build the quote from here.')}
          {services.length > 0 && (() => {
            const groups = new Map<string, any[]>();
            for (const s of services) { const c = s.category || 'More'; groups.set(c, [...(groups.get(c) || []), s]); }
            return Array.from(groups).map(([cat, list]) => (
              <section key={cat} aria-label={cat} className="space-y-2">
                {groups.size > 1 && <h2 className="px-1 text-[14px] font-semibold" style={{ color: MUTED }}>{cat}</h2>}
                {list.map((s: any) => {
                  const on = picked.includes(s.id);
                  return (
                    <button key={s.id} type="button" role="checkbox" aria-checked={on} onClick={() => { setPicked((p) => (p.includes(s.id) ? p.filter((x) => x !== s.id) : [...p, s.id])); fix('services'); }}
                      className={`flex w-full items-start justify-between gap-3 rounded-2xl bg-white p-4 text-left ${ring}`} style={{ border: on ? `2px solid ${INK}` : `1px solid ${LINE}`, margin: on ? 0 : 1 }}>
                      <span className="min-w-0">
                        <span className="block text-[16px] font-semibold">{s.name}</span>
                        <span className="mt-0.5 block text-[14px]" style={{ color: MUTED }}>{[s.duration ? `${s.duration} min` : '', s.description || ''].filter(Boolean).join(' · ')}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-3">
                        {Number(s.price) > 0 && <span className="text-[15px] font-medium tabular-nums">${s.price}</span>}
                        <span className="h-5 w-5 rounded-md box-border" style={{ border: on ? `6px solid ${INK}` : '2px solid #c9cbcf' }} aria-hidden />
                      </span>
                    </button>);
                })}
              </section>));
          })()}
          <div className={card} style={{ borderColor: LINE }}>
            <Field id="inq-custom" label={services.length ? 'Something else, or more detail?' : 'What would you like?'} error={errors.services}>
              <textarea id="inq-custom" value={customServiceNote} onChange={(e) => { setCustomServiceNote(e.target.value); fix('services'); }} rows={3} className={`${input} h-auto py-3`} {...err('services', 'inq-custom')} placeholder="Tell them what you have in mind" />
            </Field>
          </div>
          {picked.length > 0 && <p className="text-[14.5px]" style={{ color: MUTED }} aria-live="polite">{picked.length === 1 ? '1 chosen' : `${picked.length} chosen`}</p>}
        </>}

        {step === 'logistics' && <>
          {h1('Where and when?', 'So they can plan the place and the time.')}
          <div className={card} style={{ borderColor: LINE }}>
            <div><p className="text-[14.5px] font-medium">Where would it be?</p>
              <div role="radiogroup" aria-label="Where would it be?" className="mt-2 grid grid-cols-2 gap-2">{PLACES(business).map((p) => <Choice key={p.id} on={venueType === p.id} onClick={() => setVenueType(p.id)}>{p.label}</Choice>)}</div></div>
            {(venueType === 'on_site' || venueType === 'destination') && <div className="space-y-4">
              <Field id="inq-vname" label="Name of the place" hint="Optional. For example: Riverside Hall"><input id="inq-vname" value={venueName} onChange={(e) => setVenueName(e.target.value)} className={input} /></Field>
              <Field id="inq-street" label="Street address"><input id="inq-street" value={venueStreet} onChange={(e) => setVenueStreet(e.target.value)} autoComplete="street-address" className={input} /></Field>
              <Field id="inq-city" label="City"><input id="inq-city" value={venueCity} onChange={(e) => setVenueCity(e.target.value)} autoComplete="address-level2" className={input} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field id="inq-state" label="State"><input id="inq-state" value={venueState} onChange={(e) => setVenueState(e.target.value)} autoComplete="address-level1" className={input} /></Field>
                <Field id="inq-zip" label="ZIP"><input id="inq-zip" value={venueZip} onChange={(e) => setVenueZip(e.target.value)} autoComplete="postal-code" inputMode="numeric" className={input} /></Field>
              </div>
            </div>}
            <div className="grid grid-cols-2 gap-3">
              <Field id="inq-start" label="Starting at" hint="Optional"><input id="inq-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={input} /></Field>
              <Field id="inq-end" label="Finished by" hint="Optional"><input id="inq-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={input} /></Field>
            </div>
          </div>
        </>}

        {step === 'budget' && <>
          {h1('Budget and timing', 'So the quote fits what you have in mind.')}
          <div className={card} style={{ borderColor: LINE }}>
            <div><p className="text-[14.5px] font-medium">Roughly what would you spend?</p>
              <div role="radiogroup" aria-label="Roughly what would you spend?" tabIndex={-1} aria-invalid={!!errors.budgetRange} aria-describedby={errors.budgetRange ? 'inq-budget-err' : undefined} className="mt-2 grid grid-cols-2 gap-2 outline-none">{INQUIRY_BUDGETS.map((b) => <Choice key={b.id} on={budgetRange === b.id} onClick={() => { setBudgetRange(b.id); fix('budgetRange'); }}>{b.label}</Choice>)}</div>
              {errors.budgetRange && <p id="inq-budget-err" role="alert" className="mt-1.5 text-[13.5px] font-medium" style={{ color: AMBER }}>{errors.budgetRange}</p>}</div>
            <div><p className="text-[14.5px] font-medium">How soon do you need it?</p>
              <div role="radiogroup" aria-label="How soon do you need it?" tabIndex={-1} aria-invalid={!!errors.timeline} aria-describedby={errors.timeline ? 'inq-when-err' : undefined} className="mt-2 grid grid-cols-2 gap-2 outline-none">{INQUIRY_TIMELINES.map((t) => <Choice key={t.id} on={timeline === t.id} onClick={() => { setTimeline(t.id); fix('timeline'); }}>{t.label}</Choice>)}</div>
              {errors.timeline && <p id="inq-when-err" role="alert" className="mt-1.5 text-[13.5px] font-medium" style={{ color: AMBER }}>{errors.timeline}</p>}</div>
            <div><p className="text-[14.5px] font-medium">Ready to pay a deposit to hold the date? <span className="font-normal" style={{ color: MUTED }}>Optional</span></p>
              <div role="radiogroup" aria-label="Ready to pay a deposit to hold the date?" className="mt-2 grid grid-cols-2 gap-2">
                <Choice on={hasDeposit === true} onClick={() => setHasDeposit(hasDeposit === true ? null : true)} className="text-center">Yes, I’m ready</Choice>
                <Choice on={hasDeposit === false} onClick={() => setHasDeposit(hasDeposit === false ? null : false)} className="text-center">I’d like to know more</Choice>
              </div></div>
          </div>
        </>}

        {step === 'final' && <>
          {h1('Anything else?', 'Last few things, then it’s on its way.')}
          <div className={card} style={{ borderColor: LINE }}>
            <div><p className="text-[14.5px] font-medium">How did you hear about {business}? <span className="font-normal" style={{ color: MUTED }}>Optional</span></p>
              <div role="radiogroup" aria-label="How did you hear about them?" className="mt-2 grid grid-cols-2 gap-2">{INQUIRY_HEARD_FROM.map((s) => <Choice key={s} on={referralSource === s} onClick={() => { const next = referralSource === s ? '' : s; setReferralSource(next); if (!/friend/i.test(next)) setReferralCode(''); }}>{s}</Choice>)}</div></div>
            {/friend/i.test(referralSource) && <Field id="inq-ref" label="Their referral code" hint="Optional. Your friend gets their thank-you when you book."><input id="inq-ref" value={referralCode} onChange={(e) => setReferralCode(e.target.value.toUpperCase())} className={`${input} tracking-[0.12em]`} placeholder="SAM20" /></Field>}
            <Field id="inq-notes" label="Requests or notes" hint="Optional. Allergies, access needs, must-haves"><textarea id="inq-notes" value={specialRequests} onChange={(e) => setSpecialRequests(e.target.value)} rows={3} className={`${input} h-auto py-3`} /></Field>
            <div><label htmlFor="inq-photos" className="block text-[14.5px] font-medium">Pictures of what you have in mind <span className="font-normal" style={{ color: MUTED }}>Optional</span></label><Uploader tenantId={tenantId} value={photos} onChange={setPhotos} onBusy={setUploading} /></div>
            <input type="text" name="cf_hp" value={cfHp} onChange={(e) => setCfHp(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-px w-px opacity-0" />
          </div>
          <div>
            <button type="button" role="switch" aria-checked={agreed} aria-invalid={!!errors.terms} aria-describedby={errors.terms ? 'inq-terms-err' : undefined} onClick={() => { setAgreed(!agreed); fix('terms'); }} className={`flex w-full items-center gap-3 rounded-2xl border bg-white p-4 text-left ${ring}`} style={{ borderColor: errors.terms ? AMBER : LINE }}>
              <span className="relative h-7 w-12 shrink-0 rounded-full transition-colors" style={{ background: agreed ? INK : '#d5d7db' }} aria-hidden>
                <span className="absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all" style={{ left: agreed ? 22 : 2 }} />
              </span>
              <span className="text-[15px]">I’m happy for {business} to get in touch about this.</span>
            </button>
            {errors.terms && <p id="inq-terms-err" role="alert" className="mt-1.5 text-[13.5px] font-medium" style={{ color: AMBER }}>{errors.terms}</p>}
          </div>
          {sendError && <p role="alert" className="rounded-2xl px-4 py-3 text-[15px]" style={{ background: AMBER_TINT, color: AMBER }}>{sendError}</p>}
        </>}

        {step === 'done' && <>
          <div className="rounded-3xl p-6 space-y-2 text-white" style={{ background: accent }}>
            <p className="text-[14.5px] font-medium">Request sent</p>
            <h1 ref={heading} tabIndex={-1} className="text-[28px] font-semibold leading-tight outline-none">Thank you, {firstName.trim() || 'friend'}.</h1>
            <p className="text-[15.5px]">{business} has your request and will send your quote to {email.trim()}.</p>
          </div>
          <div className={card} style={{ borderColor: LINE }}>
            <h2 className="text-[17px] font-semibold">What you asked for</h2>
            <dl className="space-y-2 text-[15px]">
              <div className="flex justify-between gap-4"><dt style={{ color: MUTED }}>Event</dt><dd className="text-right">{eventName || INQUIRY_EVENT_TYPES.find((t) => t.id === eventType)?.label}</dd></div>
              {eventDate && <div className="flex justify-between gap-4"><dt style={{ color: MUTED }}>Date</dt><dd className="text-right">{new Date(`${eventDate}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</dd></div>}
              {guestCount && <div className="flex justify-between gap-4"><dt style={{ color: MUTED }}>People</dt><dd className="text-right">{guestCount}</dd></div>}
              {picked.length > 0 && <div className="flex justify-between gap-4"><dt style={{ color: MUTED }}>Services</dt><dd className="text-right">{services.filter((s) => picked.includes(s.id)).map((s) => s.name).join(', ')}</dd></div>}
            </dl>
            <p className="text-[14.5px]" style={{ color: MUTED }}>Need to change something? Reply to the email they send you.</p>
          </div>
          <Link href={`/book/${tenantId}`} className={`flex h-[54px] w-full items-center justify-center rounded-2xl border bg-white text-[16px] font-semibold ${ring}`} style={{ borderColor: LINE }}>See {business}’s booking page</Link>
        </>}
      </main>

      {step !== 'done' && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur" style={{ borderColor: LINE }}>
          <div className="mx-auto flex max-w-xl gap-3 px-4 py-3">
            {at > 0 && <button type="button" onClick={back} className={`h-[52px] rounded-2xl border bg-white px-5 text-[16px] font-semibold ${ring}`} style={{ borderColor: LINE }}>Back</button>}
            <button type="submit" disabled={sending || uploading} className={`h-[52px] flex-1 rounded-2xl text-[16px] font-semibold text-white disabled:opacity-50 ${ring}`} style={{ background: accent }}>
              {sending ? 'Sending…' : uploading ? 'Uploading pictures…' : step === 'final' ? 'Send my request' : 'Continue'}
            </button>
          </div>
        </div>
      )}
      </form>
    </div>
  );
}
