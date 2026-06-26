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
 *
 * The card on file (customer + payment method) is vaulted on the tenant's
 * CONNECTED account by the Stripe Connect webhook, so the charge is made with
 * { stripeAccount: connectedAccountId }. The event doc must carry both
 * stripeCustomerId AND stripePaymentMethodId for the charge branch to run;
 * the route that writes the event resolves stripeCustomerId from
 * client.cardOnFile.customerId (not the often-null top-level field).
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

        // The card on file (customer + payment method) was vaulted on the
        // tenant's CONNECTED account by the Stripe Connect webhook — so the
        // charge MUST be made on that connected account, not the platform.
        // Without { stripeAccount }, Stripe can't find the customer/payment
        // method and the charge fails ("No such customer").
        const connectedAccountId = tenant.stripeAccountId;
        if (!connectedAccountId) {
          updates.chargeStatus = 'failed';
          updates.errorMessage = 'Tenant has no stripeAccountId — cannot charge connected-account card.';
          await eventRef.update(updates);
          return;
        }

        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountCents,
          currency: 'usd',
          customer: data.stripeCustomerId,
          payment_method: data.stripePaymentMethodId,
          confirm: true,
          off_session: true,
          // Expand the charge so we can store its id on the income line. We do
          // NOT compute or write the processing fee here — the Connect
          // webhook's charge.succeeded handler is the single source of truth
          // for fees and will book this charge's fee + back-fill net onto the
          // revenue line below (matched by stripeChargeId). Writing a fee line
          // here too would double-count it.
          expand: ['latest_charge'],
          description: `Cancellation fee — ${data.serviceName || 'Service'} — ${data.clientName}`,
          metadata: {
            tenantId,
            // clientId is read by the webhook's fee handler to attribute the
            // processing-fee expense to this client.
            clientId: data.clientId,
            appointmentId: data.appointmentId,
            cancellationEventId: eventId,
            reason: data.reason,
            actorType: data.cancellationAudit?.actorType || 'unknown',
          },
        }, { stripeAccount: connectedAccountId });

        const latestCharge: any = paymentIntent.latest_charge;
        const chargeId: string | null =
          latestCharge && typeof latestCharge === 'object' ? latestCharge.id : (latestCharge || null);

        updates.chargeStatus = 'charged';
        updates.stripeChargeId = chargeId || paymentIntent.id;
        updates.stripeChargeAmountCents = amountCents;

        // Record the cancellation-fee REVENUE line. taxBucket:'revenue' +
        // stripeChargeId are exactly what the webhook's charge.succeeded
        // back-fill looks for, so it will attach stripeNetAmountDollars /
        // stripeFeeAmountDollars to this row once the fee posts. The matching
        // fee EXPENSE line is written by the webhook, not here.
        const txRef = db.collection(`tenants/${tenantId}/transactions`).doc();
        await txRef.set({
          id: txRef.id,
          tenantId,
          date: new Date().toISOString(),
          appointmentId: data.appointmentId,
          clientId: data.clientId,
          clientName: data.clientName,
          clientOrVendor: data.clientName,
          type: 'income',
          context: 'Business',
          category: 'Cancellation Fee',
          taxBucket: 'revenue',
          amount: data.feeAmount,
          amountCents,
          stripeChargeId: chargeId,
          stripePaymentIntentId: paymentIntent.id,
          stripePaymentMethodId: data.stripePaymentMethodId,
          status: 'succeeded',
          reason: data.reason,
          actorType: data.cancellationAudit?.actorType,
          createdAt: new Date().toISOString(),
        });

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
        const staffNotifRef = db
          .collection(`tenants/${tenantId}/notifications`)
          .doc();
        await staffNotifRef.set({
          id: staffNotifRef.id,
          userId: data.staffId || 'owner',
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
      // Balance was already incremented by the route; log the transaction here
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
    } else {
      // SAFETY NET: chargeFee was true but no branch above ran — e.g.
      // paymentMethod was 'card_on_file' yet the customer/payment-method ids
      // were missing, so the Stripe guard failed. The OLD behaviour fell
      // through here and marked the event 'complete' with no chargeStatus and
      // no ledger line — the fee vanished silently. Record it as owed, add it
      // to the client's balance, and flag staff so nothing is ever lost again.
      updates.chargeStatus = 'uncollected';
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
        notes: 'No chargeable card on file at cancellation time — added to balance.',
        createdAt: new Date().toISOString(),
      });
      if (data.clientId) {
        await db.doc(`tenants/${tenantId}/clients/${data.clientId}`).update({
          outstandingBalance: admin.firestore.FieldValue.increment(data.feeAmount),
        });
      }
      const failNotifRef = db.collection(`tenants/${tenantId}/notifications`).doc();
      await failNotifRef.set({
        id: failNotifRef.id,
        userId: data.staffId || 'owner',
        type: 'charge_failed',
        message: `Couldn't auto-charge $${data.feeAmount.toFixed(2)} cancellation fee for ${data.clientName} — no card on file. Added to balance.`,
        link: `/clients/${data.clientId}`,
        createdAt: new Date().toISOString(),
        read: false,
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