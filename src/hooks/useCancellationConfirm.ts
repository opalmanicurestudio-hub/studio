'use client';

/**
 * useCancellationConfirm
 *
 * Drop this hook into whatever parent renders <CancelAppointmentDialog />.
 * It returns the `onConfirm` handler the dialog expects.
 *
 * What it does:
 *  1. Writes a `cancellationEvents` document → triggers the Firebase Function
 *  2. Marks the appointment cancelled in Firestore immediately (optimistic)
 *  3. If paymentMethod === 'add_to_balance', increments the client's balance
 *     locally so the UI reflects it without waiting for the function
 *  4. The actual Stripe charge + email + SMS happens in the Firebase Function
 */

import { useCallback } from 'react';
import {
  doc,
  collection,
  writeBatch,
  increment,
  serverTimestamp,
} from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { nanoid } from 'nanoid';
import type { Appointment, Client } from '@/lib/data';

interface CancellationConfirmPayload {
  reason: string;
  chargeFee: boolean;
  feeAmount: number;
  paymentMethod: 'card_on_file' | 'add_to_balance' | 'waived';
  cancellationAudit: any;
  auditLogEntry: any;
}

export function useCancellationConfirm(
  appointment: Appointment | null,
  client: Client | null,
) {
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();
  const { toast } = useToast();
  const tenantId = selectedTenant?.id;

  const onConfirm = useCallback(
    async (payload: CancellationConfirmPayload) => {
      if (!firestore || !tenantId || !appointment || !client) return;

      const {
        reason,
        chargeFee,
        feeAmount,
        paymentMethod,
        cancellationAudit,
        auditLogEntry,
      } = payload;

      const eventId = nanoid();
      const now = new Date().toISOString();
      const batch = writeBatch(firestore);

      // ── 1. Mark appointment cancelled ──────────────────────────────────────
      const appointmentRef = doc(
        firestore,
        `tenants/${tenantId}/appointments`,
        appointment.id,
      );
      batch.update(appointmentRef, {
        status: 'cancelled',
        cancelledAt: now,
        cancellationAudit,
        cancellationEventId: eventId,
        // Keep the fee amount visible in reporting even if waived
        cancellationFeeCharged: chargeFee ? feeAmount : 0,
        cancellationFeeWaived: !chargeFee && feeAmount > 0,
      });

      // Mirror on walkIn document if applicable
      if (appointment.isWalkIn) {
        const walkInId = String(appointment.id).replace('apt-walkin-', '');
        const walkInRef = doc(firestore, `tenants/${tenantId}/walkIns`, walkInId);
        batch.update(walkInRef, {
          status: 'cancelled',
          cancelledAt: now,
          cancellationAudit,
        });
      }

      // ── 2. Optimistic balance update ───────────────────────────────────────
      // If we're adding to balance we update the client record immediately so
      // staff see it without waiting for the function to run.
      if (chargeFee && feeAmount > 0 && paymentMethod === 'add_to_balance') {
        const clientRef = doc(firestore, `tenants/${tenantId}/clients`, client.id);
        batch.update(clientRef, {
          outstandingBalance: increment(feeAmount),
        });
      }

      // ── 3. Audit log entry ─────────────────────────────────────────────────
      const auditRef = doc(collection(firestore, `tenants/${tenantId}/auditLog`));
      batch.set(auditRef, {
        id: auditRef.id,
        tenantId,
        ...auditLogEntry,
        createdAt: now,
      });

      // ── 4. Write the cancellation event ───────────────────────────────────
      // This is the Firestore write that the Firebase Function watches.
      // Everything async (Stripe, email, SMS) happens there.
      const eventRef = doc(
        firestore,
        `tenants/${tenantId}/cancellationEvents`,
        eventId,
      );
      batch.set(eventRef, {
        id: eventId,
        tenantId,
        appointmentId: appointment.id,
        clientId: client.id,
        clientName: client.name,
        clientEmail: client.email || null,
        clientPhone: client.phone || null,
        serviceId: appointment.serviceId,
        serviceName: appointment.serviceName || null,
        staffId: appointment.staffId,
        appointmentStartTime: appointment.startTime,

        // Payment fields — the function reads these to decide what to charge
        chargeFee,
        feeAmount,
        paymentMethod, // 'card_on_file' | 'add_to_balance' | 'waived'
        stripeCustomerId: client.stripeCustomerId || null,
        stripePaymentMethodId:
          client.cardOnFile?.paymentMethodId || client.cardOnFile?.token || null,

        // Audit
        cancellationAudit,
        reason,

        // Function processing state — the function sets these as it works
        status: 'pending', // → 'processing' → 'complete' | 'failed'
        chargeStatus: chargeFee && paymentMethod === 'card_on_file'
          ? 'pending'     // → 'charged' | 'failed' | 'waived'
          : paymentMethod === 'add_to_balance'
          ? 'balance'
          : 'waived',
        emailStatus: 'pending',   // → 'sent' | 'failed' | 'skipped'
        smsStatus: 'pending',     // → 'sent' | 'failed' | 'skipped'

        createdAt: now,
        processedAt: null,
        stripeChargeId: null,
        errorMessage: null,
      });

      await batch.commit();

      toast({
        title: 'Appointment Cancelled',
        description: chargeFee && feeAmount > 0
          ? paymentMethod === 'card_on_file'
            ? `$${feeAmount.toFixed(2)} cancellation fee is being charged to the card on file.`
            : paymentMethod === 'add_to_balance'
            ? `$${feeAmount.toFixed(2)} added to ${client.name}'s outstanding balance.`
            : 'Cancellation recorded.'
          : 'Cancellation recorded. No fee charged.',
      });
    },
    [firestore, tenantId, appointment, client, toast],
  );

  return onConfirm;
}
