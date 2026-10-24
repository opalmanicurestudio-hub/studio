// src/lib/station-booking.ts — A STATION BOOKED AND CHARGED IN ONE STEP, RECORDED ONCE (server).
// The team books a station for a renter with a card on file through api/stripe/book-station. The booking is named after
// the screen's attempt and holds its time before anything is charged: on the booking ('held', with the charge it's for:
// amount, card, customer and account) and on the station's list for each day it touches
// (tenants/{t}/stationSlots/{station}_{day}), together, so two people can't book the same time. The renter's card is
// then charged on the business's own Stripe account, under one key named after the booking, its amount and card, and
// the booking is recorded here, once: its line in the books and its rent-roll row are named after the booking, and
// written in the same step that confirms it. Stripe saying no cancels the booking and frees its time.
//
// When Stripe's answer is lost, the time stays held (the charge may have gone through), and the same attempt asked again
// finishes it. If nobody asks again, the time would stay held, with the money maybe taken and never recorded.
// settleLostStationBookings, run by the five-minute check, settles every booking left held more than 15 minutes (its
// charge unanswered, or waiting on approval from the renter's bank). It takes the booking over in one step (two runs at
// once settle it once), asks Stripe for the payment made for it (each one names the booking, and is for its amount), and
// then:
//   - it went through: recorded and confirmed as the booking itself would be;
//   - Stripe said no, or the charge never reached Stripe: canceled, and its time free again, as on a decline;
//   - still going through: left for the next run (the time stays held).
// A payment still waiting for the renter's approval is canceled at Stripe first, so it can't go through later. Either
// way the team is told once (the note is named after the booking), since the screen that booked it never heard back.
// Asked again afterwards, the same attempt is told it's done, or that it didn't go through: never charged twice.
import Stripe from 'stripe';
import { FieldValue } from 'firebase-admin/firestore';

type Note = { id: string; message: string; link: string };
type Result = 'recorded' | 'released' | 'waiting';

const OPEN_AFTER_MS = 15 * 60000;   // a booking still held this long has lost its answer
const TAKEN_MS = 5 * 60000;         // one run's hold on a booking it's settling
const DAY_S = 86400;
const safeKey = (v: any) => String(v || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
const iso = (n: number) => new Date(n).toISOString();
const ms = (v: any) => Date.parse(String(v || '')) || 0;
const stripeFor = () => new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' as any }) as any;
const noteDoc = (id: string, n: Note) => ({ id, type: 'booth_reservation', read: false, createdAt: new Date().toISOString(), link: n.link, message: n.message });
// When the booking's charge began, or (waiting on the renter's bank) when it went to wait.
const heldSince = (b: any) => ms(b?.chargeClaimAt) || ms(b?.updatedAt) || ms(b?.createdAt);

/** The station's list of what's booked on it for one day. */
export const stationSlotPath = (tenantId: string, boothId: string, day: string) => `tenants/${tenantId}/stationSlots/${safeKey(boothId)}_${day}`;

/** The days a booking touches, start day to end day, for the station's day lists. */
export function daysOf(startAt: string, endAt: string): string[] {
  const first = String(startAt).slice(0, 10), last = String(endAt).slice(0, 10);
  const out: string[] = []; let t = Date.parse(`${first}T00:00:00Z`);
  if (!Number.isFinite(t)) return out;
  for (let i = 0; i < 32; i++) { const d = new Date(t).toISOString().slice(0, 10); out.push(d); if (d >= last) break; t += 86_400_000; }
  return out;
}

export function resolveChargeId(intent: any): string | null {
  return typeof intent?.latest_charge === 'string' ? intent.latest_charge : intent?.latest_charge?.id || null;
}

/** The booking paid: its line in the books and its rent-roll row (named after the booking) and its confirmation, in one
 *  step, once. False when it was recorded already. `b` is the booking as held (the charge it's for); `fallback` fills
 *  what an older booking didn't keep. `extra` is written on the booking with it, and `note` beside it. */
export async function recordStationBooking(db: any, tenantId: string, bookingId: string, b: any, intent: any,
  o: { at?: string; fallback?: { renterName?: string; locationId?: any; renterId?: any; boothId?: any }; extra?: Record<string, any>; note?: Note } = {}): Promise<boolean> {
  const bookingRef = db.doc(`tenants/${tenantId}/bookings/${bookingId}`);
  const cents = Number(b.chargeCents) || 0;
  const chargeId = resolveChargeId(intent);
  const txnRef = db.doc(`tenants/${tenantId}/transactions/station_booking_${bookingId}`);
  const ledgerRef = db.doc(`tenants/${tenantId}/rentLedger/station_booking_${bookingId}`);
  const noteRef = o.note ? db.doc(`tenants/${tenantId}/notifications/${o.note.id}`) : null;
  const f = o.fallback || {};
  const bHours = (new Date(b.endAt).getTime() - new Date(b.startAt).getTime()) / 3_600_000;
  const at = o.at || new Date().toISOString();
  return db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(bookingRef)).data() || {};
    const line = await tx.get(txnRef);
    if (line.exists || cur.paymentStatus === 'paid') return false;
    tx.set(txnRef, {
      id: txnRef.id,
      date: at,
      description: String(b.chargeDescription || 'Day-use booking'),
      clientOrVendor: b.renterName || f.renterName || 'Renter',
      type: 'income',
      context: 'Business',
      category: 'Day-Use Booking Revenue',
      taxBucket: 'revenue',
      amount: cents / 100,
      paymentMethod: 'Card on file (Stripe)',
      stripePaymentIntentId: intent.id,
      stripeChargeId: chargeId,
      bookingId,
      hasReceipt: true,
      tenantId, locationId: b.locationId || f.locationId || null,
    });
    tx.set(ledgerRef, {
      id: ledgerRef.id,
      locationId: b.locationId || f.locationId || null,
      leaseId: null,
      bookingId,
      renterId: b.renterId || f.renterId || null,
      boothId: b.boothId || f.boothId || null,
      type: 'rent_charge',
      amountCents: cents,
      status: 'paid',
      dueDate: at,
      paidAt: at,
      description: `Day-use booking — ${b.rateType === 'daily' ? 'full day' : `${bHours}h`}`,
      method: 'card',
      createdAt: at,
      updatedAt: at,
    });
    tx.set(bookingRef, {
      status: 'confirmed',
      paymentStatus: 'paid',
      stripePaymentIntentId: intent.id,
      stripeChargeId: chargeId,
      transactionId: txnRef.id,
      ledgerEntryId: ledgerRef.id,
      holdExpiresAt: null,
      chargeClaimAt: null,
      updatedAt: at,
      ...(o.extra || {}),
    }, { merge: true });
    if (noteRef && o.note) tx.set(noteRef, noteDoc(noteRef.id, o.note));
    return true;
  });
}

/** Nothing moved: the booking ends and its time is free again on the station's day lists. Only while it's still held
 *  (and, with `still`, still as the caller left it). False when it wasn't. */
export async function releaseStationBooking(db: any, tenantId: string, bookingId: string, why: string, message: string,
  o: { at?: string; still?: (b: any) => boolean; extra?: Record<string, any>; note?: Note } = {}): Promise<boolean> {
  const bookingRef = db.doc(`tenants/${tenantId}/bookings/${bookingId}`);
  const noteRef = o.note ? db.doc(`tenants/${tenantId}/notifications/${o.note.id}`) : null;
  const at = o.at || new Date().toISOString();
  return db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(bookingRef)).data() || {};
    if (cur.status !== 'held' || (o.still && !o.still(cur))) return false;
    tx.set(bookingRef, { status: 'cancelled', cancelledAt: at, cancellationReason: why, cancellationMessage: message, chargeClaimAt: null, holdExpiresAt: null, updatedAt: at, ...(o.extra || {}) }, { merge: true });
    for (const d of daysOf(cur.startAt, cur.endAt)) tx.set(db.doc(stationSlotPath(tenantId, cur.boothId, d)), { holds: { [bookingId]: FieldValue.delete() } }, { merge: true });
    if (noteRef && o.note) tx.set(noteRef, noteDoc(noteRef.id, o.note));
    return true;
  });
}

// ── The five-minute check ────────────────────────────────────────────────────

/** Every payment on this customer since `since` (seconds), on the business's account. Null when Stripe can't be asked
 *  right now (or there are too many to look through), so nothing is decided on half an answer. */
async function paymentsSince(stripe: any, customer: string, since: number, account: string): Promise<any[] | null> {
  const found: any[] = [];
  try {
    for (let page = 0, after = ''; page < 10; page++) {
      const l: any = await stripe.paymentIntents.list({ customer, created: { gte: since }, limit: 100, ...(after ? { starting_after: after } : {}) }, { stripeAccount: account });
      const data: any[] = Array.isArray(l?.data) ? l.data : [];
      found.push(...data);
      if (!l?.has_more || !data.length) return found;
      after = String(data[data.length - 1]?.id || '');
    }
  } catch { /* asked again on the next run */ }
  return null;
}

/** What became of the payments made for a booking: one that went through counts first, then one still going through,
 *  then one waiting for approval. Otherwise Stripe said no to each, or there were none. */
function outcomeOf(payments: any[]): { state: 'paid' | 'pending' | 'open' | 'declined' | 'none'; pi: any; open: any[] } {
  const st = (p: any) => String(p?.status || '');
  const paid = payments.find((p) => st(p) === 'succeeded');
  if (paid) return { state: 'paid', pi: paid, open: [] };
  if (payments.some((p) => st(p) === 'processing')) return { state: 'pending', pi: null, open: [] };
  const open = payments.filter((p) => ['requires_action', 'requires_confirmation', 'requires_capture'].includes(st(p)));
  if (open.length) return { state: 'open', pi: open[0], open };
  const no = payments.find((p) => ['requires_payment_method', 'canceled'].includes(st(p)));
  return { state: no ? 'declined' : 'none', pi: no || null, open: [] };
}

/** Payments still waiting for the renter's approval are canceled, so none can go through after the time is freed.
 *  False when one wasn't (it may have moved on): the next run looks again. */
async function cancelOpen(stripe: any, open: any[], account: string): Promise<boolean> {
  try {
    for (const p of open) {
      const c: any = await stripe.paymentIntents.cancel(String(p.id), {}, { stripeAccount: account, idempotencyKey: `cancel_${p.id}` });
      if (String(c?.status || '') !== 'canceled') return false;
    }
    return true;
  } catch { return false; }
}

/** Take a held booking over in one step, so two runs of the check at once settle it once. */
async function takeOver(db: any, ref: any, isOpen: (b: any) => boolean, now: number): Promise<any | null> {
  return db.runTransaction(async (tx: any) => {
    const b: any = (await tx.get(ref)).data() || null;
    if (!b || !isOpen(b) || (b.settlingAt && now - ms(b.settlingAt) < TAKEN_MS)) return null;
    tx.set(ref, { settlingAt: iso(now) }, { merge: true });
    return b;
  }).catch(() => null);
}

// "on 2026-10-24, 09:00–11:00", from the booking's own times.
function whenOf(b: any): string {
  const [d1, t1] = String(b.startAt || '').split('T'); const [d2, t2] = String(b.endAt || '').split('T');
  const hm = (t: string) => String(t || '').slice(0, 5);
  return d1 === d2 ? `on ${d1}, ${hm(t1)}–${hm(t2)}` : `from ${d1} ${hm(t1)} to ${d2} ${hm(t2)}`;
}

async function settleOne(db: any, tenantId: string, tenant: any, id: string, ref: any, b: any, stripe: any, now: number): Promise<Result> {
  const acct = String(b.chargeAccount || tenant?.stripeAccountId || tenant?.stripeConnectAccountId || '');
  if (!acct) return 'waiting';
  const cents = Math.round(Number(b.chargeCents) || 0);
  let payments: any[] | null = null;
  if (b.stripePaymentIntentId) {
    // Waiting on the renter's bank: Stripe has told us which payment it is.
    try { const pi: any = await stripe.paymentIntents.retrieve(String(b.stripePaymentIntentId), {}, { stripeAccount: acct }); payments = pi ? [pi] : []; } catch { payments = null; }
  } else {
    const since = Math.floor(Math.min(...[b.chargeClaimAt, b.updatedAt, b.createdAt].map(ms).filter((x) => x > 0), now) / 1000) - DAY_S;
    const list = await paymentsSince(stripe, String(b.chargeCustomer), since, acct);
    payments = list && list.filter((p: any) => String(p?.metadata?.bookingId || '') === id && Math.round(Number(p?.amount) || 0) === cents);
  }
  if (!payments) return 'waiting';
  const found = outcomeOf(payments);
  if (found.state === 'pending') return 'waiting';

  let booth = 'the station';
  try { booth = String(((await db.doc(`tenants/${tenantId}/booths/${b.boothId}`).get()).data() || {}).name || booth); } catch { /* the default */ }
  const what = `The day-use booking for ${b.renterName || 'a renter'} at ${booth} ${whenOf(b)}`;
  const settled = { settlingAt: null, settledAt: iso(now), settledBy: 'check' };
  const noteId = `station_booking_${id}`;

  if (found.state === 'paid') {
    const at = Number(found.pi.created) > 0 ? iso(Number(found.pi.created) * 1000) : iso(now);
    const wrote = await recordStationBooking(db, tenantId, id, b, found.pi, { at, extra: settled, note: {
      id: noteId, link: '/booths', message: `${what} went through, though the screen that booked it never heard back. It’s paid and confirmed.`,
    } });
    if (!wrote) await ref.set({ settlingAt: null }, { merge: true }).catch(() => {});
    return 'recorded';
  }

  // Nothing went through: canceled and its time freed, as on a decline. Only if nobody asked again meanwhile (then that
  // request finishes it).
  if (found.state === 'open' && !(await cancelOpen(stripe, found.open, acct))) return 'waiting';
  const declined = found.state === 'declined' && found.pi?.status !== 'canceled';
  const [why, message, reason] =
    found.state === 'none' ? ['not_charged', 'This booking didn’t go through, so nothing was charged.', 'it never reached Stripe']
    : found.state === 'open' ? ['not_approved', 'This booking didn’t go through: the card needed the renter’s approval, which never came, so nothing was charged.', 'the card needed the renter’s approval, which never came']
    : declined ? ['card_declined', `Card charge failed: ${found.pi?.last_payment_error?.message || 'the card was declined.'}`, 'the card was declined']
    : ['stripe_canceled', 'This booking didn’t go through, so nothing was charged.', 'the payment was stopped before it went through'];
  const same = (x: any) => x.settlingAt === iso(now) && String(x.chargeClaimAt || '') === String(b.chargeClaimAt || '')
    && String(x.updatedAt || '') === String(b.updatedAt || '') && String(x.stripePaymentIntentId || '') === String(b.stripePaymentIntentId || '');
  const freed = await releaseStationBooking(db, tenantId, id, why, message, { at: iso(now), still: same, extra: settled, note: {
    id: noteId, link: '/booths', message: `${what} didn’t go through (${reason}), so nothing was charged and the time is free again. Book it again if it’s still wanted.`,
  } });
  return freed ? 'released' : 'waiting';
}

/** The five-minute check for stations booked and charged in one step (see the top of this file). */
export async function settleLostStationBookings(db: any, tenantId: string, tenant: any, o: { stripe?: any; now?: number } = {}): Promise<{ checked: number; recorded: number; released: number; waiting: number }> {
  const out = { checked: 0, recorded: 0, released: 0, waiting: 0 };
  const now = o.now ?? Date.now();
  // Only this route's bookings: named after their attempt, with the charge they're for.
  const lost = (b: any) => b?.status === 'held' && !!b.chargeCustomer && now - heldSince(b) >= OPEN_AFTER_MS;
  const snap = await db.collection(`tenants/${tenantId}/bookings`).where('status', '==', 'held').limit(100).get().catch(() => ({ docs: [] as any[] }));
  let stripe = o.stripe;
  for (const d of snap.docs) {
    if (!String(d.id).startsWith('sb_') || !lost(d.data() || {})) continue;
    const b = await takeOver(db, d.ref, lost, now);
    if (!b) continue;
    out.checked++;
    let r: Result = 'waiting';
    try { stripe = stripe || stripeFor(); r = await settleOne(db, tenantId, tenant, String(d.id), d.ref, b, stripe, now); }
    catch (e: any) { console.error('[station-booking]', tenantId, d.id, String(e?.message || e).slice(0, 160)); }
    if (r === 'waiting') await d.ref.set({ settlingAt: null }, { merge: true }).catch(() => {});
    out[r]++;
  }
  return out;
}
