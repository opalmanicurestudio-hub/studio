/**
 * functions/src/onDocumentPublish.ts
 *
 * Firestore trigger: fires on writes to
 *   tenants/{tenantId}/documents/{documentId}
 *
 * When a document lands on status 'published' at a version the team hasn't
 * been told about yet, every assigned, non-archived team member with an
 * email gets a short notice: what was published (or updated), and that it's
 * waiting in their Documents library to read and confirm.
 *
 * Assignment mirrors the app's own logic: assignedRoles containing 'all'
 * reaches everyone, a role name reaches that role, and assignedStaffIds
 * reaches named people.
 *
 * Idempotent: notifiedVersion is stamped on the document BEFORE any email
 * goes out, so event re-delivery (and this function's own write re-firing
 * the trigger) cannot double-send. A version that fails mid-send is not
 * retried — one nag maximum per version is the polite failure mode.
 */

import * as functions from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

const db = admin.firestore();

const esc = (v: any) =>
  String(v || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

export const onDocumentPublish = functions.firestore.onDocumentWritten(
  'tenants/{tenantId}/documents/{documentId}',
  async (event) => {
    const { tenantId } = event.params;
    const after = event.data?.after?.data();
    if (!after) return;
    if (after.status !== 'published') return;

    const version = Number(after.version || 1);
    if (Number(after.notifiedVersion || 0) >= version) return;

    await event.data!.after.ref.set({ notifiedVersion: version }, { merge: true });

    const isUpdate = version > 1;
    const title = String(after.title || 'A document').slice(0, 140);
    const roles: string[] = Array.isArray(after.assignedRoles) ? after.assignedRoles : [];
    const ids: string[] = Array.isArray(after.assignedStaffIds) ? after.assignedStaffIds : [];

    let businessName = 'Our team';
    try {
      const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
      businessName = (tenantSnap.data() as any)?.name || businessName;
    } catch { /* default stands */ }

    let staff: Array<{ id: string; name?: string; email?: string; role?: string; archived?: boolean }> = [];
    try {
      const staffSnap = await db.collection(`tenants/${tenantId}/staff`).get();
      staff = staffSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    } catch (e) {
      console.error('staff read failed', e);
      return;
    }

    const recipients = staff.filter(m =>
      !m.archived &&
      m.email &&
      (roles.includes('all') || (m.role && roles.includes(m.role)) || ids.includes(m.id))
    ).slice(0, 50);

    if (recipients.length === 0) return;

    const portalUrl = `${process.env.APP_BASE_URL || 'https://studio-one-blue.vercel.app'}/staff-portal/${tenantId}`;

    const subject = isUpdate
      ? `Updated — please re-read: ${title}`
      : `Please read: ${title}`;

    for (const m of recipients) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: `${businessName} <notifications@${process.env.RESEND_SENDING_DOMAIN || 'clarityflow.app'}>`,
            to: m.email,
            subject,
            html: `
              <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
                <p style="font-size: 12px; letter-spacing: 0.2em; text-transform: uppercase; color: #94a3b8; font-weight: 700;">${esc(businessName)}</p>
                <h2 style="margin: 8px 0 4px;">${isUpdate ? 'A document you\u2019ve read has changed.' : 'Something new to read.'}</h2>
                <div style="background: #f8fafc; border-radius: 16px; padding: 16px 20px; margin: 16px 0;">
                  <p style="margin: 0; font-weight: 700;">${esc(title)}</p>
                  <p style="margin: 4px 0 0; color: #64748b; font-size: 13px;">Version ${version}</p>
                </div>
                <p style="color: #475569; line-height: 1.6;">${isUpdate
                  ? 'It was updated since you last confirmed it. Open your staff portal, tap <strong>Documents</strong>, read the new version, and tap \u201cI\u2019ve read and understood this.\u201d'
                  : 'Open your staff portal, tap <strong>Documents</strong>, read it, and tap \u201cI\u2019ve read and understood this\u201d when you\u2019re done.'}</p>
                <p style="margin-top: 16px;"><a href="${portalUrl}" style="display: inline-block; background: #0f172a; color: #ffffff; padding: 12px 24px; border-radius: 12px; text-decoration: none; font-weight: 700;">Open my portal</a></p>
                <p style="color: #94a3b8; font-size: 12px; margin-top: 24px;">Sent by ${esc(businessName)} via their team documents system.</p>
              </div>
            `,
          }),
        });
      } catch (e) {
        console.error(`document notice failed for ${m.id}`, e);
      }
    }
  },
);
