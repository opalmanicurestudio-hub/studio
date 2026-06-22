'use client';

/**
 * useCancellationConfirm (v4)
 *
 * Changes from v3:
 *  - RESOLVED the architectural gap v3 flagged: /api/stripe/studio-cancel-refund
 *    no longer trusts appointment.depositAmountCents / depositStripePaymentIntentId
 *    (fields the actual deposit-payment webhook never populates). It now
 *    looks the deposit up itself from depositCredits — the same collection
 *    this hook's client/no-show resolution already uses, and what
 *    self-cancel and handle-no-show-action also use. All four cancellation
 *    paths now agree on a single source of truth for "does this client have
 *    a paid deposit on file."
 *  - Because the route resolves the deposit itself, Step 1 no longer needs
 *    (or trusts) a `hasDeposit` check against appointment fields — it just
 *    calls the route whenever depositDisposition is present, and the route
 *    returns a clean 404-style failure if there's genuinely nothing to
 *    resolve. CancelAppointmentDialog does its own live depositCredits
 *    lookup now to decide whether to show the picker at all.
 *
 * Changes from v2 (carried forward):
 *  - Deposit-credit resolution for CLIENT-initiated cancellations
 *    (rollover/forfeit/refund-pending), and unconditional forfeiture for
 *    no-show cancellations made through this dialog — both via
 *    depositCredits, both best-effort/non-blocking, both run AFTER the
 *    cancellation commits. A 'refund' outcome is NEVER auto-executed —
 *    recorded as a pending decision plus a staff notification only.
 *
 * No-show path: staffConfirmed flow also goes through
 * /api/notifications/handle-no-show-action when triggered from a flagged
 * notification — that route now also resolves deposits via depositCredits,
 * so both no-show entry points (this dialog, and the notification-driven
 * route) behave identically.
 */

import { useCallback } from 'react';
import {
  doc,
  collection,
  writeBatch,
  increment,
  arrayUnion,
  getDocs,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { nanoid } from 'nanoid';
import type { Appointment, Client } from '@/lib/data';
import {
  resolveDepositPolicy,
  resolveDepositOutcome,
  hoursUntilStart,
  rolloverExpiryISO,
  isCreditExpired,
} from '@/lib/deposit-policy';

interface CancellationConfirmPayload {
  reason: string;
  chargeFee: boolean;
  feeAmount: number;
  paymentMethod: 'card_on_file' | 'add_to_balance' | 'waived';
  cancellationAudit: any;
  auditLogEntry: any;
  // Studio-cancel deposit disposition — only present when actorType === 'studio'
  depositDisposition?: 'refund' | 'store_credit' | 'none';
  // Staff-added goodwill credit beyond the deposit amount — only meaningful
  // when depositDisposition === 'store_credit'.
  additionalCreditCents?: number;
}

export function useCancellationConfirm(
  appointment: Appointment | null,
  client: Client | null,
  // Resolved from the caller's in-memory services list (e.g. useInventory()),
  // not looked up here — Appointment doesn't actually carry a serviceName
  // field, so without this the cancellationEvent's serviceName is always
  // null and client emails/SMS fall back to generic "your service" text.
  serviceName?: string | null,
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
        additionalCreditCents,
      } = payload;

      const isStudioCancel = cancellationAudit?.actorType === 'studio';
      const isClientCancel = cancellationAudit?.actorType === 'client';
      const isNoShowCancel = cancellationAudit?.actorType === 'no_show';
      // No appointment-field hasDeposit check anymore — the route resolves
      // the deposit itself from depositCredits and returns a clean failure
      // if there's genuinely nothing on file. depositDisposition is only
      // ever present in the payload when CancelAppointmentDialog's own live
      // depositCredits lookup found something, so its presence already
      // implies a deposit exists.
      let resolvedDepositAmount = 0;

      // ── Step 1: Handle deposit disposition for studio cancellations ──────────
      // Do this FIRST — before marking cancelled — so if Stripe refund fails,
      // we can surface the error without having already cancelled the appointment.
      if (isStudioCancel && depositDisposition && depositDisposition !== 'none') {
        try {
          const res = await fetch('/api/stripe/studio-cancel-refund', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tenantId,
              clientId:      client.id,
              appointmentId: appointment.id,
              disposition:   depositDisposition,
              staffId:       cancellationAudit.actorId,
              reason,
              ...(depositDisposition === 'store_credit' && additionalCreditCents ? { additionalCreditCents } : {}),
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
              const fallbackRes = await fetch('/api/stripe/studio-cancel-refund', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  tenantId,
                  clientId:      client.id,
                  appointmentId: appointment.id,
                  disposition:   'store_credit',
                  staffId:       cancellationAudit.actorId,
                  reason,
                }),
              });
              const fallbackResult = await fallbackRes.json().catch(() => null);
              resolvedDepositAmount = Number(fallbackResult?.amount || 0);
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
            resolvedDepositAmount = Number(result.amount || 0);
            const msg = depositDisposition === 'refund'
              ? `$${resolvedDepositAmount.toFixed(2)} refunded to card on file`
              : `$${resolvedDepositAmount.toFixed(2)} added as store credit`;
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
        batch.update(clientRef, {
          outstandingBalance: increment(feeAmount),
          // Previously missing — outstandingBalance went up but nothing was
          // ever pushed to unpaidFees, so the Ledger's Bad Debt Aging widget
          // (which reads unpaidFees, not outstandingBalance) silently never
          // saw this debt at all.
          unpaidFees: arrayUnion({
            feeId: nanoid(),
            appointmentId: appointment.id,
            appointmentDate: now,
            feeAmount,
            reason: isNoShowCancel ? 'No-Show Fee' : `Cancellation Fee — ${cancellationAudit?.reason || 'client cancellation'}`,
          }),
        });
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
        serviceName:           serviceName || null,
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

      // ── Step 3: Deposit-credit resolution for CLIENT and NO-SHOW cancellations ─
      // Best-effort, non-blocking — the appointment is already cancelled by
      // this point. A lookup/write hiccup here should never prevent a
      // cancellation from completing.
      //
      // Client cancel: full rollover/forfeit/refund-pending policy resolution.
      // No-show: unconditional forfeiture, no rollover/refund option — same
      // stance as handle-no-show-action's deposit handling, applied here too
      // so a no-show confirmed via this dialog (rather than via a flagged
      // notification) doesn't leave the deposit untouched.
      let depositNote: string | null = null;
      if (isClientCancel || isNoShowCancel) {
        try {
          const creditsCol = collection(firestore, `tenants/${tenantId}/depositCredits`);
          let creditSnap = appointment.clientId
            ? await getDocs(query(creditsCol, where('status', '==', 'available'), where('clientId', '==', appointment.clientId)))
            : null;
          if ((!creditSnap || creditSnap.empty) && client.email) {
            creditSnap = await getDocs(query(creditsCol, where('status', '==', 'available'), where('clientEmail', '==', String(client.email).toLowerCase().trim())));
          }
          if (creditSnap && !creditSnap.empty) {
            const candidates = creditSnap.docs
              .map(d => ({ ref: d.ref, ...(d.data() as any) }))
              .filter((c: any) => !isCreditExpired(c.expiresAt));
            candidates.sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
            const credit = candidates[0];

            if (credit) {
              const amount = Number(credit.amountDollars ?? (credit.amountCents || 0) / 100);
              const decisionNow = new Date().toISOString();

              if (isNoShowCancel) {
                // No discretion, no policy lookup — genuine no-shows forfeit.
                const forfeitBatch = writeBatch(firestore);
                forfeitBatch.set(credit.ref, {
                  status: 'forfeited', forfeitedAt: decisionNow,
                  forfeitedFromAppointmentId: appointment.id, lastDecisionReason: 'no_show',
                }, { merge: true });
                // The studio is keeping this money — real, recognized
                // revenue, not just a status flip. Previously nothing
                // logged this as income anywhere.
                const noShowRevenueRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));
                forfeitBatch.set(noShowRevenueRef, {
                  id: noShowRevenueRef.id, tenantId, appointmentId: appointment.id,
                  clientId: appointment.clientId || null, clientName: client.name || credit.clientName || 'Client',
                  date: decisionNow, type: 'income', category: 'No-Show Revenue',
                  amount, amountCents: Math.round(amount * 100),
                  paymentMethod: 'Deposit', hasReceipt: false,
                  description: 'Deposit forfeited — no-show',
                });
                await forfeitBatch.commit();
                depositNote = `$${amount.toFixed(2)} deposit forfeited — no-show.`;
              } else {
                const policy = resolveDepositPolicy(selectedTenant);
                const hrs = hoursUntilStart(appointment.startTime);
                const resolved = resolveDepositOutcome({ trigger: 'client_cancel', hoursUntilStart: hrs, policy });

                if (resolved.outcome === 'refund') {
                  const decisionRef = doc(collection(firestore, `tenants/${tenantId}/depositDecisions`));
                  const decisionBatch = writeBatch(firestore);
                  decisionBatch.set(decisionRef, {
                    id: decisionRef.id, tenantId, creditId: credit.id, appointmentId: appointment.id,
                    clientId: appointment.clientId || null, clientName: client.name || credit.clientName || 'Client',
                    trigger: 'client_cancel', outcome: 'refund_pending', reason: resolved.reason,
                    amountDollars: amount, hoursUntilStart: hrs, decidedAt: decisionNow,
                  });
                  await decisionBatch.commit();
                  depositNote = `$${amount.toFixed(2)} deposit ready to refund — pending staff confirmation.`;
                } else if (resolved.outcome === 'rollover') {
                  const rolloverBatch = writeBatch(firestore);
                  rolloverBatch.set(credit.ref, {
                    status: 'available', rolledOver: true, rolledOverAt: decisionNow,
                    rolledOverFromAppointmentId: appointment.id, expiresAt: rolloverExpiryISO(policy),
                    lastDecisionReason: resolved.reason,
                  }, { merge: true });
                  await rolloverBatch.commit();
                  depositNote = `$${amount.toFixed(2)} deposit rolled over — ${resolved.reason}.`;
                } else {
                  const forfeitBatch = writeBatch(firestore);
                  forfeitBatch.set(credit.ref, {
                    status: 'forfeited', forfeitedAt: decisionNow,
                    forfeitedFromAppointmentId: appointment.id, lastDecisionReason: resolved.reason,
                  }, { merge: true });
                  // Same revenue-recognition fix as the no-show branch above.
                  const lateCancelRevenueRef = doc(collection(firestore, `tenants/${tenantId}/transactions`));
                  forfeitBatch.set(lateCancelRevenueRef, {
                    id: lateCancelRevenueRef.id, tenantId, appointmentId: appointment.id,
                    clientId: appointment.clientId || null, clientName: client.name || credit.clientName || 'Client',
                    date: decisionNow, type: 'income', category: 'Cancellation Revenue',
                    amount, amountCents: Math.round(amount * 100),
                    paymentMethod: 'Deposit', hasReceipt: false,
                    description: `Deposit forfeited — ${resolved.reason}`,
                  });
                  await forfeitBatch.commit();
                  depositNote = `$${amount.toFixed(2)} deposit forfeited — ${resolved.reason}.`;
                }
              }
            }
          }
        } catch (e) {
          console.warn('[client/no-show cancel deposit resolution]', e);
        }
      }

      // ── Vacated slot → recovery (+ behavior event). A studio/business cancel
      //    still frees the slot (so recovery fires) but is NOT the client's
      //    fault (so the behavior event is skipped via skipBehavior). Late
      //    client cancels log late_cancel; benign ones a neutral reschedule
      //    signal. Non-blocking — never fail the cancel the user just made.
      try {
        const isLate = !!(chargeFee && feeAmount > 0);
        const evType = isNoShowCancel ? 'no_show' : (isLate ? 'late_cancel' : 'reschedule');
        fetch('/api/opal/recovery-spawn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId,
            appointmentId: appointment.id,
            resolutionTicketId: eventId,
            clientId: client.id,
            eventType: evType,
            skipBehavior: isStudioCancel,
            vacatedSlotStart: appointment.startTime,
            vacatedSlotEnd: appointment.endTime,
            locationId: (appointment as any).locationId || null,
          }),
        }).catch(() => {});
      } catch { /* recovery is best-effort */ }

      // ── Toast ────────────────────────────────────────────────────────────────
      if (isStudioCancel) {
        toast({
          title:       'Appointment Cancelled',
          description: resolvedDepositAmount > 0 && depositDisposition && depositDisposition !== 'none'
            ? depositDisposition === 'refund'
              ? 'Client notified. Deposit refund is processing.'
              : 'Client notified. Deposit issued as store credit.'
            : 'Client has been notified of the cancellation.',
        });
      } else {
        const baseDesc = chargeFee && feeAmount > 0
          ? paymentMethod === 'card_on_file'
            ? `$${feeAmount.toFixed(2)} cancellation fee is being charged.`
            : `$${feeAmount.toFixed(2)} added to ${client.name}'s balance.`
          : 'Cancellation recorded. No fee charged.';
        toast({
          title:       'Appointment Cancelled',
          description: depositNote ? `${baseDesc} ${depositNote}` : baseDesc,
        });
      }
    },
    [firestore, tenantId, appointment, client, serviceName, selectedTenant, toast],
  );

  return onConfirm;
}
