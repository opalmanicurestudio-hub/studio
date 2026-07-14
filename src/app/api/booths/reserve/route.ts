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

async function findConflict(db: FirebaseFirestore.Firestore, tenantId: string, boothId: string, startDate: string, endDate: string, ignoreId?: string) {
  const snap = await db.collection(`tenants/${tenantId}/boothReservations`).where('boothId', '==', boothId).get();
  const now = Date.now();
  for (const d of snap.docs) {
    const r = d.data() as any;
    if (ignoreId && d.id === ignoreId) continue;
    const holds = r.status === 'confirmed' ||
      (r.status === 'pending_payment' && r.createdAt && now - new Date(r.createdAt).getTime() < PENDING_HOLD_MS);
    if (holds && overlaps(startDate, endDate, r.startDate, r.endDate)) return true;
  }
  return false;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tenantId, boothId, startDate, endDate, name, phone, email, returnUrl, consentAccepted } = body || {};
    if (!tenantId || !boothId || !startDate || !endDate || !name || (!phone && !email) || !returnUrl) {
      return NextResponse.json({ ok: false, error: 'Missing required fields.' }, { status: 400 });
    }
    const numDays = daysInclusive(startDate, endDate);
    if (numDays < 1 || numDays > 60) {
      return NextResponse.json({ ok: false, error: 'Invalid date range.' }, { status: 400 });
    }

    const db = getAdminDb();
    const boothSnap = await db.doc(`tenants/${tenantId}/booths/${boothId}`).get();
    if (!boothSnap.exists) return NextResponse.json({ ok: false, error: 'Space not found.' }, { status: 404 });
    const booth = boothSnap.data() as any;
    if (booth.status !== 'vacant') {
      return NextResponse.json({ ok: false, error: 'This space is no longer available.' }, { status: 409 });
    }

    // Rate: prefer an explicit daily rate; server-side pricing only —
    // the client never dictates the amount.
    const options: any[] = Array.isArray(booth.pricingOptions) && booth.pricingOptions.length > 0
      ? booth.pricingOptions
      : [{ frequency: booth.baseRentFrequency || 'monthly', amountCents: booth.baseRentCents || 0 }];
    const dayRate = options.find(o => o.frequency === 'daily' && o.amountCents > 0);
    if (!dayRate) {
      return NextResponse.json({ ok: false, error: 'This space does not offer daily booking.' }, { status: 400 });
    }
    const amountCents = dayRate.amountCents * numDays;

    if (await findConflict(db, tenantId, boothId, startDate, endDate)) {
      return NextResponse.json({ ok: false, error: 'Those dates were just taken — try different dates.' }, { status: 409 });
    }

    const resRef = db.collection(`tenants/${tenantId}/boothReservations`).doc();
    const nowIso = new Date().toISOString();
    await resRef.set({
      id: resRef.id, tenantId, boothId,
      boothName: booth.name || 'Space',
      locationId: booth.locationId || null,
      name: String(name).slice(0, 120), phone: String(phone || '').slice(0, 40), email: String(email || '').slice(0, 160),
      startDate, endDate, numDays, amountCents,
      status: 'pending_payment', createdAt: nowIso,
      consentAccepted: !!consentAccepted, consentAcceptedAt: consentAccepted ? nowIso : null,
    });

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
    const base = String(returnUrl).split('?')[0];
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: email || undefined,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: amountCents,
          product_data: {
            name: `${booth.name || 'Space'} — ${numDays} day${numDays === 1 ? '' : 's'}`,
            description: `${startDate} → ${endDate}`,
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
    const conflicted = await findConflict(db, tenantId, r.boothId, r.startDate, r.endDate, reservationId);
    const nowIso = new Date().toISOString();
    if (conflicted) {
      await resRef.set({ status: 'payment_received_conflict', confirmedAt: nowIso }, { merge: true });
      const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
      await nRef.set({ id: nRef.id, type: 'booth_reservation', read: false, createdAt: nowIso, link: '/booths',
        message: `⚠ PAID but dates conflict: ${r.name} paid for ${r.boothName} ${r.startDate} → ${r.endDate}. Refund or rebook needed.` });
      return NextResponse.json({ ok: false, confirmed: false, error: 'Payment received, but those dates were just taken. The studio will contact you to reschedule or refund.' });
    }

    await resRef.set({ status: 'confirmed', confirmedAt: nowIso, stripePaymentIntentId: session.payment_intent || null }, { merge: true });
    const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
    await nRef.set({ id: nRef.id, type: 'booth_reservation', read: false, createdAt: nowIso, link: '/booths',
      message: `💰 Day rental booked & paid: ${r.name} — ${r.boothName}, ${r.startDate} → ${r.endDate} ($${(r.amountCents / 100).toFixed(2)})` });
    return NextResponse.json({ ok: true, confirmed: true, boothName: r.boothName, startDate: r.startDate, endDate: r.endDate });
  } catch (err) {
    console.error('[booth-reserve] GET failed', err);
    return NextResponse.json({ ok: false, error: 'Could not confirm reservation.' }, { status: 500 });
  }
}
