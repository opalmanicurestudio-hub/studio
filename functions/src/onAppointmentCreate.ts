/**
 * functions/src/onAppointmentCreate.ts
 *
 * Firestore trigger: fires when a document is created in
 *   tenants/{tenantId}/appointments/{appointmentId}
 *
 * THE MISSING PIECE: previously nothing sent an instant "you're booked!"
 * confirmation. The only client-facing notification that could fire at
 * booking time was the completion-link SMS/email — and that ONLY fires
 * when something is actually outstanding (forms/deposit/card). A client
 * whose booking needed nothing (card already on file, no forms) got zero
 * confirmation of any kind until a reminder arrived hours before the
 * appointment. This closes that gap.
 *
 * Fires regardless of which system created the appointment — QuickBookForm,
 * the voice booking engine, eventually online booking — because it hooks
 * at the DATA layer (any write to this collection), not per-caller. No
 * booking path needs to remember to also send a confirmation; it happens
 * automatically as a consequence of the write existing.
 *
 * Channel respects the client's own preference
 * (client.notificationPreferences.confirmationChannel), defaulting to
 * 'both' (sms + email) when unset — see the Client type's own comment for
 * why an unset preference defaults this way rather than defaulting to
 * silence.
 *
 * Guards against duplicate/unwanted sends:
 *  - Idempotent: checks confirmationSent before doing anything, same
 *    pattern as reminderSent in the voice reminder route.
 *  - Skips secondary legs of a multi-provider booking (multiProviderGroupId
 *    set AND sequenceIndex > 0) — those are all one same-day visit for the
 *    same client; only the primary leg's confirmation represents "this
 *    booking" to them. Recurring occurrences and group guests are NOT
 *    skipped — each is a genuinely separate booking/attendee that
 *    legitimately wants its own confirmation.
 *  - Skips if status is already 'cancelled' (defensive — shouldn't happen
 *    on a fresh onCreate, but cheap to guard).
 */

import * as functions from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import twilio from 'twilio';

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!,
);

const db = admin.firestore();

const safeDate = (val: any): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val === 'string') return new Date(val);
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
  return new Date(val);
};

const formatWhen = (iso: string): string => {
  try {
    const d = safeDate(iso);
    return d.toLocaleString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return iso;
  }
};

async function sendConfirmationEmail(opts: {
  to: string;
  clientName: string;
  serviceName: string;
  staffName?: string;
  whenText: string;
  studioName: string;
  checkInUrl: string;
}) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${opts.studioName} <notifications@${process.env.RESEND_SENDING_DOMAIN || 'clarityflow.app'}>`,
      to: opts.to,
      subject: `You're booked — ${opts.serviceName} on ${opts.whenText}`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="margin-bottom: 4px;">You're booked, ${opts.clientName.split(' ')[0]}!</h2>
          <p style="color: #475569; margin-top: 0;">${opts.studioName} has you down for:</p>
          <div style="background: #f8fafc; border-radius: 16px; padding: 16px 20px; margin: 16px 0;">
            <p style="margin: 0; font-weight: 700;">${opts.serviceName}</p>
            ${opts.staffName ? `<p style="margin: 4px 0 0; color: #64748b;">with ${opts.staffName}</p>` : ''}
            <p style="margin: 4px 0 0; color: #64748b;">${opts.whenText}</p>
          </div>
          <a href="${opts.checkInUrl}" style="display: inline-block; background: #0f172a; color: white; padding: 12px 24px; border-radius: 12px; text-decoration: none; font-weight: 600;">View or manage your appointment</a>
          <p style="color: #94a3b8; font-size: 12px; margin-top: 24px;">Need to reschedule or cancel? Use the link above.</p>
        </div>
      `,
    }),
  });
  return res.ok;
}

async function sendConfirmationSms(opts: {
  to: string;
  clientName: string;
  serviceName: string;
  whenText: string;
  studioName: string;
  checkInUrl: string;
}) {
  await twilioClient.messages.create({
    to: opts.to,
    from: process.env.TWILIO_PHONE_NUMBER,
    body: `${opts.studioName}: You're booked for ${opts.serviceName} on ${opts.whenText}. View or manage: ${opts.checkInUrl}`,
  });
}

export const onAppointmentCreate = functions.firestore.onDocumentCreated(
  'tenants/{tenantId}/appointments/{appointmentId}',
  async (event) => {
    const { tenantId, appointmentId } = event.params;
    const apt = event.data?.data();
    if (!apt) return;

    if (apt.status === 'cancelled') return;
    if (apt.confirmationSent === true) return; // idempotency guard
    // Secondary legs of one same-day multi-provider visit don't each need
    // their own confirmation — only the primary leg represents "this
    // booking" to the client. Recurring occurrences and group guests are
    // deliberately NOT filtered out here — see header comment.
    if (apt.multiProviderGroupId && (apt.sequenceIndex || 0) > 0) return;

    const aptRef = db.doc(`tenants/${tenantId}/appointments/${appointmentId}`);

    try {
      const [tenantSnap, clientSnap, serviceSnap, staffSnap] = await Promise.all([
        db.doc(`tenants/${tenantId}`).get(),
        apt.clientId ? db.doc(`tenants/${tenantId}/clients/${apt.clientId}`).get() : Promise.resolve(null),
        apt.serviceId ? db.doc(`tenants/${tenantId}/services/${apt.serviceId}`).get() : Promise.resolve(null),
        apt.staffId ? db.doc(`tenants/${tenantId}/staff/${apt.staffId}`).get() : Promise.resolve(null),
      ]);

      const tenant = tenantSnap.data();
      const client = clientSnap?.exists ? clientSnap.data() : null;
      const service = serviceSnap?.exists ? serviceSnap.data() : null;
      const staffMember = staffSnap?.exists ? staffSnap.data() : null;

      if (!tenant) {
        await aptRef.set({ confirmationSent: true, confirmationSkippedReason: 'tenant_not_found' }, { merge: true });
        return;
      }

      // Default 'both' when unset — see Client type comment for reasoning.
      const channel = client?.notificationPreferences?.confirmationChannel || 'both';
      if (channel === 'none') {
        await aptRef.set({ confirmationSent: true, confirmationSkippedReason: 'client_opted_out' }, { merge: true });
        return;
      }

      const clientEmail = (client?.email || apt.clientEmail || '').trim();
      const clientPhone = (client?.phone || apt.clientPhone || '').trim();
      const clientName = client?.name || apt.clientName || 'there';
      const whenText = formatWhen(apt.startTime);
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.clarityflow.com';
      const checkInUrl = apt.checkInToken ? `${appUrl}/check-in/${apt.checkInToken}` : appUrl;

      let emailSent = false;
      let smsSent = false;

      if ((channel === 'email' || channel === 'both') && clientEmail) {
        try {
          emailSent = await sendConfirmationEmail({
            to: clientEmail,
            clientName,
            serviceName: service?.name || 'your appointment',
            staffName: staffMember?.name,
            whenText,
            studioName: tenant.name || 'the studio',
            checkInUrl,
          });
        } catch (e) {
          console.error('[onAppointmentCreate] email failed', e);
        }
      }

      if ((channel === 'sms' || channel === 'both') && clientPhone) {
        try {
          await sendConfirmationSms({
            to: clientPhone,
            clientName,
            serviceName: service?.name || 'your appointment',
            whenText,
            studioName: tenant.name || 'the studio',
            checkInUrl,
          });
          smsSent = true;
        } catch (e) {
          console.error('[onAppointmentCreate] sms failed', e);
        }
      }

      await aptRef.set({
        confirmationSent: true,
        confirmationSentAt: new Date().toISOString(),
        confirmationChannelUsed: channel,
        confirmationEmailSent: emailSent,
        confirmationSmsSent: smsSent,
      }, { merge: true });
    } catch (e) {
      console.error('[onAppointmentCreate]', e);
      // Mark it anyway — a permanently-failing appointment shouldn't retry
      // forever on every subsequent unrelated write to the same doc. Staff
      // can manually resend via AppointmentDetailsSheet if truly needed.
      await aptRef.set({ confirmationSent: true, confirmationSkippedReason: 'internal_error' }, { merge: true }).catch(() => {});
    }
  },
);
