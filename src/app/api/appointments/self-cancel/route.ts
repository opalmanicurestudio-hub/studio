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
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tenantId = searchParams.get('tenantId');
  const appointmentId = searchParams.get('appointmentId');

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
    return NextResponse.json({ ok: false, error: 'This appointment can no longer be cancelled online — please call the studio.', status: appt.status }, { status: 409 });
  }

  const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
  const tenant = tenantSnap.data() || {};
  const svcSnap = await db.doc(`tenants/${tenantId}/services/${appt.serviceId}`).get();
  const service = svcSnap.data() || {};

  const windowHours = tenant.cancellationWindowHours ?? 24;
  const hrsUntil = hoursUntil(appt.startTime);
  const isLate = hrsUntil < windowHours;
  const estimatedFee = isLate ? (tenant.cancellationFee || service.price || 0) : 0;

  return NextResponse.json({
    ok: true,
    appointment: {
      clientName: appt.clientName || null,
      startTime: appt.startTime,
      serviceName: service.name || 'Service',
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

  const { tenantId, appointmentId, clientReason } = body;
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

  // Idempotent on double-submission.
  if (appt.status === 'cancelled') {
    return NextResponse.json({ ok: true, alreadyCancelled: true });
  }
  if (appt.status !== 'confirmed' && appt.status !== 'deposit_pending') {
    return NextResponse.json({ ok: false, error: 'This appointment can no longer be cancelled online — please call the studio.', status: appt.status }, { status: 409 });
  }

  const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
  const tenant = tenantSnap.data() || {};
  const clientSnap = appt.clientId ? await db.doc(`tenants/${tenantId}/clients/${appt.clientId}`).get() : null;
  const client = clientSnap?.exists ? clientSnap.data() : {};

  // ── Rule 2: Late Cancellation Window ─────────────────────────────────────
  const windowHours = tenant.cancellationWindowHours ?? 24;
  const hrsUntil = hoursUntil(appt.startTime);
  const isLate = hrsUntil < windowHours;

  const svcSnap = await db.doc(`tenants/${tenantId}/services/${appt.serviceId}`).get();
  const service = svcSnap.data() || {};

  const feeAmount = isLate ? (tenant.cancellationFee || service.price || 0) : 0;
  const chargeFee = feeAmount > 0; // flagged, not waived, when inside the window

  const hasCard = !!(client?.cardOnFile?.paymentMethodId || client?.cardOnFile?.token);
  const paymentMethod: 'card_on_file' | 'add_to_balance' | 'waived' =
    !chargeFee ? 'waived' : (hasCard ? 'card_on_file' : 'add_to_balance');

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

  batch.update(apptRef, {
    status: 'cancelled',
    cancelledAt: now,
    cancellationAudit,
    cancellationEventId: eventId,
    cancellationFeeCharged: feeAmount,
    cancellationFeeWaived: !chargeFee,
  });

  if (chargeFee && paymentMethod === 'add_to_balance' && appt.clientId) {
    batch.update(db.doc(`tenants/${tenantId}/clients/${appt.clientId}`), {
      outstandingBalance: FieldValue.increment(feeAmount),
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

  // cancellationEvent → triggers onCancellationEvent for Stripe + email + SMS
  batch.set(db.doc(`tenants/${tenantId}/cancellationEvents/${eventId}`), {
    id: eventId,
    tenantId,
    appointmentId,
    clientId: appt.clientId || null,
    clientName: client?.name || appt.clientName || 'Guest',
    clientEmail: client?.email || appt.clientEmail || null,
    clientPhone: client?.phone || appt.clientPhone || null,
    serviceId: appt.serviceId,
    serviceName: service.name || null,
    staffId: appt.staffId || null,
    appointmentStartTime: appt.startTime,
    chargeFee,
    feeAmount,
    paymentMethod,
    stripeCustomerId: client?.stripeCustomerId || null,
    stripePaymentMethodId: client?.cardOnFile?.paymentMethodId || client?.cardOnFile?.token || null,
    cancellationAudit,
    reason: cancellationAudit.reason,
    status: 'pending',
    chargeStatus: chargeFee ? (hasCard ? 'pending' : 'balance') : 'waived',
    emailStatus: 'pending',
    smsStatus: 'pending',
    selfService: true,
    createdAt: now,
    processedAt: null,
    stripeChargeId: null,
    errorMessage: null,
  });

  await batch.commit();

  // ── Deposit disposition — best-effort, non-blocking. The appointment is ──
  // already cancelled by this point; a deposit-credit lookup hiccup should
  // never prevent a client from completing a cancellation they're entitled to.
  try {
    await resolveDepositForClientCancel({ db, FieldValue, tenantId, appt, appointmentId, client, isLate, now });
  } catch (e) {
    console.error('[self-cancel deposit resolution]', e);
  }

  return NextResponse.json({ ok: true, feeCharged: chargeFee, feeAmount, isLate });
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
  const credit = candidates[0];
  if (!credit) return;

  const amount = Number(credit.amountDollars ?? (credit.amountCents || 0) / 100);

  // Rule 2 maps directly onto deposit policy: outside the window the client
  // gave fair notice, so refund/rollover; inside the window, forfeit — the
  // studio already lost that slot, same logic as a no-show.
  if (isLate) {
    await credit.ref.set({
      status: 'forfeited',
      forfeitedAt: now,
      forfeitedFromAppointmentId: appointmentId,
      lastDecisionReason: 'client_cancel_late',
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