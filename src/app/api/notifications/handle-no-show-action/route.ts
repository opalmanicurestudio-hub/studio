/**
 * api/notifications/handle-no-show-action/route.ts
 *
 * Called when staff taps "Confirm No-Show" or "Client Is Here" from
 * a suspected_no_show or no_show_escalation notification.
 *
 * POST body:
 *   { tenantId, appointmentId, notificationId, action, staffId }
 *
 * action: 'confirm_no_show' | 'dismiss_no_show'
 *
 * On confirm_no_show:
 *   - Creates a cancellationEvent with actorType='no_show' (triggers full pipeline)
 *   - Marks notification resolved
 *   - Clears suspectedNoShow flag (appointment now properly cancelled)
 *
 * On dismiss_no_show:
 *   - Clears suspectedNoShow flag
 *   - Marks notification resolved
 *   - Logs that client arrived (helps tune the window setting over time)
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

export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const { tenantId, appointmentId, notificationId, action, staffId } = body;

  if (!tenantId || !appointmentId || !action || !staffId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  if (!['confirm_no_show', 'dismiss_no_show'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  const { db, FieldValue } = getAdmin();
  const now = new Date().toISOString();

  const apptRef  = db.doc(`tenants/${tenantId}/appointments/${appointmentId}`);
  const apptSnap = await apptRef.get();

  if (!apptSnap.exists) {
    return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
  }

  const appt = apptSnap.data();

  // Guard: only the "already cancelled" case is a true duplicate-tap/idempotency
  // situation. Do NOT also gate on `!appt.suspectedNoShow` — this route is the
  // canonical no-show confirmation endpoint, called both from a flagged
  // notification AND from staff manually confirming a no-show via
  // CancelAppointmentDialog (e.g. before the 15-minute auto-flag window even
  // elapses). The latter case legitimately has suspectedNoShow unset, and
  // previously got silently swallowed here instead of actually cancelling.
  if (appt.status === 'cancelled') {
    if (notificationId) {
      await db.doc(`tenants/${tenantId}/notifications/${notificationId}`)
        .update({ resolved: true, resolvedAt: now });
    }
    return NextResponse.json({ ok: true, alreadyResolved: true });
  }

  const batch = db.batch();

  // ── Resolve all pending notifications for this appointment ────────────────
  const notifSnap = await db
    .collection(`tenants/${tenantId}/notifications`)
    .where('appointmentId', '==', appointmentId)
    .where('resolved', '==', false)
    .where('type', 'in', ['suspected_no_show', 'no_show_escalation'])
    .get();

  notifSnap.docs.forEach((d: any) => {
    batch.update(d.ref, {
      resolved:    true,
      resolvedAt:  now,
      resolvedBy:  staffId,
      resolution:  action,
    });
  });

  if (action === 'dismiss_no_show') {
    // ── Client is here — clear the flag, log the false positive ──────────────
    batch.update(apptRef, {
      suspectedNoShow:          false,
      suspectedNoShowCleared:   true,
      suspectedNoShowClearedAt: now,
      suspectedNoShowClearedBy: staffId,
      noShowFalsePositive:      true, // analytics: helps tune the window
    });

    await batch.commit();
    return NextResponse.json({ ok: true, action: 'dismissed' });
  }

  // ── action === 'confirm_no_show' ──────────────────────────────────────────
  // Load client for contact info
  const clientSnap = await db.doc(`tenants/${tenantId}/clients/${appt.clientId}`).get();
  const client     = clientSnap.data() || {};

  // Load tenant for fee config
  const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
  const tenant     = tenantSnap.data() || {};

  // Always look up the primary service — needed for an accurate service name
  // in the client-facing email/SMS regardless of fee mode (previously this
  // lookup was skipped entirely when noShowFeeMode === 'flat', leaving the
  // cancellationEvent's serviceName null and emails saying generic
  // "your service").
  const primarySvcSnap = await db.doc(`tenants/${tenantId}/services/${appt.serviceId}`).get();
  const primarySvcName = primarySvcSnap.data()?.name || null;

  // Compute fee (100% of service by default; respects noShowFeeMode)
  let feeAmount = 0;
  if (tenant.noShowFeeMode === 'flat' && tenant.flatNoShowFee) {
    feeAmount = tenant.flatNoShowFee;
  } else {
    feeAmount = primarySvcSnap.data()?.price || 0;
    if (appt.addOnIds?.length) {
      const addOnSnaps = await Promise.all(
        appt.addOnIds.map((id: string) =>
          db.doc(`tenants/${tenantId}/services/${id}`).get(),
        ),
      );
      addOnSnaps.forEach((s: any) => { if (s.exists) feeAmount += s.data()?.price || 0; });
    }
  }

  const hasCard        = !!(client.cardOnFile?.paymentMethodId || client.cardOnFile?.token);
  const paymentMethod  = hasCard ? 'card_on_file' : 'add_to_balance';
  const eventId        = nanoid();

  const cancellationAudit = {
    actorType:   'no_show',
    actorId:     staffId,
    actorName:   'Staff Confirmed',
    reason:      'no-show',
    feeAmount,
    feeWaived:   false,
    paymentStatus: 'unpaid',
    timestamp:   now,
    confirmedBy: staffId,
    confirmedAt: now,
  };

  // Mark appointment cancelled
  batch.update(apptRef, {
    status:                 'cancelled',
    cancelledAt:            now,
    suspectedNoShow:        false,
    noShowConfirmedBy:      staffId,
    noShowConfirmedAt:      now,
    cancellationEventId:    eventId,
    cancellationFeeCharged: feeAmount,
    cancellationAudit,
  });

  // Optimistic balance update if no card
  if (paymentMethod === 'add_to_balance' && feeAmount > 0) {
    batch.update(db.doc(`tenants/${tenantId}/clients/${appt.clientId}`), {
      outstandingBalance: FieldValue.increment(feeAmount),
    });
  }

  // Handle deposit forfeiture
  if (appt.depositStatus === 'paid' && appt.depositAmountCents > 0) {
    batch.update(apptRef, {
      depositForfeited:       true,
      depositForfeitedAt:     now,
      depositForfeitedReason: 'no_show',
    });
    const txRef = db.collection(`tenants/${tenantId}/transactions`).doc();
    batch.set(txRef, {
      id:            txRef.id,
      tenantId,
      appointmentId: appt.id,
      clientId:      appt.clientId,
      type:          'deposit_forfeiture',
      category:      'No-Show Deposit',
      amount:        appt.depositAmountCents / 100,
      amountCents:   appt.depositAmountCents,
      status:        'forfeited',
      createdAt:     now,
    });
  }

  // Audit log
  const auditRef = db.collection(`tenants/${tenantId}/auditLog`).doc();
  batch.set(auditRef, {
    id:         auditRef.id,
    tenantId,
    entityType: 'appointment_cancellation',
    entityId:   appointmentId,
    actorType:  'no_show',
    actorId:    staffId,
    actorName:  'Staff Confirmed No-Show',
    timestamp:  now,
    summary:    `Staff confirmed no-show: ${client.name || appt.clientName} — $${feeAmount.toFixed(2)} fee`,
  });

  // Create cancellationEvent → triggers onCancellationEvent (Stripe + email + SMS)
  const eventRef = db.doc(`tenants/${tenantId}/cancellationEvents/${eventId}`);
  batch.set(eventRef, {
    id:                    eventId,
    tenantId,
    appointmentId:         appt.id,
    clientId:              appt.clientId,
    clientName:            client.name || appt.clientName || 'Guest',
    clientEmail:           client.email || null,
    clientPhone:           client.phone || null,
    serviceId:             appt.serviceId,
    serviceName:           primarySvcName,
    staffId:               appt.staffId,
    appointmentStartTime:  appt.startTime,
    chargeFee:             feeAmount > 0,
    feeAmount,
    paymentMethod,
    stripeCustomerId:      client.stripeCustomerId || null,
    stripePaymentMethodId: client.cardOnFile?.paymentMethodId || client.cardOnFile?.token || null,
    cancellationAudit,
    reason:                'no-show',
    status:                'pending',
    chargeStatus:          hasCard ? 'pending' : 'balance',
    emailStatus:           'pending',
    smsStatus:             'pending',
    staffConfirmed:        true,
    confirmedBy:           staffId,
    createdAt:             now,
    processedAt:           null,
    stripeChargeId:        null,
    errorMessage:          null,
  });

  await batch.commit();
  return NextResponse.json({ ok: true, action: 'confirmed', eventId });
}
