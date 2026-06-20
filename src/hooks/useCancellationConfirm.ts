'use client';

/**
 * useCancellationConfirm (v2)
 *
 * Changes from v1:
 *  - When actorType === 'studio', handles deposit disposition (refund / store credit)
 *    BEFORE writing the cancellationEvent, so the client gets their money back
 *    as part of the same action — not as a separate step staff can forget.
 *  - No-show path unchanged — staffConfirmed flow handles that via
 *    /api/notifications/handle-no-show-action
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
  // Studio-cancel deposit disposition — only present when actorType === 'studio'
  depositDisposition?: 'refund' | 'store_credit' | 'none';
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
        depositDisposition,
      } = payload;

      const isStudioCancel = cancellationAudit?.actorType === 'studio';
      const hasDeposit     = appointment.depositStatus === 'paid' &&
                             (appointment.depositAmountCents || 0) > 0;

      // ── Step 1: Handle deposit disposition for studio cancellations ──────────
      // Do this FIRST — before marking cancelled — so if Stripe refund fails,
      // we can surface the error without having already cancelled the appointment.
      if (isStudioCancel && hasDeposit && depositDisposition && depositDisposition !== 'none') {
        try {
          const res = await fetch('/api/stripe/studio-cancel-refund', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tenantId,
              clientId:              client.id,
              appointmentId:         appointment.id,
              depositAmountCents:    appointment.depositAmountCents,
              stripePaymentIntentId: appointment.depositStripePaymentIntentId || null,
              disposition:           depositDisposition,
              staffId:               cancellationAudit.actorId,
              reason,
            }),
          });

          const result = await res.json();

          if (!result.ok) {
            // If refund failed but a fallback is available, warn and continue
            if (result.fallback === 'store_credit') {
              toast({
                title:       'Refund Not Available',
                description: 'No Stripe record found — deposit will be issued as store credit instead.',
              });
              // Re-call with store_credit
              await fetch('/api/stripe/studio-cancel-refund', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  tenantId,
                  clientId:           client.id,
                  appointmentId:      appointment.id,
                  depositAmountCents: appointment.depositAmountCents,
                  disposition:        'store_credit',
                  staffId:            cancellationAudit.actorId,
                  reason,
                }),
              });
            } else {
              // Hard failure — surface it and abort the cancellation
              toast({
                variant:     'destructive',
                title:       'Deposit Refund Failed',
                description: result.reason || 'Could not process refund. Try again or apply store credit.',
              });
              return; // don't cancel the appointment
            }
          } else {
            const msg = depositDisposition === 'refund'
              ? `$${(appointment.depositAmountCents / 100).toFixed(2)} refunded to card on file`
              : `$${(appointment.depositAmountCents / 100).toFixed(2)} added as store credit`;
            toast({ title: 'Deposit Processed', description: msg });
          }
        } catch (err: any) {
          toast({
            variant:     'destructive',
            title:       'Deposit Processing Error',
            description: err?.message || 'Unknown error — cancellation aborted.',
          });
          return;
        }
      }

      // ── Step 2: Write the cancellation to Firestore ──────────────────────────
      const eventId = nanoid();
      const now     = new Date().toISOString();
      const batch   = writeBatch(firestore);

      const appointmentRef = doc(
        firestore,
        `tenants/${tenantId}/appointments`,
        appointment.id,
      );

      batch.update(appointmentRef, {
        status:                  'cancelled',
        cancelledAt:             now,
        cancellationAudit,
        cancellationEventId:     eventId,
        cancellationFeeCharged:  chargeFee ? feeAmount : 0,
        cancellationFeeWaived:   !chargeFee && feeAmount > 0,
        // Studio cancel — no fee charged to client (they're the victim)
        ...(isStudioCancel && {
          studioCancelled:        true,
          depositDisposition:     depositDisposition || 'none',
        }),
      });

      if (appointment.isWalkIn) {
        const walkInId  = String(appointment.id).replace('apt-walkin-', '');
        const walkInRef = doc(firestore, `tenants/${tenantId}/walkIns`, walkInId);
        batch.update(walkInRef, { status: 'cancelled', cancelledAt: now });
      }

      // Balance update only for client/no-show paths with a fee
      if (!isStudioCancel && chargeFee && feeAmount > 0 && paymentMethod === 'add_to_balance') {
        const clientRef = doc(firestore, `tenants/${tenantId}/clients`, client.id);
        batch.update(clientRef, { outstandingBalance: increment(feeAmount) });
      }

      // Audit log
      const auditRef = doc(collection(firestore, `tenants/${tenantId}/auditLog`));
      batch.set(auditRef, { id: auditRef.id, tenantId, ...auditLogEntry, createdAt: now });

      // cancellationEvent → triggers onCancellationEvent Firebase Function
      // For studio cancellations, chargeFee is always false (client not charged)
      const eventRef = doc(
        firestore,
        `tenants/${tenantId}/cancellationEvents`,
        eventId,
      );
      batch.set(eventRef, {
        id:                    eventId,
        tenantId,
        appointmentId:         appointment.id,
        clientId:              client.id,
        clientName:            client.name,
        clientEmail:           client.email || null,
        clientPhone:           client.phone || null,
        serviceId:             appointment.serviceId,
        serviceName:           (appointment as any).serviceName || null,
        staffId:               appointment.staffId,
        appointmentStartTime:  appointment.startTime,

        // Studio cancels: no fee, email/SMS notify client of the cancellation
        chargeFee:             isStudioCancel ? false : chargeFee,
        feeAmount:             isStudioCancel ? 0 : feeAmount,
        paymentMethod:         isStudioCancel ? 'waived' : paymentMethod,
        stripeCustomerId:      client.stripeCustomerId || null,
        stripePaymentMethodId: client.cardOnFile?.paymentMethodId || client.cardOnFile?.token || null,

        cancellationAudit,
        reason,
        studioCancelled:       isStudioCancel,
        depositDisposition:    depositDisposition || 'none',

        status:       'pending',
        chargeStatus: isStudioCancel ? 'waived' : (chargeFee && paymentMethod === 'card_on_file' ? 'pending' : paymentMethod === 'add_to_balance' ? 'balance' : 'waived'),
        emailStatus:  'pending',
        smsStatus:    'pending',

        createdAt:      now,
        processedAt:    null,
        stripeChargeId: null,
        errorMessage:   null,
      });

      await batch.commit();

      // ── Toast ────────────────────────────────────────────────────────────────
      if (isStudioCancel) {
        toast({
          title:       'Appointment Cancelled',
          description: hasDeposit && depositDisposition !== 'none'
            ? depositDisposition === 'refund'
              ? 'Client notified. Deposit refund is processing.'
              : 'Client notified. Deposit issued as store credit.'
            : 'Client has been notified of the cancellation.',
        });
      } else {
        toast({
          title:       'Appointment Cancelled',
          description: chargeFee && feeAmount > 0
            ? paymentMethod === 'card_on_file'
              ? `$${feeAmount.toFixed(2)} cancellation fee is being charged.`
              : `$${feeAmount.toFixed(2)} added to ${client.name}'s balance.`
            : 'Cancellation recorded. No fee charged.',
        });
      }
    },
    [firestore, tenantId, appointment, client, toast],
  );

  return onConfirm;
}
