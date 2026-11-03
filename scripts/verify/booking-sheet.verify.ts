// scripts/verify/booking-sheet.verify.ts — the booking sheet (Booking page step 5): one flow for every way in, opened
// over the page in the page's own color and mood; the cancel rule said in a sentence; the client this device knows;
// and the client portal's booking path (its card step, consent and visit link).
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/booking-sheet.verify.ts
import fs from 'fs';
import { execSync } from 'child_process';
import { freeChangeLine } from '../../src/lib/policy-copy';
import { moodStyle } from '../../src/components/public/kit';
import Module from 'module';
import { bookThroughEngine, holdKeyOf } from '../../src/lib/booking/engine-confirm';
import { makeDb } from './fake-db';

let bad = 0; const ok = (c: any, m: string) => { if (!c) { bad++; console.error('FAIL', m); } else console.log('  ✓', m); };
const src = (p: string) => fs.readFileSync(p, 'utf8');

(async () => {
  // ── The cancel rule, in a sentence ──────────────────────────────────────
  const t = { name: 'Opal', cancellationWindowHours: 24, defaultCancellationMode: 'flat', cancellationFee: 25 };
  ok(freeChangeLine(t, {}, '2026-11-06T15:30', '2026-11-01T10:00') === 'Free to cancel until Thu at 3:30 PM, 24 hours before. After that, a $25 cancellation fee applies.', 'the cancel rule names the day and time it stops being free, and what happens after');
  ok(freeChangeLine(t, {}, '2026-11-02T15:30', '2026-11-01T10:00').startsWith('Free to cancel until today at 3:30 PM'), 'a deadline later today says today');
  ok(freeChangeLine(t, {}, '2026-11-01T15:30', '2026-11-01T10:00') === 'It’s less than 24 hours away, so canceling after you book counts as late: a $25 cancellation fee applies.', 'a visit already inside the window says so, instead of a deadline that has passed');
  ok(freeChangeLine({ ...t, bookingPolicies: { lateCancelConsequence: 'deposit' } }, {}, '2026-11-04T15:30', '2026-11-01T10:00', 1500).endsWith('After that, the $15 deposit stays with Opal.'), 'when a late cancel keeps the deposit, the sentence says the deposit stays');
  ok(freeChangeLine({ name: 'Opal' }, {}, '2026-11-04T15:30', '2026-11-01T10:00') === 'You can cancel any time from your visit link.', 'no window: cancel any time');
  ok(freeChangeLine({ ...t, cancellationPolicy: 'Our words' }, {}, '2026-11-04T15:30', '2026-11-01T10:00') === '', 'a business that wrote its own policy has its words shown instead');
  ok(freeChangeLine({ ...t, cancellationWindowHours: 48 }, {}, '2026-11-20T09:00', '2026-11-01T10:00').startsWith('Free to cancel until Wed, Nov 18 at 9:00 AM, 2 days before.'), 'further out, the date is given');

  // ── Moods reach the sheet ───────────────────────────────────────────────
  const night = moodStyle('#8b5e57', 'night'), soft = moodStyle('#8b5e57', 'soft');
  ok(soft['--accent'] === '#8b5e57' && soft['--accent-text'] === '#8b5e57' && night['--accent-text'] !== '#8b5e57' && /^\d+ \d+% \d+%$/.test(night['--accent-hsl']), 'the sheet paints with the business color; on Night, text in it is lifted; the form parts get it too');
  const kit = src('src/components/public/kit.tsx');
  ok(!kit.includes('.pub-flow') && kit.includes('.pub[data-mood=night] .pub-ui{') && kit.includes('--primary:var(--accent-hsl,'), 'form parts inside the sheet follow the mood, light or dark, in the business color');
  const pubFlow = execSync("grep -rl 'pub-flow' src || true").toString().trim();
  ok(!pubFlow, `nothing uses the old flow theme any more${pubFlow ? ': ' + pubFlow : ''}`);

  // ── One flow, over the page ─────────────────────────────────────────────
  const bs = src('src/components/booking/BookingSheet.tsx'); const sf = (src('src/components/booking/StudioFlow.tsx') + src('src/components/booking/flow-css.ts')); const book = src('src/app/(booking)/book/[tenantId]/page.tsx');
  ok(!bs.includes('STEP_TITLES') && !bs.includes("variant?: 'overlay' | 'page'") && !bs.includes('simple?:') && !bs.includes('RadioGroup') && bs.includes('return <StudioFlow c={{'), 'the old booking screens are gone: every way in uses the one sheet');
  ok(!book.includes('variant="page"') && !book.includes('simple={') && (book.match(/\{sheet\}/g) || []).length === 3 && !book.includes("if (dialogOpen) window.scrollTo({ top: 0"), 'the booking page, a renter’s page and its welcome screen all open the sheet over themselves, without jumping the page to the top');
  ok(book.includes('lockedStaffId={sheetRenter ? providerId : undefined}') && book.includes("accent: readable(cleanBrand(sheetRenter.brand).accent)") && book.includes("cleanBrand(sheetRenter.brand).tone === 'dark' ? 'night' : 'soft'"), 'on a renter’s link the sheet comes in their color, light or dark, with them as the one who does it');
  ok(sf.includes('createPortal(') && sf.includes('document.body') && sf.includes("h.style.overflow = 'hidden'") && sf.includes('className="cf-scrim pub-scrim"'), 'the sheet sits over the page, which stays still underneath');
  ok(sf.includes("window.history.pushState({ cfFlow: mark }, '')") && sf.includes('if (backRef.current())') && sf.includes('window.history.back()') && sf.includes('if (at && at !== mark) return;'), 'the phone’s Back button steps back through the sheet, then closes it, and closing tidies up after itself');
  ok(sf.includes("if (e.key === 'Escape')") && sf.includes("closest?.('[role=\"dialog\"]')") && sf.includes('title.current?.focus({ preventScroll: true })'), 'Escape closes, Tab stays inside (but leaves the photo markup alone), and each step says what it is');
  ok(sf.includes('<button key={currentStep} type={currentStep === \'details\' ? \'submit\' : \'button\'}'), 'the button that moves to the details can’t also send them before they are filled in');

  // ── The steps ───────────────────────────────────────────────────────────
  ok(bs.includes("const serviceStep = !rescheduleOf && (addOns.length > 0 || placeOpts.length > 1);") && bs.includes("[...(serviceStep ? ['service'] : []), 'dateTime', 'details', 'review', 'confirmation']"), 'the service step shows only when there’s something to choose on it; then a time, details, and a review');
  ok(sf.includes('role="switch" aria-checked={on} onClick={() => c.toggleAddOn(a.id)}') && sf.includes("label: 'Choose a time', sub: [minutes(totalMin), priceText]"), 'add-ons are switches with their price beside them, and the total shows on the button');
  ok(sf.includes("const soonDay = stripDays.find((d) => (countFor(d) || 0) > 0) || null;") && sf.includes('Soonest{whoName ?') && sf.includes("className=\"cf-ph\"") && !/animate-spin|Loader/.test(sf), 'the soonest time is said in words; times load as soft placeholders, never a spinner');
  ok(sf.includes("if (countFor(c.date) === 0 && !isSameDay(soonDay, c.date)) c.setDate(soonDay);") && sf.includes('if (touched.current'), 'opening on a day with nothing open goes to the soonest day with times, until the client picks a day');
  ok(sf.includes("addOnIds: c.addOnIds || [], extraMinutes: c.clientExtra || 0") && bs.includes("addOnIds, extraMinutes: clientExtra });"), 'open-day counts and the pick for “Anyone” are for the visit as chosen, add-ons and extra time included');
  ok(sf.includes('Join the waitlist') && sf.includes('Next open: '), 'a day with nothing open offers the next open day and the waitlist');
  ok(bs.includes('resetPay(); setExtraOffer(null);') && bs.includes("if (result?.code === 'confirm_extra')") && bs.includes("if (result?.code === 'needs_longer')") && bs.includes("goToRef.current('confirmation');"), 'one button books: payment opens on the review for that booking; leaving the review drops it; extra time and longer visits are handled; a group request lands on the booked screen too');
  ok(!bs.includes('useCallback') && bs.includes('const resolveBookingPayload = ():'), 'what gets booked is read when the client books, so photos, guests and an agreed extra charge are never left out');
  ok(sf.includes('freeChangeLine(tenant, service,') && sf.includes('bookingPolicyLines(tenant, service,') && sf.includes('you agree to {name ?'), 'the review says the cancel rule in a sentence, with the full policies a tap away and the agreement beside the button');

  // ── Their details ───────────────────────────────────────────────────────
  ok(bs.includes('const knownKey = (tenantId: string) => `cf.me.${tenantId}`') && bs.includes("if (currentStep !== 'confirmation' || !tid || discreet) return;") && bs.includes("const me = !prefillClient && tid && !discreet ? readKnown(tid) : null;") && bs.includes('548 * 86400000'), 'a returning client on the same device finds their details filled in (never for a discreet business, forgotten after a year and a half)');
  ok(bs.includes("localStorage.removeItem(knownKey(tid)); localStorage.removeItem(`cf.lastVisit.${tid}`);") && sf.includes('Not you?'), '“Not you?” forgets them on this device and clears the form');
  ok(!/smsMarketing:\s*(true|me\.)/.test(bs) && !/smsConsent:\s*me\./.test(bs) && sf.includes('fine={c.smsConsentWording(tenant?.name)}') && sf.includes('fine={c.smsMarketingWording(tenant?.name)}'), 'text reminders and news and offers both start off, even for a client the device knows (consent is given on each booking); both show the exact words agreed to');
  ok(bs.includes("if (watch('smsMarketing') && consentPhone.length < 10)"), 'a yes to offers by text needs a mobile number too');
  ok(sf.includes("from 'react-phone-number-input/react-hook-form-input'") && sf.includes('defaultCountry="US"'), 'the mobile number takes US numbers as typed and any other country starting with +, stored the same way as before');
  ok(bs.includes("{ shouldFocus: true }") && sf.includes("[errors.clientName?.message, errors.clientEmail?.message]"), 'a missing name or email is said for both, with the first one focused');

  // ── Booked ──────────────────────────────────────────────────────────────
  ok(sf.includes('className="cf-draw"') && sf.includes('.cf-check .cf-draw{stroke-dasharray:24') && sf.includes('Your visit link') && sf.includes('Add to calendar') && sf.includes('Getting here'), 'booked: a check that draws itself, the time in big type, calendar, directions and the visit link');
  ok(book.includes("visitUrl: out.checkInToken ? `/check-in/${encodeURIComponent(String(out.checkInToken))}` : null"), 'the booked screen opens the same visit link every message carries');

  // ── The client portal's path ────────────────────────────────────────────
  const engine = src('src/lib/booking/engine-confirm.ts');
  const calls: any[] = []; let outcome: any = null;
  (globalThis as any).fetch = async (u: string, o: any) => { const b = JSON.parse(o?.body || '{}'); calls.push({ u, b });
    if (u.includes('/api/appointments/book')) return { status: 200, json: async () => ({ ok: true, status: 'confirmed', requiresCardOnFile: true, clientId: 'c1', appointmentId: 'a1', checkInToken: 'tok' }) };
    if (u.includes('booking-card')) return { status: 200, json: async () => ({ clientSecret: 'seti_x', stripeAccountId: 'acct' }) };
    return { status: 200, json: async () => ({}) }; };
  const r: any = await bookThroughEngine({ tenantId: 't1', source: 'client-portal', formData: { clientName: 'Dana', clientEmail: 'd@x.com' }, apptDetails: { serviceId: 's1', startTime: '2026-11-06T15:30:00.000Z', smsMarketing: true, smsMarketingText: 'Also text me', acceptExtraCents: 500 }, signedForms: [], setStep: () => {}, onOutcome: (x) => { outcome = x; }, held: { current: null } });
  const card = calls.find((c) => c.u.includes('booking-card'))?.b || {}; const booked = calls.find((c) => c.u.includes('/api/appointments/book'))?.b || {};
  ok(r.clientSecret === 'seti_x' && card.appointmentId === 'a1' && card.checkInToken === 'tok', 'in the portal, a business that needs a card on file now gets one (the card step sends the booking and its link token, as the server checks)');
  ok(booked.client?.smsMarketing === true && booked.client?.smsMarketingText === 'Also text me' && booked.acceptExtraCents === 500 && outcome?.visitUrl === '/check-in/tok', 'the portal carries a yes to offers with its words, an agreed extra charge, and the visit link');
  (globalThis as any).fetch = async () => ({ status: 409, json: async () => ({ ok: false, code: 'confirm_extra', error: 'Your visits usually run 15 minutes longer.', extraMinutes: 15, extraCents: 1000 }) });
  const r2: any = await bookThroughEngine({ tenantId: 't1', source: 'client-portal', formData: { clientName: 'Dana', clientEmail: 'd@x.com' }, apptDetails: { serviceId: 's1', startTime: '2026-11-06T15:30:00.000Z' }, signedForms: [], setStep: () => {}, onOutcome: () => {}, held: { current: null } });
  ok(r2.code === 'confirm_extra' && r2.extraCents === 1000, 'the portal hands the sheet a request to agree to extra time, so it can ask');
  ok(engine.includes('appointmentId };') && !src('src/app/(booking)/portal/[tenantId]/page.tsx').includes('simple=') && src('src/app/(booking)/portal/[tenantId]/[clientId]/page.tsx').includes('visitUrl: x.visitUrl || null'), 'the portal pages open the same sheet, with the gift card option for a deposit and the visit link');

  // ── From the review ─────────────────────────────────────────────────────
  ok(bs.includes('const [stepName, setStepName] = useState<string>(steps[0]);') && !bs.includes('setCurrentStepIndex'), 'the step is kept by name, so the booked screen stays put when the steps change underneath it (a reschedule finishing)');
  ok(bs.includes('initialSlot?.date, initialSlot?.time, initialSlot?.staffId]'), 'a held time from an assistant doesn’t reset the sheet every time the page redraws');
  ok(sf.includes("{c.availability.loading ? <div className=\"grid grid-cols-3 gap-2\">") && bs.includes("if (!availability.times.includes(selectedTime)) setSelectedTime(null);") && bs.includes('setSelectedTime(null); };'), 'while times load the old day’s times never show; a time not open on the day as loaded, or after an add-on changes the length, is chosen again');
  ok(bs.includes('onComplete: () => { setPaid(true);') && sf.includes("c.paid && c.bookingOutcome.status === 'pending_payment' ? { ...c.bookingOutcome, status: 'confirmed' }"), 'paid on the sheet (card or gift card): the booked screen says booked, with calendar and visit link');
  ok(bs.includes('addMinutes(startDateTime, (Number(service.duration) || 0) + addOnMinutes + clientExtra)'), 'the booking ends after its add-ons and the client’s usual extra time');
  ok(fs.readFileSync('src/lib/forms.ts', 'utf8').includes('!(Array.isArray(v) && v.length === 0)'), 'a required box ticked and then unticked is not an answer (lib/forms formLeft)');
  ok(bs.includes('const canGoBack = currentStepIndex > 0 && currentStep !== \'confirmation\' && !confirming && !leaving && !payKindCard;') && bs.includes('said = await onReleaseHold?.();') && sf.includes('if (c.confirming || c.leaving) return true;'), 'Back waits while a booking is on its way; from paying a deposit it lets the held time go first; once only a card is left to add, there is no going back to book twice');
  ok(sf.includes("if (currentStep === 'service' || currentStep === 'dateTime' || done) close();") && sf.includes("el.setAttribute('inert', '')") && sf.includes('touch-action:none') && sf.includes('role="status">{c.availability.loading ?'), 'a stray tap outside never throws away details or forms; the page behind is out of reach; screen readers hear how many times are open, not every time');
  ok(src('src/app/(booking)/portal/[tenantId]/page.tsx').includes('partyOk={false}') && src('src/app/(booking)/portal/[tenantId]/page.tsx').includes("prefillClient={client ? {") && sf.includes('c.partyOk !== false && tenant?.referrals?.on === true'), 'in the portal: the signed-in client’s details, and no guests or referral fields it can’t send');
  ok(src('src/app/api/booking/public-data/route.ts').includes("limitPublic(req, 'days', tenantId,"), 'the heaviest availability ask is limited per visitor and per business');
  const grp = src('src/app/api/appointments/book-group/route.ts');
  ok(grp.includes("smsMarketing: b.organizer?.smsMarketing === true") && grp.includes('client, ...own,') && book.includes("smsMarketing: (restDetails as any).smsMarketing === true"), 'a group request keeps the organizer’s yes to offers, where to meet and their photos');
  // Holding for a deposit: pay again only for exactly the same booking; anything changed books it fresh after letting go.
  const base = { serviceId: 's1', staffId: 'm1', startTime: 'x', addOnIds: ['a2', 'a1'] };
  const me = { name: 'Dana', email: 'd@x.com' }; const k0 = holdKeyOf(base, me, []);
  ok(holdKeyOf(base, { name: 'Dana', email: 'D@x.com ' }, []) === holdKeyOf({ ...base, addOnIds: ['a1', 'a2'] }, me, []) && [holdKeyOf({ ...base, smsConsent: true }, me, []), holdKeyOf({ ...base, staffId: 'm2' }, me, []), holdKeyOf({ ...base, notes: 'nails short' }, me, []),
    holdKeyOf(base, { ...me, phone: '5125550199' }, []), holdKeyOf(base, { ...me, name: 'Dana Reyes' }, []), holdKeyOf(base, me, [{ formId: 'f1', formData: { q1: 'yes' } }]), holdKeyOf({ ...base, inspirationPhotos: [{ url: 'u', note: 'short' }] }, me, []), holdKeyOf({ ...base, referredBy: { firstName: 'Mia', phone: '1' } }, me, [])].every((k) => k !== k0),
    'a held booking is reused only when nothing about it changed (add-ons, person, consent, notes, name, phone, form answers, photos, who recommended them)');
  const run = async (answers: Record<string, any>, held: any, key?: any) => { const calls: any[] = []; let step = '';
    (globalThis as any).fetch = async (u: string, o: any) => { calls.push({ u, b: JSON.parse(o?.body || '{}') }); const a = Object.entries(answers).find(([k]) => u.includes(k)); const [st, body] = a ? a[1] : [200, {}]; return { status: st, json: async () => body }; };
    gotOutcome = null; const r: any = await bookThroughEngine({ tenantId: 't1', source: 'client-portal', formData: { clientName: 'Dana', clientEmail: 'd@x.com' }, apptDetails: { ...base, ...(key || {}) }, signedForms: [], setStep: (x) => { step = x; }, onOutcome: (y) => { gotOutcome = y; }, held });
    return { r, calls, step, held }; };
  const sameKey = holdKeyOf(base, { name: 'Dana', email: 'd@x.com' }, []); let gotOutcome: any = null;
  let x = await run({ '/api/stripe/deposit': [409, { error: 'This deposit is already paid.' }] }, { current: { key: sameKey, appointmentId: 'h1', k: 'tk' } });
  ok(x.step === 'confirmation' && x.r.requiresPayment === false && !x.calls.some((c) => c.u.includes('/api/appointments/book')) && gotOutcome?.status === 'confirmed' && gotOutcome?.visitUrl === '/check-in/tk', 'asked to pay again for a booking that’s already paid: it’s booked (and the booked screen says so, with its visit link), not an error');
  x = await run({ '/api/stripe/deposit': [409, { error: 'This hold has ended — please pick a time again.' }], '/api/appointments/book': [200, { ok: true, status: 'confirmed', appointmentId: 'n1', checkInToken: 'tn' }] }, { current: { key: sameKey, appointmentId: 'h1', k: 'tk' } });
  ok(x.calls.some((c) => c.u.includes('/api/appointments/book')) && x.step === 'confirmation', 'a hold that ran out is booked fresh, instead of the same error again and again');
  x = await run({ '/api/appointments/release-hold': [200, { ok: true }], '/api/appointments/book': [200, { ok: true, status: 'confirmed', appointmentId: 'n2', checkInToken: 'tn' }] }, { current: { key: sameKey, appointmentId: 'h1', k: 'tk' } }, { smsConsent: true });
  const rel = x.calls.findIndex((c) => c.u.includes('release-hold')), bk = x.calls.findIndex((c) => c.u.includes('/api/appointments/book'));
  ok(rel >= 0 && bk > rel && x.calls[rel].b.appointmentId === 'h1' && x.calls[rel].b.k === 'tk' && x.held.current === null, 'changed after the hold was made: the held time is let go first, then the new choice is booked');
  x = await run({ '/api/appointments/release-hold': [500, { ok: false }] }, { current: { key: sameKey, appointmentId: 'h1', k: 'tk' } }, { smsConsent: true });
  ok(!x.calls.some((c) => c.u.includes('/api/appointments/book')) && /couldn’t let go/.test(x.r.error) && x.held.current?.appointmentId === 'h1', 'a held time that couldn’t be let go just now is kept noted and said, instead of booking a second one');
  x = await run({ '/api/appointments/release-hold': [409, { ok: false, paid: true }], '/api/appointments/book': [200, { ok: true, status: 'confirmed', appointmentId: 'n3', checkInToken: 'tn' }] }, { current: { key: sameKey, appointmentId: 'h1', k: 'tk' } }, { smsConsent: true });
  ok(x.held.current === null && !x.calls.some((c) => c.u.includes('/api/appointments/book')) && x.step === 'confirmation' && gotOutcome?.status === 'confirmed' && gotOutcome?.earlier === true && /earlier booking was already paid/.test(gotOutcome?.notice || ''), 'a held booking that turned out to be paid is the booking they get, said plainly (never a second one, never the changed time shown as booked)');
  ok(sf.includes('{c.selectedTime && !outcome.earlier &&') && sf.includes("outcome.earlier ? '' : email ?") && book.includes("bookedHeld(h, true)"), 'the booked screen doesn’t show the changed time, or the changed email, when the earlier paid booking is the one they have');
  ok(src('src/app/api/stripe/deposit/route.ts').includes("return !st || ['cancelled', 'canceled', 'declined', 'expired', 'released'].includes(st)") && src('src/app/api/stripe/deposit/route.ts').includes('await apRef.update({ depositSessions:') && src('src/app/api/stripe/deposit/route.ts').includes('Please go back and choose your time again.'), 'only a booking that is gone counts as ended (any booking that stands is booked); a deleted booking is never brought back; the cap says what to do');
  x = await run({ '/api/appointments/release-hold': [409, { ok: false, code: 'not_releasable' }], '/api/appointments/book': [200, { ok: true, status: 'confirmed', appointmentId: 'n4', checkInToken: 'tn' }] }, { current: { key: sameKey, appointmentId: 'h1', k: 'tk' } }, { smsConsent: true });
  ok(x.held.current === null && x.calls.some((c) => c.u.includes('/api/appointments/book')), 'a hold that can no longer be let go from the sheet never traps the client in “try again”');
  x = await run({ '/api/stripe/deposit': [409, { error: 'No deposit is due for this booking.', code: 'booked' }] }, { current: { key: sameKey, appointmentId: 'h1', k: 'tk' } });
  ok(x.step === 'confirmation' && gotOutcome?.status === 'confirmed', 'no deposit due any more on a booking that stands: booked');
  x = await run({ '/api/stripe/deposit': [409, { error: 'This hold has ended. Please choose a time again.', code: 'ended' }], '/api/appointments/book': [200, { ok: true, status: 'confirmed', appointmentId: 'n5', checkInToken: 'tn' }] }, { current: { key: sameKey, appointmentId: 'h1', k: 'tk' } });
  ok(x.calls.some((c) => c.u.includes('/api/appointments/book')), 'a hold that ended (released, expired, declined) is booked fresh, never called booked');
  // The route that lets a client's own held time go.
  let rdb = makeDb(); const M: any = Module as any; const load0 = M._load;
  const sessions: Record<string, any> = {}; let stripeDown = false; let expireRace = false; process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  class FakeStripe { checkout = { sessions: {
    retrieve: async (id: string) => { if (stripeDown) throw new Error('down'); if (!sessions[id]) { if ((FakeStripe as any).missing) throw Object.assign(new Error('No such checkout session'), { code: 'resource_missing' }); throw new Error('unknown'); } return { ...sessions[id] }; },
    expire: async (id: string) => { if (expireRace) { sessions[id] = { status: 'complete', payment_status: 'paid' }; throw new Error('already complete'); } sessions[id] = { status: 'expired', payment_status: 'unpaid' }; return { ...sessions[id] }; } } }; }
  M._load = function (request: string, ...rest: any[]) {
    if (request === 'stripe') return FakeStripe;
    if (request === '@/lib/firebase-admin') return { getAdminDb: () => rdb };
    if (request === '@/lib/rate-limit') return { limitPublic: async () => null };
    if (request === '@/lib/audit') return { logAuditAdmin: async () => undefined };
    if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
    return load0.call(this, request, ...rest);
  };
  const { POST: release } = await import('../../src/app/api/appointments/release-hold/route');
  const rq = (body: any) => ({ json: async () => body, headers: { get: () => null } }) as any;
  const seed = async (x: any) => { rdb = makeDb(); await rdb.doc('tenants/t1/appointments/h1').set({ status: 'pending_payment', depositStatus: 'pending', checkInToken: 'tok123', source: 'booking-page', createdAt: new Date(Date.now() - 5 * 60000).toISOString(), clientName: 'Dana', ...x }); };
  await seed({}); let rr: any = await release(rq({ tenantId: 't1', appointmentId: 'h1', k: 'nope' }));
  ok(rr.status === 404 && (await rdb.doc('tenants/t1/appointments/h1').get()).data().status === 'pending_payment', 'only with the booking’s own link token');
  rr = await release(rq({ tenantId: 't1', appointmentId: 'h1', k: 'tok123' })); const after = (await rdb.doc('tenants/t1/appointments/h1').get()).data();
  ok(rr.status === 200 && after.status === 'cancelled' && after.cancellationReason === 'changed_before_paying' && (await rdb.doc('appointmentCheckIns/tok123').get()).data()?.status === 'cancelled', 'their own unpaid online hold is let go at once, link copy included');
  for (const [why, x] of [['paid', { depositStatus: 'paid' }], ['being paid on the reader', { depositReaderPi: { id: 'pi_1' } }], ['an accepted request', { paymentDueAt: 'x' }], ['an accepted request with no deadline', { decidedAt: new Date().toISOString(), originallyRequestedAt: 'x' }], ['made at the desk', { source: 'front_desk' }], ['confirmed', { status: 'confirmed' }], ['old', { createdAt: new Date(Date.now() - 5 * 3600000).toISOString() }]] as [string, any][]) {
    await seed(x); rr = await release(rq({ tenantId: 't1', appointmentId: 'h1', k: 'tok123' }));
    ok(rr.status === 409 && (await rdb.doc('tenants/t1/appointments/h1').get()).data().status !== 'cancelled', `never one that is ${why}`);
  }
  sessions.cs1 = { status: 'open', payment_status: 'unpaid' };
  await seed({ depositSessions: ['acct_1:cs1'] }); rr = await release(rq({ tenantId: 't1', appointmentId: 'h1', k: 'tok123' }));
  ok(rr.status === 200 && sessions.cs1.status === 'expired' && (await rdb.doc('tenants/t1/appointments/h1').get()).data().status === 'cancelled', 'the payment form is closed with Stripe first, then the time is let go');
  sessions.cs1 = { status: 'complete', payment_status: 'paid' };
  await seed({ depositSessions: ['acct_1:cs1'] }); rr = await release(rq({ tenantId: 't1', appointmentId: 'h1', k: 'tok123' }));
  ok(rr.status === 409 && rr.body.paid === true && (await rdb.doc('tenants/t1/appointments/h1').get()).data().status === 'pending_payment', 'paid with Stripe but not recorded yet: never let go, and the answer says it’s paid');
  sessions.cs1 = { status: 'open', payment_status: 'unpaid' }; expireRace = true;
  await seed({ depositSessions: ['acct_1:cs1'] }); rr = await release(rq({ tenantId: 't1', appointmentId: 'h1', k: 'tok123' })); expireRace = false;
  ok(rr.status === 409 && rr.body.paid === true && (await rdb.doc('tenants/t1/appointments/h1').get()).data().status === 'pending_payment', 'paid in the very moment it was being closed: kept, and said to be paid');
  // A payment form opened while the time was being let go (the client tapped pay again) is closed too.
  sessions.cs1 = { status: 'open', payment_status: 'unpaid' }; sessions.cs2 = { status: 'open', payment_status: 'unpaid' };
  await seed({ depositSessions: ['acct_1:cs1'] });
  let grew = false; const realGet = rdb.doc.bind(rdb);
  (rdb as any).runTransaction = ((orig: any) => async (fn: any) => { if (!grew) { grew = true; await realGet('tenants/t1/appointments/h1').set({ depositSessions: ['acct_1:cs1', 'acct_1:cs2'] }, { merge: true }); } return orig(fn); })((rdb as any).runTransaction.bind(rdb));
  rr = await release(rq({ tenantId: 't1', appointmentId: 'h1', k: 'tok123' }));
  ok(rr.status === 200 && sessions.cs1.status === 'expired' && sessions.cs2.status === 'expired', 'a payment form opened while the time was being let go is closed before it’s let go');
  // Every form noted is closed, however many; one Stripe doesn't know can't be paid, so it doesn't block.
  for (let i = 0; i < 14; i++) sessions[`m${i}`] = { status: 'open', payment_status: 'unpaid' };
  await seed({ depositSessions: Array.from({ length: 14 }, (_, i) => `acct_1:m${i}`) }); rr = await release(rq({ tenantId: 't1', appointmentId: 'h1', k: 'tok123' }));
  ok(rr.status === 200 && Array.from({ length: 14 }, (_, i) => sessions[`m${i}`].status).every((x) => x === 'expired'), 'every payment form noted on a booking is closed, however many, before its time is let go');
  await seed({ depositSessions: ['acct_1:gone'] });
  const missingStripe = (FakeStripe as any); missingStripe.missing = true;
  rr = await release(rq({ tenantId: 't1', appointmentId: 'h1', k: 'tok123' }));
  ok(rr.status === 200 && (await rdb.doc('tenants/t1/appointments/h1').get()).data().status === 'cancelled', 'a payment form Stripe no longer knows doesn’t keep the time from being let go');
  missingStripe.missing = false;
  sessions.cs1 = { status: 'open', payment_status: 'unpaid' }; stripeDown = true;
  await seed({ depositSessions: ['acct_1:cs1'] }); rr = await release(rq({ tenantId: 't1', appointmentId: 'h1', k: 'tok123' })); stripeDown = false;
  ok(rr.status === 503 && (await rdb.doc('tenants/t1/appointments/h1').get()).data().status === 'pending_payment', 'when Stripe can’t be asked, nothing is let go');
  M._load = load0;
  const dep = src('src/app/api/stripe/deposit/route.ts');
  ok(dep.includes('depositSessions: FieldValue.arrayUnion(`${stripeAccountId}:${session.id}`)') && dep.includes('const no = notPayable(now); if (no) { await closeIt();') && (dep.match(/notPayable\(/g) || []).length === 3 && dep.includes("code: 'booked'") && dep.includes("code: 'ended'") && dep.includes('.length : 0) >= 12)'), 'each payment form opened for a booking is noted on it (a dozen at most); one opened just as the booking was let go is closed at once; refusals say whether it’s booked or ended, the same way at both checks');
  ok(bs.includes('if (confirming || leavingRef.current) return;') && sf.includes('disabled: c.confirming || !!c.leaving || !!c.extraOffer') && bs.includes('retry: () => { if (leavingRef.current) return;'), 'nothing can be paid or booked while a held time is being let go');
  ok(bs.includes("if (!o && currentStep === 'review' && !paid && !payKindCard) void onReleaseHold?.();"), 'closing from the review always lets a held time go (nothing held: nothing happens)');
  ok(bs.includes('const mine = ++lookupSeq.current;') && bs.includes("(tenant as any)?.id]);"), 'only the latest client lookup counts, and a lookup that fails leaves no old warning standing');
  ok(bs.includes("resetPay(); setExtraOffer(null); setLeaving(true);") && bs.includes("if (said === 'paid') { setPaid(true); goToRef.current('confirmation'); return; }") && bs.includes("if (currentStepRef.current !== 'review') return;") && sf.includes('if (c.confirming || c.leaving) return true;'), 'stepping back from paying takes the payment form away first; paid in that moment, it’s booked; paid by gift card meanwhile, it stays booked; Back waits while the time is let go');
  ok(bs.includes("if (currentStep === 'confirmation') onSettled?.();") && book.includes('onSettled={() => { heldPay.current = null; }}'), 'closing the sheet from a deposit lets the held time go; once booked, nothing about a held booking is kept to be let go later');
  ok(bs.includes('const found = await resolveIdentity(') && bs.includes('const who = found ? found.matched : matchedClient;'), 'the client checks right after the lookup read its own answer');
  ok(bs.includes("clientPhone: phoneForField(prefillClient.clientPhone)") && src('src/hooks/useServerAvailability.ts').includes("if (out.key !== key) return { ...EMPTY, loading:"), 'a saved number is put in the phone field in the form it takes; times say they are loading from the very first moment after any change');

  // ── House rules ─────────────────────────────────────────────────────────
  const files = ['src/components/booking/BookingSheet.tsx', 'src/components/booking/StudioFlow.tsx', 'src/components/booking/flow-css.ts', 'src/lib/booking/engine-confirm.ts', 'src/app/api/appointments/release-hold/route.ts', 'src/app/api/appointments/book-group/route.ts', 'src/components/booking/PartyBuilder.tsx', 'src/components/gift/DepositGiftCard.tsx', 'src/components/booking/PhotoMarkup.tsx', 'src/lib/policy-copy.ts', 'src/components/public/kit.tsx', 'src/app/(booking)/book/[tenantId]/page.tsx'];
  ok(files.every((f) => !/\{\/\*/.test(src(f))), 'no JSX comments');
  const words = ['src/components/booking/BookingSheet.tsx', 'src/components/booking/StudioFlow.tsx', 'src/components/booking/flow-css.ts', 'src/lib/booking/engine-confirm.ts', 'src/app/api/appointments/release-hold/route.ts', 'src/components/booking/PartyBuilder.tsx', 'src/components/gift/DepositGiftCard.tsx'];
  ok(words.every((f) => !/\bcancell(ed|ing)\b|\bcolour|licence|\bcall us\b/i.test(src(f).replace(/'cancelled'/g, ''))) && !/cancelling|colour/i.test(freeChangeLine.toString()), 'US spelling, never “call us”');
  ok(!/Pick colour|exact colour|stamp a nail shape/.test(src('src/components/booking/PhotoMarkup.tsx')), 'the photo markup speaks US English, for any kind of business');
  ok(!/#b42318/i.test(src('src/components/gift/DepositGiftCard.tsx')) && !/#b42318|red-/.test(sf), 'red only for destroying something: a problem shows in amber');
  const tool = new RegExp(['cl', 'aude'].join('') + '|' + ['anth', 'ropic'].join(''), 'i');
  ok(files.every((f) => !tool.test(src(f))) && !tool.test(src('scripts/verify/booking-sheet.verify.ts').replace(/\['cl', 'aude'\]|\['anth', 'ropic'\]/g, '')), 'no tool names in the code');

  if (bad) { console.error(`\n${bad} check(s) failed`); process.exit(1); }
  console.log('\nAll checks passed');
})();
