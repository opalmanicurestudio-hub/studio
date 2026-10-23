import { NextRequest, NextResponse } from 'next/server';
import { verifyStaffActor } from '@/lib/staff-auth';
import Stripe from 'stripe';
import { createHash } from 'crypto';

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
// separate step" is more workflow than the moment calls for.
//
// ONCE PER ATTEMPT, ONE BOOKING PER TIME:
//   - The screen names each attempt (a key it keeps while it retries), and the
//     booking is named after it before anything is charged. A second tap, or
//     asking again after no answer, is the same booking and the same charge.
//   - The station keeps a list of what's booked on it for each day
//     (stationSlots/{boothId}_{date}), read and written in the same step that
//     holds the time. Two people booking the same or overlapping times at the
//     same moment can't both get it: the second one finds it taken. Each booking
//     on the list is read too, so one cancelled since doesn't keep the time.
//   - The charge has one key, named after the booking, its amount and card. Stripe
//     saying no frees the time; no answer keeps it held (the charge may have gone
//     through), and the same attempt asked again finishes it.
//   - The booking's lines in the books are named after it and written with its
//     confirmation, in one step.
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
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
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
  return { db: getFirestore(app), FieldValue };
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

const safeKey = (v: any) => String(v || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
const CLAIM_MS = 2 * 60_000;
const freshClaim = (at: any) => !!at && Date.now() - (Date.parse(String(at)) || 0) < CLAIM_MS;
// Stripe said no (nothing moved) — as against no answer at all (it may have gone through).
const stripeRefused = (e: any) => ['StripeCardError', 'StripeInvalidRequestError', 'StripePermissionError', 'StripeAuthenticationError'].includes(String(e?.type || ''));

// A booking keeps its time while it's confirmed, while its charge is going through (or Stripe didn't answer, so it may
// have gone through), and while it waits on the renter's bank for the hold window.
const holdsTime = (b: any, nowIso: string) => ['confirmed', 'checked_in'].includes(String(b?.status || ''))
  || (b?.status === 'held' && (!!b.chargeClaimAt || (!!b.holdExpiresAt && String(b.holdExpiresAt) > nowIso)));

// The days a booking touches, start day to end day, for the station's day lists.
function daysOf(startAt: string, endAt: string): string[] {
  const first = String(startAt).slice(0, 10), last = String(endAt).slice(0, 10);
  const out: string[] = []; let t = Date.parse(`${first}T00:00:00Z`);
  if (!Number.isFinite(t)) return out;
  for (let i = 0; i < 32; i++) { const d = new Date(t).toISOString().slice(0, 10); out.push(d); if (d >= last) break; t += 86_400_000; }
  return out;
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
  // Charges a saved card — staff of this business (or our own server) only.
  {
    const secret = process.env.CRON_SECRET;
    const internal = !!secret && req.headers.get('x-cf-internal') === secret;
    const staff = !internal && (req.headers.get('authorization') || '').toLowerCase().startsWith('bearer ')
      ? await verifyStaffActor(req, String(tenantId || '')).then((a: any) => !!a?.ok).catch(() => false) : false;
    if (!internal && !staff) return NextResponse.json({ ok: false, error: 'Sign in to book and charge a station.', code: 'unauthorized' }, { status: 401 });
  }

  if (!tenantId || !locationId || !boothId || !renterId || !startAt || !endAt) {
    return NextResponse.json(
      { error: 'Missing tenantId, locationId, boothId, renterId, startAt, or endAt' },
      { status: 400 }
    );
  }
  if (!Number.isFinite(new Date(startAt).getTime()) || !Number.isFinite(new Date(endAt).getTime()) || new Date(startAt).getTime() >= new Date(endAt).getTime()) {
    return NextResponse.json({ error: 'endAt must be after startAt' }, { status: 400 });
  }

  const { db, FieldValue } = getAdmin();

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
    // Refuse a booking at a location that's been set inactive.
    try {
      const locSnap = await db.doc(`tenants/${tenantId}/locations/${String(locationId)}`).get();
      if (locSnap.exists && (locSnap.data() as any)?.isActive === false) {
        return NextResponse.json({ error: 'That location is closed and not taking bookings.' }, { status: 409 });
      }
    } catch { /* no location doc — the booth check below still applies */ }
    const renter = renterSnap.data();
    const stripeAccountId = tenantSnap.data()?.stripeAccountId;
    if (!stripeAccountId) {
      return NextResponse.json({ ok: false, reason: 'No connected payment account. Configure Stripe in Settings.' });
    }

    // ── What a NEW booking needs (an attempt already under way is finished as it started) ──
    const hours = (new Date(endAt).getTime() - new Date(startAt).getTime()) / 3_600_000;
    const totalCents =
      rateType === 'daily'
        ? booth.dayUseDailyCents ?? 0
        : Math.round((booth.dayUseHourlyCents ?? 0) * hours);
    const bufferMinutes = booth.dayUseBufferMinutes ?? 0;
    const minHours = booth.dayUseMinHours ?? 0;
    let problem: any = null;
    if (!booth.dayUseEnabled) problem = { ok: false, reason: 'This booth is not set up for day-use booking.' };
    else if (!renter.stripeCustomerId || !renter.defaultPaymentMethodId) problem = { ok: false, reason: 'This renter has no card on file. Send a card-setup link or use the guest booking flow.', code: 'no_card_on_file' };
    else if (totalCents <= 0) problem = { ok: false, reason: 'This booth has no day-use rate configured for that duration.' };
    else if (minHours > 0 && hours < minHours) problem = { ok: false, reason: `Minimum booking length is ${minHours} hour(s).` };

    // ── This attempt's booking, named before anything is charged ──────────
    // The screen sends its attempt key (kept while it retries); a caller that sends none gets one named after the
    // booth, renter and time, so the same request twice is still one booking.
    const attempt = safeKey(parsed.attemptKey).slice(0, 80)
      || createHash('sha256').update(`${boothId}|${renterId}|${startAt}|${endAt}|${rateType}`).digest('hex').slice(0, 32);
    const bookingRef = db.doc(`tenants/${tenantId}/bookings/sb_${attempt}`);
    const slotRef = (bId: string, day: string) => db.doc(`tenants/${tenantId}/stationSlots/${safeKey(bId)}_${day}`);
    const nowISO = new Date().toISOString();
    const leasesQ = db.collection(`tenants/${tenantId}/leases`).where('boothId', '==', boothId).where('status', 'in', ['active', 'on_leave', 'pending_signature']);
    const bookingsQ = db.collection(`tenants/${tenantId}/bookings`).where('boothId', '==', boothId);

    // ── The claim, in one step: the station's day lists, leases and other bookings are read, and the time is held
    //    on the station and in the booking together. This is the actual double-booking guard — everything upstream
    //    is UX-only convenience. ──
    const claim: any = await db.runTransaction(async (tx: any) => {
      const bs = await tx.get(bookingRef);
      if (bs.exists) {
        const cur: any = bs.data() || {};
        if (cur.status === 'cancelled') return { ended: cur };
        if (cur.status !== 'held') return { done: cur };
        if (freshClaim(cur.chargeClaimAt)) return { busy: true };
        // Asked again (no answer last time, or waiting on the bank): the same booking, the same charge.
        tx.set(bookingRef, { chargeClaimAt: nowISO, updatedAt: nowISO }, { merge: true });
        return { b: cur, retry: true };
      }
      if (problem) return { problem };
      const dayRefs = daysOf(startAt, endAt).map((d) => slotRef(boothId, d));
      const [leaseSnap, bookingsSnap] = await Promise.all([tx.get(leasesQ), tx.get(bookingsQ)]);
      const days: any[] = []; for (const r of dayRefs) days.push(await tx.get(r));
      const listed = new Set<string>();
      for (const d of days) for (const [bid, e] of Object.entries<any>((d.data() || {}).holds || {})) {
        if (bid !== bookingRef.id && e?.startAt && e?.endAt && rangesOverlap(startAt, endAt, e.startAt, e.endAt, bufferMinutes)) listed.add(bid);
      }
      const others: any[] = []; for (const bid of listed) others.push(await tx.get(db.doc(`tenants/${tenantId}/bookings/${bid}`)));

      let conflict = false;
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
        for (const bDoc of bookingsSnap.docs) {
          const b = bDoc.data();
          if (bDoc.id !== bookingRef.id && holdsTime(b, nowISO) && rangesOverlap(startAt, endAt, b.startAt, b.endAt, bufferMinutes)) { conflict = true; break; }
        }
      }
      if (!conflict) conflict = others.some((s) => s.exists && holdsTime(s.data(), nowISO));
      if (conflict) return { conflict: true };

      const b = {
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
        // The charge this booking is for, kept so asking again sends exactly the same one.
        attemptKey: attempt,
        chargeClaimAt: nowISO,
        chargeCents: totalCents,
        chargePm: String(renter.defaultPaymentMethodId),
        chargeCustomer: String(renter.stripeCustomerId),
        chargeMode: mode === 'auto' ? 'auto' : 'pos',
        chargeDescription: `Day-use booking — ${booth.name}`,
        renterName: `${renter.firstName} ${renter.lastName}`,
      };
      tx.set(bookingRef, b);
      for (const r of dayRefs) tx.set(r, { boothId, holds: { [bookingRef.id]: { startAt, endAt } } }, { merge: true });
      return { b, retry: false };
    });

    if (claim.problem) return NextResponse.json(claim.problem);
    if (claim.conflict) {
      return NextResponse.json({
        ok: false,
        reason: 'That slot is no longer available.',
        code: 'slot_conflict',
      });
    }
    if (claim.busy) return NextResponse.json({ ok: false, reason: 'This booking is going through already. Give it a moment.', code: 'in_progress' }, { status: 409 });
    if (claim.done) return NextResponse.json({ ok: true, bookingId: bookingRef.id, paymentIntentId: claim.done.stripePaymentIntentId || null, totalCents: Number(claim.done.totalCents) || 0, already: true });
    if (claim.ended) {
      return NextResponse.json({ ok: false, reason: claim.ended.cancellationMessage || 'This booking didn’t go through, so nothing was charged.', code: claim.ended.cancellationReason || 'cancelled' },
        { status: claim.ended.cancellationReason === 'card_declined' ? 402 : 200 });
    }

    const b: any = claim.b;
    const cents = Number(b.chargeCents) || 0;
    const stripe = getStripe();
    // Stripe said no: the booking ends and its time is free again.
    const release = async (why: string, message: string) => {
      const dayRefs = daysOf(b.startAt, b.endAt).map((d) => slotRef(b.boothId, d));
      const at = new Date().toISOString();
      await db.runTransaction(async (tx: any) => {
        const cur: any = (await tx.get(bookingRef)).data() || {};
        if (cur.status !== 'held') return;
        tx.set(bookingRef, { status: 'cancelled', cancelledAt: at, cancellationReason: why, cancellationMessage: message, chargeClaimAt: null, holdExpiresAt: null, updatedAt: at }, { merge: true });
        for (const r of dayRefs) tx.set(r, { holds: { [bookingRef.id]: FieldValue.delete() } }, { merge: true });
      }).catch(() => {});
    };

    // ── The charge: one key for this booking, amount and card ──────────────
    let intent: any = null;
    if (claim.retry) {
      // Asked again: the payment Stripe already has for this booking (waiting on the bank, or one whose answer was
      // lost) is looked at first, never sent again.
      try {
        if (b.stripePaymentIntentId) intent = await stripe.paymentIntents.retrieve(String(b.stripePaymentIntentId), {}, { stripeAccount: stripeAccountId });
        else {
          const l: any = await stripe.paymentIntents.list({ customer: String(b.chargeCustomer), limit: 20 }, { stripeAccount: stripeAccountId });
          intent = (Array.isArray(l?.data) ? l.data : []).find((x: any) => x?.metadata?.bookingId === bookingRef.id) || null;
        }
      } catch { intent = null; /* asked for below, under the booking's own key */ }
    }
    if (!intent) {
      try {
        intent = await stripe.paymentIntents.create(
          {
            amount: cents,
            currency: 'usd',
            customer: String(b.chargeCustomer),
            payment_method: String(b.chargePm),
            off_session: b.chargeMode === 'auto',
            confirm: true,
            ...(b.chargeMode === 'pos'
              ? { return_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://app.clarityflow.com'}/booths` }
              : {}),
            description: String(b.chargeDescription || 'Day-use booking'),
            metadata: {
              tenantId, locationId: String(b.locationId || ''), boothId: String(b.boothId || ''), renterId: String(b.renterId || ''),
              bookingId: bookingRef.id,
              kind: 'booth_booking',
            },
          },
          { stripeAccount: stripeAccountId, idempotencyKey: `station_booking_${bookingRef.id}_${cents}_${safeKey(b.chargePm)}` }
        );
      } catch (stripeErr: any) {
        if (stripeRefused(stripeErr)) {
          const message = `Card charge failed: ${stripeErr?.raw?.message || stripeErr?.message || 'the card was declined.'}`;
          await release('card_declined', message);
          return NextResponse.json({ ok: false, reason: message, code: stripeErr?.code || stripeErr?.raw?.code || 'card_declined' }, { status: 402 });
        }
        // No answer: it may have gone through, so the time stays held and the same attempt asked again finishes it.
        return NextResponse.json({ ok: false, reason: 'Stripe didn’t answer, so the charge may or may not have gone through. Try again in a couple of minutes: it won’t charge twice.', code: 'no_answer' }, { status: 502 });
      }
    }

    if (intent.status === 'requires_action') {
      // The renter's bank wants them to approve it: the time stays held for the hold window while they do, and
      // nothing is confirmed until the payment is.
      const at = new Date().toISOString();
      await bookingRef.set({ chargeClaimAt: null, stripePaymentIntentId: intent.id, holdExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString(), updatedAt: at }, { merge: true });
      return NextResponse.json({
        ok: false,
        requiresAction: true,
        clientSecret: intent.client_secret,
        bookingId: bookingRef.id,
        reason: 'Card requires additional authentication.',
      });
    }
    if (intent.status !== 'succeeded') {
      if (['requires_payment_method', 'canceled'].includes(String(intent.status))) {
        const message = `Charge did not complete (status: ${intent.status})`;
        await release(`stripe_${intent.status}`, message);
        return NextResponse.json({ ok: false, reason: message, code: intent.status });
      }
      return NextResponse.json({ ok: false, reason: 'The payment is still going through. Try again in a couple of minutes: it won’t charge twice.', code: 'processing' }, { status: 502 });
    }

    // ── The records, once: both ledgers (named after the booking) and the confirmation, in one step ──
    const chargeId = resolveChargeId(intent);
    const txnRef = db.doc(`tenants/${tenantId}/transactions/station_booking_${bookingRef.id}`);
    const ledgerRef = db.doc(`tenants/${tenantId}/rentLedger/station_booking_${bookingRef.id}`);
    const bHours = (new Date(b.endAt).getTime() - new Date(b.startAt).getTime()) / 3_600_000;
    const at = new Date().toISOString();
    await db.runTransaction(async (tx: any) => {
      const cur: any = (await tx.get(bookingRef)).data() || {};
      const line = await tx.get(txnRef);
      if (line.exists || cur.paymentStatus === 'paid') return;
      tx.set(txnRef, {
        id: txnRef.id,
        date: at,
        description: String(b.chargeDescription || 'Day-use booking'),
        clientOrVendor: b.renterName || `${renter.firstName} ${renter.lastName}`,
        type: 'income',
        context: 'Business',
        category: 'Day-Use Booking Revenue',
        taxBucket: 'revenue',
        amount: cents / 100,
        paymentMethod: 'Card on file (Stripe)',
        stripePaymentIntentId: intent.id,
        stripeChargeId: chargeId,
        bookingId: bookingRef.id,
        hasReceipt: true,
        tenantId, locationId: b.locationId || locationId,
      });
      tx.set(ledgerRef, {
        id: ledgerRef.id,
        locationId: b.locationId || locationId,
        leaseId: null,
        bookingId: bookingRef.id,
        renterId: b.renterId || renterId,
        boothId: b.boothId || boothId,
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
      }, { merge: true });
    });

    return NextResponse.json({
      ok: true,
      bookingId: bookingRef.id,
      paymentIntentId: intent.id,
      totalCents: cents,
    });
  } catch (err: any) {
    // Not a "no" from anyone: the screen keeps its attempt and asking again finishes this same booking.
    console.error('[stripe/book-station]', err);
    return NextResponse.json({ ok: false, reason: `This booking didn’t finish (${String(err?.message || 'unknown error').slice(0, 120)}). Try again in a moment: it won’t charge twice.` }, { status: 500 });
  }
}
