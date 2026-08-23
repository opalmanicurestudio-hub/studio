/**
 * functions/src/onApplicantMessageCreate.ts
 *
 * Firestore trigger: fires when a document is created in
 *   tenants/{tenantId}/applications/{applicationId}/messages/{messageId}
 *
 * The Applicants screen writes a message doc with status 'queued'; this
 * function sends it via Resend from the business's own name and flips the
 * doc to 'sent' (or 'failed' with the error), so the applicant card's
 * timeline reflects reality, not intent. Status-change entries written to
 * the same subcollection carry type 'status' and are ignored here — they
 * are timeline entries, not outbound mail.
 *
 * Idempotent: only acts on type 'email' + status 'queued', and the send
 * result overwrites status, so re-delivery of the event cannot double-send
 * once 'sent' is recorded.
 */

import * as functions from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

const db = admin.firestore();

export const onApplicantMessageCreate = functions.firestore.onDocumentCreated(
  'tenants/{tenantId}/applications/{applicationId}/messages/{messageId}',
  async (event) => {
    const { tenantId } = event.params;
    const msg = event.data?.data();
    if (!msg) return;
    if (msg.type !== 'email' || msg.status !== 'queued') return;
    if (!msg.to || !msg.body) {
      await event.data!.ref.set({ status: 'failed', error: 'Missing recipient or body' }, { merge: true });
      return;
    }

    let businessName = 'Our team';
    try {
      const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
      businessName = (tenantSnap.data() as any)?.name || businessName;
    } catch { /* fall back to default sender name */ }

    const subject = String(msg.subject || `A message from ${businessName}`).slice(0, 200);
    const bodyHtml = String(msg.body)
      .slice(0, 5000)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br/>');

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `${businessName} <notifications@${process.env.RESEND_SENDING_DOMAIN || 'clarityflow.app'}>`,
          to: msg.to,
          subject,
          html: `
            <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
              <p style="font-size: 12px; letter-spacing: 0.2em; text-transform: uppercase; color: #94a3b8; font-weight: 700;">${businessName}</p>
              <div style="font-size: 15px; color: #0f172a; line-height: 1.6;">${bodyHtml}</div>
              <p style="color: #94a3b8; font-size: 12px; margin-top: 24px;">You're receiving this because you applied to ${businessName}. Reply to this email to reach us.</p>
            </div>
          `,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        await event.data!.ref.set({ status: 'failed', error: text.slice(0, 500) }, { merge: true });
        return;
      }

      await event.data!.ref.set(
        { status: 'sent', sentAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true },
      );
    } catch (e: any) {
      await event.data!.ref.set(
        { status: 'failed', error: String(e?.message || e).slice(0, 500) },
        { merge: true },
      );
    }
  },
);
