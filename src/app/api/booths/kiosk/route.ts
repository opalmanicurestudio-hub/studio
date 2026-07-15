/**
 * /api/booths/kiosk — v1 (self check-in kiosk)
 *
 * Public endpoint powering the front-desk tablet at /kiosk/[tenantId].
 * Admin SDK — anonymous guests can't write reservations through rules,
 * and lookups must never leak other guests' data. Responses carry the
 * minimum: first name, space, time window.
 *
 * POST { action: 'lookup',  tenantId, phoneLast4 }
 *   → today's confirmed bookings whose phone ends with those 4 digits.
 * POST { action: 'checkin', tenantId, reservationId, phoneLast4 }
 *   → re-verifies the match, stamps checked_in + actualCheckIn (the same
 *     fields the owner's Check In button writes — Operations updates
 *     live, the time clock runs, settlement works unchanged), plus a
 *     kiosk consent-reconfirmation timestamp. Notifies the owner.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

const digits = (s: any) => String(s || '').replace(/\D/g, '');

async function findAgreement(db: FirebaseFirestore.Firestore, tenantId: string): Promise<string> {
  // The booking page's application agreement lives in the page-builder
  // config. Try the plausible locations defensively; a miss is fine —
  // the kiosk falls back to reconfirmation language.
  const candidates = [
    `tenants/${tenantId}/settings/bookingPage`,
    `tenants/${tenantId}/bookingPageSettings/config`,
    `tenants/${tenantId}`,
  ];
  for (const path of candidates) {
    try {
      const snap = await db.doc(path).get();
      if (!snap.exists) continue;
      const data = snap.data() as any;
      const cfg = data?.cfPageConfig || data;
      const sections: any[] = Array.isArray(cfg?.sections) ? cfg.sections : [];
      for (const s of sections) {
        const txt = s?.config?.applicationAgreement;
        if (typeof txt === 'string' && txt.trim()) return txt.trim();
      }
    } catch { /* keep trying */ }
  }
  return '';
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, tenantId } = body || {};
    if (!tenantId || !action) {
      return NextResponse.json({ ok: false, error: 'Missing parameters.' }, { status: 400 });
    }
    const db = getAdminDb();
    const today = new Date().toISOString().slice(0, 10);

    if (action === 'lookup') {
      const last4 = digits(body.phoneLast4).slice(-4);
      if (last4.length !== 4) {
        return NextResponse.json({ ok: false, error: 'Enter the last 4 digits of your phone number.' }, { status: 400 });
      }
      const snap = await db.collection(`tenants/${tenantId}/boothReservations`)
        .where('startDate', '<=', today).get();
      const matches = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as any) }))
        .filter(r =>
          ['confirmed', 'checked_in'].includes(r.status) &&
          r.endDate >= today &&
          digits(r.phone).slice(-4) === last4);
      if (matches.length === 0) {
        return NextResponse.json({ ok: false, error: "No booking found for today with that number. Double-check the digits, or see the front desk." });
      }
      const agreement = await findAgreement(db, tenantId);
      return NextResponse.json({
        ok: true,
        agreement,
        bookings: matches.map(r => ({
          id: r.id,
          firstName: (r.name || 'Guest').split(' ')[0],
          boothName: r.boothName || 'Space',
          startDate: r.startDate,
          endDate: r.endDate,
          bookingType: r.bookingType || 'daily',
          startTime: r.startTime || null,
          endTime: r.endTime || null,
          slotLabel: r.slotLabel || null,
          alreadyCheckedIn: r.status === 'checked_in',
        })),
      });
    }

    if (action === 'checkin') {
      const { reservationId } = body;
      const last4 = digits(body.phoneLast4).slice(-4);
      if (!reservationId || last4.length !== 4) {
        return NextResponse.json({ ok: false, error: 'Missing parameters.' }, { status: 400 });
      }
      const ref = db.doc(`tenants/${tenantId}/boothReservations/${reservationId}`);
      const snap = await ref.get();
      if (!snap.exists) return NextResponse.json({ ok: false, error: 'Booking not found.' }, { status: 404 });
      const r = snap.data() as any;
      if (digits(r.phone).slice(-4) !== last4) {
        return NextResponse.json({ ok: false, error: 'Booking not found.' }, { status: 404 });
      }
      if (r.status === 'checked_in') {
        return NextResponse.json({ ok: true, already: true, firstName: (r.name || 'Guest').split(' ')[0], boothName: r.boothName, endTime: r.endTime || null });
      }
      if (r.status !== 'confirmed' || r.startDate > today || r.endDate < today) {
        return NextResponse.json({ ok: false, error: 'This booking is not active today — see the front desk.' }, { status: 400 });
      }
      const nowIso = new Date().toISOString();
      await ref.set({
        status: 'checked_in',
        checked_inAt: nowIso,
        actualCheckIn: nowIso,
        kioskCheckIn: true,
        policiesReconfirmedAt: nowIso,
      }, { merge: true });
      const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
      await nRef.set({
        id: nRef.id, type: 'booth_reservation', read: false, createdAt: nowIso, link: '/booths',
        message: `👋 Kiosk check-in: ${r.name} — ${r.boothName}${r.bookingType === 'hourly' && r.endTime ? ` (until ${r.endTime})` : ''}`,
      });
      return NextResponse.json({ ok: true, firstName: (r.name || 'Guest').split(' ')[0], boothName: r.boothName, endTime: r.bookingType === 'hourly' ? r.endTime : null });
    }

    // ── v75 CONCIERGE INTEGRATION ─────────────────────────────────────
    // 'active-stay': does this phone have a checked-in booth stay today,
    // and is there a card on file? Powers the concierge kiosk's
    // "charge to my station" option. Full phone number (the concierge
    // identity step collects it) — matched on last 10 digits.
    if (action === 'active-stay') {
      const ph = digits(body.phone).slice(-10);
      if (ph.length !== 10) return NextResponse.json({ ok: true, found: false });
      const snap = await db.collection(`tenants/${tenantId}/boothReservations`)
        .where('startDate', '<=', today).get();
      const stay = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
        .find(r => r.status === 'checked_in' && r.endDate >= today && digits(r.phone).slice(-10) === ph);
      if (!stay) return NextResponse.json({ ok: true, found: false });
      return NextResponse.json({
        ok: true, found: true,
        reservationId: stay.id,
        boothName: stay.boothName || 'your station',
        cardOnFile: !!(stay.cardOnFile && stay.stripeCustomerId && stay.stripePaymentMethodId),
      });
    }

    // 'charge': room-service model — charge a concierge order to the
    // checked-in guest's card on file. Verifies phone + active stay
    // server-side; price cap keeps a kiosk bug from becoming a disaster.
    if (action === 'charge') {
      const { reservationId, amountCents, description } = body;
      const ph = digits(body.phone).slice(-10);
      if (!reservationId || !(amountCents > 0) || !description?.trim() || ph.length !== 10) {
        return NextResponse.json({ ok: false, error: 'Missing parameters.' }, { status: 400 });
      }
      if (amountCents > 50000) {
        return NextResponse.json({ ok: false, error: 'Order too large for station charging — please pay at the desk.' }, { status: 400 });
      }
      const ref = db.doc(`tenants/${tenantId}/boothReservations/${reservationId}`);
      const snap = await ref.get();
      if (!snap.exists) return NextResponse.json({ ok: false, error: 'Stay not found.' }, { status: 404 });
      const r = snap.data() as any;
      if (digits(r.phone).slice(-10) !== ph || r.status !== 'checked_in' || r.endDate < today) {
        return NextResponse.json({ ok: false, error: 'No active stay found — please pay at the desk.' }, { status: 400 });
      }
      if (!r.cardOnFile || !r.stripeCustomerId || !r.stripePaymentMethodId) {
        return NextResponse.json({ ok: false, error: 'No card on file for this stay — please pay at the desk.' }, { status: 400 });
      }

      const Stripe = (await import('stripe')).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
      let intent;
      try {
        intent = await stripe.paymentIntents.create({
          amount: amountCents, currency: 'usd',
          customer: r.stripeCustomerId, payment_method: r.stripePaymentMethodId,
          off_session: true, confirm: true,
          description: `${description.trim()} — ${r.name} (${r.boothName})`,
          metadata: { tenantId, reservationId, kind: 'concierge_charge' },
        });
      } catch (err: any) {
        const msg = err?.raw?.message || err?.message || 'Card charge failed.';
        return NextResponse.json({ ok: false, error: `Card declined: ${msg} — please pay at the desk.` }, { status: 402 });
      }

      const nowIso = new Date().toISOString();
      const txnRef = db.collection(`tenants/${tenantId}/transactions`).doc();
      await txnRef.set({
        id: txnRef.id, type: 'income', context: 'Business', taxBucket: 'revenue',
        amount: amountCents / 100, category: 'Hospitality Revenue',
        description: `${description.trim()} — charged to ${r.boothName}`,
        clientOrVendor: r.name || 'Guest', date: nowIso, paymentMethod: 'Card on file (Stripe)',
        hasReceipt: false, stripePaymentIntentId: intent.id, sourceId: reservationId, tenantId, createdAt: nowIso,
      });

      return NextResponse.json({ ok: true, chargedCents: amountCents, boothName: r.boothName });
    }

    // ── v81 STAY LINK: the renter confirmation page (/stay/...) ──────
    // 'stay-view': booking details + house rules, gated by phone last-4.
    if (action === 'stay-view') {
      const { reservationId } = body;
      const last4 = digits(body.phoneLast4).slice(-4);
      if (!reservationId || last4.length !== 4) {
        return NextResponse.json({ ok: false, error: 'Enter the last 4 digits of the phone number on the booking.' }, { status: 400 });
      }
      const snap = await db.doc(`tenants/${tenantId}/boothReservations/${reservationId}`).get();
      if (!snap.exists) return NextResponse.json({ ok: false, error: 'Booking not found.' }, { status: 404 });
      const r = snap.data() as any;
      if (digits(r.phone).slice(-4) !== last4) {
        return NextResponse.json({ ok: false, error: 'Booking not found.' }, { status: 404 });
      }
      const agreement = await findAgreement(db, tenantId);
      let studioName = 'The studio';
      try {
        const t = await db.doc(`tenants/${tenantId}`).get();
        studioName = (t.data() as any)?.name || (t.data() as any)?.businessName || studioName;
      } catch { /* cosmetic */ }
      return NextResponse.json({
        ok: true,
        studioName,
        agreement,
        booking: {
          id: snap.id,
          firstName: (r.name || 'Guest').split(' ')[0],
          name: r.name, boothName: r.boothName || 'Space',
          startDate: r.startDate, endDate: r.endDate,
          bookingType: r.bookingType || 'daily',
          startTime: r.startTime || null, endTime: r.endTime || null,
          slotLabel: r.slotLabel || null,
          amountCents: r.amountCents || 0,
          status: r.status,
          rulesAcknowledgedAt: r.rulesAcknowledgedAt || null,
          emergencyContact: r.emergencyContact || null,
        },
      });
    }

    // 'stay-onboard': acknowledge house rules + save emergency contact.
    // Timestamped — this is the day-guest equivalent of the signed lease.
    if (action === 'stay-onboard') {
      const { reservationId, emergencyName, emergencyPhone } = body;
      const last4 = digits(body.phoneLast4).slice(-4);
      if (!reservationId || last4.length !== 4) {
        return NextResponse.json({ ok: false, error: 'Missing parameters.' }, { status: 400 });
      }
      const ref = db.doc(`tenants/${tenantId}/boothReservations/${reservationId}`);
      const snap = await ref.get();
      if (!snap.exists) return NextResponse.json({ ok: false, error: 'Booking not found.' }, { status: 404 });
      const r = snap.data() as any;
      if (digits(r.phone).slice(-4) !== last4) {
        return NextResponse.json({ ok: false, error: 'Booking not found.' }, { status: 404 });
      }
      const nowIso = new Date().toISOString();
      const updates: any = { rulesAcknowledgedAt: nowIso };
      if (emergencyName?.trim() || emergencyPhone?.trim()) {
        updates.emergencyContact = {
          name: String(emergencyName || '').slice(0, 100),
          phone: String(emergencyPhone || '').slice(0, 30),
          addedAt: nowIso,
        };
      }
      await ref.set(updates, { merge: true });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  } catch (err) {
    console.error('[kiosk] failed', err);
    return NextResponse.json({ ok: false, error: 'Something went wrong — see the front desk.' }, { status: 500 });
  }
}
