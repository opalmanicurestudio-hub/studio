/**
 * functions/src/onInterviewInviteUpdate.ts
 *
 * Firestore trigger: fires when a document is updated in
 *   tenants/{tenantId}/interviewInvites/{inviteId}
 *
 * When the applicant responds on the public /interview page, this closes
 * the loop: an accepted slot gets a written confirmation email (people
 * screenshot these), and either outcome is written into the application's
 * timeline so the Applicants screen tells the whole story without anyone
 * refreshing an inbox.
 *
 * Idempotent: only acts on the pending → responded transition, and stamps
 * responseHandled so event re-delivery cannot double-send.
 *
 * Deliberately NOT here: writing the interview into the appointments
 * collection. Appointments feed revenue/utilization stats — an interview
 * in that collection would corrupt every staff report. Planner integration
 * needs its own pass against the planner's data model.
 */

import * as functions from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

const db = admin.firestore();

const esc = (v: any) =>
  String(v || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

export const onInterviewInviteUpdate = functions.firestore.onDocumentUpdated(
  'tenants/{tenantId}/interviewInvites/{inviteId}',
  async (event) => {
    const { tenantId, inviteId } = event.params;
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;
    if (before.status !== 'pending') return;
    if (after.status !== 'accepted' && after.status !== 'needs_new_times' && after.status !== 'countered') return;
    if (after.responseHandled === true) return;

    await event.data!.after.ref.set({ responseHandled: true }, { merge: true });

    let businessName = 'Our team';
    try {
      const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
      businessName = (tenantSnap.data() as any)?.name || businessName;
    } catch { /* default stands */ }

    let applicantEmail = '';
    try {
      const appSnap = await db.doc(`tenants/${tenantId}/applications/${after.applicationId}`).get();
      applicantEmail = String((appSnap.data() as any)?.email || '');
    } catch { /* timeline entry still gets written */ }

    const accepted = after.status === 'accepted';
    const whenText = accepted && after.chosenSlot
      ? new Date(after.chosenSlot).toLocaleString('en-US', {
          weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
        })
      : '';

    if (accepted && applicantEmail) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: `${businessName} <notifications@${process.env.RESEND_SENDING_DOMAIN || 'clarityflow.app'}>`,
            to: applicantEmail,
            subject: `Interview confirmed — ${whenText}`,
            html: `
              <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
                <p style="font-size: 12px; letter-spacing: 0.2em; text-transform: uppercase; color: #94a3b8; font-weight: 700;">${esc(businessName)}</p>
                <h2 style="margin: 8px 0 4px;">You're confirmed, ${esc(after.firstName || 'there')}.</h2>
                <div style="background: #f8fafc; border-radius: 16px; padding: 16px 20px; margin: 16px 0;">
                  ${after.roleTitle ? `<p style="margin: 0; font-weight: 700;">${esc(after.roleTitle)}</p>` : ''}
                  <p style="margin: 4px 0 0; color: #64748b;">${esc(whenText)}</p>
                </div>
                <p style="color: #475569; line-height: 1.6;">If anything changes, just reply to this email and we'll rearrange.</p>
              </div>
            `,
          }),
        });
      } catch (e) {
        console.error('interview confirmation send failed', e);
      }
    }

    if (after.applicationId) {
      try {
        await db.doc(`tenants/${tenantId}/applications/${after.applicationId}/messages/invite_${inviteId}`).set({
          id: `invite_${inviteId}`,
          type: 'status',
          toStatus: 'interview',
          note: accepted ? `interview confirmed — ${whenText}` : after.status === 'countered' ? `sent their availability (${(after.proposedSlots || []).length} option${(after.proposedSlots || []).length === 1 ? '' : 's'})` : 'asked for different interview times',
          by: 'Applicant',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (e) {
        console.error('timeline write failed', e);
      }
    }

    const first = esc(after.firstName || 'An applicant');
    if (after.status === 'accepted') {
      await notifyOwner(tenantId, `Interview confirmed: ${after.firstName || 'applicant'}`, `<h2 style="margin: 8px 0 4px;">${first} confirmed their interview.</h2><p style="color: #475569;">${esc(whenText || '')}${after.roleTitle ? ` \u00b7 ${esc(after.roleTitle)}` : ''}</p>`);
    } else if (after.status === 'countered') {
      const slots = (after.proposedSlots || []).map((sl: string) => {
        try { return new Date(sl).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return sl; }
      });
      await notifyOwner(tenantId, `${after.firstName || 'An applicant'} sent their availability`, `<h2 style="margin: 8px 0 4px;">${first} can\u2019t make your times — they sent theirs.</h2><p style="color: #475569;">${slots.map((x: string) => esc(x)).join('<br/>')}</p>${after.applicantNote ? `<p style="color: #64748b; font-style: italic;">\u201c${esc(after.applicantNote)}\u201d</p>` : ''}`);
    } else {
      await notifyOwner(tenantId, `${after.firstName || 'An applicant'} needs new interview times`, `<h2 style="margin: 8px 0 4px;">${first} asked for different times.</h2>`);
    }
  },
);


const notifyOwner = async (tenantId: string, subject: string, bodyHtml: string) => {
  try {
    const tSnap = await db.doc(`tenants/${tenantId}`).get();
    const t = (tSnap.data() as any) || {};
    let ownerEmail: string = t.notificationEmail || t.email || '';
    if (!ownerEmail && t.userId) {
      try {
        const { getAuth } = await import('firebase-admin/auth');
        ownerEmail = (await getAuth().getUser(t.userId)).email || '';
      } catch { /* no lookup available */ }
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
        subject,
        html: `<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">${bodyHtml}<p style="color: #475569; line-height: 1.6;">Open <strong>Applicants</strong> in ClarityFlow to act on it.</p></div>`,
      }),
    });
  } catch (e) {
    console.error('owner notify failed', e);
  }
};
