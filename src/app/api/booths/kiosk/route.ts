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
import { resolveDayUseAgreement, buildSignedRecord } from '@/lib/esign';
import { resolveIncidentalPolicy } from '@/lib/incidentals';

const digits = (s: any) => String(s || '').replace(/\D/g, '');

// Build the exact day-use agreement text for a reservation, using the owner's
// custom booking terms if set (else the built-in protective default) and the
// studio's incidentals caps. Same resolver the online booking route uses, so
// the guest sees identical terms whether they booked online or walked in.
async function buildDayUseAgreement(db: FirebaseFirestore.Firestore, tenantId: string, r: any): Promise<{ title: string; text: string }> {
  let tenantData: any = {};
  try { tenantData = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {}; } catch { /* defaults below */ }
  const custom = await findAgreement(db, tenantId);
  const isHourly = r.bookingType === 'hourly';
  const bookingWindow = isHourly
    ? `${r.startDate} · ${r.startTime}–${r.endTime}`
    : (r.startDate === r.endDate ? r.startDate : `${r.startDate} → ${r.endDate}`);
  const cats = resolveIncidentalPolicy(tenantData);
  const incidentalsSchedule = (Array.isArray(cats) && cats.length)
    ? cats.map((c: any) => c.capCents > 0 ? `• ${c.label} — up to $${(c.capCents / 100).toFixed(0)}` : `• ${c.label}`).join('\n')
    : '(No incidental charges configured.)';
  return resolveDayUseAgreement(custom, {
    date: new Date().toISOString().slice(0, 10),
    studioName: tenantData?.name || tenantData?.businessName || 'The Studio',
    signerName: r.name || 'Guest',
    boothName: r.boothName || 'the space',
    bookingWindow,
    amount: `$${((r.amountCents || 0) / 100).toFixed(2)}`,
    incidentalsSchedule,
  });
}

// Persist a check-in signature to the append-only, write-once legal store —
// the same collection leases and online bookings use. Idempotent per booking.
async function persistKioskSignature(db: FirebaseFirestore.Firestore, tenantId: string, reservationId: string, r: any, agreement: { title: string; text: string }, signedName: string): Promise<void> {
  try {
    const col = db.collection(`tenants/${tenantId}/signedDocuments`);
    const existing = await col.where('meta.reservationId', '==', reservationId).limit(1).get();
    if (!existing.empty) return;
    const ref = col.doc();
    const record = buildSignedRecord(ref.id, {
      subjectType: 'client',
      subjectId: reservationId,
      subjectName: r.name || 'Guest',
      kind: 'day_use',
      title: agreement.title,
      agreementText: agreement.text,
      meta: {
        reservationId, source: 'kiosk_checkin',
        boothId: r.boothId || null, boothName: r.boothName || null,
        startDate: r.startDate || null, endDate: r.endDate || null,
        bookingType: r.bookingType || null,
      },
    }, signedName);
    await ref.set(record);
  } catch (err) {
    // Never let the legal-record write block check-in; the snapshot also
    // lands on the reservation as a backstop.
    console.error('[booth-kiosk] persistKioskSignature failed', err);
  }
}


// Exact Stripe fee via the charge's balance transaction. Fail-open.
async function stripeFeeFor(paymentIntentId: string | null): Promise<{ feeCents: number; chargeId: string | null }> {
  try {
    if (!paymentIntentId || !process.env.STRIPE_SECRET_KEY) return { feeCents: 0, chargeId: null };
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
    const pi: any = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge.balance_transaction'] });
    const charge: any = pi?.latest_charge;
    const bt: any = charge?.balance_transaction;
    return { feeCents: Number(bt?.fee) || 0, chargeId: charge?.id || null };
  } catch { return { feeCents: 0, chargeId: null }; }
}

async function loadRules(db: FirebaseFirestore.Firestore, tenantId: string): Promise<any> {
  const DEFAULTS = {
    toursEnabled: true, tourAutoConfirm: true, tourDurationMins: 30,
    tourDays: [1, 2, 3, 4, 5], tourWindowStart: '10:00', tourWindowEnd: '17:00',
    bookingLeadHours: 2, bookingHorizonDays: 60,
  };
  try {
    const t = await db.doc(`tenants/${tenantId}`).get();
    const rules = (t.data() as any)?.bookingPageSettings?.automationRules;
    return { ...DEFAULTS, ...(rules || {}) };
  } catch { return DEFAULTS; }
}

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
    // 'active-stay': who can this concierge order be charged to?
    //
    //   • boothId (a renter's station link /concierge?booth=…): resolve the
    //     station's payer — a checked-in day guest at that booth, else the
    //     booth's resident RENTER. Returns the renter's amenity settings
    //     (who-pays + comp allowance) so the kiosk knows how to bill.
    //   • phone (the walk-in lounge kiosk): the checked-in day guest whose
    //     card is on file, matched on the last 10 digits.
    if (action === 'active-stay') {
      const boothId = String(body.boothId || '').trim();

      // ── Station-scoped: a renter's booth link. ──
      if (boothId) {
        // 1) A checked-in day guest occupying that booth today (bill their card).
        const resSnap = await db.collection(`tenants/${tenantId}/boothReservations`)
          .where('boothId', '==', boothId).get();
        const dayStay = resSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
          .find(r => r.status === 'checked_in' && r.startDate <= today && r.endDate >= today);
        if (dayStay) {
          return NextResponse.json({
            ok: true, found: true, payerType: 'reservation',
            reservationId: dayStay.id,
            boothName: dayStay.boothName || 'your station',
            cardOnFile: !!(dayStay.cardOnFile && dayStay.stripeCustomerId && dayStay.stripePaymentMethodId),
            amenityPayer: 'renter', amenityCompAllowance: 0,
          });
        }
        // 2) Otherwise the resident renter of that booth.
        let boothName = 'your station';
        try {
          const bSnap = await db.doc(`tenants/${tenantId}/booths/${boothId}`).get();
          if (bSnap.exists) boothName = (bSnap.data() as any)?.name || boothName;
        } catch { /* cosmetic */ }
        const leaseSnap = await db.collection(`tenants/${tenantId}/leases`)
          .where('boothId', '==', boothId).get();
        const lease = leaseSnap.docs.map(d => d.data() as any)
          .find(l => ['active', 'on_leave'].includes(l.status));
        if (lease?.renterId) {
          const rSnap = await db.doc(`tenants/${tenantId}/renters/${lease.renterId}`).get();
          const rt = rSnap.exists ? (rSnap.data() as any) : null;
          if (rt && rt.amenitiesEnabled) {
            return NextResponse.json({
              ok: true, found: true, payerType: 'renter',
              renterId: lease.renterId,
              boothName,
              renterName: `${rt.firstName || ''} ${rt.lastName || ''}`.trim() || 'Renter',
              cardOnFile: !!(rt.cardOnFile && rt.stripeCustomerId && rt.stripePaymentMethodId),
              amenityPayer: rt.amenityPayer === 'client' ? 'client' : 'renter',
              amenityCompAllowance: Math.max(0, Math.round(Number(rt.amenityCompAllowance) || 0)),
            });
          }
        }
        // Booth exists, but no active stay/renter or amenities not enabled:
        // the menu still works, just no station charging.
        return NextResponse.json({ ok: true, found: false, boothName });
      }

      // ── Phone-scoped: the walk-in lounge kiosk (unchanged). ──
      const ph = digits(body.phone).slice(-10);
      if (ph.length !== 10) return NextResponse.json({ ok: true, found: false });
      const snap = await db.collection(`tenants/${tenantId}/boothReservations`)
        .where('startDate', '<=', today).get();
      const stay = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
        .find(r => r.status === 'checked_in' && r.endDate >= today && digits(r.phone).slice(-10) === ph);
      if (!stay) return NextResponse.json({ ok: true, found: false });
      return NextResponse.json({
        ok: true, found: true, payerType: 'reservation',
        reservationId: stay.id,
        boothName: stay.boothName || 'your station',
        cardOnFile: !!(stay.cardOnFile && stay.stripeCustomerId && stay.stripePaymentMethodId),
      });
    }

    // 'charge': room-service model — charge a concierge order to a card on
    // file. Two payers:
    //   • reservationId (+ phone): a checked-in day guest's card (unchanged).
    //   • renterId: a booth's resident renter's card, for a renter whose
    //     clients are allowed to charge to their station (amenitiesEnabled).
    // A price cap keeps a kiosk bug from becoming a disaster.
    if (action === 'charge') {
      const { reservationId, renterId, amountCents, description } = body;
      if (!(amountCents > 0) || !description?.trim()) {
        return NextResponse.json({ ok: false, error: 'Missing parameters.' }, { status: 400 });
      }
      if (amountCents > 50000) {
        return NextResponse.json({ ok: false, error: 'Order too large for station charging — please pay at the desk.' }, { status: 400 });
      }

      // ── Renter-station charge: a renter's client billing the renter's card ──
      if (renterId && !reservationId) {
        const rSnap = await db.doc(`tenants/${tenantId}/renters/${renterId}`).get();
        if (!rSnap.exists) return NextResponse.json({ ok: false, error: 'Station not found — please pay the host.' }, { status: 404 });
        const rt = rSnap.data() as any;
        if (!rt.amenitiesEnabled) {
          return NextResponse.json({ ok: false, error: 'Station charging isn’t enabled here — please pay the host.' }, { status: 400 });
        }
        if (!rt.cardOnFile || !rt.stripeCustomerId || !rt.stripePaymentMethodId) {
          return NextResponse.json({ ok: false, error: 'No card on file for this station — please pay the host.' }, { status: 400 });
        }
        const renterName = `${rt.firstName || ''} ${rt.lastName || ''}`.trim() || 'Renter';
        const boothName = String(body.boothName || 'their station');
        const Stripe = (await import('stripe')).default;
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
        let intent;
        try {
          intent = await stripe.paymentIntents.create({
            amount: amountCents, currency: 'usd',
            customer: rt.stripeCustomerId, payment_method: rt.stripePaymentMethodId,
            off_session: true, confirm: true,
            description: `${description.trim()} — ${boothName} (${renterName})`,
            metadata: { tenantId, renterId, kind: 'concierge_renter_charge' },
          });
        } catch (err: any) {
          const msg = err?.raw?.message || err?.message || 'Card charge failed.';
          // Non-punitive: a decline just means collect another way.
          return NextResponse.json({ ok: false, error: `Card declined: ${msg} — please pay the host.` }, { status: 402 });
        }
        const nowIso = new Date().toISOString();
        const txnRef = db.collection(`tenants/${tenantId}/transactions`).doc();
        await txnRef.set({
          id: txnRef.id, type: 'income', context: 'Business', taxBucket: 'revenue',
          amount: amountCents / 100, category: 'Hospitality Revenue',
          description: `${description.trim()} — charged to ${boothName} (${renterName})`,
          clientOrVendor: renterName, date: nowIso, paymentMethod: 'Card on file (Stripe)',
          hasReceipt: false, stripePaymentIntentId: intent.id, sourceId: renterId, renterId, tenantId, createdAt: nowIso,
        });
        try {
          const { feeCents: __fee, chargeId: __chg } = await stripeFeeFor(intent.id);
          if (__fee > 0) {
            const feeRef = db.collection(`tenants/${tenantId}/transactions`).doc();
            await feeRef.set({
              id: feeRef.id, type: 'expense', context: 'Business', taxBucket: 'operating_cost',
              amount: __fee / 100, category: 'Processing Fees',
              description: `Stripe fee — concierge charge — ${boothName} (${renterName})`,
              clientOrVendor: 'Stripe', date: nowIso, paymentMethod: 'Deducted from payout',
              hasReceipt: false, stripePaymentIntentId: intent.id, stripeChargeId: __chg,
              sourceId: renterId, renterId, tenantId, createdAt: nowIso,
            });
          }
        } catch { /* fee recording never blocks the charge */ }
        return NextResponse.json({ ok: true, chargedCents: amountCents, boothName });
      }

      // ── Reservation charge: a checked-in day guest's card (unchanged) ──
      const ph = digits(body.phone).slice(-10);
      if (!reservationId || ph.length !== 10) {
        return NextResponse.json({ ok: false, error: 'Missing parameters.' }, { status: 400 });
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
      // Record the exact Stripe fee as a paired Processing Fees expense.
      try {
        const { feeCents: __fee, chargeId: __chg } = await stripeFeeFor(intent.id);
        if (__fee > 0) {
          const feeRef = db.collection(`tenants/${tenantId}/transactions`).doc();
          await feeRef.set({
            id: feeRef.id, type: 'expense', context: 'Business', taxBucket: 'operating_cost',
            amount: __fee / 100, category: 'Processing Fees',
            description: `Stripe fee — concierge charge — ${r.boothName} (${r.name})`,
            clientOrVendor: 'Stripe', date: nowIso, paymentMethod: 'Deducted from payout',
            hasReceipt: false, stripePaymentIntentId: intent.id, stripeChargeId: __chg,
            sourceId: reservationId, tenantId, createdAt: nowIso,
          });
        }
      } catch { /* fee recording never blocks the charge */ }


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
      // The full day-use agreement to type-sign at check-in (owner's custom
      // terms or the built-in protective default), plus whether it's already
      // signed so the stay page can show a receipt instead of re-prompting.
      const dayUseAgreement = await buildDayUseAgreement(db, tenantId, r);
      return NextResponse.json({
        ok: true,
        studioName,
        agreement,
        dayUseAgreement,
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
          agreementSignedName: r.agreementSignedName || null,
          agreementSignedAt: r.agreementSignedAt || null,
          emergencyContact: r.emergencyContact || null,
          rating: r.rating || null,
        },
      });
    }

    // 'stay-onboard': type-sign the day-use agreement + save emergency
    // contact. This is the day-guest equivalent of the signed lease — a
    // walk-in signs here for the first time; an online guest re-confirms.
    // When a typed name is provided, the exact terms are snapshotted to the
    // write-once legal store, just like the online booking path.
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
      const signedName = String(body.signedName || '').trim().slice(0, 120);
      // Capture the signature only if this booking hasn't already got one on
      // file (an online guest already signed; don't overwrite that record).
      if (signedName.length >= 2 && !r.agreementSignedAt) {
        const agreement = await buildDayUseAgreement(db, tenantId, r);
        updates.agreementTitle = agreement.title;
        updates.agreementText = agreement.text;
        updates.agreementSignedName = signedName;
        updates.agreementSignedAt = nowIso;
        await persistKioskSignature(db, tenantId, reservationId, r, agreement, signedName);
      }
      if (emergencyName?.trim() || emergencyPhone?.trim()) {
        updates.emergencyContact = {
          name: String(emergencyName || '').slice(0, 100),
          phone: String(emergencyPhone || '').slice(0, 30),
          addedAt: nowIso,
        };
      }
      await ref.set(updates, { merge: true });
      return NextResponse.json({ ok: true, signed: !!updates.agreementSignedAt });
    }

    // ── v82 AVAILABILITY: dates only, zero PII — powers the public
    // booking calendar's disabled dates. Daily bookings block their
    // whole range; hourly days stay open (multiple can coexist).
    if (action === 'availability') {
      const { boothId } = body;
      if (!boothId) return NextResponse.json({ ok: false, error: 'Missing boothId.' }, { status: 400 });
      const snap = await db.collection(`tenants/${tenantId}/boothReservations`)
        .where('boothId', '==', boothId).get();
      const now = Date.now();
      const HOLD_MS = 30 * 60 * 1000;
      const booked = new Set<string>();
      for (const d of snap.docs) {
        const r = d.data() as any;
        const holds = ['confirmed', 'checked_in'].includes(r.status) ||
          (r.status === 'pending_payment' && r.createdAt && now - new Date(r.createdAt).getTime() < HOLD_MS);
        if (!holds) continue;
        if (r.bookingType === 'hourly') continue;   // hourly days remain bookable
        let t = new Date(r.startDate + 'T00:00:00Z').getTime();
        const e = new Date(r.endDate + 'T00:00:00Z').getTime();
        for (; t <= e; t += 86400000) booked.add(new Date(t).toISOString().slice(0, 10));
      }
      return NextResponse.json({ ok: true, bookedDates: Array.from(booked) });
    }

    // ── v82 REVIEW: "how was your stay" — rating + note on the
    // reservation, phone-gated like everything else.
    if (action === 'stay-review') {
      const { reservationId, rating, reviewText } = body;
      const last4 = digits(body.phoneLast4).slice(-4);
      const stars = Number(rating);
      if (!reservationId || last4.length !== 4 || !(stars >= 1 && stars <= 5)) {
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
      const prevStars = Number(r.rating) || 0;
      await ref.set({ rating: stars, reviewText: String(reviewText || '').slice(0, 1000), reviewedAt: nowIso }, { merge: true });
      // Aggregate on the booth doc (publicly readable) so listings can
      // show ★ averages without exposing reservations. Re-reviews adjust
      // the sum instead of double-counting.
      if (r.boothId) {
        try {
          const bRef = db.doc(`tenants/${tenantId}/booths/${r.boothId}`);
          const bSnap = await bRef.get();
          if (bSnap.exists) {
            const bd = bSnap.data() as any;
            const count = (Number(bd.ratingCount) || 0) + (prevStars > 0 ? 0 : 1);
            const sum = (Number(bd.ratingSum) || 0) + stars - prevStars;
            await bRef.set({ ratingCount: count, ratingSum: sum }, { merge: true });
          }
        } catch { /* aggregates are a bonus — the review itself is saved */ }
      }
      const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
      await nRef.set({ id: nRef.id, type: 'booth_review', read: false, createdAt: nowIso, link: '/booths',
        message: `${'⭐'.repeat(stars)} ${r.name} rated their stay at ${r.boothName}${reviewText ? `: "${String(reviewText).slice(0, 120)}"` : ''}` });
      return NextResponse.json({ ok: true });
    }

    // ── v84 CANCELLATION REQUEST: guest asks; owner decides (refunds are
    // money — never auto-issued). Flags the reservation and notifies.
    if (action === 'stay-cancel') {
      const { reservationId, reason } = body;
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
      if (['checked_in', 'completed'].includes(r.status)) {
        return NextResponse.json({ ok: false, error: 'This stay has already started — please talk to the front desk.' }, { status: 400 });
      }
      if (r.cancelRequestedAt) return NextResponse.json({ ok: true, already: true });
      const nowIso = new Date().toISOString();
      await ref.set({ cancelRequestedAt: nowIso, cancelReason: String(reason || '').slice(0, 500), status: 'cancel_requested' }, { merge: true });
      const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
      await nRef.set({ id: nRef.id, type: 'booth_reservation', read: false, createdAt: nowIso, link: '/booths',
        message: `🚫 Cancellation requested: ${r.name} — ${r.boothName}, ${r.startDate}${r.bookingType === 'hourly' && r.startTime ? ` ${r.startTime}` : ''}. Review to refund or decline.${reason ? ` Reason: "${String(reason).slice(0, 100)}"` : ''}` });
      return NextResponse.json({ ok: true });
    }

    // ── v88 TOUR SCHEDULING (pipeline Step 3) ────────────────────────
    // 'tour-slots': open tour times for a date, per the owner's rules,
    // minus already-booked tours. Real appointment scheduling.
    if (action === 'tour-slots') {
      const { date } = body;   // YYYY-MM-DD
      if (!date) return NextResponse.json({ ok: false, error: 'Missing date.' }, { status: 400 });
      const rules = await loadRules(db, tenantId);
      if (!rules.toursEnabled) return NextResponse.json({ ok: true, slots: [], toursOff: true });
      const dow = new Date(date + 'T00:00:00Z').getUTCDay();
      if (!rules.tourDays.includes(dow)) return NextResponse.json({ ok: true, slots: [] });

      const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
      const pad = (n: number) => String(n).padStart(2, '0');
      const dur = rules.tourDurationMins || 30;
      const startM = toMin(rules.tourWindowStart || '10:00');
      const endM = toMin(rules.tourWindowEnd || '17:00');
      const leadMs = (rules.bookingLeadHours || 0) * 3600000;
      const now = Date.now();

      // Existing tours that day → block those times
      const tourSnap = await db.collection(`tenants/${tenantId}/tours`)
        .where('date', '==', date).get();
      const taken = new Set(tourSnap.docs
        .map(d => d.data() as any)
        .filter(t => ['requested', 'confirmed'].includes(t.status))
        .map(t => t.time));

      const slots: string[] = [];
      for (let m = startM; m + dur <= endM; m += dur) {
        const hhmm = `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
        if (taken.has(hhmm)) continue;
        if (new Date(`${date}T${hhmm}:00`).getTime() - now < leadMs) continue;   // lead-time
        slots.push(hhmm);
      }
      return NextResponse.json({ ok: true, slots, durationMins: dur });
    }

    // 'tour-book': create the tour. auto-confirm or await approval per
    // rules. Writes to /tours AND /boothApplications (kind:'tour') so it
    // flows into the CRM pipeline as a 'Toured' stage contact.
    if (action === 'tour-book') {
      const { date, time, name, phone, email, message } = body;
      if (!date || !time || !name || !(phone || email)) {
        return NextResponse.json({ ok: false, error: 'Please give your name, a contact, and pick a time.' }, { status: 400 });
      }
      const rules = await loadRules(db, tenantId);
      if (!rules.toursEnabled) return NextResponse.json({ ok: false, error: 'Tours are not currently offered.' }, { status: 400 });

      // Re-check the slot is still free (race guard)
      const clashSnap = await db.collection(`tenants/${tenantId}/tours`).where('date', '==', date).get();
      if (clashSnap.docs.some(d => { const t = d.data() as any; return t.time === time && ['requested', 'confirmed'].includes(t.status); })) {
        return NextResponse.json({ ok: false, error: 'That time was just taken — please pick another.' }, { status: 409 });
      }

      const nowIso = new Date().toISOString();
      const status = rules.tourAutoConfirm ? 'confirmed' : 'requested';
      const tourRef = db.collection(`tenants/${tenantId}/tours`).doc();
      await tourRef.set({
        id: tourRef.id, date, time, durationMins: rules.tourDurationMins || 30,
        name, phone: phone || '', email: email || '', message: String(message || '').slice(0, 500),
        status, createdAt: nowIso, tenantId,
      });
      // Pipeline record — shows up in Contacts as 'Toured'
      const appRef = db.collection(`tenants/${tenantId}/boothApplications`).doc();
      await appRef.set({
        id: appRef.id, kind: 'tour', name, phone: phone || '', email: email || '',
        message: `Tour ${status === 'confirmed' ? 'booked' : 'requested'} for ${date} ${time}${message ? ` — "${message}"` : ''}`,
        status: 'new', tourId: tourRef.id, tourDate: date, tourTime: time,
        createdAt: nowIso, tenantId,
      });
      const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
      await nRef.set({ id: nRef.id, type: 'booth_tour', read: false, createdAt: nowIso, link: '/booths',
        message: `📅 Tour ${status === 'confirmed' ? 'booked' : 'requested'}: ${name} — ${date} at ${time}${status === 'requested' ? ' (needs your OK)' : ''}` });

      return NextResponse.json({ ok: true, status, autoConfirmed: status === 'confirmed' });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  } catch (err) {
    console.error('[kiosk] failed', err);
    return NextResponse.json({ ok: false, error: 'Something went wrong — see the front desk.' }, { status: 500 });
  }
}
