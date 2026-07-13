import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

// ─── /api/stripe/book-station/route.ts ─────────────────────────────────────
// Path A of the hourly/daily day-use feature: an EXISTING renter with a
// card already on file (Renter.stripeCustomerId / defaultPaymentMethodId),
// booked by staff in-app. Modeled directly on /api/stripe/charge-card's
// `mode: 'pos'` / `mode: 'auto'` split — same on-session-vs-off-session
// reasoning applies here unchanged (renter present at a desk vs. not).
//
// Unlike charge-card, this route also OWNS the booking record: it holds
// the slot, charges the card, and confirms the booking, all in one call.
// That's deliberate — for a 2-hour walk-in booking, "reserve then pay in a
// separate step" is more workflow than the moment calls for; the slot is
// held for the length of this request only (a few hundred ms), not left
// dangling the way a public checkout-session hold has to be.
//
// UTILIZATION NOTE: the response includes the booth's fresh occupancy
// numbers post-booking. Nothing else in this route computes them — do not
// let a UI reach for the raw bookings list to recompute this client-side;
// it'll drift the moment two staff members book concurrently.
//
// LEDGER: writes to BOTH tenants/{t}/transactions (required — this is what
// the connect-webhook's charge.succeeded/refunded/dispute handlers match
// against for fee reconciliation; skip this and the booking's Stripe fees
// silently never attach) and tenants/{t}/rentLedger (so the booking shows
// up in the Rent Roll dashboard next to lease income; status 'paid' since
// it's collected upfront, so it never contributes to outstanding balance).
// ─────────────────────────────────────────────────────────────────────────

function getAdmin() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin';
  let app = getApps().find((a: any) => a.name === APP_NAME);
  if (!app) {
    app = initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    }, APP_NAME);
  }
  return { db: getFirestore(app) };
}

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });
}

function resolveChargeId(intent: Stripe.PaymentIntent): string | null {
  return typeof intent.latest_charge === 'string' ? intent.latest_charge : (intent.latest_charge as any)?.id || null;
}

// True if two [start,end) ranges overlap with an optional buffer around b.
function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string, bufferMinutes = 0) {
  const bufMs = bufferMinutes * 60_000;
  return new Date(aStart).getTime() < new Date(bEnd).getTime() + bufMs
    && new Date(bStart).getTime() - bufMs < new Date(aEnd).getTime();
}

export async function POST(req: NextRequest) {
  let parsed: any = {};
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const {
    tenantId,
    locationId,
    boothId,
    renterId,
    startAt,
    endAt,
    rateType = 'hourly',       // 'hourly' | 'daily'
    mode = 'pos',                // 'pos' (renter present) | 'auto' (off-session)
  } = parsed;

  if (!tenantId || !locationId || !boothId || !renterId || !startAt || !endAt) {
    return NextResponse.json(
      { error: 'Missing tenantId, locationId, boothId, renterId, startAt, or endAt' },
      { status: 400 }
    );
  }
  if (new Date(startAt).getTime() >= new Date(endAt).getTime()) {
    return NextResponse.json({ error: 'endAt must be after startAt' }, { status: 400 });
  }

  const { db } = getAdmin();
  const nowISO = new Date().toISOString();

  try {
    // ── Load booth, renter, tenant in parallel ───────────────────────────
    const [boothSnap, renterSnap, tenantSnap] = await Promise.all([
      db.doc(`tenants/${tenantId}/booths/${boothId}`).get(),
      db.doc(`tenants/${tenantId}/renters/${renterId}`).get(),
      db.doc(`tenants/${tenantId}`).get(),
    ]);

    if (!boothSnap.exists) return NextResponse.json({ ok: false, reason: 'Booth not found' }, { status: 404 });
    if (!renterSnap.exists) return NextResponse.json({ ok: false, reason: 'Renter not found' }, { status: 404 });

    const booth = boothSnap.data();
    const renter = renterSnap.data();
    const stripeAccountId = tenantSnap.data()?.stripeAccountId;

    if (!booth.dayUseEnabled) {
      return NextResponse.json({ ok: false, reason: 'This booth is not set up for day-use booking.' });
    }
    if (!stripeAccountId) {
      return NextResponse.json({ ok: false, reason: 'No connected payment account. Configure Stripe in Settings.' });
    }
    if (!renter.stripeCustomerId || !renter.defaultPaymentMethodId) {
      return NextResponse.json({
        ok: false,
        reason: 'This renter has no card on file. Send a card-setup link or use the guest booking flow.',
        code: 'no_card_on_file',
      });
    }

    // ── Compute price from the booth's day-use rates ──────────────────────
    const hours = (new Date(endAt).getTime() - new Date(startAt).getTime()) / 3_600_000;
    const totalCents =
      rateType === 'daily'
        ? booth.dayUseDailyCents ?? 0
        : Math.round((booth.dayUseHourlyCents ?? 0) * hours);
    if (totalCents <= 0) {
      return NextResponse.json({ ok: false, reason: 'This booth has no day-use rate configured for that duration.' });
    }
    const bufferMinutes = booth.dayUseBufferMinutes ?? 0;
    const minHours = booth.dayUseMinHours ?? 0;
    if (minHours > 0 && hours < minHours) {
      return NextResponse.json({ ok: false, reason: `Minimum booking length is ${minHours} hour(s).` });
    }

    // ── Transaction: re-check overlap against leases + other bookings, ────
    // then write the booking as 'held'. This is the actual double-booking
    // guard — everything upstream is UX-only convenience.
    const bookingRef = db.collection(`tenants/${tenantId}/bookings`).doc();
    let conflict = false;

    await db.runTransaction(async (tx: any) => {
      const [leaseSnap, bookingsSnap] = await Promise.all([
        db.collection(`tenants/${tenantId}/leases`)
          .where('boothId', '==', boothId)
          .where('status', 'in', ['active', 'on_leave', 'pending_signature'])
          .get(),
        db.collection(`tenants/${tenantId}/bookings`)
          .where('boothId', '==', boothId)
          .get(),
      ]);

      for (const leaseDoc of leaseSnap.docs) {
        const lease = leaseDoc.data();
        if (!lease.scheduleSlot) { conflict = true; break; } // exclusive lease blocks all day-use
        const day = new Date(startAt).getDay();
        if (lease.scheduleSlot.days?.includes(day)) {
          if (!lease.scheduleSlot.startTime) { conflict = true; break; }
          const slotStart = `${String(startAt).slice(0, 10)}T${lease.scheduleSlot.startTime}:00`;
          const slotEnd = `${String(startAt).slice(0, 10)}T${lease.scheduleSlot.endTime ?? '23:59'}:00`;
          if (rangesOverlap(startAt, endAt, slotStart, slotEnd)) { conflict = true; break; }
        }
      }

      if (!conflict) {
        const nowForFilter = new Date().toISOString();
        for (const bDoc of bookingsSnap.docs) {
          const b = bDoc.data();
          const isBlocking =
            b.status === 'confirmed' || b.status === 'checked_in' ||
            (b.status === 'held' && b.holdExpiresAt && b.holdExpiresAt > nowForFilter);
          if (isBlocking && rangesOverlap(startAt, endAt, b.startAt, b.endAt, bufferMinutes)) {
            conflict = true;
            break;
          }
        }
      }

      if (conflict) return;

      tx.set(bookingRef, {
        id: bookingRef.id,
        tenantId, locationId, boothId, renterId,
        status: 'held',
        startAt, endAt, rateType,
        rateCentsSnapshot: rateType === 'daily' ? booth.dayUseDailyCents ?? 0 : booth.dayUseHourlyCents ?? 0,
        totalCents,
        stripePaymentIntentId: null,
        stripeChargeId: null,
        paymentStatus: 'unpaid',
        transactionId: null,
        ledgerEntryId: null,
        holdExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        cancelledAt: null,
        cancellationReason: null,
        createdAt: nowISO,
        updatedAt: nowISO,
      });
    });

    if (conflict) {
      return NextResponse.json({
        ok: false,
        reason: 'That slot is no longer available.',
        code: 'slot_conflict',
      });
    }

    // ── Charge the card on file ────────────────────────────────────────────
    const stripe = getStripe();
    const idempotencyKey = `booking_${bookingRef.id}`;
    let intent: Stripe.PaymentIntent;
    try {
      intent = await stripe.paymentIntents.create(
        {
          amount: totalCents,
          currency: 'usd',
          customer: renter.stripeCustomerId,
          payment_method: renter.defaultPaymentMethodId,
          off_session: mode === 'auto',
          confirm: true,
          ...(mode === 'pos'
            ? { return_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://app.clarityflow.com'}/booths` }
            : {}),
          description: `Day-use booking — ${booth.name}`,
          metadata: {
            tenantId, locationId, boothId, renterId,
            bookingId: bookingRef.id,
            kind: 'booth_booking',
          },
        },
        { stripeAccount: stripeAccountId, idempotencyKey }
      );
    } catch (stripeErr: any) {
      await bookingRef.update({ status: 'cancelled', cancelledAt: new Date().toISOString(), cancellationReason: 'stripe_error', updatedAt: new Date().toISOString() });
      const code = stripeErr?.code || stripeErr?.raw?.code || 'charge_failed';
      return NextResponse.json({ ok: false, reason: stripeErr?.message || 'Card charge failed', code });
    }

    if (intent.status === 'requires_action') {
      // Held slot stays reserved for the 5-min hold window while the
      // frontend completes 3DS; it does not confirm until payment does.
      return NextResponse.json({
        ok: false,
        requiresAction: true,
        clientSecret: intent.client_secret,
        bookingId: bookingRef.id,
        reason: 'Card requires additional authentication.',
      });
    }
    if (intent.status !== 'succeeded') {
      await bookingRef.update({ status: 'cancelled', cancelledAt: new Date().toISOString(), cancellationReason: `stripe_${intent.status}`, updatedAt: new Date().toISOString() });
      return NextResponse.json({ ok: false, reason: `Charge did not complete (status: ${intent.status})`, code: intent.status });
    }

    // ── Confirm booking + write both ledgers ───────────────────────────────
    const chargeId = resolveChargeId(intent);
    const txnRef = db.collection(`tenants/${tenantId}/transactions`).doc();
    const ledgerRef = db.collection(`tenants/${tenantId}/rentLedger`).doc();
    const batch = db.batch();

    batch.set(txnRef, {
      id: txnRef.id,
      date: nowISO,
      description: `Day-use booking — ${booth.name}`,
      clientOrVendor: `${renter.firstName} ${renter.lastName}`,
      type: 'income',
      context: 'Business',
      category: 'Day-Use Booking Revenue',
      taxBucket: 'revenue',
      amount: totalCents / 100,
      paymentMethod: 'Card on file (Stripe)',
      stripePaymentIntentId: intent.id,
      stripeChargeId: chargeId,
      bookingId: bookingRef.id,
      hasReceipt: true,
      tenantId, locationId,
    });

    batch.set(ledgerRef, {
      id: ledgerRef.id,
      locationId,
      leaseId: null,
      bookingId: bookingRef.id,
      renterId,
      boothId,
      type: 'rent_charge',
      amountCents: totalCents,
      status: 'paid',
      dueDate: nowISO,
      paidAt: nowISO,
      description: `Day-use booking — ${rateType === 'daily' ? 'full day' : `${hours}h`}`,
      method: 'card',
      createdAt: nowISO,
      updatedAt: nowISO,
    });

    batch.update(bookingRef, {
      status: 'confirmed',
      paymentStatus: 'paid',
      stripePaymentIntentId: intent.id,
      stripeChargeId: chargeId,
      transactionId: txnRef.id,
      ledgerEntryId: ledgerRef.id,
      holdExpiresAt: null,
      updatedAt: new Date().toISOString(),
    });

    await batch.commit();

    return NextResponse.json({
      ok: true,
      bookingId: bookingRef.id,
      paymentIntentId: intent.id,
      totalCents,
    });
  } catch (err: any) {
    console.error('[stripe/book-station]', err);
    return NextResponse.json({ ok: false, reason: err.message }, { status: 200 });
  }
}
