// src/lib/table-booking-server.ts — TABLES BOOKED ONLINE, on the server (the guest's pages through api/table-book, the
// host stand through api/host/floor and lib/floor-server). Lib/table-booking has the rules.
// - Each booking is tenants/{t}/tableBookings/{id}. The seats a day's bookings take are kept together on
//   tableBookingDays/{day}, changed in one step with the booking, so two guests can't both take the last seats.
// - A big table waits for the guest's card for a few minutes: the card company's own form saves it (nothing is charged)
//   under a customer on the business's account. A card form left open past that lets the seats go.
// - The guest's link (a long random key on the booking) shows the booking, says they're running late, and cancels it.
// - On the day, each booking is on the host stand as a party still to come (one party per booking, made once), with
//   what the guest told us and whether a card holds it.
// - A no-show (past the time the table is held) or a cancel after the free time: a manager can charge the fee the guest
//   agreed to, once, from the host stand. Or let it go. Money never moves on its own.
import crypto from 'crypto';
import { accountOf, readerStripe } from '@/lib/reader-sale';
import { floorSettingsOf } from '@/lib/table-stage';
import { resolveHostingSettings } from '@/lib/floor-plans';
import { addDays, tenantTimeZone, todayIn, wallToUtc } from '@/lib/tenant-time';
import { bookingWords, cardNeeded, CARD_HOLD_MIN, cleanAsks, cleanNote, DAY, feeFor, fits, freeUntil, heldNow, money, slotsFor, tableBookingOf, timesFor,
  toMin, weekdayOf, type Held, type Slot } from '@/lib/table-booking';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
export const BOOK_TOKEN = /^[A-Za-z0-9_-]{20,40}$/;
const nowIso = () => new Date().toISOString();
/** Bookings still to come for one mobile number or email, at most. */
export const MAX_PER_GUEST = 3;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
export class BookStop extends Error { constructor(public msg: string, public status = 409, public code?: string) { super(msg); } }

const bookingRef = (db: any, T: string, id: string) => db.doc(`${T}/tableBookings/${id}`);
const dayRef = (db: any, T: string, day: string) => db.doc(`${T}/tableBookingDays/${day}`);
/** The party a booking is on the host stand as (one per booking, so it's never there twice). */
export const partyIdOf = (bookingId: string) => `tb_${bookingId}`.slice(0, 150);

const startOf = (tz: string) => (day: string, time: string) => { const m = toMin(time); return wallToUtc(day, Math.floor(m / 60), m % 60, tz).getTime(); };

// The seats online bookings can fill: the business's number, or the floor plan's seats.
const seatCache = new Map<string, { at: number; n: number }>();
async function seatsOf(db: any, T: string, tenant: any): Promise<number> {
  const s = tableBookingOf(tenant); if (s.seats > 0) return s.seats;
  const hit = seatCache.get(T); if (hit && Date.now() - hit.at < 60000) return hit.n;
  const plan: any = (await db.doc(`${T}/floorPlans/default`).get().catch(() => null))?.data?.() || null;
  const units: any[] = Array.isArray(plan?.units) ? plan.units : [];
  const n = units.reduce((a, u) => a + Math.max(0, Math.floor(Number(u?.seatCount) || (Array.isArray(u?.seats) ? u.seats.length : 0))), 0) || 40;
  if (seatCache.size > 1000) seatCache.clear();
  seatCache.set(T, { at: Date.now(), n }); return n;
}

/** The days a guest can pick (today on, as far ahead as the business takes bookings, on its days). */
export function bookableDays(tenant: any, now = Date.now()): string[] {
  const s = tableBookingOf(tenant); if (!s.on) return [];
  const today = todayIn(tenantTimeZone(tenant), new Date(now)); const out: string[] = [];
  for (let i = 0; i < s.aheadDays && out.length < 60; i++) { const d = addDays(today, i); if (s.days.includes(weekdayOf(d))) out.push(d); }
  return out;
}

const heldOf = (doc: any, now: number, but?: string): Held[] => Object.entries<any>(doc?.entries || {}).filter(([id, h]) => id !== but && h && heldNow(h, now)).map(([, h]) => ({ at: String(h.at), size: num(h.size), until: h.until || null }));

/** The times on a day, each open or full, for a party this size. */
export async function slotsOn(db: any, T: string, tenant: any, day: string, size: number, now = Date.now()): Promise<Slot[]> {
  const s = tableBookingOf(tenant); if (!s.on || !DAY.test(day) || !bookableDays(tenant, now).includes(day)) return [];
  const [doc, seats] = await Promise.all([dayRef(db, T, day).get().then((d: any) => d.data() || {}), seatsOf(db, T, tenant)]);
  return slotsFor({ day, size, s, fs: floorSettingsOf(tenant), seats, held: heldOf(doc, now), now, startOf: startOf(tenantTimeZone(tenant)) });
}

export type BookInput = { day: string; time: string; size: number; name: string; phone?: string; email?: string; asks?: string[]; note?: string; agree?: boolean };

/** A guest books: the seats taken for them in the same step (or "that time just filled up"), and for a big table, the
 *  card company's form to save their card (the seats held a few minutes while they do). */
export async function makeBooking(db: any, T: string, tenant: any, tenantId: string, input: BookInput, o: { stripe?: any; origin?: string } = {}) {
  const s = tableBookingOf(tenant); if (!s.on) throw new BookStop('Booking a table online isn’t open here right now.', 409, 'off');
  const tz = tenantTimeZone(tenant); const now = Date.now();
  const day = String(input.day || ''); const time = String(input.time || ''); const size = Math.round(Number(input.size) || 0);
  if (!DAY.test(day) || !bookableDays(tenant, now).includes(day)) throw new BookStop('Pick a day we take bookings.', 400);
  if (!timesFor(s).includes(time)) throw new BookStop('Pick one of the times.', 400);
  if (size < 1 || size > s.maxSize) throw new BookStop(`Online bookings are for up to ${s.maxSize}.`, 400);
  const arrives = startOf(tz)(day, time);
  if (arrives - s.cutoffMin * 60000 < now) throw new BookStop('That time is too soon to book now. Pick a later one.', 409, 'late');
  const name = String(input.name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const phone = String(input.phone || '').replace(/[^\d+()\-. ]/g, '').trim().slice(0, 24);
  const email = String(input.email || '').trim().toLowerCase().slice(0, 120);
  if (!name) throw new BookStop('Add your name.', 400);
  if (phone.replace(/\D/g, '').length < 7 && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BookStop('Add a mobile number or an email, so we can send your booking.', 400);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BookStop('That email doesn’t look right.', 400);
  // A few bookings to come at most for one mobile number or email (so one person can't fill the room, or have us text
  // strangers over and over).
  const phoneKey = phone.replace(/\D/g, '').slice(-10) || null;
  const today = todayIn(tz, new Date(now));
  for (const [field, v] of [['phoneKey', phoneKey], ['email', email || null]] as [string, string | null][]) {
    if (!v) continue;
    const mine = await db.collection(`${T}/tableBookings`).where(field, '==', v).limit(40).get();
    if (mine.docs.map((d: any) => d.data() || {}).filter((x: any) => ['booked', 'card'].includes(String(x.status)) && String(x.day) >= today).length >= MAX_PER_GUEST)
      throw new BookStop(`You have ${MAX_PER_GUEST} bookings coming up already. To book another, cancel one from its link first.`, 409, 'many');
  }
  const acct = accountOf(tenant); const stripe = o.stripe || readerStripe();
  // (A business that wants a card but can't take cards yet still gets the booking, without one.)
  const withCard = cardNeeded(size, s) && !!acct && !!stripe && !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (withCard && input.agree !== true) throw new BookStop(`Tick the box to agree to the ${money(feeFor(size, s))} charge for a late cancel or a no-show.`, 400, 'agree');
  // A big table someone else left at the card form, whose card did go through: theirs first.
  await settleLeftCards(db, T, tenant, tenantId, day, { stripe }).catch(() => null);

  const id = `tb${crypto.randomBytes(8).toString('hex')}`; const token = crypto.randomBytes(16).toString('base64url');
  const arrivesAt = new Date(arrives).toISOString(); const at = nowIso();
  const fs = floorSettingsOf(tenant); const seats = await seatsOf(db, T, tenant);
  const doc = { id, day, time, arrivesAt, size, name, phone: phone || null, phoneKey, email: email || null, asks: cleanAsks(input.asks), note: cleanNote(input.note),
    status: withCard ? 'card' : 'booked', token, source: 'online', createdAt: at, updatedAt: at,
    ...(withCard ? { fee: feeFor(size, s), freeUntil: freeUntil(arrivesAt, s), agreedAt: at, policy: { feePerGuest: s.feePerGuest, cancelHours: s.cancelHours } } : { fee: 0, freeUntil: null }) };
  await db.runTransaction(async (tx: any) => {
    const dRef = dayRef(db, T, day); const d: any = (await tx.get(dRef)).data() || {};
    if (!fits(heldOf(d, now), time, size, seats, fs)) throw new BookStop('That time just filled up. Pick another.', 409, 'full');
    // Seats taken by card forms left open are let go here as they're passed.
    const entries: Record<string, any> = {};
    for (const [k, h] of Object.entries<any>(d.entries || {})) if (h && heldNow(h, now)) entries[k] = h;
    entries[id] = { at: time, size, until: withCard ? new Date(now + CARD_HOLD_MIN * 60000).toISOString() : null };
    tx.set(dRef, { day, entries, updatedAt: at });
    tx.set(bookingRef(db, T, id), doc);
  });
  if (!withCard) {
    await tellBooked(db, T, tenant, tenantId, doc, o.origin || '').catch(() => null);
    return { id, token, status: 'booked' as const, words: bookingWords(arrivesAt, size, tz) };
  }
  try {
    const cu = await stripe.customers.create({ name, email: email || undefined, phone: phone || undefined, metadata: { tenantId, tableBookingId: id } }, { stripeAccount: acct, idempotencyKey: `tbook-cu-${id}` });
    const si = await stripe.setupIntents.create({ customer: cu.id, usage: 'off_session', payment_method_types: ['card'], metadata: { tenantId, source: 'table_booking', tableBookingId: id } },
      { stripeAccount: acct, idempotencyKey: `tbook-si-${id}` });
    await bookingRef(db, T, id).set({ customerId: cu.id, setupIntentId: si.id }, { merge: true });
    return { id, token, status: 'card' as const, words: bookingWords(arrivesAt, size, tz), fee: doc.fee, freeUntil: doc.freeUntil, freeWords: shortWhen(doc.freeUntil, tz), clientSecret: si.client_secret,
      publishableKey: String(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY), stripeAccount: acct };
  } catch {
    await releaseSeats(db, T, day, id).catch(() => null);
    await bookingRef(db, T, id).set({ status: 'failed', updatedAt: nowIso() }, { merge: true }).catch(() => null);
    throw new BookStop('Cards can’t be saved right now, so the table isn’t booked yet. Try again in a moment.', 503);
  }
}

async function releaseSeats(db: any, T: string, day: string, id: string) {
  const dRef = dayRef(db, T, day);
  await db.runTransaction(async (tx: any) => {
    const d: any = (await tx.get(dRef)).data(); if (!d?.entries?.[id]) return;
    const entries = { ...d.entries }; delete entries[id];
    tx.set(dRef, { ...d, entries, updatedAt: nowIso() });
  });
}

/** The guest's card form said the card is saved: asked of the card company, then the booking is confirmed (if its seats
 *  were let go meanwhile, they're taken again if they're still free). */
export async function cardSaved(db: any, T: string, tenant: any, tenantId: string, id: string, o: { stripe?: any; origin?: string } = {}) {
  const ref = bookingRef(db, T, id); const b: any = (await ref.get()).data();
  if (!b) throw new BookStop('That booking wasn’t found.', 404);
  if (b.status === 'booked') return { status: 'booked' as const };
  if (b.status !== 'card' || !b.setupIntentId) throw new BookStop('This booking can’t be finished now. Book again.', 409, 'gone');
  const acct = accountOf(tenant); const stripe = o.stripe || readerStripe();
  if (!acct || !stripe) throw new BookStop('Cards can’t be saved right now.', 503);
  let si: any; try { si = await stripe.setupIntents.retrieve(String(b.setupIntentId), {}, { stripeAccount: acct }); } catch { throw new BookStop('We couldn’t check your card just now. Try again in a moment.', 503); }
  if (String(si?.metadata?.tableBookingId || '') !== id || String(si?.metadata?.tenantId || '') !== tenantId) throw new BookStop('That card isn’t for this booking.', 409);
  if (si.status === 'processing') return { status: 'pending' as const };
  if (si.status !== 'succeeded') throw new BookStop('Your card wasn’t saved. Try again.', 409, 'not_saved');
  const pmId = typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id;
  let pm: any = null; try { pm = pmId ? await stripe.paymentMethods.retrieve(pmId, {}, { stripeAccount: acct }) : null; } catch { pm = null; }
  const card = { customerId: typeof si.customer === 'string' ? si.customer : si.customer?.id || b.customerId || null, paymentMethodId: pmId || null, brand: String(pm?.card?.brand || 'card'), last4: String(pm?.card?.last4 || '') };
  const fs = floorSettingsOf(tenant); const seats = await seatsOf(db, T, tenant); const now = Date.now();
  const done = await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(ref)).data() || {};
    if (cur.status === 'booked') return 'already';
    if (cur.status !== 'card') return 'gone';
    const dRef = dayRef(db, T, String(cur.day)); const d: any = (await tx.get(dRef)).data() || {};
    const mine = d.entries?.[id];
    if (!mine || !heldNow(mine, now)) { if (!fits(heldOf(d, now, id), String(cur.time), num(cur.size), seats, fs)) return 'full'; }
    tx.set(dRef, { day: cur.day, entries: { ...(d.entries || {}), [id]: { at: cur.time, size: num(cur.size), until: null } }, updatedAt: nowIso() });
    tx.set(ref, { status: 'booked', card, updatedAt: nowIso() }, { merge: true });
    return 'booked';
  });
  if (done === 'full') { await ref.set({ status: 'expired', card, updatedAt: nowIso() }, { merge: true }); throw new BookStop('That time filled up while your card was being saved. Nothing was charged. Pick another time.', 409, 'full'); }
  if (done === 'gone') throw new BookStop('This booking can’t be finished now. Book again.', 409, 'gone');
  if (done === 'booked') await tellBooked(db, T, tenant, tenantId, { ...b, card }, o.origin || '').catch(() => null);
  return { status: 'booked' as const };
}

/** Big tables whose card form was left open past its time: one whose card did go through is booked after all (if it
 *  still fits); the rest are let go. */
async function settleLeftCards(db: any, T: string, tenant: any, tenantId: string, day: string, o: { stripe?: any }) {
  const d: any = (await dayRef(db, T, day).get()).data(); const now = Date.now();
  const left = Object.entries<any>(d?.entries || {}).filter(([, h]) => h && h.until && !heldNow(h, now)).slice(0, 5);
  for (const [id] of left) {
    const b: any = (await bookingRef(db, T, id).get()).data();
    if (b?.status === 'card' && b.setupIntentId) { try { await cardSaved(db, T, tenant, tenantId, id, o); continue; } catch { /* not saved, or no room: let go */ } }
    // Let go in one step, and only if it's still waiting for its card and its time is still up (the guest's own page
    // may have just finished it).
    await db.runTransaction(async (tx: any) => {
      const bRef = bookingRef(db, T, id); const dRef = dayRef(db, T, day);
      const cur: any = (await tx.get(bRef)).data() || null; const dd: any = (await tx.get(dRef)).data() || {};
      const h = dd.entries?.[id];
      if (h && (!h.until || heldNow(h, Date.now()))) return;
      if (cur && cur.status !== 'card') { if (h && cur.status !== 'booked') { const entries = { ...dd.entries }; delete entries[id]; tx.set(dRef, { ...dd, entries, updatedAt: nowIso() }); } return; }
      if (h) { const entries = { ...dd.entries }; delete entries[id]; tx.set(dRef, { ...dd, entries, updatedAt: nowIso() }); }
      if (cur) tx.set(bRef, { status: 'expired', updatedAt: nowIso() }, { merge: true });
    }).catch(() => null);
  }
}

/** The guest's link to their booking. */
export function manageUrl(origin: string, tenantId: string, id: string, token: string) {
  return `${origin.replace(/\/+$/, '')}/table/${encodeURIComponent(tenantId)}/${id}?k=${token}`;
}

async function tellBooked(db: any, T: string, tenant: any, tenantId: string, b: any, origin: string) {
  const { linkOrigin } = await import('@/lib/app-origin');
  const tz = tenantTimeZone(tenant); const biz = String(tenant.name || tenant.businessName || 'We').slice(0, 60);
  const link = manageUrl(linkOrigin(tenant, origin), tenantId, b.id, b.token);
  const hold = resolveHostingSettings(tenant?.hostingSettings).holdGraceMinutes;
  const card = b.card?.last4 ? ` Your card ending ${b.card.last4} holds the table: cancel before ${shortWhen(b.freeUntil, tz)} and nothing is charged.` : '';
  const text = `${biz}: you’re booked, ${bookingWords(b.arrivesAt, num(b.size), tz)}. We hold the table ${hold} minutes.${card} Change or cancel: ${link}`;
  await send(db, tenantId, b, text, `You’re booked at ${biz}`, 'table_booking');
}

async function send(db: any, tenantId: string, b: any, text: string, subject: string, kind: string) {
  const meta = { kind, recipientType: 'client', recipientId: String(b.id), recipientName: String(b.name || '').slice(0, 80) || null } as any;
  if (b.phone) {
    const { sendTenantSms } = await import('@/lib/sms');
    await sendTenantSms(db, tenantId, String(b.phone), text, { email: b.email || null, subject }, meta);
    return;
  }
  if (b.email) {
    const { sendNotification } = await import('@/lib/notify');
    await sendNotification(db, { tenantId, channel: 'email', to: String(b.email), subject, text, kind, clientName: b.name || null, recipientType: 'client' } as any);
  }
}
const shortWhen = (iso: string | null | undefined, tz: string) => (iso ? new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz }).replace(/ (AM|PM)$/, (m) => m.toLowerCase()) : '');

/** The booking, by its link. */
export async function bookingByToken(db: any, T: string, id: string, token: string) {
  if (!/^tb[0-9a-f]{16}$/.test(id) || !BOOK_TOKEN.test(token)) return null;
  const b: any = (await bookingRef(db, T, id).get()).data();
  if (!b || typeof b.token !== 'string' || b.token.length !== token.length || !crypto.timingSafeEqual(Buffer.from(b.token), Buffer.from(token))) return null;
  return b;
}

/** What the guest's link shows. Never anyone else's booking, and nothing about the business but its name. */
export async function bookingView(db: any, T: string, tenant: any, b: any) {
  const tz = tenantTimeZone(tenant); const hold = resolveHostingSettings(tenant?.hostingSettings).holdGraceMinutes;
  const party: any = (await db.doc(`${T}/parties/${partyIdOf(b.id)}`).get().catch(() => null))?.data?.() || null;
  const here = party && ['seated', 'finished'].includes(String(party.status));
  const past = Date.parse(b.arrivesAt) + hold * 60000 < Date.now();
  const state = b.status === 'cancelled' ? 'cancelled' : b.status === 'no_show' ? 'missed' : here ? 'here' : b.status === 'booked' ? (past ? 'past' : 'booked') : 'unfinished';
  return { state, words: bookingWords(b.arrivesAt, num(b.size), tz), arrivesAt: b.arrivesAt, size: num(b.size), asks: Array.isArray(b.asks) ? b.asks : [], note: b.note || '',
    holdMin: hold, card: b.card?.last4 ? { brand: String(b.card.brand || 'card'), last4: String(b.card.last4) } : null, fee: num(b.fee),
    freeUntil: b.freeUntil || null, freeWords: b.freeUntil ? shortWhen(b.freeUntil, tz) : null, lateFee: !!b.card && !!b.freeUntil && Date.now() > Date.parse(b.freeUntil),
    lateBy: num(b.lateBy) || null, day: b.day, time: b.time };
}

/** Cancelled, by the guest (their link) or the host. After the free time, with a card, the host stand sees it as a late
 *  cancel the fee can be charged for. */
export async function cancelBooking(db: any, T: string, tenant: any, tenantId: string, id: string, by: string, o: { guestAsked?: boolean } = {}) {
  // Late only when the guest is the one cancelling (their link, or they asked the host); never when the business does.
  const guest = by === 'guest' || o.guestAsked === true;
  const ref = bookingRef(db, T, id); const pRef = db.doc(`${T}/parties/${partyIdOf(id)}`);
  const r = await db.runTransaction(async (tx: any) => {
    const b: any = (await tx.get(ref)).data(); if (!b) throw new BookStop('That booking wasn’t found.', 404);
    const p: any = (await tx.get(pRef)).data() || null;
    if (b.status === 'cancelled') return { already: true, b };
    if (p && ['seated', 'finished'].includes(String(p.status))) throw new BookStop('You’re here already, so this booking can’t be cancelled.', 409);
    if (!['booked', 'card'].includes(String(b.status))) throw new BookStop('This booking can’t be cancelled now.', 409);
    const dRef = dayRef(db, T, String(b.day)); const d: any = (await tx.get(dRef)).data() || null;
    const late = guest && !!b.card && !!b.freeUntil && Date.now() > Date.parse(b.freeUntil) && num(b.fee) > 0;
    if (d?.entries?.[id]) { const entries = { ...d.entries }; delete entries[id]; tx.set(dRef, { ...d, entries, updatedAt: nowIso() }); }
    tx.set(ref, { status: 'cancelled', cancelledAt: nowIso(), cancelledBy: by, lateCancel: late, lateOpen: late, updatedAt: nowIso() }, { merge: true });
    if (p && p.status === 'expected') tx.set(pRef, { status: 'cancelled', finishedAt: nowIso() }, { merge: true });
    return { already: false, b: { ...b, lateCancel: late } };
  });
  forgetBookings(T);
  if (!r.already && by === 'guest') {
    const tz = tenantTimeZone(tenant); const biz = String(tenant.name || tenant.businessName || 'We').slice(0, 60);
    await send(db, tenantId, r.b, `${biz}: your booking for ${bookingWords(r.b.arrivesAt, num(r.b.size), tz)} is cancelled.${r.b.lateCancel ? ` It was cancelled after the free time, so the ${money(num(r.b.fee))} you agreed to may be charged.` : ''}`, `Your booking at ${biz} is cancelled`, 'table_booking').catch(() => null);
  }
  return { late: !!r.b.lateCancel, already: r.already };
}

/** "We're running late": the host stand shows it, and holds the table that much longer. */
export async function runningLate(db: any, T: string, id: string, minutes: number) {
  const m = [5, 10, 15, 20, 30].includes(Math.round(minutes)) ? Math.round(minutes) : 15;
  const ref = bookingRef(db, T, id); const pRef = db.doc(`${T}/parties/${partyIdOf(id)}`);
  await db.runTransaction(async (tx: any) => {
    const b: any = (await tx.get(ref)).data(); if (!b || b.status !== 'booked') throw new BookStop('This booking can’t be changed now.', 409);
    const p: any = (await tx.get(pRef)).data() || null;
    tx.set(ref, { lateBy: m, lateAt: nowIso(), updatedAt: nowIso() }, { merge: true });
    if (p && p.status === 'expected') tx.set(pRef, { lateBy: m }, { merge: true });
  });
  return { lateBy: m };
}

// ── On the day: the host stand ─────────────────────────────────────────────────────────────────────────────────────
const lastSync = new Map<string, number>();
const lateCache = new Map<string, LateCancel[]>();
/** Something changed a business's bookings: the host stand's next look is fresh. */
export function forgetBookings(T: string) { for (const k of Array.from(lastSync.keys())) if (k.startsWith(`${T}|`)) { lastSync.delete(k); lateCache.delete(k); } }
// What each booking was last put on the floor as, so a booking that hasn't changed isn't looked at again.
const synced = new Map<string, string>();
export type LateCancel = { bookingId: string; name: string; size: number; time: string; day: string; fee: number; card: string };

/** Today's bookings on the host stand: each one booked becomes a party still to come (once); one cancelled comes off.
 *  Returns the late cancels the fee could be charged for. At most every half minute a business, unless `fresh`. */
export async function bookingsOnFloor(db: any, T: string, tenant: any, session: any, o: { fresh?: boolean; stripe?: any } = {}): Promise<LateCancel[]> {
  if (!session?.id || !DAY.test(String(session.businessDay || ''))) return [];
  const key = `${T}|${session.id}`; const last = lastSync.get(key) || 0;
  if (!o.fresh && Date.now() - last <= 30000) return lateCache.get(key) || [];
  if (lastSync.size > 2000) { lastSync.clear(); lateCache.clear(); }
  lastSync.set(key, Date.now());
  const snap = await db.collection(`${T}/tableBookings`).where('day', '==', String(session.businessDay)).limit(400).get();
  const list: any[] = snap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
  {
    const tenantId = T.split('/')[1];
    if (list.some((b) => b.status === 'card')) await settleLeftCards(db, T, tenant, tenantId, String(session.businessDay), { stripe: o.stripe }).catch(() => null);
    if (synced.size > 20000) synced.clear();
    for (const b of list) {
      if (!ID.test(String(b.id))) continue;
      const sig = `${session.id}|${b.status}|${num(b.lateBy)}`; const sk = `${T}|${b.id}`;
      if (!['booked', 'cancelled'].includes(String(b.status)) || synced.get(sk) === sig) continue;
      const pRef = db.doc(`${T}/parties/${partyIdOf(b.id)}`);
      await db.runTransaction(async (tx: any) => {
        const p: any = (await tx.get(pRef)).data() || null;
        const cur: any = (await tx.get(bookingRef(db, T, b.id))).data() || {};
        if (cur.status === 'booked' && !p) {
          tx.set(pRef, { id: pRef.id, sessionId: session.id, name: String(cur.name || 'Booking').slice(0, 80), size: Math.max(1, num(cur.size)), needs: [], source: 'booking', status: 'expected',
            arrivesAt: cur.arrivesAt, joinedAt: null, quotedMinutes: null, notifiedAt: null, seatedAt: null, finishedAt: null, turnMinutes: null, unitIds: [], guestIds: [`tbook:${b.id}`],
            ...(cur.phone ? { phone: String(cur.phone) } : {}), ...(cur.email ? { email: String(cur.email) } : {}), bookingId: b.id, asks: Array.isArray(cur.asks) ? cur.asks : [], note: cur.note || '', cardHeld: !!cur.card?.paymentMethodId,
            fee: num(cur.fee), lateBy: num(cur.lateBy) || null, createdAt: nowIso() });
        } else if (cur.status === 'cancelled' && p && p.status === 'expected') {
          tx.set(pRef, { status: 'cancelled', finishedAt: nowIso() }, { merge: true });
        } else if (cur.status === 'booked' && p && p.status === 'expected' && (num(p.lateBy) !== num(cur.lateBy) || p.sessionId !== session.id)) {
          // (A day's service opened again: the party moves to it.)
          tx.set(pRef, { lateBy: num(cur.lateBy) || null, sessionId: session.id }, { merge: true });
        }
      }).then(() => { synced.set(sk, sig); }).catch((e: any) => { console.warn('[table-booking] floor', b.id, e?.message || e); });
    }
  }
  // Late cancels to charge or let go: any from yesterday on, whatever day the booking was for (a late cancel today for
  // tomorrow is seen today). A no-show is only on the host stand on its own day.
  // (Only the ones still to decide: charged or let go, they're off it.)
  const lates = await db.collection(`${T}/tableBookings`).where('lateOpen', '==', true).limit(200).get().catch(() => ({ docs: [] as any[] }));
  const from = addDays(String(session.businessDay), -1);
  const out = lates.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((b: any) => b.status === 'cancelled' && String(b.day) >= from && b.card?.paymentMethodId && num(b.fee) > 0 && !['paid', 'waived'].includes(String(b.charge?.state || '')))
    .sort((a: any, b: any) => String(a.arrivesAt).localeCompare(String(b.arrivesAt)))
    .map((b: any) => ({ bookingId: b.id, name: String(b.name || 'Booking'), size: num(b.size), time: String(b.time || ''), day: String(b.day), fee: num(b.fee), card: String(b.card?.last4 || '') }));
  lateCache.set(key, out);
  return out;
}

const REFUSED = ['StripeCardError', 'StripeInvalidRequestError', 'StripePermissionError', 'StripeAuthenticationError'];

/** A manager charges the fee the guest agreed to: a no-show (past the time the table is held, never seated) or a cancel
 *  after the free time. Once, whoever taps: the same charge under one key, recorded once. */
export async function chargeBooking(db: any, T: string, tenant: any, tenantId: string, id: string, by: string, o: { stripe?: any } = {}) {
  const ref = bookingRef(db, T, id); const b: any = (await ref.get()).data();
  if (!b) throw new BookStop('That booking wasn’t found.', 404);
  if (b.charge?.state === 'paid') return { already: true, amount: num(b.charge.amount) };
  if (b.charge?.state === 'waived') throw new BookStop('This was let go, so it isn’t charged.', 409);
  if (!b.card?.paymentMethodId || !b.card?.customerId || !(num(b.fee) > 0)) throw new BookStop('There’s no card to charge for this booking.', 409);
  const p: any = (await db.doc(`${T}/parties/${partyIdOf(id)}`).get()).data() || null;
  const hold = resolveHostingSettings(tenant?.hostingSettings).holdGraceMinutes;
  const kind: 'no_show' | 'late_cancel' = b.status === 'cancelled' ? 'late_cancel' : 'no_show';
  if (kind === 'late_cancel' && !b.lateCancel) throw new BookStop('They cancelled in time, so there’s nothing to charge.', 409);
  if (kind === 'no_show') {
    if (b.status !== 'booked' && b.status !== 'no_show') throw new BookStop('This booking can’t be charged.', 409);
    if (p && ['seated', 'finished'].includes(String(p.status))) throw new BookStop('They came, so there’s nothing to charge.', 409);
    if (Date.parse(b.arrivesAt) + (hold + num(b.lateBy)) * 60000 > Date.now()) throw new BookStop('Their table is still being held. Charge only once that time has passed.', 409);
  }
  const acct = accountOf(tenant); const stripe = o.stripe || readerStripe();
  if (!acct || !stripe) throw new BookStop('Card payments aren’t set up here.', 409);
  const cents = Math.round(num(b.fee) * 100); const tz = tenantTimeZone(tenant); const biz = String(tenant.name || tenant.businessName || 'Booking').slice(0, 60);
  const words = bookingWords(b.arrivesAt, num(b.size), tz);
  const tried = !!b.charge;
  await ref.set({ charge: { state: 'charging', kind, amount: cents / 100, at: nowIso(), by } }, { merge: true });
  let pi: any = null; let declined = '';
  // Asked before (an answer may have been lost): a charge that went through for this booking is the one, never a second.
  if (tried) {
    try {
      const l: any = await stripe.paymentIntents.list({ customer: b.card.customerId, limit: 20 }, { stripeAccount: acct });
      pi = (Array.isArray(l?.data) ? l.data : []).find((x: any) => x?.metadata?.tableBookingId === id && x?.status === 'succeeded') || null;
    } catch { pi = null; }
  }
  if (!pi) try {
    pi = await stripe.paymentIntents.create({ amount: cents, currency: 'usd', customer: b.card.customerId, payment_method: b.card.paymentMethodId, off_session: true, confirm: true,
      description: `${biz}: ${kind === 'no_show' ? 'no-show' : 'late cancel'}, ${words}`.slice(0, 200), metadata: { tenantId, source: 'table_booking_fee', tableBookingId: id, kind } },
      { stripeAccount: acct, idempotencyKey: `tbook-fee-${id}-${cents}` });
  } catch (e: any) {
    if (!REFUSED.includes(String(e?.type || ''))) throw new BookStop('The card company didn’t answer, so it may or may not have gone through. Try again in a minute: it won’t charge twice.', 503);
    declined = String(e?.raw?.message || e?.message || 'The card was declined.').slice(0, 160);
  }
  if (pi && pi.status !== 'succeeded') { if (pi.status === 'processing') throw new BookStop('The charge is still going through. Look again in a minute.', 202); declined = 'The card was declined.'; }
  if (declined) {
    await ref.set({ charge: { state: 'declined', kind, amount: cents / 100, at: nowIso(), by, error: declined } }, { merge: true });
    throw new BookStop(`${declined} Nothing was charged.`, 402, 'declined');
  }
  const txRef = db.doc(`${T}/transactions/tbookfee_${id}`); const at = nowIso();
  const wrote = await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(ref)).data() || {}; const line = await tx.get(txRef);
    if (cur.charge?.state === 'paid') return false;
    if (!line.exists) tx.set(txRef, { id: txRef.id, type: 'income', context: 'Business', taxBucket: 'revenue', source: 'table_booking', amount: cents / 100,
      category: kind === 'no_show' ? 'No-show Fee' : 'Cancellation Fee', description: `${kind === 'no_show' ? 'No-show fee' : 'Late cancel fee'}: ${String(b.name || 'Booking')}, ${words}`,
      clientOrVendor: String(b.name || 'Guest'), date: at, paymentMethod: 'Card on file (Stripe)', hasReceipt: false, stripePaymentIntentId: pi.id, sourceId: id, tenantId, createdAt: at });
    tx.set(ref, { status: kind === 'no_show' ? 'no_show' : 'cancelled', charge: { state: 'paid', kind, amount: cents / 100, at, by, piId: pi.id }, lateOpen: false, updatedAt: at, ...(cur.status === 'booked' ? { noShowAt: at } : {}) }, { merge: true });
    return true;
  });
  forgetBookings(T);
  if (!wrote) return { already: true, amount: cents / 100 };
  if (kind === 'no_show') await db.doc(`${T}/parties/${partyIdOf(id)}`).set({ status: 'no_show', finishedAt: at }, { merge: true }).catch(() => null);
  await send(db, tenantId, b, `${biz}: we charged ${money(cents / 100)} to your card ending ${b.card.last4 || ''} for ${kind === 'no_show' ? 'not coming to' : 'cancelling late'} your booking, ${words}, as agreed when you booked.`, `A charge from ${biz}`, 'table_booking_fee').catch(() => null);
  return { already: false, amount: cents / 100 };
}

/** Not charged after all: a no-show marked as one (nothing charged), or a late cancel let go. */
export async function letGo(db: any, T: string, tenant: any, id: string, by: string) {
  const ref = bookingRef(db, T, id); const pRef = db.doc(`${T}/parties/${partyIdOf(id)}`);
  const hold = resolveHostingSettings(tenant?.hostingSettings).holdGraceMinutes;
  await db.runTransaction(async (tx: any) => {
    const b: any = (await tx.get(ref)).data(); if (!b) throw new BookStop('That booking wasn’t found.', 404);
    if (b.charge?.state === 'paid') return;
    if (b.status === 'booked' && Date.parse(b.arrivesAt) + (hold + num(b.lateBy)) * 60000 > Date.now()) throw new BookStop('Their table is still being held.', 409);
    const p: any = (await tx.get(pRef)).data() || null;
    if (b.status === 'booked' && p && ['seated', 'finished'].includes(String(p.status))) throw new BookStop('They came.', 409);
    tx.set(ref, { ...(b.status === 'booked' ? { status: 'no_show', noShowAt: nowIso() } : {}), charge: { state: 'waived', at: nowIso(), by }, lateOpen: false, updatedAt: nowIso() }, { merge: true });
    if (b.status === 'booked' && p && p.status === 'expected') tx.set(pRef, { status: 'no_show', finishedAt: nowIso() }, { merge: true });
  });
  forgetBookings(T);
  return { ok: true };
}
