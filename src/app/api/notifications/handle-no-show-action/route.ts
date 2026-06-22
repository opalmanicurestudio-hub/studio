/**
 * api/notifications/handle-no-show-action/route.ts
 *
 * Called when staff taps "Confirm No-Show" or "Client Is Here" from
 * a suspected_no_show or no_show_escalation notification — or when staff
 * manually confirm a no-show via CancelAppointmentDialog before the
 * automated flag even fires (see guard note below).
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
 *   - Forfeits any available deposit credit (depositCredits collection —
 *     see note below on why this isn't the appointment-level deposit fields)
 *
 * On dismiss_no_show:
 *   - Clears suspectedNoShow flag
 *   - Marks notification resolved
 *   - Logs that client arrived (helps tune the window setting over time)
 *
 * REVISED — deposit forfeiture: previously checked
 * appt.depositStatus === 'paid' && appt.depositAmountCents > 0, which the
 * actual deposit-payment webhook never populates in this codebase. Switched
 * to looking up tenants/{tenantId}/depositCredits directly, matching every
 * other cancellation path (studio-cancel-refund, useCancellationConfirm,
 * self-cancel).
 */

import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { spawnRecoveryTicket } from '@/lib/opal/recovery-engine';
import { appendBehaviorEvent } from '@/lib/opal/behavior-ledger';

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

function isCreditExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() <= Date.now();
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

  // Guard: only "already cancelled" is a true duplicate-tap/idempotency
  // situation. Deliberately NOT also gating on `!appt.suspectedNoShow` —
  // this route is the canonical no-show confirmation endpoint, called both
  // from a flagged notification AND from staff manually confirming a
  // no-show via CancelAppointmentDialog (e.g. before the 15-minute
  // auto-flag window even elapses). The latter case legitimately has
  // suspectedNoShow unset; gating on it there used to silently swallow a
  // real confirmation request instead of actually cancelling anything.
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
  // in the client-facing email/SMS regardless of fee mode.
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
      // Same fix as self-cancel and useCancellationConfirm — without this,
      // the balance went up but the Ledger's Bad Debt Aging widget (reads
      // unpaidFees) never saw it.
      unpaidFees: FieldValue.arrayUnion({
        feeId: nanoid(),
        appointmentId: appt.id,
        appointmentDate: now,
        feeAmount,
        reason: 'No-Show Fee',
      }),
    });
  }

  // ── Deposit forfeiture — depositCredits, not appointment fields ──────────
  let depositForfeitedAmount = 0;
  try {
    const creditsCol = db.collection(`tenants/${tenantId}/depositCredits`);
    let creditSnap = appt.clientId
      ? await creditsCol.where('status', '==', 'available').where('clientId', '==', appt.clientId).get()
      : { empty: true, docs: [] as any[] };
    if (creditSnap.empty && client?.email) {
      creditSnap = await creditsCol.where('status', '==', 'available').where('clientEmail', '==', String(client.email).toLowerCase().trim()).get();
    }
    if (!creditSnap.empty) {
      const candidates = creditSnap.docs
        .map((d: any) => ({ ref: d.ref, id: d.id, ...(d.data() as any) }))
        .filter((c: any) => !isCreditExpired(c.expiresAt));
      candidates.sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
      const credit = candidates[0];
      if (credit) {
        depositForfeitedAmount = Number(credit.amountDollars ?? (credit.amountCents || 0) / 100);
        batch.set(credit.ref, {
          status: 'forfeited',
          forfeitedAt: now,
          forfeitedFromAppointmentId: appt.id,
          lastDecisionReason: 'no_show',
        }, { merge: true });

        const txRef = db.collection(`tenants/${tenantId}/transactions`).doc();
        batch.set(txRef, {
          id: txRef.id, tenantId, appointmentId: appt.id, clientId: appt.clientId,
          clientName: client.name || appt.clientName || 'Client',
          date: now, type: 'income', category: 'No-Show Revenue',
          amount: depositForfeitedAmount, amountCents: Math.round(depositForfeitedAmount * 100),
          paymentMethod: 'Deposit', hasReceipt: false,
          description: 'Deposit forfeited — no-show',
        });
      }
    }
  } catch (e) {
    console.error('[handle-no-show-action] deposit forfeiture lookup failed', e);
    // Best-effort — don't block the cancellation on a deposit-lookup hiccup.
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
    summary:    `Staff confirmed no-show: ${client.name || appt.clientName} — $${feeAmount.toFixed(2)} fee${depositForfeitedAmount > 0 ? `, $${depositForfeitedAmount.toFixed(2)} deposit forfeited` : ''}`,
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

  // ── Behavior ledger + recovery, post-commit (the slot is now genuinely dead).
  //    A no-show is the trigger; the Resolution ticket is the cancellationEvent
  //    (eventId). Wrapped so a recovery hiccup never fails the confirmation.
  try {
    await appendBehaviorEvent(db, {
      tenantId,
      clientId: appt.clientId,
      eventType: 'no_show',
      // If the no-showed appointment was itself a recovered fill, weigh leniently.
      weightContext: appt.source === 'recovery' ? 'recovery_fill' : 'normal',
      locationId: appt.locationId || null,
      resolutionTicketId: eventId,
    });
    await spawnRecoveryTicket(db, {
      tenantId,
      resolutionTicketId: eventId,
      locationId: appt.locationId || null,
      providerId: appt.staffId || appt.providerId || '',
      resourceIds: appt.resourceIds || [],
      serviceId: appt.serviceId || '',
      durationMinutes: appt.durationMinutes
        || Math.max(15, Math.round((new Date(appt.endTime).getTime() - new Date(appt.startTime).getTime()) / 60000)),
      slotStart: appt.startTime,
      slotEnd: appt.endTime,
      originalAppointmentValueCents: Math.round((feeAmount || 0) * 100),
    });
  } catch (e) {
    console.error('[handle-no-show-action] behavior/recovery post-commit failed', e);
  }

  return NextResponse.json({ ok: true, action: 'confirmed', eventId, depositForfeitedAmount });
}
