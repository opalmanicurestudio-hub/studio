// src/lib/push.ts — MAKE PHONES BUZZ for app notifications (the sending half of push).
// Staff phones register in the staff portal (lib/push-notifications.ts files the device under their staff doc's
// `fcmTokens`). This used to be sent by a background function (onNotificationCreate) that was never deployed, so no
// phone ever buzzed. Now the 5-minute no-shows job sends each new notification (last 20 minutes) to the recipient's
// phones once — marked `pushedAt` so nothing buzzes twice. A notification for "owner" goes to everyone with the
// owner role (the old function dropped those). Dead registrations are pruned so the list heals itself.
// Needs NEXT_PUBLIC_FIREBASE_VAPID_KEY in Vercel for phones to register at all; without registered phones this
// quietly does nothing and the in-app badge still works.
import { FieldValue } from 'firebase-admin/firestore';

function titleFor(type: string | undefined, business: string): string {
  switch (type) {
    case 'staff_message': return 'New team message';
    case 'sms_escalation': return 'A client text needs you';
    case 'sms_escalation_unassigned': return 'Unassigned client text';
    case 'membership_payment_failed': return 'Membership payment failed';
    case 'charge_failed': return 'A charge didn’t go through';
    default: return business || 'New notification';
  }
}

export async function pushNewNotifications(db: any, messaging: any, tenantId: string, tenant: any, base: string, windowMs = 20 * 60000) {
  const T = `tenants/${tenantId}`; const since = new Date(Date.now() - windowMs).toISOString();
  const snap = await db.collection(`${T}/notifications`).where('createdAt', '>=', since).limit(100).get();
  let sent = 0;
  for (const d of snap.docs) {
    const n: any = d.data() || {};
    if (n.pushedAt || !n.userId || !n.message) continue;
    // Claim it first — two runs can never send the same one twice.
    const mine = await db.runTransaction(async (tx: any) => { const cur: any = (await tx.get(d.ref)).data() || {}; if (cur.pushedAt) return false; tx.update(d.ref, { pushedAt: new Date().toISOString() }); return true; });
    if (!mine) continue;
    const people = n.userId === 'owner'
      ? (await db.collection(`${T}/staff`).where('role', '==', 'owner').get()).docs
      : [await db.doc(`${T}/staff/${n.userId}`).get()].filter((s: any) => s.exists);
    for (const p of people) {
      const tokens: string[] = (p.data() as any)?.fcmTokens || [];
      if (!tokens.length) continue;
      const link = n.link ? `${base}${n.link}` : base;
      try {
        const res = await messaging.sendEachForMulticast({ tokens, notification: { title: titleFor(n.type, tenant?.name), body: String(n.message).slice(0, 180) },
          webpush: { fcmOptions: { link }, notification: { icon: `${base}/icon-192.png`, badge: `${base}/icon-192.png` } } });
        sent += res.successCount || 0;
        const dead = tokens.filter((_, i) => { const r = res.responses[i]; const code = String(r?.error?.code || ''); return !r?.success && (code.includes('registration-token-not-registered') || code.includes('invalid-argument')); });
        if (dead.length) await p.ref.set({ fcmTokens: FieldValue.arrayRemove(...dead) }, { merge: true }).catch(() => null);
      } catch { /* a push must never break the job */ }
    }
  }
  return sent;
}
