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

import { logAuditAdmin } from '@/lib/audit';
import { NextRequest, NextResponse } from 'next/server';
import { brandedEmailHtml } from '@/lib/email-template';
import { sendNotification } from '@/lib/notify';
import { getAdminDb } from '@/lib/firebase-admin';
import { resolveDayUseAgreement, buildSignedRecord } from '@/lib/esign';
import { resolveIncidentalPolicy } from '@/lib/incidentals';
import { recognizeContact, resolveRenterDayDiscount } from '@/lib/booth-recognition';
import { tenantTimeZone, todayIn } from '@/lib/tenant-time';
import { requireRole } from '@/lib/route-guard';
import { limitPublic, bump } from '@/lib/rate-limit';
import { checkGuestPass, deskSignedIn, makeStationToken, renewStationLink, stationLinkOk, stationLinkVersion, stationRenterId } from '@/lib/station-token';
import { createHash } from 'crypto';
import Stripe from 'stripe';

const digits = (s: any) => String(s || '').replace(/\D/g, '');
const ID_RE = /^[A-Za-z0-9_-]{1,120}$/;
// Ids named after what they record, so a second run of the same step finds it done.
const safeKey = (v: any) => String(v || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
const CLAIM_MS = 2 * 60000;
const freshClaim = (at: any) => !!at && Date.now() - (Date.parse(String(at)) || 0) < CLAIM_MS;
// Stripe said no (nothing moved) — as against no answer at all (it may have gone through).
const stripeRefused = (e: any) => ['StripeCardError', 'StripeInvalidRequestError', 'StripePermissionError', 'StripeAuthenticationError'].includes(String(e?.type || ''));
const NO_ANSWER = 'Stripe didn’t answer, so the charge may or may not have gone through. Try again in a couple of minutes: it won’t charge twice.';

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
    // The date printed on a signed agreement is the studio's date. A UTC one
    // would date an 8pm signature to tomorrow, on a document the guest signed
    // and may later be shown.
    date: todayIn(tenantTimeZone(tenantData)),
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
    // THE KIOSK'S TODAY. Every lookup below asks "is this booking active
    // today" — so on a UTC clock a guest checking in at 8pm Pacific was told
    // "no booking found for today" while standing in front of the booth,
    // because the server had already rolled over to tomorrow. Read from the
    // tenant doc, which the kiosk already needs anyway.
    let kioskTenant: any = {};
    try { kioskTenant = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {}; } catch { /* falls back to UTC */ }
    const today = todayIn(tenantTimeZone(kioskTenant));

    // ── 'recognize': who is this contact to the business? ─────────────
    // Powers the booking form's "welcome back" state. Requires a FULL
    // phone (7+ digits) or email — never a partial probe — and returns
    // only what the form needs: first name, tier, and the renter perks.
    // No addresses, no booking history details, no other guests' data.
    if (action === 'recognize') {
      const phone = digits(body.phone);
      const email = String(body.email || '').trim().toLowerCase();
      if (phone.length < 7 && !/^\S+@\S+\.\S+$/.test(email)) {
        return NextResponse.json({ ok: true, tier: 'new' });
      }
      const rec = await recognizeContact(db, tenantId, phone, email);
      let discountPercent = 0;
      if (rec.isResident) {
        try {
          const t = await db.doc(`tenants/${tenantId}`).get();
          discountPercent = resolveRenterDayDiscount(t.data());
        } catch { /* cosmetic */ }
      }
      // Active day-pass balance — the booking form tells them their next
      // booking is already paid for.
      let passDaysLeft = 0;
      try {
        const mail = email;
        const snap = await db.collection(`tenants/${tenantId}/boothPasses`).where('status', '==', 'active').get();
        for (const d of snap.docs) {
          const p = d.data() as any;
          if ((phone && p.contactKey === phone) || (mail && p.contactKey === mail)) {
            passDaysLeft += Math.max(0, (Number(p.daysTotal) || 0) - (Number(p.daysUsed) || 0));
          }
        }
      } catch { /* additive */ }
      return NextResponse.json({
        ok: true,
        tier: rec.tier,
        firstName: rec.renterFirstName,
        visits: rec.paidVisitsTotal,
        isResident: rec.isResident,
        signatureWaived: rec.isResident && rec.hasSignedLease,
        discountPercent,
        passDaysLeft,
      });
    }

    // ── 'pass-packs': the day-pass bundles offered for sale on the public
    // booking page. Prices come from the OWNER'S config only.
    if (action === 'pass-packs') {
      try {
        const t = await db.doc(`tenants/${tenantId}`).get();
        const raw = (t.data() as any)?.bookingPageSettings?.dayPassPacks;
        const packs = Array.isArray(raw)
          ? raw.filter((p: any) => Number(p.days) > 0 && Number(p.amountCents) > 0)
              .map((p: any) => ({ label: p.label || `${p.days}-day pack`, days: Number(p.days), amountCents: Number(p.amountCents) }))
          : [];
        return NextResponse.json({ ok: true, packs });
      } catch { return NextResponse.json({ ok: true, packs: [] }); }
    }

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
        id: nRef.id, type: 'booth_reservation', read: false, createdAt: nowIso, link: '/pos?tab=spaces',
        message: `${r.name} has checked in at the kiosk for ${r.boothName}${r.bookingType === 'hourly' && r.endTime ? ` (until ${r.endTime})` : ''}.`,
      });
      return NextResponse.json({ ok: true, firstName: (r.name || 'Guest').split(' ')[0], boothName: r.boothName, endTime: r.bookingType === 'hourly' ? r.endTime : null });
    }

    // ── 'station-link': the signed link for a renter's station, for the owner's screen to show and copy (managers
    // only). With renew: a new link, and the old one stops charging the station. The signature names the space and its
    // current renter, so a new renter in the space gets a new link too.
    if (action === 'station-link') {
      const g = await requireRole(req, String(tenantId), 'manager'); if (g.deny) return g.deny;
      const boothId = String(body.boothId || '');
      if (!ID_RE.test(String(tenantId)) || !ID_RE.test(boothId)) return NextResponse.json({ ok: false, error: 'Missing parameters.' }, { status: 400 });
      const renterId = await stationRenterId(db, tenantId, boothId);
      if (!renterId) return NextResponse.json({ ok: false, error: 'Nobody rents this space right now, so it has no station link.' }, { status: 404 });
      const renew = body.renew === true;
      const version = renew ? await renewStationLink(db, tenantId, boothId) : await stationLinkVersion(db, tenantId, boothId);
      const token = makeStationToken(tenantId, boothId, renterId, version);
      if (!token) return NextResponse.json({ ok: false, error: 'Station links aren’t available yet. Please try again later.' }, { status: 500 });
      if (renew) await logAuditAdmin(db, tenantId, { action: 'booth.station_link_renewed', targetType: 'booth', targetId: boothId, summary: 'A new concierge link was made for this station. The old link no longer charges it.',
        actor: { type: 'user', id: g.actor?.uid || undefined, name: g.actor?.name || undefined, role: g.actor?.role || undefined } }).catch(() => {});
      return NextResponse.json({ ok: true, token, version });
    }

    // ── v75 CONCIERGE INTEGRATION ─────────────────────────────────────
    // 'active-stay': who can this concierge order be charged to?
    //
    //   • boothId (a renter's station link /concierge?booth=…&k=…): the station's payer — a checked-in day guest at that
    //     booth, else the booth's resident RENTER — with the renter's amenity settings (who pays, complimentary
    //     allowance), so the kiosk knows how to bill. Only a link carrying the station's signature (or the front desk
    //     signed in on this screen) is told any of it. An older link without one still opens the menu, and is told to
    //     ask the front desk for the station's current link.
    //   • phone (the walk-in lounge kiosk): the checked-in day guest whose card is on file, matched on the last 10
    //     digits. Charging that card still takes the code texted to that phone.
    if (action === 'active-stay') {
      const boothId = String(body.boothId || '').trim();

      // ── Station-scoped: a renter's booth link. ──
      if (boothId) {
        if (!ID_RE.test(boothId)) return NextResponse.json({ ok: true, found: false });
        let boothName = 'your station';
        try {
          const bSnap = await db.doc(`tenants/${tenantId}/booths/${boothId}`).get();
          if (bSnap.exists) boothName = (bSnap.data() as any)?.name || boothName;
        } catch { /* cosmetic */ }
        // A checked-in day guest occupying that booth today (their own card), else the resident renter of that booth.
        const resSnap = await db.collection(`tenants/${tenantId}/boothReservations`)
          .where('boothId', '==', boothId).get();
        const dayStay = resSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
          .find(r => r.status === 'checked_in' && r.startDate <= today && r.endDate >= today);
        const link = await stationLinkOk(db, tenantId, boothId, body.stationToken);
        let rt: any = null;
        if (link.renterId) {
          const rSnap = await db.doc(`tenants/${tenantId}/renters/${link.renterId}`).get();
          rt = rSnap.exists ? (rSnap.data() as any) : null;
        }
        const payable = !!dayStay || !!(rt && rt.amenitiesEnabled);
        if (payable && !link.ok && !(await deskSignedIn(req, tenantId))) {
          return NextResponse.json({ ok: true, found: false, boothName, linkNeedsUpdate: true });
        }
        if (dayStay) {
          return NextResponse.json({
            ok: true, found: true, payerType: 'reservation',
            reservationId: dayStay.id,
            boothName: dayStay.boothName || 'your station',
            cardOnFile: !!(dayStay.cardOnFile && dayStay.stripeCustomerId && dayStay.stripePaymentMethodId),
            amenityPayer: 'renter', amenityCompAllowance: 0,
          });
        }
        if (rt && rt.amenitiesEnabled) {
          return NextResponse.json({
            ok: true, found: true, payerType: 'renter',
            boothName,
            renterName: `${rt.firstName || ''} ${rt.lastName || ''}`.trim() || 'Renter',
            cardOnFile: !!(rt.cardOnFile && rt.stripeCustomerId && rt.stripePaymentMethodId),
            amenityPayer: rt.amenityPayer === 'client' ? 'client' : 'renter',
            amenityCompAllowance: Math.max(0, Math.round(Number(rt.amenityCompAllowance) || 0)),
          });
        }
        // Booth exists, but no active stay/renter or amenities not enabled:
        // the menu still works, just no station charging.
        return NextResponse.json({ ok: true, found: false, boothName });
      }

      // ── Phone-scoped: the walk-in lounge kiosk. A phone number alone tells nothing: only the code's pass for that
      // number, or the front desk signed in on the screen, is told whether that number is checked in here today. ──
      const ph = digits(body.phone).slice(-10);
      if (ph.length !== 10) return NextResponse.json({ ok: true, found: false });
      if (!checkGuestPass(String(tenantId), ph, body.guestPass) && !(await deskSignedIn(req, String(tenantId)))) {
        return NextResponse.json({ ok: true, found: false });
      }
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

    // 'charge': room service — an order from the concierge menu charged to a card on file. Two payers:
    //   • payer 'station': the station's resident renter, for a renter who lets their clients order to the station
    //     (amenitiesEnabled, and the renter pays). Needs the station's signed link, or the front desk signed in here.
    //   • payer 'stay': a checked-in day guest's own card. Needs the guest pass from the code texted to their phone.
    // The price is the menu's, worked out here; the screen's figure is only checked against it, so a guest is never
    // charged an amount they weren't shown. A price cap keeps a kiosk bug from becoming a disaster.
    // Once per order: the screen names each order and keeps the name when it asks again. The server makes the order's
    // id from that name, claims it in one step, charges under one key, and writes one line in the books named after it.
    // No answer from Stripe keeps the claim, so asking again sends the same charge, never a second. A station (or a
    // guest's stay) that has had a lot charged in a short time is asked to pay another way.
    if (action === 'charge') {
      if (!ID_RE.test(String(tenantId))) return NextResponse.json({ ok: false, error: 'Missing parameters.' }, { status: 400 });
      const limited = await limitPublic(req, 'concierge_charge', String(tenantId), { perHour: 60, perDay: 2000 });
      if (limited) return limited;
      const itemId = String(body.itemId || '');
      const quantity = Number(body.quantity);
      const orderKey = safeKey(body.orderKey).slice(0, 80);
      const boothId = String(body.boothId || '');
      if (!ID_RE.test(itemId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 10 || !orderKey || (boothId && !ID_RE.test(boothId))) {
        return NextResponse.json({ ok: false, error: 'Missing parameters.' }, { status: 400 });
      }
      const iSnap = await db.doc(`tenants/${tenantId}/inventory/${itemId}`).get();
      const item: any = iSnap.exists ? iSnap.data() : null;
      if (!item || item.type !== 'refreshment' || item.showInConcierge === false || !(Number(item.totalStock) > 0)) {
        return NextResponse.json({ ok: false, error: 'That isn’t on the menu right now.' }, { status: 404 });
      }
      const amountCents = Math.round(Math.max(0, Number(item.price) || 0) * quantity * 100);
      if (body.amountCents !== undefined && body.amountCents !== null && Math.round(Number(body.amountCents)) !== amountCents) {
        return NextResponse.json({ ok: false, error: 'The price of this item just changed. Please check the menu and order again.' }, { status: 409 });
      }
      if (amountCents < 50) return NextResponse.json({ ok: false, error: 'There’s nothing to charge for this order.' }, { status: 400 });
      if (amountCents > 50000) {
        return NextResponse.json({ ok: false, error: 'Order too large for station charging — please pay at the desk.' }, { status: 400 });
      }
      const what = `Concierge: ${String(item.name || 'Item').slice(0, 80)} (x${quantity})`;

      // ── Who pays, and the proof ──
      let payer: { kind: 'station' | 'stay'; id: string; customer: string; pm: string; name: string; boothName: string; boothId: string | null; instead: string };
      if (body.payer === 'stay' || body.reservationId || body.phone) {
        const ph = digits(body.phone).slice(-10);
        if (ph.length !== 10) return NextResponse.json({ ok: false, error: 'Enter your mobile number to charge your card on file.' }, { status: 400 });
        if (!checkGuestPass(String(tenantId), ph, body.guestPass)) {
          return NextResponse.json({ ok: false, needsCode: true, error: 'To charge your card on file, enter the code we text to your phone.' }, { status: 403 });
        }
        const rid = String(body.reservationId || '');
        let stay: any = null;
        if (rid && ID_RE.test(rid)) {
          const s = await db.doc(`tenants/${tenantId}/boothReservations/${rid}`).get();
          if (s.exists) stay = { id: s.id, ...(s.data() as any) };
        } else if (!rid) {
          const snap = await db.collection(`tenants/${tenantId}/boothReservations`).where('startDate', '<=', today).get();
          stay = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
            .find(r => r.status === 'checked_in' && r.endDate >= today && digits(r.phone).slice(-10) === ph && (!boothId || r.boothId === boothId)) || null;
        }
        if (!stay || digits(stay.phone).slice(-10) !== ph || stay.status !== 'checked_in' || stay.startDate > today || stay.endDate < today) {
          return NextResponse.json({ ok: false, error: 'No active stay found — please pay at the desk.' }, { status: 400 });
        }
        if (!stay.cardOnFile || !stay.stripeCustomerId || !stay.stripePaymentMethodId) {
          return NextResponse.json({ ok: false, error: 'No card on file for this stay — please pay at the desk.' }, { status: 400 });
        }
        payer = { kind: 'stay', id: String(stay.id), customer: String(stay.stripeCustomerId), pm: String(stay.stripePaymentMethodId), name: String(stay.name || 'Guest'),
          boothName: String(stay.boothName || 'your station'), boothId: stay.boothId ? String(stay.boothId) : null, instead: 'please pay at the desk' };
      } else {
        if (!boothId) return NextResponse.json({ ok: false, error: 'Missing parameters.' }, { status: 400 });
        const link = await stationLinkOk(db, tenantId, boothId, body.stationToken);
        const rSnap = link.renterId ? await db.doc(`tenants/${tenantId}/renters/${link.renterId}`).get() : null;
        const rt: any = rSnap?.exists ? rSnap.data() : null;
        if (!rt) return NextResponse.json({ ok: false, error: 'Station not found — please pay the host.' }, { status: 404 });
        if (!rt.amenitiesEnabled) {
          return NextResponse.json({ ok: false, error: 'Station charging isn’t enabled here — please pay the host.' }, { status: 400 });
        }
        if (!link.ok && !(await deskSignedIn(req, tenantId))) {
          return NextResponse.json({ ok: false, linkNeedsUpdate: true, error: 'To charge this to the station, please ask the front desk for the station’s current link.' }, { status: 403 });
        }
        if (rt.amenityPayer === 'client') {
          return NextResponse.json({ ok: false, error: 'At this station, guests pay for their own orders — please pay the host.' }, { status: 400 });
        }
        if (!rt.cardOnFile || !rt.stripeCustomerId || !rt.stripePaymentMethodId) {
          return NextResponse.json({ ok: false, error: 'No card on file for this station — please pay the host.' }, { status: 400 });
        }
        let boothName = 'their station';
        try { const b = await db.doc(`tenants/${tenantId}/booths/${boothId}`).get(); if (b.exists) boothName = (b.data() as any)?.name || boothName; } catch { /* cosmetic */ }
        payer = { kind: 'station', id: link.renterId, customer: String(rt.stripeCustomerId), pm: String(rt.stripePaymentMethodId),
          name: `${rt.firstName || ''} ${rt.lastName || ''}`.trim() || 'Renter', boothName, boothId, instead: 'please pay the host' };
      }

      // ── The order, claimed in one step ──
      const orderId = `sc_${createHash('sha256').update(`${tenantId}|${payer.kind}|${payer.id}|${orderKey}`).digest('hex').slice(0, 24)}`;
      const claimRef = db.doc(`tenants/${tenantId}/private/kiosk/stationCharges/${orderId}`);
      const done = (c: any) => NextResponse.json({ ok: true, chargedCents: Number(c.amountCents) || 0, boothName: c.boothName || payer.boothName, orderId, already: true });
      const prior: any = (await claimRef.get()).data() || null;
      if (prior?.status === 'charged') return done(prior);
      if (!prior || prior.status === 'failed') {
        // A new charge: at most 15 an hour and 60 a day from one station (or one guest's stay).
        const who = createHash('sha256').update(`${tenantId}|${payer.kind}|${payer.id}`).digest('hex').slice(0, 32);
        const now = Date.now();
        const okHour = await bump(`concierge_station_${who}_h${Math.floor(now / 3600000)}`, 15, 2 * 3600000).catch(() => true);
        const okDay = okHour && await bump(`concierge_station_${who}_d${Math.floor(now / 86400000)}`, 60, 2 * 86400000).catch(() => true);
        if (!okHour || !okDay) {
          return NextResponse.json({ ok: false, error: `This station has had a lot of orders charged in a short time — ${payer.instead} for this one.` }, { status: 429 });
        }
      }
      const nowIso = new Date().toISOString();
      const claim: any = await db.runTransaction(async (tx: any) => {
        const c: any = (await tx.get(claimRef)).data() || null;
        if (c?.status === 'charged') return { already: c };
        if (c?.status === 'charging' && freshClaim(c.claimAt)) return { busy: true };
        if (c?.status === 'charging') {
          // Asked again after no answer: the same charge (its stored amount and card), never a different one.
          tx.set(claimRef, { claimAt: nowIso }, { merge: true });
          return { cents: Number(c.amountCents) || 0, pm: String(c.pm || ''), customer: String(c.customer || '') };
        }
        tx.set(claimRef, { id: orderId, status: 'charging', claimAt: nowIso, amountCents, pm: payer.pm, customer: payer.customer, payerKind: payer.kind, payerId: payer.id,
          boothId: payer.boothId, boothName: payer.boothName, itemId, quantity, description: what, requestId: null, createdAt: c?.createdAt || nowIso }, { merge: true });
        return { cents: amountCents, pm: payer.pm, customer: payer.customer };
      });
      if (claim.already) return done(claim.already);
      if (claim.busy) return NextResponse.json({ ok: false, error: 'This charge is going through already. Give it a moment.' }, { status: 409 });
      const cents = Number(claim.cents) || 0;

      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
      let intent: any;
      try {
        intent = await stripe.paymentIntents.create({
          amount: cents, currency: 'usd',
          customer: claim.customer, payment_method: claim.pm,
          off_session: true, confirm: true,
          expand: ['latest_charge.balance_transaction'],
          description: `${what} — ${payer.boothName} (${payer.name})`,
          metadata: { tenantId: String(tenantId), orderId, ...(payer.kind === 'station' ? { renterId: payer.id, kind: 'concierge_renter_charge' } : { reservationId: payer.id, kind: 'concierge_charge' }) },
        }, { idempotencyKey: `concierge-${orderId}-${cents}-${safeKey(claim.pm)}` });
      } catch (err: any) {
        const msg = err?.raw?.message || err?.message || 'Card charge failed.';
        if (stripeRefused(err)) {
          // Nothing moved: the order is free to try again (as a new attempt), and nothing is recorded. Non-punitive —
          // a decline just means collect another way.
          await claimRef.set({ status: 'failed', claimAt: null, failedAt: new Date().toISOString(), error: String(msg).slice(0, 200) }, { merge: true });
          return NextResponse.json({ ok: false, error: `Card declined: ${msg} — ${payer.instead}.` }, { status: 402 });
        }
        return NextResponse.json({ ok: false, error: NO_ANSWER }, { status: 502 });
      }

      // ── Recorded once: the order's line in the books and its Stripe fee, with the claim marked charged ──
      const charge: any = intent?.latest_charge;
      let feeCents = Number(charge?.balance_transaction?.fee) || 0;
      let chargeId: string | null = typeof charge === 'string' ? charge : (charge?.id || null);
      if (!feeCents) { const f = await stripeFeeFor(intent.id); feeCents = f.feeCents; chargeId = chargeId || f.chargeId; }
      const txnRef = db.doc(`tenants/${tenantId}/transactions/concierge_${orderId}`);
      const feeRef = db.doc(`tenants/${tenantId}/transactions/conciergefee_${orderId}`);
      const at = new Date().toISOString();
      await db.runTransaction(async (tx: any) => {
        const c: any = (await tx.get(claimRef)).data() || {};
        if (c.status === 'charged') return;
        tx.set(txnRef, {
          id: txnRef.id, type: 'income', context: 'Business', taxBucket: 'revenue',
          amount: cents / 100, category: 'Hospitality Revenue',
          description: `${c.description || what} — charged to ${payer.boothName}${payer.kind === 'station' ? ` (${payer.name})` : ''}`,
          clientOrVendor: payer.name, date: at, paymentMethod: 'Card on file (Stripe)',
          hasReceipt: false, stripePaymentIntentId: intent.id, stripeChargeId: chargeId, sourceId: payer.id,
          ...(payer.kind === 'station' ? { renterId: payer.id } : {}), conciergeOrderId: orderId, tenantId, createdAt: at,
        });
        if (feeCents > 0) tx.set(feeRef, {
          id: feeRef.id, type: 'expense', context: 'Business', taxBucket: 'operating_cost',
          amount: feeCents / 100, category: 'Processing Fees',
          description: `Stripe fee — concierge charge — ${payer.boothName} (${payer.name})`,
          clientOrVendor: 'Stripe', date: at, paymentMethod: 'Deducted from payout',
          hasReceipt: false, stripePaymentIntentId: intent.id, stripeChargeId: chargeId,
          sourceId: payer.id, ...(payer.kind === 'station' ? { renterId: payer.id } : {}), relatedTxnId: txnRef.id, tenantId, createdAt: at,
        });
        tx.set(claimRef, { status: 'charged', chargedAt: at, paymentIntentId: intent.id, claimAt: null }, { merge: true });
      });
      return NextResponse.json({ ok: true, chargedCents: cents, boothName: payer.boothName, orderId });
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
        message: `${r.name} rated their stay at ${r.boothName} ${stars} out of 5 stars${reviewText ? `: "${String(reviewText).slice(0, 120)}"` : '.'}` });
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
      await nRef.set({ id: nRef.id, type: 'booth_reservation', read: false, createdAt: nowIso, link: '/pos?tab=spaces',
        message: `Action needed: ${r.name} has requested to cancel ${r.boothName} on ${r.startDate}${r.bookingType === 'hourly' && r.startTime ? ` at ${r.startTime}` : ''}. Please review it and refund or decline.${reason ? ` Reason given: "${String(reason).slice(0, 100)}"` : ''}` });
      return NextResponse.json({ ok: true });
    }

    // ── v88 TOUR SCHEDULING (pipeline Step 3) ────────────────────────
    // 'tour-slots': open tour times for a date, per the owner's rules,
    // minus already-booked tours. Real appointment scheduling.
    if (action === 'tour-slots') {
      const { date } = body;   // YYYY-MM-DD
      if (!date) return NextResponse.json({ ok: false, error: 'Missing date.' }, { status: 400 });
      const rules = await loadRules(db, tenantId);
      const autoConfirm = rules.tourAutoConfirm !== false;
      if (!rules.toursEnabled) return NextResponse.json({ ok: true, slots: [], toursOff: true, autoConfirm });
      const dow = new Date(date + 'T00:00:00Z').getUTCDay();
      if (!rules.tourDays.includes(dow)) return NextResponse.json({ ok: true, slots: [], autoConfirm });

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
      return NextResponse.json({ ok: true, slots, durationMins: dur, autoConfirm });
    }

    // ── tour-manage-*: the visitor moving or cancelling their own visit ──────
    // Keyed by the manageToken on the tour doc. The cutoff is the shop's lead
    // time: a visit cannot be changed from inside the window the shop would
    // not accept a new booking in either. Moving reuses the same clash check
    // as booking, so the visitor can only take a genuinely open time.
    if (action === 'tour-manage-get' || action === 'tour-manage-cancel' || action === 'tour-manage-move') {
      const { tourId, token } = body;
      if (!tourId || !token) return NextResponse.json({ ok: false, error: 'Missing link.' }, { status: 400 });
      const tourRef = db.doc(`tenants/${tenantId}/tours/${tourId}`);
      const tourSnap = await tourRef.get();
      const tour = tourSnap.exists ? (tourSnap.data() as any) : null;
      if (!tour || !tour.manageToken || tour.manageToken !== String(token)) {
        return NextResponse.json({ ok: false, error: 'This link is not valid.' }, { status: 404 });
      }
      const rules = await loadRules(db, tenantId);
      const cutoffHours = Number(rules.bookingLeadHours) > 0 ? Number(rules.bookingLeadHours) : 2;
      const startMs = tour.date && tour.time ? new Date(`${tour.date}T${tour.time}:00`).getTime() : NaN;
      const changeable = ['confirmed', 'requested'].includes(String(tour.status))
        && !isNaN(startMs) && startMs - Date.now() > cutoffHours * 3600000;
      const tenantDoc = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
      const studioName = tenantDoc.name || 'The studio';
      const summary = {
        name: tour.name || '', date: tour.date || '', time: tour.time || '',
        status: tour.status, changeable, cutoffHours, studioName,
      };

      if (action === 'tour-manage-get') return NextResponse.json({ ok: true, tour: summary });
      if (!changeable) {
        return NextResponse.json({ ok: false, error: `Changes close ${cutoffHours} hours before the visit — please call or reply to your confirmation.`, tour: summary }, { status: 409 });
      }

      if (action === 'tour-manage-cancel') {
        const nowIso = new Date().toISOString();
        await tourRef.set({ status: 'cancelled', cancelledAt: nowIso, cancelledBy: 'visitor' }, { merge: true });
        if (tour.applicationId) {
          await db.doc(`tenants/${tenantId}/boothApplications/${tour.applicationId}`)
            .set({ status: 'declined', declinedAt: nowIso, declinedBy: 'visitor' }, { merge: true }).catch(() => {});
        }
        {
          const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
          await nRef.set({ id: nRef.id, type: 'booth_tour', read: false, createdAt: nowIso, link: '/pipeline',
            message: `${tour.name || 'A visitor'} has cancelled their tour on ${tour.date} at ${tour.time}.` });
        }
        await logAuditAdmin(db, tenantId, { action: 'tour.cancel', targetType: 'tour', targetId: tourId, summary: `Tour on ${tour.date} at ${tour.time} cancelled by the visitor${tour.name ? ` (${tour.name})` : ''}`,
          actor: { type: 'user', name: tour.name || 'Visitor', role: 'visitor', via: 'tour link' } }).catch(() => {});
        return NextResponse.json({ ok: true, tour: { ...summary, status: 'cancelled', changeable: false } });
      }

      if (action === 'tour-manage-move') {
        const { date, time } = body;
        if (!date || !time) return NextResponse.json({ ok: false, error: 'Pick a new time.' }, { status: 400 });
        const newStart = new Date(`${date}T${time}:00`).getTime();
        if (isNaN(newStart) || newStart - Date.now() < cutoffHours * 3600000) {
          return NextResponse.json({ ok: false, error: 'That time is too soon.' }, { status: 409 });
        }
        const clashSnap = await db.collection(`tenants/${tenantId}/tours`).where('date', '==', date).get();
        if (clashSnap.docs.some(d => d.id !== tourId && (d.data() as any).time === time && ['requested', 'confirmed'].includes((d.data() as any).status))) {
          return NextResponse.json({ ok: false, error: 'That time was just taken — pick another.' }, { status: 409 });
        }
        const nowIso = new Date().toISOString();
        const previous = { date: tour.date, time: tour.time };
        await tourRef.set({ date, time, rescheduledAt: nowIso, rescheduledBy: 'visitor', previous }, { merge: true });
        if (tour.applicationId) {
          await db.doc(`tenants/${tenantId}/boothApplications/${tour.applicationId}`).set({
            tourSlot: `${date} ${time}`, tourStartIso: new Date(`${date}T${time}:00`).toISOString(), rescheduledAt: nowIso,
          }, { merge: true }).catch(() => {});
        }
        {
          const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
          await nRef.set({ id: nRef.id, type: 'booth_tour', read: false, createdAt: nowIso, link: '/pipeline',
            message: `${tour.name || 'A visitor'} has moved their tour from ${previous.date} at ${previous.time} to ${date} at ${time}.` });
        }
        await logAuditAdmin(db, tenantId, { action: 'tour.move', targetType: 'tour', targetId: tourId, summary: `Tour moved by the visitor${tour.name ? ` (${tour.name})` : ''} from ${previous.date} ${previous.time} to ${date} ${time}`,
          before: previous, after: { date, time }, actor: { type: 'user', name: tour.name || 'Visitor', role: 'visitor', via: 'tour link' } }).catch(() => {});
        return NextResponse.json({ ok: true, tour: { ...summary, date, time } });
      }
    }

    // 'tour-days': how many open times each day has across a range, so a
    // picker can draw only the days worth tapping. Same rules and the same
    // taken-slot maths as tour-slots, run once for the whole window instead of
    // once per tap. One read for the range, not one per day.
    if (action === 'tour-days') {
      const { from, to } = body;   // YYYY-MM-DD, inclusive
      if (!from || !to || String(to) < String(from)) {
        return NextResponse.json({ ok: false, error: 'Missing range.' }, { status: 400 });
      }
      const rules = await loadRules(db, tenantId);
      const autoConfirm = rules.tourAutoConfirm !== false;
      if (!rules.toursEnabled) return NextResponse.json({ ok: true, days: {}, toursOff: true, autoConfirm });

      const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
      const pad = (n: number) => String(n).padStart(2, '0');
      const dur = rules.tourDurationMins || 30;
      const startM = toMin(rules.tourWindowStart || '10:00');
      const endM = toMin(rules.tourWindowEnd || '17:00');
      const leadMs = (rules.bookingLeadHours || 0) * 3600000;
      const now = Date.now();

      const tourSnap = await db.collection(`tenants/${tenantId}/tours`)
        .where('date', '>=', String(from)).where('date', '<=', String(to)).get();
      const takenByDay = new Map<string, Set<string>>();
      for (const d of tourSnap.docs) {
        const t = d.data() as any;
        if (!['requested', 'confirmed'].includes(t.status)) continue;
        if (!takenByDay.has(t.date)) takenByDay.set(t.date, new Set());
        takenByDay.get(t.date)!.add(t.time);
      }

      const days: Record<string, number> = {};
      const cursor = new Date(String(from) + 'T00:00:00Z');
      const last = new Date(String(to) + 'T00:00:00Z');
      for (let guard = 0; cursor <= last && guard < 62; guard++, cursor.setUTCDate(cursor.getUTCDate() + 1)) {
        const date = cursor.toISOString().slice(0, 10);
        if (!rules.tourDays.includes(cursor.getUTCDay())) continue;
        const taken = takenByDay.get(date) || new Set<string>();
        let open = 0;
        for (let m = startM; m + dur <= endM; m += dur) {
          const hhmm = `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
          if (taken.has(hhmm)) continue;
          if (new Date(`${date}T${hhmm}:00`).getTime() - now < leadMs) continue;
          open++;
        }
        if (open > 0) days[date] = open;
      }
      return NextResponse.json({ ok: true, days, durationMins: dur, autoConfirm });
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
      const durMins = rules.tourDurationMins || 30;
      // The planner renders tours from the APPLICATION doc's tourStartIso.
      // Without these two fields a tour booked here held a real slot and still
      // never appeared on anybody's calendar — the front desk had no way to
      // know someone was coming. Written in the studio's own wall-clock frame,
      // matching how the listings form has always written them.
      const tourStartIso = `${date}T${time}:00`;
      const tourEndIso = (() => {
        const [hh, mm] = String(time).split(':').map(Number);
        const total = hh * 60 + mm + durMins;
        const eh = String(Math.floor(total / 60) % 24).padStart(2, '0');
        const em = String(total % 60).padStart(2, '0');
        return `${date}T${eh}:${em}:00`;
      })();
      const tourRef = db.collection(`tenants/${tenantId}/tours`).doc();
      // manageToken: the visitor's own key to move or cancel this visit from
      // the link in their confirmation and reminder, without a login and
      // without a phone call. Unguessable; checked by the tour-manage-*
      // actions below; never shown to the owner.
      const manageToken = (globalThis.crypto?.randomUUID?.() || `${Date.now()}${Math.random()}`).replace(/-/g, '');
      await tourRef.set({
        id: tourRef.id, date, time, durationMins: durMins,
        name, phone: phone || '', email: email || '', message: String(message || '').slice(0, 500),
        status, createdAt: nowIso, tenantId, manageToken,
      });
      // Pipeline record — shows up in Contacts as 'Toured'
      const appRef = db.collection(`tenants/${tenantId}/boothApplications`).doc();
      await appRef.set({
        id: appRef.id, kind: 'tour', name, phone: phone || '', email: email || '',
        message: `Tour ${status === 'confirmed' ? 'booked' : 'requested'} for ${date} ${time}${message ? ` — "${message}"` : ''}`,
        status: 'new', tourId: tourRef.id, tourDate: date, tourTime: time,
        tourStartIso, tourEndIso, tourSource: 'tour_page',
        createdAt: nowIso, tenantId,
      });
      const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
      await nRef.set({ id: nRef.id, type: 'booth_tour', read: false, createdAt: nowIso, link: '/pipeline',
        message: `${status === 'requested' ? 'Action needed: ' : ''}${name} has ${status === 'confirmed' ? 'booked' : 'requested'} a tour on ${date} at ${time}.${status === 'requested' ? ' Please approve or decline it.' : ''}` });

      // ── The prospect's copy ──────────────────────────────────────────────
      // Until now the tour existed everywhere except in the hands of the
      // person taking it: planner, pipeline, owner notification — and the
      // prospect walked away with nothing to hold. OPT-IN by design
      // This one is NOT gated on prospectEmailsEnabled. That opt-in exists so
      // a shop can withhold outreach it has not read the wording of — but a
      // confirmation for a booking somebody just made is transactional, not
      // outreach. Withholding it means a visitor books a time and hears
      // nothing at all, which is how they stop believing the booking worked.
      // Turn the KIND off in message settings if it is genuinely unwanted;
      // that switch is the honest one, and it logs the suppression.
      // Best-effort — the tour is already booked whether or not this lands.
      const tenantDoc = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
      const manageUrl = `${req.nextUrl?.origin || ''}/tour-manage/${tenantId}/${tourRef.id}/${manageToken}`;
      let emailed = false;
      if (String(email || '').includes('@')) {
        try {
          const studioName = tenantDoc.name || tenantDoc.businessName || 'The studio';
          const firstName = String(name || '').split(' ')[0] || 'there';
          const confirmed = status === 'confirmed';
          const html = brandedEmailHtml({
            studioName,
            title: confirmed ? 'Your tour is confirmed' : 'We have received your tour request',
            bodyLines: [
              `Hi ${firstName},`,
              confirmed
                ? `Thank you for booking a tour. Your visit is confirmed for ${date} at ${time}.`
                : `Thank you for your tour request for ${date} at ${time}. We will confirm it with you shortly.`,
              `The tour takes about ${durMins} minutes, and there is nothing you need to bring or prepare.`,
              confirmed
                ? `If the time no longer works for you, you can change or cancel your visit using the button below.`
                : `If the time no longer works for you, please reply to this email and we will find another.`,
              `Kind regards, ${studioName}`,
            ],
            ...(confirmed ? { cta: { label: 'Change or cancel my visit', url: manageUrl } } : {}),
            footerNote: `Sent by ${studioName}. You're receiving this because you ${confirmed ? 'booked' : 'requested'} a tour with us.`,
          });
          const sent = await sendNotification(db, {
            tenantId, channel: 'email', to: email,
            subject: confirmed
              ? `Your tour is confirmed for ${date} at ${time}`
              : `We have received your tour request for ${date} at ${time}`,
            html, kind: 'tour_confirmation',
            recipientType: 'contact', recipientId: tourRef.id, recipientName: name || null,
            eventConfirmed: confirmed,
            eventStartIso: `${date}T${time}:00`,
          });
          emailed = sent.status === 'sent';
        } catch (err) { console.error('[kiosk] tour confirmation email failed (tour is safe)', err); }
      }

      // tourId so a caller that booked on someone's behalf can follow up on
      // this exact tour (the pipeline's confirm-an-accepted-invite path does).
      await logAuditAdmin(db, tenantId, { action: 'tour.book', targetType: 'tour', targetId: tourRef.id,
        summary: `Tour ${status === 'confirmed' ? 'booked' : 'requested'} for ${date} at ${time}${name ? ` — ${name}` : ''}${emailed ? ' (confirmation emailed)' : ''}`,
        actor: { type: 'user', name: name || 'Visitor', role: 'visitor', via: 'tour booking' } }).catch(() => {});
      return NextResponse.json({ ok: true, status, autoConfirmed: status === 'confirmed', tourId: tourRef.id, emailed });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  } catch (err) {
    console.error('[kiosk] failed', err);
    return NextResponse.json({ ok: false, error: 'Something went wrong — see the front desk.' }, { status: 500 });
  }
}
