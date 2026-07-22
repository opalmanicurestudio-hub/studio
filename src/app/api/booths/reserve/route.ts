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
import { logAuditAdmin } from '@/lib/audit';
import { resolveIncidentalPolicy, validateIncidental } from '@/lib/incidentals';

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

// v85 — shared-lease occupancy. A 'partial' booth is bookable, but never
// inside a window a resident renter's lease already owns (scheduleSlot:
// weekday indexes + optional HH:MM window; no times = whole day).
async function leaseSlotConflict(db: FirebaseFirestore.Firestore, tenantId: string, boothId: string, proposed: { startDate: string; endDate: string; bookingType?: string; startTime?: string; endTime?: string }): Promise<string | null> {
  const snap = await db.collection(`tenants/${tenantId}/leases`).where('boothId', '==', boothId).get();
  const slots = snap.docs
    .map((d) => d.data() as any)
    .filter((l) => ['active', 'on_leave', 'pending_signature'].includes(l.status)
      && l.scheduleSlot && Array.isArray(l.scheduleSlot.days) && l.scheduleSlot.days.length > 0)
    .map((l) => l.scheduleSlot);
  if (!slots.length) return null;
  const isHourly = proposed.bookingType === 'hourly' && proposed.startTime && proposed.endTime;
  for (let t = new Date(proposed.startDate + 'T00:00:00Z').getTime(), e = new Date(proposed.endDate + 'T00:00:00Z').getTime(); t <= e; t += DAY_MS) {
    const iso = new Date(t).toISOString().slice(0, 10);
    const dow = new Date(t).getUTCDay();
    for (const s of slots) {
      if (!s.days.includes(dow)) continue;
      const slotStart = s.startTime || '00:00';
      const slotEnd = s.endTime || '23:59';
      if (!isHourly) return `${iso} (a resident renter has that day)`;
      if ((proposed.startTime as string) < slotEnd && slotStart < (proposed.endTime as string)) {
        return `${iso} ${slotStart}–${slotEnd} (a resident renter has that window)`;
      }
    }
  }
  return null;
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
    // v85 — 'partial' booths (shared leases) take guest bookings too, just
    // never inside the resident renters' scheduled windows (checked below).
    if (booth.status !== 'vacant' && booth.status !== 'partial') {
      return NextResponse.json({ ok: false, error: 'This space is no longer available.' }, { status: 409 });
    }
    const leaseClash = await leaseSlotConflict(db, tenantId, boothId, { startDate, endDate, bookingType, startTime, endTime });
    if (leaseClash) {
      return NextResponse.json({ ok: false, error: `That time isn't available — ${leaseClash}.` }, { status: 409 });
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
      ...(customerId ? {} : { customer_email: email || undefined }),
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


// Fetch the exact Stripe fee for a payment intent via its charge's
// balance transaction. Fail-open: fee recording must never block revenue.
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

// Robust fee resolver for OFF-SESSION charges. They settle in the same request,
// so the balance-transaction fee may not be readable yet. Try the expanded
// intent, then a re-fetch, then fall back to an ESTIMATE (US standard 2.9% +
// $0.30) so the processing-fee expense is NEVER silently dropped.
async function resolveFeeCents(intent: any, grossCents: number): Promise<{ feeCents: number; chargeId: string | null; estimated: boolean }> {
  const charge: any = intent?.latest_charge;
  let chargeId: string | null = (charge && typeof charge === 'object') ? (charge.id || null) : (typeof charge === 'string' ? charge : null);
  const bt: any = (charge && typeof charge === 'object') ? charge.balance_transaction : null;
  let fee = (bt && typeof bt === 'object') ? (Number(bt.fee) || 0) : 0;
  if (!fee && intent?.id) {
    const r = await stripeFeeFor(intent.id);
    fee = r.feeCents; chargeId = chargeId || r.chargeId;
  }
  if (!fee && grossCents > 0) return { feeCents: Math.round(grossCents * 0.029) + 30, chargeId, estimated: true };
  return { feeCents: fee, chargeId, estimated: false };
}

// Canonical Transaction shape (verified against the Ledger page):
// amount in DOLLARS, required type 'income'.
async function writeLedgerTxn(db: FirebaseFirestore.Firestore, tenantId: string, reservationId: string, r: any, paymentIntentId: string | null) {
  const txnRef = db.collection(`tenants/${tenantId}/transactions`).doc();
  const nowIso = new Date().toISOString();
  const { feeCents, chargeId } = await stripeFeeFor(paymentIntentId);
  await txnRef.set({
    id:                    txnRef.id,
    type:                  'income',
    context:               'Business',
    taxBucket:             'revenue',
    // v74 — REQUIRED: every booth ledger view filters on this field;
    // without it, paid bookings were invisible in the booth Money tab.
    source:                'booth_rent',
    amount:                (r.amountCents || 0) / 100,
    stripeFeeCents:        feeCents || null,
    netAmountCents:        feeCents ? (r.amountCents || 0) - feeCents : null,
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
    stripeChargeId:        chargeId,
    sourceId:              reservationId,
    tenantId,
    createdAt:             nowIso,
  });

  // Paired expense: the processing fee Stripe deducts before payout.
  // Without this the P&L overstates revenue and the fee disappears.
  if (feeCents > 0) {
    const feeRef = db.collection(`tenants/${tenantId}/transactions`).doc();
    await feeRef.set({
      id: feeRef.id,
      type: 'expense',
      context: 'Business',
      taxBucket: 'operating_cost',
      amount: feeCents / 100,
      category: 'Processing Fee',
      description: `Stripe fee — ${r.bookingType === 'hourly' ? 'hourly' : 'day'} rental — ${r.boothName || 'Space'} (${r.name})`,
      clientOrVendor: 'Stripe',
      date: nowIso,
      paymentMethod: 'Deducted from payout',
      hasReceipt: false,
      stripePaymentIntentId: paymentIntentId,
      stripeChargeId: chargeId,
      sourceId: reservationId,
      relatedTxnId: txnRef.id,
      tenantId,
      createdAt: nowIso,
    });
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
    const conflicted = await findConflict(db, tenantId, r.boothId, { startDate: r.startDate, endDate: r.endDate, bookingType: r.bookingType, startTime: r.startTime, endTime: r.endTime }, reservationId)
      || !!(await leaseSlotConflict(db, tenantId, r.boothId, { startDate: r.startDate, endDate: r.endDate, bookingType: r.bookingType, startTime: r.startTime, endTime: r.endTime }));
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
    await logAuditAdmin(db, tenantId, {
      action: 'booth.booking_paid', targetType: 'boothReservation', targetId: reservationId,
      summary: `Booking paid via Stripe: ${r.name || 'guest'} · ${r.boothName || 'space'} (${r.startDate}${r.endDate !== r.startDate ? ` → ${r.endDate}` : ''})${(r.creditAppliedCents || 0) > 0 ? ` · $${((r.creditAppliedCents || 0) / 100).toFixed(2)} credit applied` : ''}`,
      amount: (r.amountCents || 0) / 100, actor: { type: 'system', name: 'booth-checkout' },
    });
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
        expand: ['latest_charge.balance_transaction'],
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
      source: 'booth_rent',
      amount: r.overageDueCents / 100, category: 'Booth Rent',
      description: `Overage — ${r.boothName || 'Space'} — ${r.name} (+${r.overageMinutes} min)`,
      clientOrVendor: r.name || 'Day renter', date: nowIso, paymentMethod: 'Card on file (Stripe)',
      hasReceipt: false, stripePaymentIntentId: intent.id, sourceId: reservationId, tenantId, createdAt: nowIso,
    });
    // Paired Stripe processing-fee expense — resolved robustly so it's never dropped.
    {
      const { feeCents, chargeId, estimated } = await resolveFeeCents(intent, r.overageDueCents);
      if (feeCents > 0) {
        const feeRef = db.collection(`tenants/${tenantId}/transactions`).doc();
        await feeRef.set({
          id: feeRef.id, type: 'expense', context: 'Business', taxBucket: 'operating_cost',
          amount: feeCents / 100, category: 'Processing Fee', estimated,
          description: `Stripe fee${estimated ? ' (est.)' : ''} — overage — ${r.boothName || 'Space'} (${r.name})`,
          clientOrVendor: 'Stripe', date: nowIso, paymentMethod: 'Deducted from payout',
          hasReceipt: false, stripePaymentIntentId: intent.id, stripeChargeId: chargeId,
          sourceId: reservationId, relatedTxnId: txnRef.id, tenantId, createdAt: nowIso,
        });
      }
    }
    // v74 — removed: this block was an exact DUPLICATE of the fee write
    // above, double-counting the Stripe fee expense on every overage charge.

    await resRef.set({ overageStatus: 'charged', overageChargedAt: nowIso, overagePaymentIntentId: intent.id }, { merge: true });

    return NextResponse.json({ ok: true, chargedCents: r.overageDueCents });
  } catch (err) {
    console.error('[booth-reserve] PUT failed', err);
    return NextResponse.json({ ok: false, error: 'Could not charge overage.' }, { status: 500 });
  }
}


// ── PATCH: real Stripe refund for a paid reservation ─────────────────────────
// v74 — replaces the old "Mark Refunded" status flip, which moved no money
// and left the ledger permanently showing income for refunded stays.
// Body: { tenantId, reservationId, amountCents?, reason?, actor? }
//   amountCents — optional partial refund; defaults to the full charge.
// Does, atomically in sequence with idempotency guards:
//   1. stripe.refunds.create against the booking's PaymentIntent
//   2. ledger reversal (type 'reversal', category 'Refunds', source
//      'booth_rent') so booth income reports stay truthful
//   3. reservation → status 'refunded' with the Stripe refund id
//   4. audit entry naming who refunded and why
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { tenantId, reservationId, reason } = body || {};
    if (!tenantId) {
      return NextResponse.json({ ok: false, error: 'Missing parameters.' }, { status: 400 });
    }
    const db = getAdminDb();

    // ── LEASE INCIDENTAL (action:'lease_incidental') — charge a MONTHLY resident
    // renter's card on file (damage, cleaning, lost key, product), governed by
    // the SAME capped policy as day/hourly renters. Keyed by leaseId, not a
    // reservation. Records income + paired Stripe fee, appends to the lease's
    // incidentals log, and audits. Off-session + confirmed.
    if (body.action === 'lease_incidental') {
      const leaseId = String(body.leaseId || '').trim();
      if (!leaseId) return NextResponse.json({ ok: false, error: 'Missing lease.' }, { status: 400 });
      const amountCents = Math.round(Number(body.amountCents) || 0);
      const leaseRef = db.doc(`tenants/${tenantId}/leases/${leaseId}`);
      const leaseSnap = await leaseRef.get();
      if (!leaseSnap.exists) return NextResponse.json({ ok: false, error: 'Lease not found.' }, { status: 404 });
      const lease = leaseSnap.data() as any;
      const renterName = lease.renterName || lease.name || 'Renter';
      const boothName = lease.boothName || 'Space';
      if (!lease.stripeCustomerId || !lease.stripePaymentMethodId) {
        return NextResponse.json({ ok: false, error: 'No card on file for this renter yet — it’s saved the first time they pay rent online. Collect in person for now.' }, { status: 400 });
      }
      // Same single-source-of-truth policy the day/hourly path and lease use.
      const cats = resolveIncidentalPolicy((await db.doc(`tenants/${tenantId}`).get()).data());
      const v = validateIncidental(cats, String(body.category || body.description || ''), amountCents, String(body.note || ''));
      if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: v.status });
      const description = v.description;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
      let intent;
      try {
        intent = await stripe.paymentIntents.create({
          amount: amountCents, currency: 'usd',
          customer: lease.stripeCustomerId, payment_method: lease.stripePaymentMethodId,
          off_session: true, confirm: true,
          expand: ['latest_charge.balance_transaction'],
          description: `Incidental — ${boothName} — ${renterName}: ${description}`,
          metadata: { tenantId, leaseId, kind: 'lease_incidental' },
        });
      } catch (err: any) {
        const msg = err?.raw?.message || err?.message || 'Card charge failed.';
        // Card decline is NOT a suspension — the renter keeps their space; the
        // owner just collects another way. (Same non-punitive posture as overages.)
        return NextResponse.json({ ok: false, error: `Card charge failed: ${msg} — collect another way; the renter is not affected.` }, { status: 402 });
      }
      const nowIso = new Date().toISOString();
      const txnRef = db.collection(`tenants/${tenantId}/transactions`).doc();
      await txnRef.set({
        id: txnRef.id, type: 'income', context: 'Business', taxBucket: 'revenue', source: 'booth_rent',
        amount: amountCents / 100, category: 'Renter Incidental',
        description: `Incidental — ${boothName} — ${renterName}: ${description}`,
        clientOrVendor: renterName, date: nowIso, paymentMethod: 'Card on file (Stripe)',
        hasReceipt: false, stripePaymentIntentId: intent.id, sourceId: leaseId, tenantId, createdAt: nowIso,
      });
      try {
        const { feeCents, chargeId, estimated } = await resolveFeeCents(intent, amountCents);
        if (feeCents > 0) {
          const feeRef = db.collection(`tenants/${tenantId}/transactions`).doc();
          await feeRef.set({
            id: feeRef.id, type: 'expense', context: 'Business', taxBucket: 'operating_cost',
            amount: feeCents / 100, category: 'Processing Fee', estimated,
            description: `Stripe fee${estimated ? ' (est.)' : ''} — incidental — ${boothName} (${renterName})`,
            clientOrVendor: 'Stripe', date: nowIso, paymentMethod: 'Deducted from payout',
            hasReceipt: false, stripePaymentIntentId: intent.id, stripeChargeId: chargeId,
            sourceId: leaseId, relatedTxnId: txnRef.id, tenantId, createdAt: nowIso,
          });
        }
      } catch { /* fee accounting is best-effort */ }
      const list = Array.isArray(lease.incidentals) ? lease.incidentals : [];
      list.push({ amountCents, description, at: nowIso, paymentIntentId: intent.id });
      await leaseRef.set({ incidentals: list, incidentalsTotalCents: (lease.incidentalsTotalCents || 0) + amountCents }, { merge: true });
      await logAuditAdmin(db, tenantId, {
        action: 'booth.incidental_charged', targetType: 'lease', targetId: leaseId,
        summary: `Incidental charged: ${renterName} · ${boothName} — ${description} ($${(amountCents / 100).toFixed(2)})`,
        amount: amountCents / 100, actor: { type: 'system', name: 'lease-incidental' },
      });
      return NextResponse.json({ ok: true, chargedCents: amountCents });
    }

    if (!reservationId) {
      return NextResponse.json({ ok: false, error: 'Missing parameters.' }, { status: 400 });
    }
    const resRef = db.doc(`tenants/${tenantId}/boothReservations/${reservationId}`);
    const snap = await resRef.get();
    if (!snap.exists) return NextResponse.json({ ok: false, error: 'Reservation not found.' }, { status: 404 });
    const r = snap.data() as any;

    // ── INCIDENTAL (action:'incidental') — charge an arbitrary amount (damage,
    // cleaning, lost key, product) to the reservation's card on file, hotel-
    // style. Off-session + confirmed; records to the ledger with a paired
    // Stripe-fee expense, and appends to the reservation's incidentals log.
    if (body.action === 'incidental') {
      const amountCents = Math.round(Number(body.amountCents) || 0);
      if (!r.stripeCustomerId || !r.stripePaymentMethodId) {
        return NextResponse.json({ ok: false, error: 'No card on file for this booking — collect in person.' }, { status: 400 });
      }
      // ── Incidentals policy — no made-up charges. Only owner-defined charge
      // types are allowed, and each is capped. Validated HERE (server) via the
      // shared policy module so it holds even if the UI is bypassed, and stays
      // in lockstep with the monthly-renter path and the signed lease.
      const cats = resolveIncidentalPolicy((await db.doc(`tenants/${tenantId}`).get()).data());
      const v = validateIncidental(cats, String(body.category || body.description || ''), amountCents, String(body.note || ''));
      if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: v.status });
      const description = v.description;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
      let intent;
      try {
        intent = await stripe.paymentIntents.create({
          amount: amountCents, currency: 'usd',
          customer: r.stripeCustomerId, payment_method: r.stripePaymentMethodId,
          off_session: true, confirm: true,
          expand: ['latest_charge.balance_transaction'],
          description: `Incidental — ${r.boothName || 'Space'} — ${r.name}: ${description}`,
          metadata: { tenantId, reservationId, kind: 'booth_incidental' },
        });
      } catch (err: any) {
        const msg = err?.raw?.message || err?.message || 'Card charge failed.';
        return NextResponse.json({ ok: false, error: `Card charge failed: ${msg} — collect in person instead.` }, { status: 402 });
      }
      const nowIso = new Date().toISOString();
      const txnRef = db.collection(`tenants/${tenantId}/transactions`).doc();
      await txnRef.set({
        id: txnRef.id, type: 'income', context: 'Business', taxBucket: 'revenue', source: 'booth_rent',
        amount: amountCents / 100, category: 'Renter Incidental',
        description: `Incidental — ${r.boothName || 'Space'} — ${r.name}: ${description}`,
        clientOrVendor: r.name || 'Day renter', date: nowIso, paymentMethod: 'Card on file (Stripe)',
        hasReceipt: false, stripePaymentIntentId: intent.id, sourceId: reservationId, tenantId, createdAt: nowIso,
      });
      try {
        const { feeCents, chargeId, estimated } = await resolveFeeCents(intent, amountCents);
        if (feeCents > 0) {
          const feeRef = db.collection(`tenants/${tenantId}/transactions`).doc();
          await feeRef.set({
            id: feeRef.id, type: 'expense', context: 'Business', taxBucket: 'operating_cost',
            amount: feeCents / 100, category: 'Processing Fee', estimated,
            description: `Stripe fee${estimated ? ' (est.)' : ''} — incidental — ${r.boothName || 'Space'} (${r.name})`,
            clientOrVendor: 'Stripe', date: nowIso, paymentMethod: 'Deducted from payout',
            hasReceipt: false, stripePaymentIntentId: intent.id, stripeChargeId: chargeId,
            sourceId: reservationId, relatedTxnId: txnRef.id, tenantId, createdAt: nowIso,
          });
        }
      } catch { /* fee accounting is best-effort */ }
      const list = Array.isArray(r.incidentals) ? r.incidentals : [];
      list.push({ amountCents, description, at: nowIso, paymentIntentId: intent.id });
      await resRef.set({ incidentals: list, incidentalsTotalCents: (r.incidentalsTotalCents || 0) + amountCents }, { merge: true });
      await logAuditAdmin(db, tenantId, {
        action: 'booth.incidental_charged', targetType: 'boothReservation', targetId: reservationId,
        summary: `Incidental charged: ${r.name || 'guest'} · ${r.boothName || 'space'} — ${description} ($${(amountCents / 100).toFixed(2)})`,
        amount: amountCents / 100, actor: { type: 'system', name: 'booth-incidental' },
      });
      return NextResponse.json({ ok: true, chargedCents: amountCents });
    }

    // ── v85: RESCHEDULE (action:'reschedule') — same length, new time, ─────
    // conflict-checked against other bookings AND resident-renter slots.
    if (body.action === 'reschedule') {
      if (r.status !== 'confirmed') {
        return NextResponse.json({ ok: false, error: `A ${String(r.status).replace(/_/g, ' ')} reservation can't be rescheduled — cancel and rebook instead.` }, { status: 400 });
      }
      const startDate = String(body.startDate || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
        return NextResponse.json({ ok: false, error: 'Invalid date.' }, { status: 400 });
      }
      const isHourly = r.bookingType === 'hourly';
      // Daily: omitting endDate keeps the same length automatically.
      let endDate = String(body.endDate || '').slice(0, 10);
      if (!endDate || isHourly) {
        if (isHourly) endDate = startDate;
        else {
          const n = (r.numDays || daysInclusive(r.startDate, r.endDate)) - 1;
          const t = new Date(startDate + 'T00:00:00Z');
          t.setUTCDate(t.getUTCDate() + n);
          endDate = t.toISOString().slice(0, 10);
        }
      }
      if (endDate < startDate) return NextResponse.json({ ok: false, error: 'Invalid dates.' }, { status: 400 });
      const startTime = isHourly ? String(body.startTime || r.startTime || '') : null;
      const endTime = isHourly ? String(body.endTime || r.endTime || '') : null;
      if (isHourly && (!/^\d{2}:\d{2}$/.test(startTime || '') || !/^\d{2}:\d{2}$/.test(endTime || '') || (startTime as string) >= (endTime as string))) {
        return NextResponse.json({ ok: false, error: 'Invalid time range.' }, { status: 400 });
      }
      // Same-length rule: a different duration is a different price —
      // that's a cancel-and-rebook (refund path), not a reschedule.
      const newDays = daysInclusive(startDate, endDate);
      if (!isHourly && newDays !== (r.numDays || daysInclusive(r.startDate, r.endDate))) {
        return NextResponse.json({ ok: false, error: 'Reschedules keep the same number of days — for a different length, cancel (refund) and rebook.' }, { status: 400 });
      }
      if (isHourly) {
        const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
        if (mins(endTime as string) - mins(startTime as string) !== mins(r.endTime) - mins(r.startTime)) {
          return NextResponse.json({ ok: false, error: 'Reschedules keep the same duration — for a different length, cancel (refund) and rebook.' }, { status: 400 });
        }
      }
      // The owner's declared schedule is still law on the new dates.
      const boothSnap = await db.doc(`tenants/${tenantId}/booths/${r.boothId}`).get();
      const booth = boothSnap.exists ? (boothSnap.data() as any) : {};
      const schedDays: number[] | undefined = Array.isArray(booth.dayRentalDays) ? booth.dayRentalDays : undefined;
      const blackouts: string[] = Array.isArray(booth.blackoutDates) ? booth.blackoutDates : [];
      for (let t = new Date(startDate + 'T00:00:00Z').getTime(), e = new Date(endDate + 'T00:00:00Z').getTime(); t <= e; t += DAY_MS) {
        const iso = new Date(t).toISOString().slice(0, 10);
        const dow = new Date(t).getUTCDay();
        if (schedDays && schedDays.length > 0 && !schedDays.includes(dow)) {
          return NextResponse.json({ ok: false, error: `This space isn't available on ${iso}.` }, { status: 400 });
        }
        if (blackouts.includes(iso)) {
          return NextResponse.json({ ok: false, error: `${iso} is unavailable.` }, { status: 400 });
        }
      }
      if (isHourly) {
        const openT = booth.openTime || '00:00';
        const closeT = booth.closeTime || '23:59';
        if ((startTime as string) < openT || (endTime as string) > closeT) {
          return NextResponse.json({ ok: false, error: `Hourly bookings are available ${openT} – ${closeT}.` }, { status: 400 });
        }
      }
      const proposed = { startDate, endDate, bookingType: r.bookingType, startTime: startTime || undefined, endTime: endTime || undefined };
      if (await findConflict(db, tenantId, r.boothId, proposed, reservationId)) {
        return NextResponse.json({ ok: false, error: 'That time is already booked — pick another.' }, { status: 409 });
      }
      const slotClash = await leaseSlotConflict(db, tenantId, r.boothId, proposed);
      if (slotClash) {
        return NextResponse.json({ ok: false, error: `That time isn't available — ${slotClash}.` }, { status: 409 });
      }
      const nowIso = new Date().toISOString();
      const prev = { startDate: r.startDate, endDate: r.endDate, startTime: r.startTime || null, endTime: r.endTime || null };
      await resRef.set({
        startDate, endDate,
        startTime: startTime || null, endTime: endTime || null,
        numDays: newDays,
        rescheduledAt: nowIso,
        rescheduleCount: (r.rescheduleCount || 0) + 1,
        prevSchedule: prev,
        rescheduleRequestedAt: null,
        rescheduleRequestNote: null,
      }, { merge: true });
      const fmt = (d: string, s?: string | null, e2?: string | null) => (s ? `${d} ${s}–${e2}` : d);
      await logAuditAdmin(db, tenantId, {
        action: 'booth.rescheduled', targetType: 'boothReservation', targetId: reservationId,
        summary: `${r.name || 'Guest'}'s ${r.boothName || 'space'} booking moved: ${fmt(prev.startDate, prev.startTime, prev.endTime)} → ${fmt(startDate, startTime, endTime)}`,
        before: prev, after: { startDate, endDate, startTime, endTime },
        actor: { type: 'user', name: body.actorName || 'Owner', via: 'booths-page' },
      });
      const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
      await nRef.set({
        id: nRef.id, userId: null, read: false, createdAt: nowIso,
        type: 'booth_reservation', link: '/booths',
        message: `${r.name || 'A guest'}'s booking moved to ${fmt(startDate, startTime, endTime)} (${r.boothName || 'space'}).`,
      });
      return NextResponse.json({ ok: true, startDate, endDate, startTime, endTime });
    }

    if (r.status === 'refunded') {
      // Idempotent: repeat calls succeed without double-refunding.
      return NextResponse.json({ ok: true, refundedCents: r.refundedCents || 0, alreadyRefunded: true });
    }
    const REFUNDABLE = ['confirmed', 'checked_in', 'completed', 'cancel_requested', 'cancelled_refund_pending', 'payment_received_conflict'];
    if (!REFUNDABLE.includes(r.status)) {
      return NextResponse.json({ ok: false, error: `A ${String(r.status).replace(/_/g, ' ')} reservation can't be refunded.` }, { status: 400 });
    }
    if (!r.stripePaymentIntentId) {
      return NextResponse.json({ ok: false, error: 'No Stripe payment on this reservation — record the refund manually in the ledger.' }, { status: 400 });
    }
    const paidCents = Number(r.amountCents) || 0;
    const requested = Number(body.amountCents) || paidCents;
    const refundCents = Math.min(Math.max(0, Math.round(requested)), paidCents);
    if (refundCents <= 0) return NextResponse.json({ ok: false, error: 'Nothing to refund.' }, { status: 400 });

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
    let refund;
    try {
      refund = await stripe.refunds.create({
        payment_intent: r.stripePaymentIntentId,
        amount: refundCents,
        metadata: { tenantId, reservationId, kind: 'booth_refund' },
      });
    } catch (err: any) {
      const msg = err?.raw?.message || err?.message || 'Refund failed.';
      return NextResponse.json({ ok: false, error: `Stripe refund failed: ${msg}` }, { status: 402 });
    }

    const nowIso = new Date().toISOString();
    const txnRef = db.collection(`tenants/${tenantId}/transactions`).doc();
    await txnRef.set({
      id: txnRef.id, type: 'reversal', context: 'Business', taxBucket: 'refund',
      source: 'booth_rent',
      amount: refundCents / 100, category: 'Refunds',
      description: `Refund — ${r.boothName || 'Space'} — ${r.name || 'guest'}${reason ? ` (${String(reason).slice(0, 120)})` : ''}`,
      clientOrVendor: r.name || 'Day renter', date: nowIso, paymentMethod: 'Card (Stripe refund)',
      hasReceipt: false, stripePaymentIntentId: r.stripePaymentIntentId, stripeRefundId: refund.id,
      sourceId: reservationId, tenantId, createdAt: nowIso,
    });
    await resRef.set({
      status: 'refunded', refundedAt: nowIso,
      refundedCents: refundCents, stripeRefundId: refund.id,
      refundReason: reason ? String(reason).slice(0, 300) : null,
    }, { merge: true });

    const actor = (body?.actor && body.actor.type === 'user')
      ? { type: 'user' as const, id: body.actor.id || undefined, name: body.actor.name || undefined, role: body.actor.role || undefined }
      : { type: 'user' as const };
    await logAuditAdmin(db, tenantId, {
      action: 'booth.refunded', targetType: 'boothReservation', targetId: reservationId,
      summary: `Refunded ${refundCents === paidCents ? 'in full' : `$${(refundCents / 100).toFixed(2)} of $${(paidCents / 100).toFixed(2)}`}: ${r.name || 'guest'} · ${r.boothName || 'space'}${reason ? ` — ${String(reason).slice(0, 80)}` : ''} · Stripe ${refund.id}`,
      amount: refundCents / 100, actor,
    });

    return NextResponse.json({ ok: true, refundedCents: refundCents, stripeRefundId: refund.id });
  } catch (err) {
    console.error('[booth-reserve] PATCH failed', err);
    return NextResponse.json({ ok: false, error: 'Could not process refund.' }, { status: 500 });
  }
}
