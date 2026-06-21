/**
 * functions/src/onCancellationEvent.ts
 *
 * Firestore trigger: fires when a document is created in
 *   tenants/{tenantId}/cancellationEvents/{eventId}
 *
 * Responsibilities:
 *  - Charge the Stripe card on file (if paymentMethod === 'card_on_file')
 *  - Send cancellation email via Resend (or swap for SendGrid / Postmark)
 *  - Send cancellation SMS via Twilio
 *  - Update the event document with results
 *  - Notify assigned staff member
 */

import * as functions from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import Stripe from 'stripe';
import twilio from 'twilio';

// ── Clients ──────────────────────────────────────────────────────────────────

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
});

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!,
);

const db = admin.firestore();

// ── Helper: send email via Resend ─────────────────────────────────────────────
// Swap this function body for SendGrid / Postmark if preferred.
async function sendCancellationEmail(opts: {
  to: string;
  clientName: string;
  serviceName: string;
  appointmentStartTime: string;
  feeAmount: number;
  feeCharged: boolean;
  paymentMethod: string;
  studioName: string;
  studioEmail: string;
  reason: string;
  actorType: string;
}) {
  const {
    to, clientName, serviceName, appointmentStartTime,
    feeAmount, feeCharged, paymentMethod, studioName,
    studioEmail, reason, actorType,
  } = opts;

  const apptDate = new Date(appointmentStartTime).toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
    year: 'numeric', hour: 'numeric', minute: '2-digit',
  });

  const feeBlock = feeCharged && feeAmount > 0
    ? paymentMethod === 'card_on_file'
      ? `<p>A cancellation fee of <strong>$${feeAmount.toFixed(2)}</strong> has been charged to the card on file.</p>`
      : `<p>A cancellation fee of <strong>$${feeAmount.toFixed(2)}</strong> has been added to your account balance.</p>`
    : '';

  const subjectMap: Record<string, string> = {
    no_show: `Missed Appointment — ${studioName}`,
    studio: `Your Appointment Has Been Cancelled — ${studioName}`,
    client: `Cancellation Confirmed — ${studioName}`,
  };

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${studioName} <${studioEmail}>`,
      to,
      subject: subjectMap[actorType] || `Appointment Update — ${studioName}`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
          <h2 style="margin-bottom:4px">Hi ${clientName},</h2>
          <p>Your <strong>${serviceName}</strong> appointment scheduled for
          <strong>${apptDate}</strong> has been cancelled.</p>
          ${feeBlock}
          <p>If you have questions, reply to this email or contact us directly.</p>
          <p style="color:#888;font-size:12px;margin-top:32px">${studioName}</p>
        </div>
      `,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error: ${err}`);
  }
}

// ── Helper: send SMS via Twilio ───────────────────────────────────────────────
async function sendCancellationSMS(opts: {
  to: string;
  clientName: string;
  serviceName: string;
  appointmentStartTime: string;
  feeAmount: number;
  feeCharged: boolean;
  studioName: string;
  studioPhone: string;
  actorType: string;
}) {
  const {
    to, clientName, serviceName, appointmentStartTime,
    feeAmount, feeCharged, studioName, studioPhone, actorType,
  } = opts;

  const apptDate = new Date(appointmentStartTime).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });

  const feeText = feeCharged && feeAmount > 0
    ? ` A $${feeAmount.toFixed(2)} cancellation fee has been applied.`
    : '';

  const prefixMap: Record<string, string> = {
    no_show: `Hi ${clientName}, we missed you today`,
    studio:  `Hi ${clientName}, your ${serviceName} appt`,
    client:  `Hi ${clientName}, your ${serviceName} appt`,
  };

  const body = `${prefixMap[actorType] || `Hi ${clientName}, your appt`} on ${apptDate} has been cancelled.${feeText} Questions? Reply or call ${studioPhone}. — ${studioName}`;

  await twilioClient.messages.create({
    body,
    from: process.env.TWILIO_PHONE_NUMBER!,
    to,
  });
}

// ── Main trigger ──────────────────────────────────────────────────────────────
export const onCancellationEvent = functions.firestore.onDocumentCreated(
  'tenants/{tenantId}/cancellationEvents/{eventId}',
  async (event) => {
    const { tenantId, eventId } = event.params;
    const data = event.data?.data();
    if (!data || data.status !== 'pending') return;

    const eventRef = db.doc(`tenants/${tenantId}/cancellationEvents/${eventId}`);

    // Mark processing immediately to prevent double-execution
    await eventRef.update({ status: 'processing' });

    // Load tenant config for studio name, email, phone, etc.
    const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
    const tenant = tenantSnap.data();
    if (!tenant) {
      await eventRef.update({ status: 'failed', errorMessage: 'Tenant not found' });
      return;
    }

    const updates: Record<string, any> = {
      status: 'complete',
      processedAt: new Date().toISOString(),
    };

    // ── Stripe charge ─────────────────────────────────────────────────────────
    if (
      data.chargeFee &&
      data.feeAmount > 0 &&
      data.paymentMethod === 'card_on_file' &&
      data.stripePaymentMethodId &&
      data.stripeCustomerId
    ) {
      try {
        const amountCents = Math.round(data.feeAmount * 100);

        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountCents,
          currency: 'usd',
          customer: data.stripeCustomerId,
          payment_method: data.stripePaymentMethodId,
          confirm: true,
          off_session: true,
          // Expand the balance transaction so we can read the ACTUAL Stripe
          // processing fee Stripe charged on this specific transaction, at
          // the moment it happens — rather than relying on a separate
          // charge.succeeded webhook to backfill it later. This makes fee
          // capture self-contained and independent of whether any webhook
          // is deployed: every charge records its own gross/fee/net here.
          expand: ['latest_charge.balance_transaction'],
          description: `Cancellation fee — ${data.serviceName || 'Service'} — ${data.clientName}`,
          metadata: {
            tenantId,
            appointmentId: data.appointmentId,
            cancellationEventId: eventId,
            reason: data.reason,
            actorType: data.cancellationAudit?.actorType || 'unknown',
          },
        });

        // Pull the real fee/net off the balance transaction. Falls back to
        // 0 fee (and net === gross) only if Stripe didn't return it, which
        // is then visibly reconcilable rather than silently wrong.
        let stripeFeeCents = 0;
        let netCents = amountCents;
        const latestCharge: any = paymentIntent.latest_charge;
        const bt: any = latestCharge && typeof latestCharge === 'object' ? latestCharge.balance_transaction : null;
        if (bt && typeof bt === 'object') {
          stripeFeeCents = bt.fee || 0;
          netCents = bt.net || (amountCents - stripeFeeCents);
        }

        updates.chargeStatus = 'charged';
        updates.stripeChargeId = paymentIntent.id;
        updates.stripeChargeAmountCents = amountCents;
        updates.stripeFeeCents = stripeFeeCents;
        updates.stripeNetCents = netCents;

        // Record the transaction in the tenant's transactions collection
        const txRef = db.collection(`tenants/${tenantId}/transactions`).doc();
        await txRef.set({
          id: txRef.id,
          tenantId,
          appointmentId: data.appointmentId,
          clientId: data.clientId,
          clientName: data.clientName,
          type: 'cancellation_fee',
          category: 'Cancellation Fee',
          amount: data.feeAmount,
          amountCents,
          // Gross / fee / net all recorded on the income line itself, so the
          // ledger never has to guess what a charge actually netted.
          stripeFeeCents,
          netCents,
          stripePaymentIntentId: paymentIntent.id,
          stripePaymentMethodId: data.stripePaymentMethodId,
          status: 'succeeded',
          reason: data.reason,
          actorType: data.cancellationAudit?.actorType,
          createdAt: new Date().toISOString(),
        });

        // Separate expense line for the processing fee, so it shows up as a
        // real cost in the ledger (not just netted invisibly against income).
        // This mirrors how the refund route logs its incremental fee, and is
        // the same shape a charge.succeeded webhook would write — but written
        // here, synchronously, where we know the charge definitely happened.
        if (stripeFeeCents > 0) {
          const feeTxRef = db.collection(`tenants/${tenantId}/transactions`).doc();
          await feeTxRef.set({
            id: feeTxRef.id,
            tenantId,
            appointmentId: data.appointmentId,
            clientId: data.clientId,
            clientName: data.clientName,
            type: 'expense',
            category: 'Card Processing Fee',
            amount: stripeFeeCents / 100,
            amountCents: stripeFeeCents,
            relatedTransactionId: txRef.id,
            stripePaymentIntentId: paymentIntent.id,
            status: 'succeeded',
            reason: 'stripe_processing_fee',
            createdAt: new Date().toISOString(),
          });
        }

        // Notify owner/admin that card was charged
        const adminsSnap = await db
          .collection(`tenants/${tenantId}/staff`)
          .where('role', 'in', ['admin', 'owner'])
          .get();

        const notifBatch = db.batch();
        adminsSnap.docs.forEach(d => {
          const notifRef = db.collection(`tenants/${tenantId}/notifications`).doc();
          notifBatch.set(notifRef, {
            id: notifRef.id,
            userId: d.id,
            type: 'cancellation_charge',
            message: `$${data.feeAmount.toFixed(2)} cancellation fee charged to ${data.clientName}`,
            link: `/clients/${data.clientId}`,
            createdAt: new Date().toISOString(),
            read: false,
          });
        });
        await notifBatch.commit();

      } catch (stripeErr: any) {
        console.error('Stripe charge failed:', stripeErr);
        updates.chargeStatus = 'failed';
        updates.stripeErrorCode = stripeErr?.code || 'unknown';
        updates.errorMessage = stripeErr?.message || 'Stripe charge failed';

        // If card declined, notify staff so they can collect manually
        const staffSnap = await db
          .doc(`tenants/${tenantId}/staff/${data.staffId}`)
          .get();
        const staffNotifRef = db
          .collection(`tenants/${tenantId}/notifications`)
          .doc();
        await staffNotifRef.set({
          id: staffNotifRef.id,
          userId: data.staffId,
          type: 'charge_failed',
          message: `Card charge failed for ${data.clientName} — collect $${data.feeAmount.toFixed(2)} manually`,
          link: `/clients/${data.clientId}`,
          createdAt: new Date().toISOString(),
          read: false,
        });
      }
    } else if (data.paymentMethod === 'waived' || !data.chargeFee) {
      updates.chargeStatus = 'waived';
    } else if (data.paymentMethod === 'add_to_balance') {
      updates.chargeStatus = 'balance';
      // Balance was already incremented client-side; log the transaction here
      const txRef = db.collection(`tenants/${tenantId}/transactions`).doc();
      await txRef.set({
        id: txRef.id,
        tenantId,
        appointmentId: data.appointmentId,
        clientId: data.clientId,
        clientName: data.clientName,
        type: 'cancellation_fee',
        category: 'Cancellation Fee',
        amount: data.feeAmount,
        status: 'balance_owed',
        reason: data.reason,
        actorType: data.cancellationAudit?.actorType,
        createdAt: new Date().toISOString(),
      });
    }

    // ── Email ─────────────────────────────────────────────────────────────────
    if (data.clientEmail && tenant.cancellationEmailEnabled !== false) {
      try {
        await sendCancellationEmail({
          to: data.clientEmail,
          clientName: data.clientName,
          serviceName: data.serviceName || 'your service',
          appointmentStartTime: data.appointmentStartTime,
          feeAmount: data.feeAmount,
          feeCharged: data.chargeFee && updates.chargeStatus === 'charged',
          paymentMethod: data.paymentMethod,
          studioName: tenant.name || 'The Studio',
          studioEmail: tenant.email || 'noreply@example.com',
          reason: data.reason,
          actorType: data.cancellationAudit?.actorType || 'studio',
        });
        updates.emailStatus = 'sent';
      } catch (emailErr: any) {
        console.error('Email failed:', emailErr);
        updates.emailStatus = 'failed';
        updates.emailError = emailErr?.message;
      }
    } else {
      updates.emailStatus = 'skipped';
    }

    // ── SMS ───────────────────────────────────────────────────────────────────
    if (data.clientPhone && tenant.cancellationSmsEnabled !== false) {
      try {
        await sendCancellationSMS({
          to: data.clientPhone,
          clientName: data.clientName,
          serviceName: data.serviceName || 'your service',
          appointmentStartTime: data.appointmentStartTime,
          feeAmount: data.feeAmount,
          feeCharged: data.chargeFee && updates.chargeStatus === 'charged',
          studioName: tenant.name || 'The Studio',
          studioPhone: tenant.phone || '',
          actorType: data.cancellationAudit?.actorType || 'studio',
        });
        updates.smsStatus = 'sent';
      } catch (smsErr: any) {
        console.error('SMS failed:', smsErr);
        updates.smsStatus = 'failed';
        updates.smsError = smsErr?.message;
      }
    } else {
      updates.smsStatus = 'skipped';
    }

    // ── Finalize ──────────────────────────────────────────────────────────────
    await eventRef.update(updates);
  },
);