/**
 * api/appointments/self-cancel/route.ts
 *
 * Implements Rule 2 — Late Cancellation Window.
 *
 * Public, UNAUTHENTICATED route. The appointmentId itself (a high-entropy
 * nanoid, generated wherever appointments are created) functions as the
 * bearer capability token — the same trust model already used by
 * checkInToken (appointmentCheckIns/{token}) and the bookingCompletions
 * token elsewhere in this codebase. Reached from
 * /cancel/[tenantId]/[appointmentId].
 *
 * GET  ?tenantId=...&appointmentId=...   → appointment details + fee preview
 *      for the public page to render before the client confirms.
 * POST { tenantId, appointmentId, clientReason }
 *
 * Rule 2 logic:
 *   hoursUntilStart >= tenant.cancellationWindowHours  → fee waived (plenty of notice)
 *   hoursUntilStart <  tenant.cancellationWindowHours  → fee FLAGGED, not waived.
 *     The actual charge still goes through the same cancellationEvent →
 *     onCancellationEvent pipeline as every other cancellation path — this
 *     route never calls Stripe directly for the cancellation fee.
 *
 * Card-on-file resolution: the customer id and payment-method id are read
 * from client.cardOnFile (where the Stripe Connect webhook vaults them on the
 * CONNECTED account), NOT from the top-level client.stripeCustomerId — which
 * is frequently unset and, even when set, may be a platform-level customer
 * the connected-account charge can't see. Preferring cardOnFile.customerId is
 * what lets onCancellationEvent actually charge the card; reading the
 * top-level field was why cancellation fees silently never landed.
 *
 * Fee calculation is intentionally simple — flat tenant.cancellationFee,
 * falling back to the service price. It does NOT replicate the staff-side
 * profitability matrix (labor/overhead breakdown) used in
 * CancelAppointmentDialog, since that exposes internal cost structure that
 * has no place in a public, unauthenticated flow.
 *
 * Deposit disposition: this is a CLIENT-initiated cancellation, not a
 * studio-initiated one, so it deliberately does NOT call
 * /api/stripe/studio-cancel-refund (that route is reserved for cancellations
 * that are the studio's fault). Instead it mirrors the rollover/forfeit/
 * refund-pending policy resolution via the depositCredits collection — the
 * same logic restored in useCancellationConfirm v3 for the staff-dialog
 * client-cancel path, so both client-initiated paths behave identically.
 * A 'refund' outcome is NEVER auto-executed — recorded as a pending decision
 * plus a staff notification only.
 *
 * Anti-abuse note: there is no rate limiting on this route at the
 * application level. If that matters for your traffic, add it at the
 * platform/edge layer (e.g. Vercel's rate limiting or a WAF rule) — it's
 * not something this route implements itself.
 */

import { staffOrServer } from '@/lib/route-guard';
import { hasRealCard } from '@/lib/card-on-file';
import { resolveDepositPolicy, rolloverExpiryISO } from '@/lib/deposit-policy';
import { planCancellation, cancellationOutcomeLines } from '@/lib/policy-copy';
import { sendCancellationNotice } from '@/lib/cancel-notice';
import { internalPost, internalOrigin } from '@/lib/message-policy';
import { resolvePolicy } from '@/lib/booking-policies';
import { hoursToDeadline } from '@/lib/change-rules';
import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';

function getAdmin() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore, FieldValue }     = require('firebase-admin/firestore');
  const APP_NAME = 'admin';
  let app = getApps().find((a: any) => a.name === APP_NAME);
  if (!app) {
    app = initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    }, APP_NAME);
  }
  return { db: getFirestore(app), FieldValue };
}

function hoursUntil(dateStr: string): number {
  return (new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60);
}

const CLIENT_REASON_VALUES = [
  'rescheduled',
  'schedule_conflict',
  'changed_mind',
  'found_alternative',
  'price_concern',
  'health_or_childcare',
  'other',
];

function isCreditExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() <= Date.now();
}

// ── GET: appointment details + fee preview for the public page ────────────────

// ── ONE CALCULATION for the client's own cancellation — the same one the front
// desk uses (planCancellation): the fee from Booking policies, the deposit on
// this booking handled per the deposit policy + the late-cancellation choice
// (it counts toward the fee / becomes credit / is refunded). The preview (GET)
// and the cancellation (POST) both use it, so what the client is shown is what
// happens. Renter bookings keep their own (renter) rules — untouched here.
async function planSelfCancel(db: any, tenantId: string, appointmentId: string, appt: any, tenant: any, service: any, client: any, isReschedule: boolean) {
  const P = resolvePolicy(tenant, service); const dp = resolveDepositPolicy(tenant);
  const windowHours = Number(P.cancel.windowHours.value) || 24;
  const hrs = hoursToDeadline(tenant, appt, service);
  const isLate = hrs < windowHours;
  const price = Number(service?.price) || 0, val = Number(P.cancel.feeValue.value) || 0, mode = P.cancel.feeMode.value;
  // "Your costs" needs the cost model (front desk); online it falls back to your flat fee, else the service price — as before.
  const policyFee = mode === 'flat' ? val : mode === 'percentage' ? price * (val > 0 ? val : 100) / 100 : mode === 'none' ? 0 : (Number(tenant?.cancellationFee) || price);
  const feeDollars = isLate && !isReschedule ? Math.round(policyFee * 100) / 100 : 0;
  let credit: any = null;
  if (!isReschedule && !appt.isRenterBooking && appt.clientId) {
    try {
      const snap = await db.collection(`tenants/${tenantId}/depositCredits`).where('clientId', '==', String(appt.clientId)).where('status', '==', 'available').get();
      const list = snap.docs.map((d: any) => ({ ref: d.ref, id: d.id, ...(d.data() as any) })).filter((c: any) => !isCreditExpired(c.expiresAt));
      list.sort((a: any, b: any) => (b.appointmentId === appointmentId ? 1 : 0) - (a.appointmentId === appointmentId ? 1 : 0) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      credit = list[0] || null;
      if (credit) credit.amount = Number(credit.amountDollars ?? (Number(credit.amountCents) || 0) / 100) || 0;
    } catch { credit = null; }
  }
  const pmId = client?.cardOnFile?.paymentMethodId || (hasRealCard(client) ? client?.cardOnFile?.token : null) || null;
  const cusId = client?.cardOnFile?.stripeCustomerId || client?.cardOnFile?.customerId || client?.stripeCustomerId || null;
  const hasCard = !!(pmId && cusId);
  const plan = planCancellation({ who: 'client', feeDollars, policyFeeDollars: feeDollars, chargeFee: true, depositDollars: appt.isRenterBooking ? 0 : (credit?.amount || 0),
    hoursUntilStart: hrs, depositPolicy: dp, collectPref: 'card', hasCard, cardLast4: client?.cardOnFile?.last4 || null, lateConsequence: P.cancel.lateConsequence.value });
  return { plan, credit, isLate, windowHours, hrs, hasCard, dp, feeDollars };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tenantId = searchParams.get('tenantId');
  const appointmentId = searchParams.get('appointmentId');
  // The key (their visit token) proves it's the client's own link. Without it, only a basic preview — never contact details.
  const key = String(searchParams.get('k') || '');

  if (!tenantId || !appointmentId) {
    return NextResponse.json({ ok: false, error: 'Missing tenantId or appointmentId' }, { status: 400 });
  }

  const { db } = getAdmin();
  const apptSnap = await db.doc(`tenants/${tenantId}/appointments/${appointmentId}`).get();
  if (!apptSnap.exists) {
    return NextResponse.json({ ok: false, error: 'Appointment not found' }, { status: 404 });
  }
  const appt = apptSnap.data();

  if (appt.status === 'cancelled') {
    return NextResponse.json({ ok: false, error: 'This appointment has already been cancelled.', alreadyCancelled: true }, { status: 409 });
  }
  if (appt.status !== 'confirmed' && appt.status !== 'deposit_pending') {
    return NextResponse.json({ ok: false, error: 'This appointment can’t be cancelled online at this point.', status: appt.status }, { status: 409 });
  }

  const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
  const tenant = tenantSnap.data() || {};
  const svcSnap = await db.doc(`tenants/${tenantId}/services/${appt.serviceId}`).get();
  const service = svcSnap.data() || {};

  // Booking policies: the window (a service can differ) and the deadline counted from the ORIGINAL time.
  const clientDocG = appt.clientId ? (((await db.doc(`tenants/${tenantId}/clients/${appt.clientId}`).get()).data() as any) || {}) : {};
  const pv = await planSelfCancel(db, tenantId, appointmentId, appt, tenant, service, clientDocG, false);
  const windowHours = pv.windowHours; const isLate = pv.isLate;
  const estimatedFee = appt.isRenterBooking ? (isLate ? (tenant.cancellationFee || service.price || 0) : 0) : pv.plan.due;

  return NextResponse.json({
    // Exactly what will happen, in the business's policy wording — shown BEFORE they confirm.
    preview: appt.isRenterBooking ? null : { lines: cancellationOutcomeLines(pv.plan.outcome, { preview: true }), due: pv.plan.due, applied: pv.plan.applied, fee: pv.plan.fee },
    ok: true,
    appointment: {
      clientName: appt.clientName || null,
      clientEmail: key && key === appt.checkInToken ? appt.clientEmail || null : null,
      clientPhone: key && key === appt.checkInToken ? appt.clientPhone || null : null,
      canCancel: !!key && key === appt.checkInToken,
      startTime: appt.startTime,
      serviceName: appt.renterServiceName || service.name || 'Service',
      serviceId: appt.serviceId || null,
      staffId: appt.staffId || null,
      isRenterBooking: !!appt.isRenterBooking,
      status: appt.status || null,
    },
    studioName: tenant.name || 'The Studio',
    studioPhone: tenant.twilioPhoneNumber || tenant.phone || null,
    cancellationPolicyText: tenant.cancellationPolicyText || null,
    isLate,
    windowHours,
    estimatedFee,
  });
}

// ── POST: actually cancel ──────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 });
  }

  const { tenantId, appointmentId } = body;
  // "Rescheduled online" arrives from the booking page after the NEW visit
  // is already booked; it is a move, not a cancellation, and carries no fee
  // and no package forfeit.
  const rescheduledToId = typeof body.rescheduledToId === 'string' ? body.rescheduledToId : null;
  const clientReason = body.clientReason === 'Rescheduled online' ? 'rescheduled' : body.clientReason;
  if (!tenantId || !appointmentId) {
    return NextResponse.json({ ok: false, error: 'Missing tenantId or appointmentId' }, { status: 400 });
  }
  if (clientReason && !CLIENT_REASON_VALUES.includes(clientReason)) {
    return NextResponse.json({ ok: false, error: 'Invalid clientReason' }, { status: 400 });
  }

  const { db, FieldValue } = getAdmin();
  const apptRef = db.doc(`tenants/${tenantId}/appointments/${appointmentId}`);
  const apptSnap = await apptRef.get();
  if (!apptSnap.exists) {
    return NextResponse.json({ ok: false, error: 'Appointment not found' }, { status: 404 });
  }
  const appt = apptSnap.data();

  // Only the client's own link (their visit token as the key), staff, or our own server can cancel.
  // An appointment id alone is not enough — it isn't a secret.
  const key = String((body as any)?.k || '');
  const keyOk = !!key && !!appt.checkInToken && key === appt.checkInToken;
  if (!keyOk && !(await staffOrServer(req, String(tenantId)))) {
    return NextResponse.json({ ok: false, error: 'For your security, please cancel from the link in your latest confirmation or your visit link.', code: 'needs_link' }, { status: 403 });
  }

  // Idempotent on double-submission.
  if (appt.status === 'cancelled') {
    return NextResponse.json({ ok: true, alreadyCancelled: true });
  }
  if (appt.status !== 'confirmed' && appt.status !== 'deposit_pending') {
    return NextResponse.json({ ok: false, error: 'This appointment can’t be cancelled online at this point.', status: appt.status }, { status: 409 });
  }

  const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
  const tenant = tenantSnap.data() || {};
  const clientSnap = appt.clientId ? await db.doc(`tenants/${tenantId}/clients/${appt.clientId}`).get() : null;
  const client = clientSnap?.exists ? clientSnap.data() : {};

  // ── Rule 2: Late Cancellation Window ─────────────────────────────────────
  const svcSnap = await db.doc(`tenants/${tenantId}/services/${appt.serviceId}`).get();
  const service = svcSnap.data() || {};
  // Booking policies: the window (a service can differ) and the deadline counted from the ORIGINAL time.
  const windowHours = Number(resolvePolicy(tenant, service).cancel.windowHours.value) || 24;
  const hrsUntil = hoursToDeadline(tenant, appt, service);
  const isLate = hrsUntil < windowHours;


  const isReschedule = clientReason === 'rescheduled' && !!rescheduledToId;
  // Studio bookings: the shared plan (fee from Booking policies, minus any deposit
  // the policy counts toward it). Renter bookings keep their own rules.
  const pv = appt.isRenterBooking ? null : await planSelfCancel(db, tenantId, appointmentId, appt, tenant, service, client, isReschedule);
  const feeAmount = pv ? pv.plan.due : (isLate && !isReschedule ? (tenant.cancellationFee || service.price || 0) : 0);
  const chargeFee = feeAmount > 0; // flagged, not waived, when inside the window

  // Read the card's customer + payment method from where the Connect webhook
  // actually vaults them (client.cardOnFile), preferring cardOnFile.customerId
  // over the top-level client.stripeCustomerId. These exact two values are
  // written onto the cancellationEvent below so onCancellationEvent can charge.
  const stripePaymentMethodId =
    client?.cardOnFile?.paymentMethodId || (hasRealCard(client) ? client?.cardOnFile?.token : null) || null;
  const stripeCustomerId =
    client?.cardOnFile?.stripeCustomerId ||
    client?.cardOnFile?.customerId ||
    client?.stripeCustomerId ||
    null;
  const hasCard = !!(stripePaymentMethodId && stripeCustomerId);
  let paymentMethod: 'card_on_file' | 'add_to_balance' | 'waived' =
    !chargeFee ? 'waived' : (hasCard ? 'card_on_file' : 'add_to_balance');
  // Studio bookings: charge the card NOW (no retries — never twice). A decline
  // falls back to what they owe, once; the background function is told it's done.
  let chargedIntentId: string | null = null;
  if (pv && chargeFee && hasCard) {
    const cr = await internalPost(internalOrigin(tenant, req.nextUrl.origin), '/api/stripe/charge-card', {
      tenantId, clientId: appt.clientId, amountCents: Math.round(feeAmount * 100), description: 'Late-cancellation fee', category: 'Cancellation Fees',
      appointmentId, reason: 'Client cancelled inside the window', mode: 'auto', kind: 'deposit' }, { retries: 0 });
    if (cr.ok && cr.data?.ok && cr.data?.paymentIntentId) chargedIntentId = cr.data.paymentIntentId;
    else paymentMethod = 'add_to_balance';
  }

  const now = new Date().toISOString();
  const eventId = nanoid();

  const cancellationAudit = {
    actorType: 'client' as const,
    actorId: appt.clientId || 'unknown_client',
    actorName: client?.name || appt.clientName || 'Client',
    reason: clientReason === 'other' ? 'other' : 'client_request',
    clientReason: clientReason || 'schedule_conflict',
    feeAmount,
    feeWaived: !chargeFee,
    paymentStatus: chargeFee ? 'unpaid' : 'paid',
    timestamp: now,
  };

  const batch = db.batch();

  // A credit or included visit already applied to the old visit FOLLOWS the
  // move to the new one — the client paid for it once.
  if (isReschedule && rescheduledToId && (appt.paidByPackageId || appt.paidByMembershipId)) {
    batch.set(db.doc(`tenants/${tenantId}/appointments/${rescheduledToId}`), {
      ...(appt.paidByPackageId ? { paidByPackageId: appt.paidByPackageId, paidByPackageName: appt.paidByPackageName || null } : {}),
      ...(appt.paidByMembershipId ? { paidByMembershipId: appt.paidByMembershipId, paidByMembershipName: appt.paidByMembershipName || null } : {}),
      creditMovedFromAppointmentId: appointmentId, creditMovedAt: now,
    }, { merge: true });
  }

  batch.update(apptRef, {
    status: 'cancelled',
    cancelledAt: now,
    ...(isReschedule ? { rescheduledToId, cancellationReason: 'rescheduled', paidByPackageId: null, paidByPackageName: null, paidByMembershipId: null, paidByMembershipName: null } : {}),
    cancellationAudit,
    cancellationEventId: eventId,
    cancellationFeeCharged: feeAmount,
    cancellationFeeWaived: !chargeFee,
  });

  // A RENTER'S client cancelling a package-covered (or package-eligible)
  // visit: the package's own terms decide whether a credit is kept or lost.
  // The studio's cancellation fee never applies to a renter booking.
  let packageNote: string | null = null;
  if (appt.isRenterBooking && !isReschedule) {
    try {
      const { decideCredit, hoursUntil } = await import('@/lib/package-credits');
      const purCol = db.collection(`tenants/${tenantId}/renterPackagePurchases`);
      let purchase: any = null;
      if (appt.paidByPackageId) { const p = await purCol.doc(String(appt.paidByPackageId)).get(); purchase = p.exists ? { id: p.id, ...(p.data() as any) } : null; }
      if (!purchase && appt.clientId) {
        const snap = await purCol.where('clientId', '==', String(appt.clientId)).get();
        purchase = snap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }))
          .filter((p: any) => p.status !== 'refunded' && (!p.expiresAt || p.expiresAt >= now) && ((Number(p.creditsTotal) || 0) - (Number(p.creditsUsed) || 0)) > 0)
          .filter((p: any) => !p.serviceId || !appt.serviceId || p.serviceId === appt.serviceId)[0] || null;
      }
      if (purchase) {
        const pkg = ((await db.doc(`tenants/${tenantId}/renterPackages/${String(purchase.packageId)}`).get()).data() as any) || {};
        const d = decideCredit(pkg, { by: 'client', how: 'cancel', hoursBeforeStart: hoursToDeadline(tenant, appt, service) }, !!appt.paidByPackageId, ((Number(purchase.creditsTotal) || 0) - (Number(purchase.creditsUsed) || 0)) > 0);
        const evRef = db.collection(`tenants/${tenantId}/packageEvents`).doc();
        if (d.action === 'restore') {
          batch.update(purCol.doc(purchase.id), { creditsUsed: Math.max(0, (Number(purchase.creditsUsed) || 0) - 1) });
          batch.update(apptRef, { paidByPackageId: null, paidByPackageName: null, packageCreditRestoredAt: now });
          batch.set(evRef, { id: evRef.id, purchaseId: purchase.id, appointmentId, clientId: appt.clientId || null, at: now, action: 'restore', reason: d.reason, ending: 'client_cancel' });
        } else if (d.action === 'forfeit') {
          batch.update(purCol.doc(purchase.id), { creditsUsed: (Number(purchase.creditsUsed) || 0) + 1, lastUsedAt: now });
          batch.update(apptRef, { paidByPackageId: purchase.id, paidByPackageName: purchase.packageName || pkg.name || 'Package', packageForfeitedAt: now });
          batch.set(evRef, { id: evRef.id, purchaseId: purchase.id, appointmentId, clientId: appt.clientId || null, at: now, action: 'forfeit', reason: d.reason, ending: 'client_cancel' });
        }
        packageNote = d.reason;
      }
    } catch (e) { console.error('[self-cancel] package rule', e); }
  }

  if (chargeFee && paymentMethod === 'add_to_balance' && appt.clientId && !appt.isRenterBooking) {
    batch.update(db.doc(`tenants/${tenantId}/clients/${appt.clientId}`), {
      outstandingBalance: FieldValue.increment(feeAmount),
      // appointmentDate set to NOW (when the fee was incurred), not the
      // original appointment's start time — aging should measure how long
      // this debt has existed, not how old the booking was.
      unpaidFees: FieldValue.arrayUnion({
        feeId: nanoid(),
        appointmentId,
        appointmentDate: now,
        feeAmount,
        reason: `Late Cancellation Fee (self-service)`,
      }),
    });
  }

  // Audit log — same shape as every other cancellation path in this codebase.
  const auditRef = db.collection(`tenants/${tenantId}/auditLog`).doc();
  batch.set(auditRef, {
    id: auditRef.id,
    tenantId,
    entityType: 'appointment_cancellation',
    entityId: appointmentId,
    actorType: 'client',
    actorId: appt.clientId || 'unknown_client',
    actorName: client?.name || appt.clientName || 'Client',
    timestamp: now,
    summary: `${client?.name || appt.clientName || 'Client'} self-cancelled their appointment${chargeFee ? ` — $${feeAmount.toFixed(2)} late-cancellation fee` : ''}`,
    detail: {
      clientId: appt.clientId || null,
      clientName: client?.name || appt.clientName || 'Unknown',
      reason: cancellationAudit.reason,
      clientReason: cancellationAudit.clientReason,
      feeAmount,
      feeWaived: !chargeFee,
      paymentMethod: chargeFee ? paymentMethod : undefined,
      selfService: true,
      hoursUntilStart: Math.round(hrsUntil * 10) / 10,
      cancellationWindowHours: windowHours,
    },
  });

  // cancellationEvent → triggers onCancellationEvent for Stripe + email + SMS.
  // NOTE: stripeCustomerId / stripePaymentMethodId here use the RESOLVED
  // variables above (cardOnFile-first), NOT inline top-level reads — this is
  // the line that makes the fee actually charge.
  batch.set(db.doc(`tenants/${tenantId}/cancellationEvents/${eventId}`), {
    id: eventId,
    tenantId,
    appointmentId,
    clientId: appt.clientId || null,
    clientName: client?.name || appt.clientName || 'Guest',
    // Studio bookings: the client gets ONE message from here (sendCancellationNotice) — not a second from the function.
    clientEmail: pv ? null : (client?.email || appt.clientEmail || null),
    clientPhone: pv ? null : (client?.phone || appt.clientPhone || null),
    ...(pv ? { clientNotifiedBy: 'visit link' } : {}),
    serviceId: appt.serviceId,
    serviceName: service.name || null,
    staffId: appt.staffId || null,
    appointmentStartTime: appt.startTime,
    chargeFee,
    feeAmount,
    paymentMethod,
    // Already charged here → no card details, so the function can't charge twice.
    stripeCustomerId: chargedIntentId ? null : stripeCustomerId,
    stripePaymentMethodId: chargedIntentId ? null : stripePaymentMethodId,
    ...(chargedIntentId ? { stripePaymentIntentId: chargedIntentId, chargedAt: now, chargedBy: 'visit link' } : {}),
    cancellationAudit,
    reason: cancellationAudit.reason,
    // onCancellationEvent only acts on 'pending'. A RESCHEDULE is a move —
    // the client already has the new confirmation, so no "your appointment
    // has been cancelled" email. A RENTER's booking is announced by this
    // route in the renter's own name (below), not the studio's. Both keep
    // the event for the audit trail.
    status: isReschedule ? 'skipped_reschedule' : appt.isRenterBooking ? 'handled_renter_voice' : 'pending',
    chargeStatus: chargedIntentId ? 'succeeded' : chargeFee ? (paymentMethod === 'card_on_file' ? 'pending' : 'balance') : 'waived',
    emailStatus: 'pending',
    smsStatus: 'pending',
    selfService: true,
    createdAt: now,
    processedAt: null,
    stripeChargeId: null,
    errorMessage: null,
  });

  // A reschedule carries the DEPOSIT across with the visit — it was paid
  // for the booking, not for that particular hour.
  if (isReschedule && rescheduledToId) {
    const depositFields: any = {};
    for (const k of ['depositAmountCents', 'depositStatus', 'depositPaidAt', 'renterDepositCents', 'renterDepositPaidAt', 'renterDepositSessionId', 'renterDepositChargeId']) {
      if (appt[k] !== undefined && appt[k] !== null) depositFields[k] = appt[k];
    }
    if (Object.keys(depositFields).length) {
      batch.set(db.doc(`tenants/${tenantId}/appointments/${rescheduledToId}`), { ...depositFields, depositMovedFromAppointmentId: appointmentId }, { merge: true });
    }
  }

  await batch.commit();

  // ── A renter's booking: the client hears it from the renter; the renter hears it too ──
  if (appt.isRenterBooking) {
    try {
      const { renterVoice, tellClient, notifyRenter, renterPortalUrl } = await import('@/lib/renter-comms');
      const st = appt.staffId ? ((await db.doc(`tenants/${tenantId}/staff/${String(appt.staffId)}`).get()).data() as any) : null;
      if (st?.renterId) {
        const tz = tenant.timezone || 'America/New_York';
        const when = new Date(appt.startTime).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz });
        const svcName = appt.renterServiceName || service.name || 'appointment';
        const portal = await renterPortalUrl(db, tenantId);
        if (isReschedule) {
          let newWhen = '';
          try { const n = ((await db.doc(`tenants/${tenantId}/appointments/${rescheduledToId}`).get()).data() as any); if (n?.startTime) newWhen = new Date(n.startTime).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz }); } catch { /* fine */ }
          await notifyRenter(db, tenantId, String(st.renterId), 'rescheduled', `${appt.clientName || 'A client'} moved ${svcName} from ${when}${newWhen ? ` to ${newWhen}` : ''}.`, { tone: 'slate', subject: `${appt.clientName || 'A client'} moved their visit`, link: portal });
        } else {
          const v = await renterVoice(db, tenantId, String(st.renterId));
          await tellClient(db, v, { email: client?.email || appt.clientEmail, phone: client?.phone || appt.clientPhone, clientId: appt.clientId || null, name: client?.name || appt.clientName || null },
            `Cancelled — ${svcName}, ${when}`,
            [`Your ${svcName} on ${when} is cancelled.`, packageNote ? packageNote : '', v.bookingUrl ? `Whenever you're ready, book again: ${v.bookingUrl}` : ''].filter(Boolean), 'renter_client_cancelled');
          await notifyRenter(db, tenantId, String(st.renterId), 'cancelled', `${appt.clientName || 'A client'} cancelled ${svcName} on ${when}${isLate ? ' (late notice)' : ''}. That time is open again.`, { tone: isLate ? 'amber' : 'slate', subject: `${appt.clientName || 'A client'} cancelled`, link: portal });
        }
      }
    } catch (e) { console.error('[self-cancel] renter voice', e); }
  }

  // ── Deposit disposition — best-effort, non-blocking. The appointment is ──
  // already cancelled by this point; a deposit-credit lookup hiccup should
  // never prevent a client from completing a cancellation they're entitled to.
  try {
    // A reschedule moved the deposit with the visit; there is nothing to refund.
    if (!isReschedule) await resolveDepositForClientCancel({ db, FieldValue, tenantId, appt, appointmentId, client, isLate, now,
      ...(pv ? { outcome: (pv.plan.outcome.deposit?.outcome as any) || null, creditId: pv.credit?.id || null, depositPolicy: pv.dp } : {}) });
  } catch (e) {
    console.error('[self-cancel deposit resolution]', e);
  }

  // One message to the client, saying exactly what happened (studio bookings).
  let lines: string[] | null = null;
  if (pv) {
    const outcome = { ...pv.plan.outcome, collected: !chargeFee ? pv.plan.outcome.collected : chargedIntentId ? 'card' : 'balance' } as any;
    try { lines = (await sendCancellationNotice(db, tenantId, appointmentId, outcome, internalOrigin(tenant, req.nextUrl.origin), { ...appt, status: 'cancelled' })).lines; } catch (e) { console.error('[self-cancel notice]', e); }
  }
  return NextResponse.json({ ok: true, feeCharged: chargeFee, feeAmount, isLate, packageNote, lines });
}

// ── Deposit resolution — mirrors useCancellationConfirm v3's client-cancel ────
// logic exactly, so the public self-service path and the staff-dialog
// client-cancel path behave identically. Operates on depositCredits, NOT the
// appointment.depositAmountCents fields (see the architectural-gap note in
// useCancellationConfirm.ts about these two not yet being unified).
async function resolveDepositForClientCancel(opts: {
  db: any;
  FieldValue: any;
  tenantId: string;
  appt: any;
  appointmentId: string;
  client: any;
  isLate: boolean;
  now: string;
  /** The plan's decision (planCancellation) — when given, do exactly this. */
  outcome?: 'forfeit' | 'applied' | 'rollover' | 'store_credit' | 'refund' | null;
  creditId?: string | null;
  depositPolicy?: any;
}) {
  const { db, tenantId, appt, appointmentId, client, isLate, now } = opts;

  const creditsCol = db.collection(`tenants/${tenantId}/depositCredits`);
  let snap = appt.clientId
    ? await creditsCol.where('status', '==', 'available').where('clientId', '==', appt.clientId).get()
    : { empty: true, docs: [] as any[] };
  if (snap.empty && client?.email) {
    snap = await creditsCol.where('status', '==', 'available').where('clientEmail', '==', String(client.email).toLowerCase().trim()).get();
  }
  if (snap.empty) return; // no deposit credit on file for this client — nothing to resolve

  const candidates = snap.docs
    .map((d: any) => ({ ref: d.ref, ...(d.data() as any) }))
    .filter((c: any) => !isCreditExpired(c.expiresAt));
  candidates.sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  const credit = (opts.creditId && candidates.find((c: any) => c.ref?.id === opts.creditId)) || candidates[0];
  if (!credit) return;

  const amount = Number(credit.amountDollars ?? (credit.amountCents || 0) / 100);
  const oc = opts.outcome || (isLate ? 'forfeit' : 'refund');

  // Becomes credit for their next visit (the deposit policy's early-cancel default).
  if (oc === 'rollover' || oc === 'store_credit') {
    await credit.ref.set({ status: 'available', rolledOver: true, rolledOverAt: now, rolledOverFromAppointmentId: appointmentId,
      expiresAt: rolloverExpiryISO(opts.depositPolicy || resolveDepositPolicy({})) }, { merge: true });
    const decisionRef = db.collection(`tenants/${tenantId}/depositDecisions`).doc();
    await decisionRef.set({ id: decisionRef.id, tenantId, creditId: credit.ref.id, appointmentId, clientId: appt.clientId || null,
      trigger: 'client_cancel', outcome: 'rollover', reason: 'policy', amountDollars: amount, decidedAt: now });
    await db.doc(`tenants/${tenantId}/appointments/${appointmentId}`).set({ depositDisposition: 'rolled_over', depositDispositionAt: now }, { merge: true });
    return;
  }

  // Rule 2 maps directly onto deposit policy: outside the window the client
  // gave fair notice, so refund/rollover; inside the window, forfeit — the
  // studio already lost that slot, same logic as a no-show.
  if (oc === 'forfeit' || oc === 'applied') {
    await credit.ref.set({
      status: 'forfeited',
      forfeitedAt: now,
      forfeitedFromAppointmentId: appointmentId,
      lastDecisionReason: 'client_cancel_late',
    }, { merge: true });

    // Stamp the disposition on the appointment too, so the resolution wrap in
    // AppointmentDetailsSheet can show "deposit forfeited" rather than only
    // surfacing it via the ledger receipt line.
    await db.doc(`tenants/${tenantId}/appointments/${appointmentId}`).set({
      depositForfeited: true,
      depositForfeitedAt: now,
      depositForfeitedReason: 'client_cancel_late',
    }, { merge: true });

    const decisionRef = db.collection(`tenants/${tenantId}/depositDecisions`).doc();
    await decisionRef.set({
      id: decisionRef.id, tenantId, creditId: credit.id, appointmentId,
      clientId: appt.clientId || null, clientName: client?.name || credit.clientName || 'Client',
      trigger: 'client_cancel', outcome: 'forfeit', reason: 'client_cancel_late',
      amountDollars: amount, decidedAt: now,
    });

    // The studio is keeping this money — that's real, recognized revenue,
    // not just a status change on the credit record. Previously nothing
    // logged this as income anywhere, so forfeited deposits were invisible
    // to every financial report.
    const revenueRef = db.collection(`tenants/${tenantId}/transactions`).doc();
    await revenueRef.set({
      id: revenueRef.id, tenantId, appointmentId,
      clientId: appt.clientId || null, clientName: client?.name || credit.clientName || 'Client',
      date: now, type: 'income', category: 'Cancellation Revenue',
      amount, amountCents: Math.round(amount * 100),
      paymentMethod: 'Deposit', hasReceipt: false,
      description: 'Deposit forfeited — late self-service cancellation',
      notes: 'Client cancelled inside the studio\'s cancellation window; deposit retained per policy.',
    });
    return;
  }

  // Outside the window — refund requires staff confirmation, never
  // auto-executed from a public route. Record as pending + notify staff.
  const decisionRef = db.collection(`tenants/${tenantId}/depositDecisions`).doc();
  await decisionRef.set({
    id: decisionRef.id, tenantId, creditId: credit.id, appointmentId,
    clientId: appt.clientId || null, clientName: client?.name || credit.clientName || 'Client',
    trigger: 'client_cancel', outcome: 'refund_pending', reason: 'client_cancel_advance_notice',
    amountDollars: amount, decidedAt: now,
  });

  const adminsSnap = await db.collection(`tenants/${tenantId}/staff`).where('role', 'in', ['admin', 'owner']).get();
  const notifBatch = db.batch();
  adminsSnap.docs.forEach((d: any) => {
    const notifRef = db.collection(`tenants/${tenantId}/notifications`).doc();
    notifBatch.set(notifRef, {
      id: notifRef.id,
      userId: d.id,
      type: 'deposit_refund_pending',
      appointmentId,
      resolved: false,
      message: `${client?.name || credit.clientName || 'A client'} cancelled with advance notice — $${amount.toFixed(2)} deposit ready to refund`,
      link: `/clients/${appt.clientId || ''}`,
      createdAt: now,
      read: false,
    });
  });
  await notifBatch.commit();
}
