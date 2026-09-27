'use client';
// src/components/booking/StudioFlow.tsx — THE BOOKING SHEET, STUDIO DESIGN.
//
// Drawn in the Studio look (warm paper, the business's accent, Plus Jakarta
// Sans, white rounded cards, calm motion). ALL the booking logic stays in
// BookingSheet — availability, identity checks, deposit rules, form checks,
// card on file, payment, reschedules — and is handed in as `c`.
//   When   who (chips) · level (if used) · week strip · open times
//   You    details · text consent · inspiration photos (markup tool) ·
//          consent forms (answered x of y) · review · one Confirm
//   Pay    only when a deposit is due — the secure card form
//   Done   the server's own words · who/when/where · calendar · directions

import { useMemo } from 'react';
import { Controller, FormProvider } from 'react-hook-form';
import { addDays, format, isBefore, isSameDay, isToday, startOfDay } from 'date-fns';
import { PhoneInput } from '../ui/phone-input';
import { FormFieldRenderer } from '../consents/FormFieldRenderer';
import { PhotoMarkup } from './PhotoMarkup';
import { icsHref, googleHref } from '@/lib/ics';

const KNOWN = new Set(['heading', 'paragraph', 'short-text', 'long-text', 'multiple-choice', 'checkboxes', 'image-upload', 'signature']);
const clock = (t: string) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`; };
const answered = (v: any) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);
const card = 'rounded-3xl bg-white p-5 shadow-[0_1px_2px_rgba(28,25,23,.04),0_12px_32px_-18px_rgba(28,25,23,.25)]';
const field = 'h-12 w-full rounded-2xl border border-stone-200 bg-white px-4 text-[16px] outline-none transition focus:border-[var(--accent)] focus:ring-4 focus:ring-[color-mix(in_srgb,var(--accent)_15%,transparent)]';

export function StudioFlow({ c }: { c: any }) {
  const { service, tenant, currentStep, steps, currentStepIndex } = c;
  const accent = 'var(--accent, #7c3aed)';
  const shown = steps.filter((s: string) => s !== 'confirmation');
  const titles: Record<string, string> = { dateTime: 'Choose a time', details: 'Your details', checkout: 'Pay your deposit', confirmation: '' };
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(c.weekStart, i)), [c.weekStart]);
  const errors = c.methods.formState.errors || {};
  const whenLabel = c.selectedTime ? `${format(c.date, 'EEEE, MMMM d')} at ${clock(c.selectedTime)}` : '';
  const who = c.selectedStaffId === 'any' ? (c.bookedStaff?.name || 'First available') : (c.selectedStaff?.name || '');
  const priceLabel = c.price ? `$${Number(c.price).toFixed(Number(c.price) % 1 ? 2 : 0)}` : '';

  const header = currentStep !== 'confirmation' && (
    <header className="sticky top-0 z-20 bg-[#faf8f5]/95 px-5 pb-3 backdrop-blur" style={{ paddingTop: 'calc(env(safe-area-inset-top,0px) + 12px)' }}>
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => (currentStepIndex > 0 ? c.handlePrevStep() : c.onOpenChange(false))} aria-label={currentStepIndex > 0 ? 'Back' : 'Close'} className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-lg shadow-sm">{currentStepIndex > 0 ? '←' : '✕'}</button>
        <div className="min-w-0 flex-1 text-center"><p className="truncate text-[13px] text-stone-500">{service?.name}{priceLabel ? ` · ${priceLabel}` : ''}</p><p className="truncate text-[17px] font-semibold">{titles[currentStep] || ''}</p></div>
        {currentStepIndex > 0 ? <button type="button" onClick={() => c.onOpenChange(false)} aria-label="Close" className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm">✕</button> : <span className="w-10" />}
      </div>
      <div className="mt-3 flex gap-1.5" aria-label={`Step ${Math.min(currentStepIndex + 1, shown.length)} of ${shown.length}`}>{shown.map((s: string, i: number) => <span key={s} className="h-1 flex-1 rounded-full transition-all duration-500" style={{ background: i <= currentStepIndex ? accent : '#e7e5e4' }} />)}</div>
    </header>
  );

  // ── When ───────────────────────────────────────────────────────────────
  const whenStep = (
    <div className="space-y-5">
      {!c.lockedStaffId && c.qualifiedStaff.length > 1 && <section className="space-y-2" aria-label="Who">
        <p className="text-[13px] text-stone-500">With</p>
        <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1">{[{ id: 'any', name: 'Anyone' }, ...c.qualifiedStaff].map((m: any) => { const on = c.selectedStaffId === m.id; return (
          <button key={m.id} type="button" onClick={() => c.handleStaffSelect(m.id)} aria-pressed={on} className={`flex shrink-0 items-center gap-2 rounded-full py-1.5 pl-1.5 pr-4 text-[15px] transition active:scale-95 ${on ? 'text-white shadow' : 'bg-white shadow-sm'}`} style={on ? { background: accent } : undefined}>
            {m.avatarUrl ? <img src={m.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" /> : <span className={`flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-semibold ${on ? 'bg-white/25' : 'bg-stone-100'}`}>{m.id === 'any' ? '✦' : String(m.name || '?').charAt(0)}</span>}
            {m.id === 'any' ? 'Anyone' : String(m.name || '').split(' ')[0]}
          </button>
        ); })}</div>
      </section>}
      {c.selectedStaffId === 'any' && c.availableTiersForService?.length > 0 && <section className="space-y-2" aria-label="Level">
        <p className="text-[13px] text-stone-500">Level</p>
        <div className="flex flex-wrap gap-2">{[{ id: 'any', name: 'Any' }, ...c.availableTiersForService].map((t: any) => <button key={t.id} type="button" onClick={() => c.setSelectedTierId(t.id)} aria-pressed={c.selectedTierId === t.id} className={`rounded-full px-4 py-2 text-[14px] ${c.selectedTierId === t.id ? 'text-white' : 'bg-white shadow-sm'}`} style={c.selectedTierId === t.id ? { background: accent } : undefined}>{t.name}</button>)}</div>
      </section>}
      <section className={`${card} space-y-4`} aria-label="Day">
        <div className="flex items-center justify-between"><button type="button" onClick={() => c.setDate((d: Date) => addDays(d, -7))} disabled={isBefore(addDays(c.weekStart, -1), startOfDay(new Date()))} aria-label="Previous week" className="flex h-9 w-9 items-center justify-center rounded-full bg-stone-100 disabled:opacity-30">‹</button>
          <p className="text-[15px] font-semibold">{format(c.weekStart, 'MMMM yyyy')}</p>
          <button type="button" onClick={() => c.setDate((d: Date) => addDays(d, 7))} aria-label="Next week" className="flex h-9 w-9 items-center justify-center rounded-full bg-stone-100">›</button></div>
        <div className="grid grid-cols-7 gap-1.5">{weekDays.map((d) => { const past = isBefore(d, startOfDay(new Date())) && !isToday(d); const on = isSameDay(d, c.date); return (
          <button key={d.toISOString()} type="button" disabled={past} onClick={() => { c.setDate(d); c.setSelectedTime(null); }} aria-pressed={on} aria-label={format(d, 'EEEE, MMMM d')} className={`flex aspect-[4/5] flex-col items-center justify-center rounded-2xl transition active:scale-95 ${on ? 'text-white shadow' : past ? 'opacity-25' : 'bg-stone-50'}`} style={on ? { background: accent } : undefined}>
            <span className="text-[11px] opacity-70">{format(d, 'EEE')}</span><span className="text-[17px] font-semibold">{format(d, 'd')}</span>{isToday(d) && <span className="mt-0.5 h-1 w-1 rounded-full" style={{ background: on ? '#fff' : accent }} />}
          </button>
        ); })}</div>
      </section>
      <section className="space-y-2" aria-label="Times" aria-live="polite">
        <p className="text-[13px] text-stone-500">{format(c.date, 'EEEE, MMMM d')}</p>
        {c.availability.loading && !c.timeSlots.length ? <div className="grid grid-cols-3 gap-2">{Array.from({ length: 6 }, (_, i) => <span key={i} className="h-12 animate-pulse rounded-2xl bg-white/70" />)}</div>
          : c.timeSlots.length === 0 ? <div className={`${card} space-y-3 text-center`}><p className="text-[15px]">No open times this day.</p><button type="button" onClick={() => c.setDate((d: Date) => addDays(d, 1))} className="rounded-full px-5 py-2.5 text-[15px] text-white" style={{ background: accent }}>Try the next day</button>{c.availability.warnings?.[0] && <p className="text-[12px] text-stone-500">{c.availability.warnings[0]}</p>}</div>
          : <div className="grid grid-cols-3 gap-2">{c.timeSlots.map((t: string) => { const on = c.selectedTime === t; const hot = c.hotSlotMap.get(t); return (
            <button key={t} type="button" onClick={() => { c.setSelectedTime(t); setTimeout(() => c.setCurrentStepIndex(steps.indexOf('details')), 220); }} aria-pressed={on} className={`relative h-12 rounded-2xl text-[15px] font-medium transition active:scale-95 ${on ? 'text-white shadow' : 'bg-white shadow-sm'}`} style={on ? { background: accent } : undefined}>
              {clock(t)}{hot && <span className="absolute -top-1.5 right-1 rounded-full bg-amber-400 px-1.5 text-[10px] font-semibold text-amber-950">Just opened</span>}
            </button>
          ); })}</div>}
      </section>
    </div>
  );

  // ── You ────────────────────────────────────────────────────────────────
  const reg = c.methods.register;
  const forms: any[] = c.requiredForms || [];
  const youStep = (
    <FormProvider {...c.methods}>
      {/* The form never submits by itself: buttons inside consent-form fields
          (choices, the phone country picker) would otherwise submit it early
          and show "Incomplete forms" mid-answer. Only Confirm moves on. */}
      <form id="studio-details" onSubmit={(e) => e.preventDefault()} className="space-y-5">
        <section className={`${card} space-y-4`} aria-label="Your details">
          <label className="block space-y-1.5"><span className="text-[14px] font-medium">Full name</span><input {...reg('clientName')} autoComplete="name" className={field} placeholder="Your name" />{errors.clientName && <span className="text-[13px] text-red-700">{String(errors.clientName.message || 'Please add your name')}</span>}</label>
          <label className="block space-y-1.5"><span className="text-[14px] font-medium">Email</span><input {...reg('clientEmail')} type="email" autoComplete="email" inputMode="email" className={field} placeholder="you@example.com" />{errors.clientEmail && <span className="text-[13px] text-red-700">{String(errors.clientEmail.message || 'Please add a valid email')}</span>}</label>
          <div className="space-y-1.5"><span className="text-[14px] font-medium">Mobile <span className="font-normal text-stone-500">(optional)</span></span><PhoneInput name="clientPhone" label="" /></div>
          {(['smsConsent', 'smsMarketing'] as const).map((k) => <Controller key={k} name={k} control={c.methods.control} render={({ field: f }) => (
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-stone-50 p-3 text-[13px] leading-relaxed text-stone-600"><input type="checkbox" checked={!!f.value} onChange={(e) => f.onChange(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 rounded accent-[var(--accent)]" />{k === 'smsConsent' ? c.smsConsentWording(tenant?.name) : c.smsMarketingWording(tenant?.name)}</label>
          )} />)}
          {c.isResolvingIdentity && <p className="text-[13px] text-stone-500" role="status">Checking your details…</p>}
          {c.bannedClient && <p className="rounded-2xl bg-red-50 p-3 text-[14px] text-red-800" role="alert">We can’t take this booking online. Please contact {tenant?.name || 'us'} directly.</p>}
          {c.existingClientWithBalance && <p className="rounded-2xl bg-amber-50 p-3 text-[14px] text-amber-900" role="alert">There’s an open balance on your account. Please settle it with {tenant?.name || 'us'} before booking online.</p>}
        </section>
        <section className={`${card} space-y-3`} aria-label="Anything we should know">
          <p className="text-[15px] font-semibold">Anything we should know? <span className="font-normal text-stone-500">(optional)</span></p>
          <textarea {...reg('notes')} rows={3} className="w-full rounded-2xl border border-stone-200 p-3 text-[16px] outline-none focus:border-[var(--accent)]" placeholder="Allergies, preferences, what you’re hoping for…" />
          <p className="pt-1 text-[15px] font-semibold">Inspiration photos <span className="font-normal text-stone-500">(optional)</span></p>
          <PhotoMarkup tenantId={c.tenantId} value={c.inspoPhotos} onChange={c.setInspoPhotos} accent={c.accentHex} />
        </section>
        {forms.map((form: any) => {
          const qs = (form.fields || []).filter((f: any) => f.type !== 'heading' && f.type !== 'paragraph'); const done = qs.filter((f: any) => answered(c.formAnswers[form.id]?.[f.id])).length;
          const set = (fid: string, v: any) => c.setFormAnswers((p: any) => ({ ...p, [form.id]: { ...(p[form.id] || {}), [fid]: v } }));
          return (
            <section key={form.id} className={`${card} space-y-4`} aria-label={form.title}>
              <div className="flex items-start justify-between gap-3"><div><p className="text-[16px] font-semibold">{form.title}</p><p className="text-[13px] text-stone-500">Please answer every question.</p></div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium ${done === qs.length ? 'bg-emerald-50 text-emerald-800' : 'bg-stone-100 text-stone-600'}`}>{done === qs.length ? '✓ Complete' : `${done} of ${qs.length}`}</span></div>
              <div className="space-y-5">{(form.fields || []).map((f: any) => KNOWN.has(f.type)
                ? <FormFieldRenderer key={f.id} field={f} value={c.formAnswers[form.id]?.[f.id]} onChange={(v: any) => set(f.id, v)} />
                : <label key={f.id} className="block space-y-1.5"><span className="text-[14px] font-medium">{f.label || 'Question'}</span><input value={c.formAnswers[form.id]?.[f.id] || ''} onChange={(e) => set(f.id, e.target.value)} className={field} /></label>)}</div>
            </section>
          );
        })}
        <section className={`${card} space-y-3`} aria-label="Review">
          <p className="text-[16px] font-semibold">Your booking</p>
          <dl className="grid grid-cols-[5.5rem_1fr] gap-y-2 text-[15px]">
            <dt className="text-stone-500">Service</dt><dd>{service?.name}</dd>
            <dt className="text-stone-500">With</dt><dd>{who}</dd>
            <dt className="text-stone-500">When</dt><dd>{whenLabel}</dd>
            {priceLabel && <><dt className="text-stone-500">Price</dt><dd>{priceLabel}</dd></>}
          </dl>
          {c.previewLines?.length > 0 && <ul className="space-y-1 rounded-2xl bg-stone-50 p-3 text-[13px] text-stone-600">{c.previewLines.map((l: string) => <li key={l}>{l}</li>)}</ul>}
        </section>
      </form>
    </FormProvider>
  );

  // ── Pay ────────────────────────────────────────────────────────────────
  const payStep = (
    <div className="space-y-4">
      <section className={`${card} space-y-1`}><p className="text-[15px] text-stone-600">A deposit holds your time and comes off your total at your visit.</p>{c.depositAmount > 0 && <p className="text-3xl font-light">${Number(c.depositAmount).toFixed(2)}</p>}</section>
      <section className={`${card} min-h-[320px]`} aria-label="Secure payment">
        {c.depositError ? <div className="space-y-3 text-center"><p className="text-[15px] text-red-800" role="alert">{c.depositError}</p><button type="button" onClick={() => c.initiateCheckout()} className="rounded-full px-5 py-2.5 text-[15px] text-white" style={{ background: accent }}>Try again</button></div>
          : <>{(c.depositLoading || !c.depositClientSecret) && <p className="py-10 text-center text-[14px] text-stone-500" role="status">Opening secure payment…</p>}<div ref={c.embeddedMountRef} /></>}
      </section>
      <p className="text-center text-[12px] text-stone-500">Payments are handled securely by Stripe.</p>
    </div>
  );

  // ── Done ───────────────────────────────────────────────────────────────
  const outcome = c.bookingOutcome || { status: 'confirmed', notice: '' };
  const isRequest = outcome.status === 'requested';
  const startIso = c.selectedTime ? new Date(`${format(c.date, 'yyyy-MM-dd')}T${c.selectedTime}:00`).toISOString() : null;
  const ev = startIso ? { title: `${service?.name || 'Appointment'}${tenant?.name ? ` — ${tenant.name}` : ''}`, start: startIso, end: new Date(Date.parse(startIso) + (Number(service?.duration) || 60) * 60000).toISOString(), location: tenant?.address || null, details: isRequest ? 'Requested — not confirmed yet.' : null } : null;
  const doneStep = (
    <div className="space-y-5 pt-6 text-center" style={{ paddingTop: 'calc(env(safe-area-inset-top,0px) + 32px)' }}>
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full text-4xl text-white shadow-lg" style={{ background: accent, animation: 'pubRise .6s cubic-bezier(.2,.8,.2,1) both' }} aria-hidden>{isRequest ? '✉' : '✓'}</div>
      <div className="space-y-2"><h2 className="text-3xl font-light">{isRequest ? <>Request <b>sent</b></> : outcome.status === 'pending_payment' ? <>Almost <b>there</b></> : <>You’re <b>booked</b></>}</h2>
        <p className="mx-auto max-w-sm text-[15px] text-stone-600">{outcome.notice || (isRequest ? 'We’ll look at your request and get back to you shortly.' : 'We’ve emailed your confirmation.')}</p></div>
      <section className={`${card} mx-auto max-w-sm text-left`}><dl className="grid grid-cols-[4.5rem_1fr] gap-y-2 text-[15px]"><dt className="text-stone-500">What</dt><dd>{service?.name}</dd><dt className="text-stone-500">With</dt><dd>{who}</dd><dt className="text-stone-500">When</dt><dd>{whenLabel}</dd>{tenant?.address && <><dt className="text-stone-500">Where</dt><dd>{tenant.address}</dd></>}</dl></section>
      <div className="mx-auto flex max-w-sm flex-wrap justify-center gap-2">
        {ev && !isRequest && <><a href={icsHref(ev)} download="appointment.ics" className="rounded-full bg-white px-4 py-2.5 text-[14px] shadow-sm">Add to Apple / Outlook</a><a href={googleHref(ev)} target="_blank" rel="noreferrer" className="rounded-full bg-white px-4 py-2.5 text-[14px] shadow-sm">Add to Google</a></>}
        {tenant?.address && <a href={`https://maps.google.com/?q=${encodeURIComponent(tenant.address)}`} target="_blank" rel="noreferrer" className="rounded-full bg-white px-4 py-2.5 text-[14px] shadow-sm">Directions</a>}
      </div>
      <p className="text-[13px] text-stone-500">Your email has links to change or cancel.</p>
      <button type="button" onClick={() => c.onOpenChange(false)} className="h-12 w-full max-w-sm rounded-full text-[16px] font-medium text-white" style={{ background: accent }}>Done</button>
    </div>
  );

  // ── Action bar ─────────────────────────────────────────────────────────
  const primary = currentStep === 'dateTime'
    ? { label: c.selectedTime ? 'Continue' : 'Pick a time', disabled: !c.selectedTime, go: () => c.handleNextStep() }
    : currentStep === 'details'
      ? { label: c.confirming ? 'Booking…' : steps[currentStepIndex + 1] === 'checkout' ? 'Continue to payment' : isRequestPreview(c) ? 'Send request' : 'Confirm booking', disabled: c.confirming || !!c.bannedClient || !!c.existingClientWithBalance, go: () => c.handleNextStep() }
      : null;

  return (
    <div className="min-h-[100dvh] bg-[#faf8f5] text-[#1c1917]" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      {header}
      <main className="mx-auto max-w-xl px-5 pb-40 pt-2" key={currentStep} style={{ animation: 'pubRise .45s cubic-bezier(.2,.8,.2,1) both' }}>
        {currentStep === 'dateTime' && whenStep}
        {currentStep === 'details' && youStep}
        {currentStep === 'checkout' && payStep}
        {currentStep === 'confirmation' && doneStep}
      </main>
      {primary && <div className="fixed inset-x-0 bottom-0 z-20 border-t border-stone-200/70 bg-[#faf8f5]/95 px-5 pt-3 backdrop-blur" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 12px)' }}>
        <div className="mx-auto max-w-xl space-y-1.5">
          {currentStep === 'dateTime' && c.selectedTime && <p className="text-center text-[13px] text-stone-500">{whenLabel}{c.selectedStaffId !== 'any' && who ? ` with ${who.split(' ')[0]}` : ''}</p>}
          <button type="button" disabled={primary.disabled} onClick={primary.go} className="h-13 w-full rounded-full py-3.5 text-[16px] font-medium text-white shadow-lg transition active:scale-[.99] disabled:opacity-40" style={{ background: accent }}>{primary.label}</button>
        </div>
      </div>}
    </div>
  );
}

function isRequestPreview(c: any) { return c.bookingPreview?.status === 'requested'; }
