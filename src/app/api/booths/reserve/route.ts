/**
 * /api/booths/reserve — v1 (SPRINT 3: pay-and-book for day rentals)
 *
 * POST — creates a conflict-checked reservation and a Stripe Checkout
 *        session. The visitor pays on Stripe's hosted page and returns.
 * GET  — confirms payment (idempotent): verifies the Checkout session is
 *        paid, flips the reservation to 'confirmed', notifies the owner.
 *
 * Design decisions:
 *  - Admin SDK (getAdminDb) — reservations carry PII, so they are NEVER
 *    publicly readable; all checks happen server-side. No rules changes.
 *  - Conflict engine: a booth-day can be sold once. Confirmed
 *    reservations always block; pending ones block for 30 minutes (a
 *    checkout in progress holds the dates, then expires — no deadlocks
 *    from abandoned carts).
 *  - The Stripe race window (two checkouts completing for the same dates)
 *    is closed at confirm time: if the dates got taken while paying, the
 *    reservation is NOT confirmed and the response tells the client to
 *    contact the studio for a refund — flagged in the owner notification.
 *    Rare by construction (30-min holds), handled honestly when it happens.
 *
 * ENV: STRIPE_SECRET_KEY (already set — charge-card uses it).
 */

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getAdminDb } from '@/lib/firebase-admin';

const LEASE_FREQS = ['monthly', 'weekly', 'biweekly'];
const DAY_MS = 24 * 60 * 60 * 1000;
const PENDING_HOLD_MS = 30 * 60 * 1000;

function daysInclusive(start: string, end: string): number {
  const s = new Date(start + 'T00:00:00Z').getTime();
  const e = new Date(end + 'T00:00:00Z').getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return 0;
  return Math.round((e - s) / DAY_MS) + 1;
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

// v67 — TIME-AWARE conflicts. Two reservations conflict when their date
// ranges overlap AND their times overlap. A daily booking (no times)
// occupies the whole day, so it conflicts with everything that day.
// Hourly bookings only conflict when their hour windows intersect.
function timesConflict(a: any, b: any): boolean {
  const aHourly = a.bookingType === 'hourly' && a.startTime && a.endTime;
  const bHourly = b.bookingType === 'hourly' && b.startTime && b.endTime;
  if (!aHourly || !bHourly) return true;           // any daily involved → whole-day block
  return a.startTime < b.endTime && b.startTime < a.endTime;
}

async function findConflict(db: FirebaseFirestore.Firestore, tenantId: string, boothId: string, proposed: { startDate: string; endDate: string; bookingType?: string; startTime?: string; endTime?: string }, ignoreId?: string) {
  const snap = await db.collection(`tenants/${tenantId}/boothReservations`).where('boothId', '==', boothId).get();
  const now = Date.now();
  for (const d of snap.docs) {
    const r = d.data() as any;
    if (ignoreId && d.id === ignoreId) continue;
    const holds = r.status === 'confirmed' ||
      (r.status === 'pending_payment' && r.createdAt && now - new Date(r.createdAt).getTime() < PENDING_HOLD_MS);
    if (holds && overlaps(proposed.startDate, proposed.endDate, r.startDate, r.endDate) && timesConflict(proposed, r)) return true;
  }
  return false;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tenantId, boothId, startDate, endDate, name, phone, email, returnUrl, consentAccepted, bookingType, startTime, endTime } = body || {};
    if (!tenantId || !boothId || !startDate || !endDate || !name || (!phone && !email) || !returnUrl) {
      return NextResponse.json({ ok: false, error: 'Missing required fields.' }, { status: 400 });
    }
    const isHourly = bookingType === 'hourly';
    const numDays = daysInclusive(startDate, endDate);
    if (isHourly) {
      if (startDate !== endDate) return NextResponse.json({ ok: false, error: 'Hourly bookings are for a single day.' }, { status: 400 });
      if (!/^\d{2}:\d{2}$/.test(startTime || '') || !/^\d{2}:\d{2}$/.test(endTime || '') || startTime >= endTime) {
        return NextResponse.json({ ok: false, error: 'Invalid time range.' }, { status: 400 });
      }
    } else if (numDays < 1 || numDays > 60) {
      return NextResponse.json({ ok: false, error: 'Invalid date range.' }, { status: 400 });
    }

    const db = getAdminDb();
    const boothSnap = await db.doc(`tenants/${tenantId}/booths/${boothId}`).get();
    if (!boothSnap.exists) return NextResponse.json({ ok: false, error: 'Space not found.' }, { status: 404 });
    const booth = boothSnap.data() as any;
    if (booth.status !== 'vacant') {
      return NextResponse.json({ ok: false, error: 'This space is no longer available.' }, { status: 409 });
    }

    // ── AVAILABILITY ENGINE (v66): the owner's declared schedule is law.
    // Every day in the requested range must be an offerable weekday and
    // not a blackout date. Client-side validation mirrors this, but the
    // server is the enforcement point — never trust the picker.
    const schedDays: number[] | undefined = Array.isArray(booth.dayRentalDays) ? booth.dayRentalDays : undefined;
    const blackouts: string[] = Array.isArray(booth.blackoutDates) ? booth.blackoutDates : [];
    if (schedDays && schedDays.length === 0) {
      return NextResponse.json({ ok: false, error: 'This space does not offer day rentals.' }, { status: 400 });
    }
    for (let t = new Date(startDate + 'T00:00:00Z').getTime(), e = new Date(endDate + 'T00:00:00Z').getTime(); t <= e; t += DAY_MS) {
      const iso = new Date(t).toISOString().slice(0, 10);
      const dow = new Date(t).getUTCDay();
      if (schedDays && !schedDays.includes(dow)) {
        return NextResponse.json({ ok: false, error: `This space isn't available on ${iso} — check the available days and pick a different range.` }, { status: 400 });
      }
      if (blackouts.includes(iso)) {
        return NextResponse.json({ ok: false, error: `${iso} is unavailable — pick a different range.` }, { status: 400 });
      }
    }
    if (isHourly) {
      const openT = booth.openTime || '00:00';
      const closeT = booth.closeTime || '23:59';
      if (startTime < openT || endTime > closeT) {
        return NextResponse.json({ ok: false, error: `Hourly bookings are available ${openT} – ${closeT}.` }, { status: 400 });
      }
    }

    // Rate: prefer an explicit daily rate; server-side pricing only —
    // the client never dictates the amount.
    const options: any[] = Array.isArray(booth.pricingOptions) && booth.pricingOptions.length > 0
      ? booth.pricingOptions
      : [{ frequency: booth.baseRentFrequency || 'monthly', amountCents: booth.baseRentCents || 0 }];
    let amountCents: number;
    let unitsLabel: string;
    if (isHourly) {
      const hourRate = options.find(o => o.frequency === 'hourly' && o.amountCents > 0);
      if (!hourRate) return NextResponse.json({ ok: false, error: 'This space does not offer hourly booking.' }, { status: 400 });
      const numHours = Math.round(((new Date(`2000-01-01T${endTime}:00Z`).getTime() - new Date(`2000-01-01T${startTime}:00Z`).getTime()) / 3600000) * 2) / 2;
      if (numHours < 1 || numHours > 14) return NextResponse.json({ ok: false, error: 'Hourly bookings are 1–14 hours.' }, { status: 400 });
      amountCents = Math.round(hourRate.amountCents * numHours);
      unitsLabel = `${numHours} hour${numHours === 1 ? '' : 's'} (${startTime}–${endTime})`;
    } else {
      const dayRate = options.find(o => o.frequency === 'daily' && o.amountCents > 0);
      if (!dayRate) {
        return NextResponse.json({ ok: false, error: 'This space does not offer daily booking.' }, { status: 400 });
      }
      amountCents = dayRate.amountCents * numDays;
      unitsLabel = `${numDays} day${numDays === 1 ? '' : 's'}`;
    }

    if (await findConflict(db, tenantId, boothId, { startDate, endDate, bookingType: isHourly ? 'hourly' : 'daily', startTime, endTime })) {
      return NextResponse.json({ ok: false, error: 'Those dates were just taken — try different dates.' }, { status: 409 });
    }

    // ── v69 CREDITS: unused-time credits from past stays auto-apply.
    // Matched by phone or email. Credits are 'reserved' at checkout and
    // 'consumed' on payment confirmation; stale reservations (>1h old,
    // payment never completed) are released back to available here.
    let creditAppliedCents = 0;
    const appliedCreditIds: string[] = [];
    try {
      const contactKeys = [phone, email].map(v => (v || '').trim()).filter(Boolean);
      if (contactKeys.length) {
        const credSnap = await db.collection(`tenants/${tenantId}/boothCredits`).where('contactKey', 'in', contactKeys.slice(0, 2)).get();
        const staleCutoff = Date.now() - 60 * 60 * 1000;
        for (const cd of credSnap.docs) {
          const cr = cd.data() as any;
          if (cr.status === 'reserved' && cr.reservedAt && new Date(cr.reservedAt).getTime() < staleCutoff) {
            await cd.ref.set({ status: 'available', reservedAt: null, reservedForReservationId: null }, { merge: true });
            cr.status = 'available';
          }
          if (cr.status !== 'available') continue;
          if (creditAppliedCents >= amountCents - 100) break;   // always charge ≥ $1 (Stripe minimum ~$0.50; $1 keeps it clean)
          const usable = Math.min(cr.amountCents, amountCents - 100 - creditAppliedCents);
          if (usable <= 0) break;
          creditAppliedCents += usable;
          appliedCreditIds.push(cd.id);
        }
      }
    } catch { /* credits are a bonus — never block a booking over them */ }
    const chargeCents = amountCents - creditAppliedCents;

    const resRef = db.collection(`tenants/${tenantId}/boothReservations`).doc();
    const nowIso = new Date().toISOString();
    await resRef.set({
      id: resRef.id, tenantId, boothId,
      boothName: booth.name || 'Space',
      locationId: booth.locationId || null,
      name: String(name).slice(0, 120), phone: String(phone || '').slice(0, 40), email: String(email || '').slice(0, 160),
      startDate, endDate, numDays, amountCents: chargeCents,
      originalAmountCents: amountCents,
      creditAppliedCents,
      appliedCreditIds,
      bookingType: isHourly ? 'hourly' : 'daily',
      startTime: isHourly ? startTime : null,
      endTime: isHourly ? endTime : null,
      status: 'pending_payment', createdAt: nowIso,
      consentAccepted: !!consentAccepted, consentAcceptedAt: consentAccepted ? nowIso : null,
    });

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
    const base = String(returnUrl).split('?')[0];
    for (const cid of appliedCreditIds) {
      await db.doc(`tenants/${tenantId}/boothCredits/${cid}`).set(
        { status: 'reserved', reservedAt: nowIso, reservedForReservationId: resRef.id }, { merge: true });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: email || undefined,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: chargeCents,
          product_data: {
            name: `${booth.name || 'Space'} — ${unitsLabel}`,
            description: (isHourly ? `${startDate} · ${startTime}–${endTime}` : `${startDate} → ${endDate}`)
              + (creditAppliedCents > 0 ? ` · $${(creditAppliedCents / 100).toFixed(2)} credit applied` : ''),
          },
        },
      }],
      success_url: `${base}?cfReservationId=${resRef.id}&cfSession={CHECKOUT_SESSION_ID}`,
      cancel_url: base,
      metadata: { tenantId, reservationId: resRef.id },
    });
    await resRef.set({ stripeSessionId: session.id }, { merge: true });
    return NextResponse.json({ ok: true, url: session.url });
  } catch (err) {
    console.error('[booth-reserve] POST failed', err);
    return NextResponse.json({ ok: false, error: 'Could not start checkout.' }, { status: 500 });
  }
}


// Canonical Transaction shape (verified against the Ledger page):
// amount in DOLLARS, required type 'income'.
async function writeLedgerTxn(db: FirebaseFirestore.Firestore, tenantId: string, reservationId: string, r: any, paymentIntentId: string | null) {
  const txnRef = db.collection(`tenants/${tenantId}/transactions`).doc();
  const nowIso = new Date().toISOString();
  await txnRef.set({
    id:                    txnRef.id,
    type:                  'income',
    context:               'Business',
    taxBucket:             'revenue',
    amount:                (r.amountCents || 0) / 100,
    category:              'Booth Rent',
    description:           r.bookingType === 'hourly'
      ? `Hourly rental — ${r.boothName || 'Space'} — ${r.name} (${r.startDate} ${r.startTime}–${r.endTime})`
      : `Day rental — ${r.boothName || 'Space'} — ${r.name} (${r.startDate} → ${r.endDate})`,
    clientOrVendor:        r.name || 'Day renter',
    date:                  nowIso,
    paymentMethod:         'Card (Stripe)',
    hasReceipt:            false,
    checkoutSessionId:     r.stripeSessionId || null,
    stripePaymentIntentId: paymentIntentId,
    stripeChargeId:        null,
    sourceId:              reservationId,
    tenantId,
    createdAt:             nowIso,
  });
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get('tenantId');
    const reservationId = searchParams.get('reservationId');
    const sessionId = searchParams.get('sessionId');
    if (!tenantId || !reservationId || !sessionId) {
      return NextResponse.json({ ok: false, error: 'Missing parameters.' }, { status: 400 });
    }
    const db = getAdminDb();
    const resRef = db.doc(`tenants/${tenantId}/boothReservations/${reservationId}`);
    const resSnap = await resRef.get();
    if (!resSnap.exists) return NextResponse.json({ ok: false, error: 'Reservation not found.' }, { status: 404 });
    const r = resSnap.data() as any;
    if (r.status === 'confirmed') {
      // v59 — self-heal: reservations confirmed before ledger reporting
      // existed (or whose txn write failed) get their entry on the next
      // confirmation call instead of never.
      const existing = await db.collection(`tenants/${tenantId}/transactions`).where('sourceId', '==', reservationId).limit(1).get();
      if (existing.empty) await writeLedgerTxn(db, tenantId, reservationId, r, r.stripePaymentIntentId || null);
      return NextResponse.json({ ok: true, confirmed: true, boothName: r.boothName, startDate: r.startDate, endDate: r.endDate });
    }
    if (r.stripeSessionId !== sessionId) {
      return NextResponse.json({ ok: false, error: 'Session mismatch.' }, { status: 400 });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== 'paid') {
      return NextResponse.json({ ok: false, confirmed: false, error: 'Payment not completed.' });
    }

    // Close the race window: dates may have been confirmed by another
    // checkout while this one was on Stripe.
    const conflicted = await findConflict(db, tenantId, r.boothId, { startDate: r.startDate, endDate: r.endDate, bookingType: r.bookingType, startTime: r.startTime, endTime: r.endTime }, reservationId);
    const nowIso = new Date().toISOString();
    if (conflicted) {
      await resRef.set({ status: 'payment_received_conflict', confirmedAt: nowIso }, { merge: true });
      const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
      await nRef.set({ id: nRef.id, type: 'booth_reservation', read: false, createdAt: nowIso, link: '/booths',
        message: `⚠ PAID but dates conflict: ${r.name} paid for ${r.boothName} ${r.startDate} → ${r.endDate}. Refund or rebook needed.` });
      return NextResponse.json({ ok: false, confirmed: false, error: 'Payment received, but those dates were just taken. The studio will contact you to reschedule or refund.' });
    }

    await resRef.set({ status: 'confirmed', confirmedAt: nowIso, stripePaymentIntentId: session.payment_intent || null }, { merge: true });
    for (const cid of (r.appliedCreditIds || [])) {
      await db.doc(`tenants/${tenantId}/boothCredits/${cid}`).set(
        { status: 'consumed', consumedAt: nowIso, consumedByReservationId: reservationId }, { merge: true });
    }

    // v54 — REPORT TO LEDGER. Same collection and shape as the service's
    // buildLedgerEntry (tenants/{tid}/transactions), so day-rental income
    // sits beside booth rent in every financial view.
    await writeLedgerTxn(db, tenantId, reservationId, r, (session.payment_intent as string) || null);
    const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
    await nRef.set({ id: nRef.id, type: 'booth_reservation', read: false, createdAt: nowIso, link: '/booths',
      message: `💰 Day rental booked & paid: ${r.name} — ${r.boothName}, ${r.startDate} → ${r.endDate} ($${(r.amountCents / 100).toFixed(2)})` });
    return NextResponse.json({ ok: true, confirmed: true, boothName: r.boothName, startDate: r.startDate, endDate: r.endDate });
  } catch (err) {
    console.error('[booth-reserve] GET failed', err);
    return NextResponse.json({ ok: false, error: 'Could not confirm reservation.' }, { status: 500 });
  }
}
