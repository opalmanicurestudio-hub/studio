/**
 * functions/src/onApplicationCreate.ts
 *
 * Firestore trigger: fires when a document is created in
 *   tenants/{tenantId}/applications/{applicationId}
 *
 * Sends the applicant an instant "we got it" email — the gap Jessica hit
 * herself: she applied and heard nothing. The email doubles as education:
 * it carries the tenant's own welcome note (tenants/{id}.applicationWelcome,
 * set on the Applicants screen) and, when the application targets a listing,
 * that listing's description — so the confirmation teaches the applicant
 * about the business and what the job entails while confirming receipt.
 *
 * Also writes the send into the application's messages subcollection so the
 * applicant timeline shows it like any other email.
 *
 * Idempotent: guards on receiptSent before doing anything, same pattern as
 * confirmationSent in onAppointmentCreate. Skips silently when there is no
 * email address (phone-only applications).
 */

import * as functions from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

const db = admin.firestore();

const esc = (v: any) =>
  String(v || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

export const onApplicationCreate = functions.firestore.onDocumentCreated(
  'tenants/{tenantId}/applications/{applicationId}',
  async (event) => {
    const { tenantId, applicationId } = event.params;
    const app = event.data?.data();
    if (!app) return;
    if (app.receiptSent === true) return;
    if (!app.email) return;

    let businessName = 'Our team';
    let welcomeNote = '';
    try {
      const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
      const t = tenantSnap.data() as any;
      businessName = t?.name || businessName;
      welcomeNote = String(t?.applicationWelcome || '').slice(0, 2000);
    } catch { /* defaults stand */ }

    let listingBlock = '';
    if (app.listingId) {
      try {
        const listingSnap = await db.doc(`tenants/${tenantId}/jobListings/${app.listingId}`).get();
        const l = listingSnap.data() as any;
        if (l) {
          listingBlock = `
            <div style="background: #f8fafc; border-radius: 16px; padding: 16px 20px; margin: 16px 0;">
              <p style="margin: 0; font-weight: 700;">${esc(l.title)}</p>
              ${l.payRange || l.scheduleNote ? `<p style="margin: 4px 0 0; color: #64748b; font-size: 13px;">${esc([l.payRange, l.scheduleNote].filter(Boolean).join(' · '))}</p>` : ''}
              ${l.description ? `<p style="margin: 8px 0 0; color: #475569; font-size: 14px; line-height: 1.6;">${esc(l.description).replace(/\n/g, '<br/>')}</p>` : ''}
            </div>`;
        }
      } catch { /* listing block is optional */ }
    }

    const first = esc(String(app.name || 'there').split(' ')[0]);

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `${businessName} <notifications@${process.env.RESEND_SENDING_DOMAIN || 'clarityflow.app'}>`,
          to: app.email,
          subject: `We got your application — ${businessName}`,
          html: `
            <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
              <p style="font-size: 12px; letter-spacing: 0.2em; text-transform: uppercase; color: #94a3b8; font-weight: 700;">${esc(businessName)}</p>
              <h2 style="margin: 8px 0 4px;">Thanks, ${first} — it's in.</h2>
              <p style="color: #475569; margin-top: 0; line-height: 1.6;">Your application${app.listingTitle ? ` for <strong>${esc(app.listingTitle)}</strong>` : ''} reached us and a real person will read it. Here's a little about us while you wait:</p>
              ${welcomeNote ? `<p style="color: #0f172a; line-height: 1.6;">${esc(welcomeNote).replace(/\n/g, '<br/>')}</p>` : ''}
              ${listingBlock}
              <p style="color: #475569; line-height: 1.6;">If you're a fit, we'll reach out at this address about next steps — usually within a few days.</p>
              <p style="color: #94a3b8; font-size: 12px; margin-top: 24px;">You're receiving this because you applied to ${esc(businessName)}. Reply to this email to reach us.</p>
            </div>
          `,
        }),
      });

      const msgRef = db.doc(`tenants/${tenantId}/applications/${applicationId}/messages/receipt`);
      if (res.ok) {
        await Promise.all([
          event.data!.ref.set({ receiptSent: true }, { merge: true }),
          msgRef.set({
            id: 'receipt',
            type: 'email',
            status: 'sent',
            to: app.email,
            subject: `We got your application — ${businessName}`,
            by: 'System',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
          }),
        ]);
      } else {
        const text = await res.text();
        await msgRef.set({
          id: 'receipt',
          type: 'email',
          status: 'failed',
          to: app.email,
          subject: `We got your application — ${businessName}`,
          by: 'System',
          error: text.slice(0, 500),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    } catch (e: any) {
      console.error('receipt send failed', e);
    }

    try {
      const tSnap = await db.doc(`tenants/${tenantId}`).get();
      const t = (tSnap.data() as any) || {};
      let ownerEmail: string = t.notificationEmail || t.email || '';
      if (!ownerEmail && t.userId) {
        try {
          const { getAuth } = await import('firebase-admin/auth');
          ownerEmail = (await getAuth().getUser(t.userId)).email || '';
        } catch { /* no admin auth user lookup */ }
      }
      if (!ownerEmail) return;
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `ClarityFlow <notifications@${process.env.RESEND_SENDING_DOMAIN || 'clarityflow.app'}>`,
          to: ownerEmail,
          subject: `New application: ${esc(app.name || 'Someone')}${app.position ? ` — ${esc(app.position)}` : ''}`,
          html: `
            <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
              <h2 style="margin: 8px 0 4px;">Someone just applied.</h2>
              <div style="background: #f8fafc; border-radius: 16px; padding: 16px 20px; margin: 16px 0;">
                <p style="margin: 0; font-weight: 700;">${esc(app.name || 'Applicant')}</p>
                <p style="margin: 4px 0 0; color: #64748b; font-size: 13px;">${esc(app.position || '')}${app.email ? ` \u00b7 ${esc(app.email)}` : ''}</p>
              </div>
              <p style="color: #475569; line-height: 1.6;">Open <strong>Applicants</strong> in ClarityFlow to review, message, or schedule an interview.</p>
            </div>
          `,
        }),
      });
    } catch (e) {
      console.error('owner alert failed', e);
    }
  },
);
