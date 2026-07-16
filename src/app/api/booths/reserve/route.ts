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
    const { tenantId, boothId, startDate, endDate, name, phone, email, returnUrl, consentAccepted, bookingType, startTime, endTime, slotLabel,
      doingServices, licenseNumber, insuranceCarrier, insuranceConfirmed, idAcknowledged,
      licenseDocUrl, insuranceDocUrl, idDocUrl } = body || {};
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
      // v73 — SLOTS: when the guest booked a pre-set slot, price and times
      // come from the OWNER'S CONFIG, never the client. The submitted
      // times must match the slot exactly.
      const slots: any[] = Array.isArray(booth.bookingSlots) ? booth.bookingSlots : [];
      const matchedSlot = slotLabel
        ? slots.find(s => s.label === slotLabel && s.startTime === startTime && s.endTime === endTime && s.amountCents > 0)
        : null;
      if (slotLabel && !matchedSlot) {
        return NextResponse.json({ ok: false, error: 'That time slot is no longer offered — refresh and pick again.' }, { status: 400 });
      }
      const hourRate = options.find(o => o.frequency === 'hourly' && o.amountCents > 0);
      if (!matchedSlot && !hourRate) {
        return NextResponse.json({ ok: false, error: slots.length > 0 ? 'Pick one of the offered time slots.' : 'This space does not offer hourly booking.' }, { status: 400 });
      }
      if (matchedSlot) {
        amountCents = matchedSlot.amountCents;
        unitsLabel = matchedSlot.label + ` (${startTime}–${endTime})`;
      } else {
      const numHours = Math.round(((new Date(`2000-01-01T${endTime}:00Z`).getTime() - new Date(`2000-01-01T${startTime}:00Z`).getTime()) / 3600000) * 2) / 2;
      if (numHours < 1 || numHours > 14) return NextResponse.json({ ok: false, error: 'Hourly bookings are 1–14 hours.' }, { status: 400 });
      amountCents = Math.round(hourRate!.amountCents * numHours);
      unitsLabel = `${numHours} hour${numHours === 1 ? '' : 's'} (${startTime}–${endTime})`;
      }
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
    const netCents = amountCents - creditAppliedCents;   // owed after credits

    // ── Tranche 2: deposit split. Per-space override wins; else tenant rule.
    // booth.depositPercent (0-100) or booth.depositRequired === false disables.
    let rules: any = {};
    let tenantData: any = {};
    try {
      const tSnap = await db.doc(`tenants/${tenantId}`).get();
      tenantData = (tSnap.data() as any) || {};
      rules = tenantData?.bookingPageSettings?.automationRules || {};
    } catch { /* defaults below */ }
    // Per-space deposit config wins ONLY when explicitly typed; otherwise
    // fall back to the tenant default. (Bug fix: a booth saved with
    // depositType 'none' or a legacy null percent must NOT block the
    // tenant default — we key off an explicit, non-'none' depositType.)
    const boothType: string | undefined = booth.depositType;
    const usePerSpace = boothType !== undefined && boothType !== null;
    const depositType = usePerSpace ? boothType
      : (rules.depositRequired ? (rules.depositType || 'percent') : 'none');
    const balanceMode = booth.balanceMode || rules.balanceMode || 'in_person'; // 'at_checkin' | 'in_person'

    // Compute the deposit by TYPE. netCents is the amount owed (post-credit).
    let chargeCents = netCents;
    let depositCents = 0;
    let balanceDueCents = 0;
    const hoursBooked = (isHourly && startTime && endTime)
      ? Math.max(0, (new Date(`2000-01-01T${endTime}:00`).getTime() - new Date(`2000-01-01T${startTime}:00`).getTime()) / 3600000)
      : (numDays || 1) * 8;   // day rental ≈ 8 billable hours for break-even math

    if (depositType === 'flat') {
      const flat = usePerSpace ? (Number(booth.depositFlatCents) || 0) : (Number(rules.depositFlatCents) || 0);
      depositCents = Math.min(netCents, Math.max(0, flat));
    } else if (depositType === 'percent') {
      const pct = usePerSpace ? (Number(booth.depositPercent) || 0) : (Number(rules.depositPercent) || 0);
      if (pct > 0 && pct < 100) depositCents = Math.max(100, Math.round(netCents * (pct / 100)));
    } else if (depositType === 'breakeven') {
      // Per-space cost wins; else the studio's TMHR (Total cost per hour
      // from Financial Foundation); else the tenant rule's configured rate.
      let hourly = usePerSpace ? (Number(booth.breakevenHourlyCents) || 0) : 0;
      if (hourly <= 0) {
        const tmhrDollars = Number(tenantData?.tmhr) || 0;   // stored in dollars/hr
        hourly = tmhrDollars > 0 ? Math.round(tmhrDollars * 100) : (Number(rules.breakevenHourlyCents) || 0);
      }
      depositCents = Math.min(netCents, Math.max(0, Math.round(hourly * hoursBooked)));
    }
    // Diagnostic trace — why did we charge what we charged? Stored on the
    // reservation so a "deposit didn't apply" is explainable at a glance.
    const depositTrace = {
      source: usePerSpace ? 'space' : (rules.depositRequired ? 'studio_default' : 'none'),
      resolvedType: depositType,
      boothDepositType: booth.depositType ?? null,
      studioDepositRequired: !!rules.depositRequired,
      tmhr: Number(tenantData?.tmhr) || 0,
      hoursBooked,
      computedDepositCents: depositCents,
      netCents,
    };
    console.log('[reserve] deposit trace', JSON.stringify(depositTrace));

    // Only split if the deposit is a real partial amount
    if (depositCents > 0 && depositCents < netCents && netCents > 100) {
      balanceDueCents = netCents - depositCents;
      chargeCents = depositCents;
    } else {
      depositCents = 0;   // full payment (deposit ≥ total or zero)
    }

    const resRef = db.collection(`tenants/${tenantId}/boothReservations`).doc();
    const nowIso = new Date().toISOString();
    await resRef.set({
      id: resRef.id, tenantId, boothId,
      boothName: booth.name || 'Space',
      locationId: booth.locationId || null,
      name: String(name).slice(0, 120), phone: String(phone || '').slice(0, 40), email: String(email || '').slice(0, 160),
      startDate, endDate, numDays, amountCents: chargeCents,
      originalAmountCents: amountCents,
      netDueCents: netCents,
      depositCents, balanceDueCents,
      balanceMode: balanceDueCents > 0 ? balanceMode : null,
      balancePaid: false,
      depositTrace,
      creditAppliedCents,
      appliedCreditIds,
      stripeCustomerId: null as string | null,
      bookingType: isHourly ? 'hourly' : 'daily',
      slotLabel: slotLabel || null,
      startTime: isHourly ? startTime : null,
      endTime: isHourly ? endTime : null,
      status: 'pending_payment', createdAt: nowIso,
      consentAccepted: !!consentAccepted, consentAcceptedAt: consentAccepted ? nowIso : null,
      // Tranche 1 — compliance captured at booking
      doingServices: !!doingServices,
      licenseNumber: licenseNumber || null,
      insuranceCarrier: insuranceCarrier || null,
      insuranceConfirmed: !!insuranceConfirmed,
      idAcknowledged: !!idAcknowledged,
      licenseDocUrl: licenseDocUrl || null,
      insuranceDocUrl: insuranceDocUrl || null,
      idDocUrl: idDocUrl || null,
      complianceCapturedAt: (doingServices || licenseNumber || insuranceConfirmed || idAcknowledged || licenseDocUrl || insuranceDocUrl || idDocUrl) ? nowIso : null,
    });

    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ ok: false, error: 'Payments are not configured yet (missing Stripe key on the server). Add STRIPE_SECRET_KEY in Vercel → Settings → Environment Variables, then redeploy.' }, { status: 500 });
    }
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
    const base = String(returnUrl).split('?')[0];
    for (const cid of appliedCreditIds) {
      await db.doc(`tenants/${tenantId}/boothCredits/${cid}`).set(
        { status: 'reserved', reservedAt: nowIso, reservedForReservationId: resRef.id }, { merge: true });
    }

    // ── v70 CARD ON FILE (hotel model): every day/hourly booking saves
    // the card to a Stripe Customer for off-session incidental charges
    // (overages, damages). Stripe Checkout shows the card-save consent
    // language automatically when setup_future_usage is set.
    let customerId: string | null = null;
    try {
      if (email) {
        const existing = await stripe.customers.list({ email, limit: 1 });
        customerId = existing.data[0]?.id || null;
      }
      if (!customerId) {
        const created = await stripe.customers.create({
          email: email || undefined, phone: phone || undefined, name: name || undefined,
          metadata: { tenantId },
        });
        customerId = created.id;
      }
    } catch { customerId = null; /* booking must never fail over customer creation */ }

    const session = await stripe.checkout.sessions.create({
      ...(customerId ? { customer: customerId } : {}),
      payment_intent_data: { setup_future_usage: 'off_session' },
      mode: 'payment',
      customer_email: email || undefined,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: chargeCents,
          product_data: {
            name: `${booth.name || 'Space'} — ${unitsLabel}`
              + (depositCents > 0 ? ` (deposit)` : ''),
            description: (isHourly ? `${startDate} · ${startTime}–${endTime}` : `${startDate} → ${endDate}`)
              + (depositCents > 0 ? ` · $${(depositCents / 100).toFixed(2)} deposit of $${(netCents / 100).toFixed(2)} · balance $${(balanceDueCents / 100).toFixed(2)} ${balanceMode === 'at_checkin' ? 'at check-in' : 'in person'}` : '')
              + (creditAppliedCents > 0 ? ` · $${(creditAppliedCents / 100).toFixed(2)} credit applied` : ''),
          },
        },
      }],
      success_url: `${base}?cfReservationId=${resRef.id}&cfSession={CHECKOUT_SESSION_ID}`,
      cancel_url: base,
      metadata: { tenantId, reservationId: resRef.id },
    });
    await resRef.set({ stripeSessionId: session.id, stripeCustomerId: customerId }, { merge: true });
    return NextResponse.json({ ok: true, url: session.url });
  } catch (err: any) {
    console.error('[booth-reserve] POST failed', err);
    const detail = String(err?.raw?.message || err?.message || '').slice(0, 180);
    return NextResponse.json({ ok: false, error: `Could not start checkout${detail ? `: ${detail}` : '.'}` }, { status: 500 });
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
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent'] });
    const pi: any = session.payment_intent;
    const savedPaymentMethodId: string | null = (pi && typeof pi === 'object' && pi.payment_method) ? String(pi.payment_method) : null;
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

    await resRef.set({
      status: 'confirmed', confirmedAt: nowIso,
      stripePaymentIntentId: (typeof session.payment_intent === 'string' ? session.payment_intent : pi?.id) || null,
      stripePaymentMethodId: savedPaymentMethodId,
      cardOnFile: !!savedPaymentMethodId,
    }, { merge: true });
    for (const cid of (r.appliedCreditIds || [])) {
      await db.doc(`tenants/${tenantId}/boothCredits/${cid}`).set(
        { status: 'consumed', consumedAt: nowIso, consumedByReservationId: reservationId }, { merge: true });
    }

    // v54 — REPORT TO LEDGER. Same collection and shape as the service's
    // buildLedgerEntry (tenants/{tid}/transactions), so day-rental income
    // sits beside booth rent in every financial view.
    await writeLedgerTxn(db, tenantId, reservationId, r, (typeof session.payment_intent === 'string' ? session.payment_intent : pi?.id) || null);
    const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
    await nRef.set({ id: nRef.id, type: 'booth_reservation', read: false, createdAt: nowIso, link: '/booths',
      message: `💰 Day rental booked & paid: ${r.name} — ${r.boothName}, ${r.startDate} → ${r.endDate} ($${(r.amountCents / 100).toFixed(2)})` });
    return NextResponse.json({ ok: true, confirmed: true, boothName: r.boothName, startDate: r.startDate, endDate: r.endDate });
  } catch (err) {
    console.error('[booth-reserve] GET failed', err);
    return NextResponse.json({ ok: false, error: 'Could not confirm reservation.' }, { status: 500 });
  }
}

// ── PUT: charge an incidental (overage) to the card on file ──────────────────
// Body: { tenantId, reservationId }
// Charges reservation.overageDueCents off-session to the saved payment
// method. On success: ledger entry + overageStatus 'charged'. On card
// failure (declined/expired): returns the error so the owner falls back
// to in-person collection — the flag stays 'due'.
export async function PUT(req: NextRequest) {
  try {
    const { tenantId, reservationId } = await req.json();
    if (!tenantId || !reservationId) {
      return NextResponse.json({ ok: false, error: 'Missing parameters.' }, { status: 400 });
    }
    const db = getAdminDb();
    const resRef = db.doc(`tenants/${tenantId}/boothReservations/${reservationId}`);
    const snap = await resRef.get();
    if (!snap.exists) return NextResponse.json({ ok: false, error: 'Reservation not found.' }, { status: 404 });
    const r = snap.data() as any;

    if (r.overageStatus !== 'due' || !(r.overageDueCents > 0)) {
      return NextResponse.json({ ok: false, error: 'No overage due on this reservation.' }, { status: 400 });
    }
    if (!r.stripeCustomerId || !r.stripePaymentMethodId) {
      return NextResponse.json({ ok: false, error: 'No card on file for this booking — collect in person.' }, { status: 400 });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
    let intent;
    try {
      intent = await stripe.paymentIntents.create({
        amount: r.overageDueCents,
        currency: 'usd',
        customer: r.stripeCustomerId,
        payment_method: r.stripePaymentMethodId,
        off_session: true,
        confirm: true,
        description: `Overage — ${r.boothName || 'Space'} — ${r.name} (+${r.overageMinutes} min)`,
        metadata: { tenantId, reservationId, kind: 'booth_overage' },
      });
    } catch (err: any) {
      const msg = err?.raw?.message || err?.message || 'Card charge failed.';
      return NextResponse.json({ ok: false, error: `Card charge failed: ${msg} — collect in person instead.` }, { status: 402 });
    }

    const nowIso = new Date().toISOString();
    const txnRef = db.collection(`tenants/${tenantId}/transactions`).doc();
    await txnRef.set({
      id: txnRef.id, type: 'income', context: 'Business', taxBucket: 'revenue',
      amount: r.overageDueCents / 100, category: 'Booth Rent',
      description: `Overage — ${r.boothName || 'Space'} — ${r.name} (+${r.overageMinutes} min)`,
      clientOrVendor: r.name || 'Day renter', date: nowIso, paymentMethod: 'Card on file (Stripe)',
      hasReceipt: false, stripePaymentIntentId: intent.id, sourceId: reservationId, tenantId, createdAt: nowIso,
    });
    await resRef.set({ overageStatus: 'charged', overageChargedAt: nowIso, overagePaymentIntentId: intent.id }, { merge: true });

    return NextResponse.json({ ok: true, chargedCents: r.overageDueCents });
  } catch (err) {
    console.error('[booth-reserve] PUT failed', err);
    return NextResponse.json({ ok: false, error: 'Could not charge overage.' }, { status: 500 });
  }
}
