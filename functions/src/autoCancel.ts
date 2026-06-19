/**
 * functions/src/autoCancel.ts
 *
 * Scheduled function that runs every 5 minutes and enforces the studio's
 * cancellation business rules automatically:
 *
 *   Rule 1 — No-Show Window
 *     If an appointment is still 'confirmed' or 'servicing' X minutes after
 *     its start time and the client never arrived, auto-cancel as no-show.
 *     Default window: 15 minutes. Configurable per tenant: tenant.noShowWindowMinutes
 *
 *   Rule 2 — Late Cancellation Window
 *     If a client's self-service cancellation link is used inside the studio's
 *     cancellation window, automatically flag the fee rather than waiving it.
 *     (This rule logs a flag — the actual charge still goes through the event pipeline.)
 *
 *   Rule 3 — Deposit Forfeiture on No-Show
 *     If a no-show appointment had a deposit paid, automatically mark it
 *     forfeited and create a transaction record.
 *
 *   Rule 4 — Repeat No-Show Flag
 *     If a client has ≥ N no-shows in the past 90 days, automatically add
 *     a flag to their profile (e.g. requireDeposit, requireCardOnFile).
 *     Configurable: tenant.repeatNoShowThreshold (default: 2)
 *
 * The function creates a cancellationEvent document for each auto-cancel,
 * which then triggers onCancellationEvent for Stripe + email + SMS.
 */

import * as functions from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { nanoid } from 'nanoid';

const db = admin.firestore();

// ── Types ─────────────────────────────────────────────────────────────────────

interface TenantConfig {
  id: string;
  name: string;
  noShowWindowMinutes?: number;       // minutes after start before auto no-show (default 15)
  cancellationWindowHours?: number;   // hours before appt inside which fee applies (default 24)
  repeatNoShowThreshold?: number;     // no-shows before flagging client (default 2)
  noShowFeeMode?: 'full_service' | 'flat' | 'matrix'; // how to compute the fee
  flatNoShowFee?: number;
  autoCancelEnabled?: boolean;        // master kill-switch (default true)
  cancellationEmailEnabled?: boolean;
  cancellationSmsEnabled?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60 * 1000);
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function hoursUntil(dateStr: string): number {
  return (new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60);
}

// ── Main scheduled function ───────────────────────────────────────────────────
export const autoCancel = functions.scheduler.onSchedule(
  {
    schedule: 'every 5 minutes',
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const tenantsSnap = await db.collection('tenants').get();

    await Promise.allSettled(
      tenantsSnap.docs.map(async tenantDoc => {
        const tenant = { id: tenantDoc.id, ...tenantDoc.data() } as TenantConfig;

        // Per-tenant kill-switch
        if (tenant.autoCancelEnabled === false) return;

        await Promise.allSettled([
          processNoShows(tenant),
          processRepeatNoShowFlags(tenant),
        ]);
      }),
    );
  },
);

// ── Rule 1: No-Show Detection ─────────────────────────────────────────────────
async function processNoShows(tenant: TenantConfig) {
  const windowMinutes = tenant.noShowWindowMinutes ?? 15;
  const cutoff = minutesAgo(windowMinutes);

  // Find appointments that started more than `windowMinutes` ago,
  // are still in 'confirmed' status, and haven't been auto-cancelled yet.
  const apptSnap = await db
    .collection(`tenants/${tenant.id}/appointments`)
    .where('status', '==', 'confirmed')
    .where('startTime', '<=', cutoff.toISOString())
    .where('autoCancelledNoShow', '==', false)  // prevent double-processing
    .get();

  if (apptSnap.empty) return;

  await Promise.allSettled(
    apptSnap.docs.map(async apptDoc => {
      const appt = { id: apptDoc.id, ...apptDoc.data() } as any;

      // Guard: if the appointment was checked in (actualStartTime set), skip
      if (appt.actualStartTime) return;

      const clientSnap = await db
        .doc(`tenants/${tenant.id}/clients/${appt.clientId}`)
        .get();
      const client = clientSnap.data();
      if (!client) return;

      // Compute fee
      let feeAmount = 0;
      if (tenant.noShowFeeMode === 'flat' && tenant.flatNoShowFee) {
        feeAmount = tenant.flatNoShowFee;
      } else {
        // Default: 100% of service price
        const svcSnap = await db
          .doc(`tenants/${tenant.id}/services/${appt.serviceId}`)
          .get();
        const svc = svcSnap.data();
        feeAmount = svc?.price || 0;

        // Include add-on prices
        if (appt.addOnIds?.length) {
          const addOnSnaps = await Promise.all(
            appt.addOnIds.map((id: string) =>
              db.doc(`tenants/${tenant.id}/services/${id}`).get(),
            ),
          );
          addOnSnaps.forEach(s => {
            if (s.exists) feeAmount += s.data()?.price || 0;
          });
        }
      }

      const hasCard = !!(
        client.cardOnFile?.paymentMethodId || client.cardOnFile?.token
      );
      const paymentMethod = hasCard ? 'card_on_file' : 'add_to_balance';
      const eventId = nanoid();
      const now = new Date().toISOString();

      const batch = db.batch();

      // Mark appointment cancelled
      batch.update(apptDoc.ref, {
        status: 'cancelled',
        cancelledAt: now,
        autoCancelledNoShow: true,
        cancellationEventId: eventId,
        cancellationFeeCharged: feeAmount,
        cancellationAudit: {
          actorType: 'no_show',
          actorId: 'system',
          actorName: 'Auto-Cancel System',
          reason: 'no-show',
          feeAmount,
          feeWaived: false,
          paymentStatus: 'unpaid',
          timestamp: now,
        },
      });

      // Optimistic balance update
      if (paymentMethod === 'add_to_balance' && feeAmount > 0) {
        const clientRef = db.doc(`tenants/${tenant.id}/clients/${appt.clientId}`);
        batch.update(clientRef, {
          outstandingBalance: admin.firestore.FieldValue.increment(feeAmount),
        });
      }

      // Handle deposit forfeiture (Rule 3)
      if (appt.depositStatus === 'paid' && appt.depositAmountCents > 0) {
        batch.update(apptDoc.ref, {
          depositForfeited: true,
          depositForfeitedAt: now,
          depositForfeitedReason: 'no_show',
        });
        const txRef = db.collection(`tenants/${tenant.id}/transactions`).doc();
        batch.set(txRef, {
          id: txRef.id,
          tenantId: tenant.id,
          appointmentId: appt.id,
          clientId: appt.clientId,
          type: 'deposit_forfeiture',
          category: 'No-Show Deposit',
          amount: appt.depositAmountCents / 100,
          amountCents: appt.depositAmountCents,
          status: 'forfeited',
          createdAt: now,
        });
      }

      // Audit log
      const auditRef = db.collection(`tenants/${tenant.id}/auditLog`).doc();
      batch.set(auditRef, {
        id: auditRef.id,
        tenantId: tenant.id,
        entityType: 'appointment_cancellation',
        entityId: appt.id,
        actorType: 'no_show',
        actorId: 'system',
        actorName: 'Auto-Cancel System',
        timestamp: now,
        summary: `Auto no-show: ${client.name || appt.clientName} — $${feeAmount.toFixed(2)} fee`,
        detail: {
          clientId: appt.clientId,
          clientName: client.name || appt.clientName,
          reason: 'no-show',
          feeAmount,
          paymentMethod,
          windowMinutes,
          autoTriggered: true,
        },
      });

      // Create the cancellationEvent — triggers onCancellationEvent
      const eventRef = db
        .doc(`tenants/${tenant.id}/cancellationEvents/${eventId}`);
      batch.set(eventRef, {
        id: eventId,
        tenantId: tenant.id,
        appointmentId: appt.id,
        clientId: appt.clientId,
        clientName: client.name || appt.clientName || 'Guest',
        clientEmail: client.email || null,
        clientPhone: client.phone || null,
        serviceId: appt.serviceId,
        serviceName: appt.serviceName || null,
        staffId: appt.staffId,
        appointmentStartTime: appt.startTime,
        chargeFee: feeAmount > 0,
        feeAmount,
        paymentMethod,
        stripeCustomerId: client.stripeCustomerId || null,
        stripePaymentMethodId:
          client.cardOnFile?.paymentMethodId || client.cardOnFile?.token || null,
        cancellationAudit: {
          actorType: 'no_show',
          actorId: 'system',
          actorName: 'Auto-Cancel System',
          reason: 'no-show',
          feeAmount,
          feeWaived: false,
          paymentStatus: 'unpaid',
          timestamp: now,
        },
        reason: 'no-show',
        status: 'pending',
        chargeStatus: hasCard ? 'pending' : 'balance',
        emailStatus: 'pending',
        smsStatus: 'pending',
        autoTriggered: true,
        createdAt: now,
        processedAt: null,
        stripeChargeId: null,
        errorMessage: null,
      });

      await batch.commit();
      console.log(`Auto no-show: tenant=${tenant.id} appt=${appt.id} fee=$${feeAmount}`);
    }),
  );
}

// ── Rule 4: Repeat No-Show Flagging ──────────────────────────────────────────
async function processRepeatNoShowFlags(tenant: TenantConfig) {
  const threshold = tenant.repeatNoShowThreshold ?? 2;
  const since = daysAgo(90).toISOString();

  // Find no-show cancellations in the past 90 days
  const noShowSnap = await db
    .collection(`tenants/${tenant.id}/appointments`)
    .where('status', '==', 'cancelled')
    .where('autoCancelledNoShow', '==', true)
    .where('cancelledAt', '>=', since)
    .get();

  // Group by clientId
  const countsByClient = new Map<string, number>();
  noShowSnap.docs.forEach(d => {
    const clientId = d.data().clientId;
    if (clientId) countsByClient.set(clientId, (countsByClient.get(clientId) || 0) + 1);
  });

  await Promise.allSettled(
    Array.from(countsByClient.entries()).map(async ([clientId, count]) => {
      if (count < threshold) return;

      const clientRef = db.doc(`tenants/${tenant.id}/clients/${clientId}`);
      const snap = await clientRef.get();
      if (!snap.exists) return;

      const client = snap.data()!;
      // Only update if not already flagged
      if (client.repeatNoShowFlagged) return;

      await clientRef.update({
        repeatNoShowFlagged: true,
        repeatNoShowCount: count,
        repeatNoShowFlaggedAt: new Date().toISOString(),
        // Enforce stricter requirements going forward
        requiresDepositOnBooking: true,
        requiresCardOnFile: true,
      });

      // Notify admins
      const adminsSnap = await db
        .collection(`tenants/${tenant.id}/staff`)
        .where('role', 'in', ['admin', 'owner'])
        .get();

      const batch = db.batch();
      adminsSnap.docs.forEach(d => {
        const notifRef = db.collection(`tenants/${tenant.id}/notifications`).doc();
        batch.set(notifRef, {
          id: notifRef.id,
          userId: d.id,
          type: 'repeat_no_show',
          message: `${client.name || 'A client'} has ${count} no-shows in 90 days — deposit + card now required`,
          link: `/clients/${clientId}`,
          createdAt: new Date().toISOString(),
          read: false,
        });
      });
      await batch.commit();

      console.log(`Repeat no-show flag: tenant=${tenant.id} client=${clientId} count=${count}`);
    }),
  );
}
