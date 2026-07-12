/**
 * onNotificationCreate — v1
 *
 * THE missing piece that makes phones actually buzz. Everything in the
 * platform already writes to tenants/{tenantId}/notifications — SMS
 * escalations, staff messages, membership payment failures, booking
 * events. This trigger turns every one of those writes into a real push
 * notification to the recipient's registered devices, automatically. No
 * notification-creation site anywhere needs to know push exists.
 *
 * Token registry: staff docs carry an fcmTokens array, written by
 * src/lib/push-notifications.ts when someone PINs into the portal (or an
 * admin opens Messages) on a device and grants permission. Dead tokens
 * (uninstalled, permission revoked) are pruned on send failure, so the
 * array self-heals.
 *
 * Matches the v2 trigger style used by onAppointmentCreate.ts.
 * Set APP_URL in the function's environment for correct click-through
 * links; falls back to the production domain.
 */

import * as functions from 'firebase-functions/v2';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

export const onNotificationCreate = functions.firestore.onDocumentCreated(
  'tenants/{tenantId}/notifications/{notificationId}',
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const notif = snap.data() as any;
    const { tenantId } = event.params;
    const userId: string | undefined = notif?.userId;
    if (!userId || !notif?.message) return;

    const db = getFirestore();
    const staffSnap = await db.doc(`tenants/${tenantId}/staff/${userId}`).get();
    const tokens: string[] = (staffSnap.data() as any)?.fcmTokens || [];
    if (tokens.length === 0) return; // no registered devices — in-app badge still works

    const base = process.env.APP_URL || 'https://app.clarityflow.com';
    const link = notif.link ? `${base}${notif.link}` : base;

    const res = await getMessaging().sendEachForMulticast({
      tokens,
      notification: {
        title: titleFor(notif.type),
        body: String(notif.message).slice(0, 180),
      },
      webpush: {
        fcmOptions: { link },
        notification: {
          icon: `${base}/icon-192.png`,
          badge: `${base}/icon-192.png`,
        },
      },
    });

    // Prune tokens that are permanently dead so the array self-heals.
    const dead: string[] = [];
    res.responses.forEach((r, i) => {
      const code = (r.error as any)?.code || '';
      if (!r.success && (code.includes('registration-token-not-registered') || code.includes('invalid-argument'))) {
        dead.push(tokens[i]);
      }
    });
    if (dead.length > 0) {
      await staffSnap.ref.set({ fcmTokens: FieldValue.arrayRemove(...dead) }, { merge: true }).catch(() => {});
    }
  },
);

function titleFor(type?: string): string {
  switch (type) {
    case 'staff_message': return 'New team message';
    case 'sms_escalation': return 'Client text needs you';
    case 'sms_escalation_unassigned': return 'Unassigned client text';
    case 'membership_payment_failed': return 'Membership payment failed';
    default: return 'ClarityFlow';
  }
}
