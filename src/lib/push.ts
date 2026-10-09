// src/lib/push.ts — MAKE PHONES BUZZ for app notifications (the sending half of push).
// Staff phones register in the staff portal (lib/push-notifications.ts files the device under their staff doc's
// `fcmTokens`). This used to be sent by a background function (onNotificationCreate) that was never deployed, so no
// phone ever buzzed. Now the 5-minute no-shows job sends each new notification (last 20 minutes) to the recipient's
// phones once — marked `pushedAt` so nothing buzzes twice. A notification for "owner" goes to everyone with the
// owner role (the old function dropped those); one for nobody in particular (e.g. Station Assist "anyone") goes to owners,
// admins and managers. Dead registrations are pruned so the list heals itself.
// SPEED: urgent ones are pushed the moment they're saved (`pushNow`, called by the walk-in, client-text, Station Assist
// and running-late routes); everything else within a minute (/api/cron/push). Each is claimed once — never twice.
// Needs NEXT_PUBLIC_FIREBASE_VAPID_KEY in Vercel for phones to register at all; without registered phones this
// quietly does nothing and the in-app badge still works.
import { FieldValue } from 'firebase-admin/firestore';

/** WHICH NOTIFICATIONS BUZZ A PHONE. Everything still appears in the app's notification list; this only decides the
 *  buzz. 'now' = someone needs to act in minutes · 'today' = needs attention today · anything not listed is quiet
 *  (reports, receipts, "for your records") — so phones never get noisier by accident when a new type is added. */
export const PUSH_TIER: Record<string, 'now' | 'today'> = {
  // Front desk & visits — a person is waiting
  walk_in_assigned: 'now', renter_arrived: 'now', guest_arrived: 'now', front_door: 'now', guest_running_late: 'now', late_choice: 'now',
  suspected_no_show: 'now', no_show_escalation: 'now', appointment_overdue: 'now', addon_handoff: 'now', escalation: 'now',
  provider_delay_reply: 'now', disruption_reply: 'now', cover_request: 'now', provider_ask: 'now', provider_offer_reply: 'now', change_request: 'now',
  // Station Assist & lounge
  assist: 'now', assist_escalation: 'now', floor_assist: 'now',
  // Housekeeping — stations, kits, cleansing, sterilising, laundry, delays
  turnover_due: 'now', turnover_escalation: 'now', kit_timer: 'now', kit_cleansed: 'now', contact_reached: 'now', cycle_done: 'now', linen_timer: 'now', kit_none_usable: 'now', visit_delay: 'now', delay_affects_you: 'now',
  // Clients reaching out
  sms: 'now', sms_escalation: 'now', sms_escalation_unassigned: 'now', call_message: 'now', call_reply: 'now',
  // The team
  staff_message: 'now', approval_request: 'now', pin_reset: 'now', test: 'now',
  swap_request: 'today', request_approved: 'today', request_denied: 'today', day_off_approved: 'today', swap_approved: 'today', schedule_published: 'today', task: 'today',
  // Booth rental
  booth_reservation: 'today', booth_tour: 'today', booth_application: 'today', booth_no_show: 'today', renter_leave: 'today', renter_document: 'today',
  renter_concern: 'today', renter_message: 'today', renter_swap: 'today', credential: 'today', rent_late: 'today', renter_barred: 'today', tour_followup: 'today',
  // Other tools
  school_tour: 'today', quote_accepted: 'today', quote_declined: 'today', quote_revision: 'today', maintenance: 'today', maintenance_collision: 'today',
  membership_payment_failed: 'today', payroll_draft: 'today', waitlist_join: 'today', appointment: 'today', user: 'today',
};
export const buzzes = (type?: string) => !!PUSH_TIER[String(type || '')];

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

/** WHERE TAPPING IT OPENS — chosen per person, so nobody is sent anywhere that isn't theirs.
 *   • Owners, admins, managers → the matching page in the main app.
 *   • Everyone else → ALWAYS their own staff portal, on the right tab — never an owner page.
 *   • Only ever inside this app (outside addresses are refused). What anyone can actually SEE is still decided by
 *     signing in — the portal asks for their PIN, the app for their login — not by the link. */
const PORTAL_TABS = ['today', 'schedule', 'requests', 'earnings', 'inbox', 'messages', 'team', 'documents', 'rent', 'orders'];
const PORTAL_TO_APP: Record<string, string> = { today: '/dashboard', schedule: '/schedule', requests: '/schedule/requests', earnings: '/financials', inbox: '/messages', messages: '/messages', team: '/staff', documents: '/documents', rent: '/rent', orders: '/retail-orders' };
const TYPE_TO_TAB: Record<string, string> = { staff_message: 'messages', swap_request: 'requests', swap_approved: 'requests', request_approved: 'requests', request_denied: 'requests', day_off_approved: 'requests', schedule_published: 'schedule', task: 'documents', renter_message: 'messages', rent_late: 'rent' };
export const MANAGER_ROLES_PUSH = ['owner', 'admin', 'manager'];

export function pushLink(base: string, tenantId: string, link?: string, opts: { role?: string; type?: string } = {}): string {
  const b = String(base || '').replace(/\/+$/, '');
  let l = String(link || '').trim();
  if (/^https?:\/\//.test(l)) l = l.startsWith(b) ? l.slice(b.length) || '/' : '';   // outside this app → refused
  const isManager = MANAGER_ROLES_PUSH.includes(String(opts.role || '').toLowerCase());
  if (isManager) {
    if (l.startsWith('/')) return `${b}${l}`;
    return `${b}${PORTAL_TO_APP[l] || '/dashboard'}`;
  }
  // Team members: their own portal, on the right tab.
  let tab = PORTAL_TABS.includes(l) ? l : '';
  if (!tab && l.startsWith('/')) tab = /^\/(my-)?schedule\/requests/.test(l) ? 'requests' : /^\/(my-)?schedule/.test(l) ? 'schedule' : /^\/messages/.test(l) ? 'messages' : '';
  if (!tab) tab = TYPE_TO_TAB[String(opts.type || '')] || 'today';
  return `${b}/staff-portal/${tenantId}?tab=${tab}`;
}

export async function pushNewNotifications(db: any, messaging: any, tenantId: string, tenant: any, base: string, windowMs = 20 * 60000) {
  const T = `tenants/${tenantId}`; const since = new Date(Date.now() - windowMs).toISOString();
  const snap = await db.collection(`${T}/notifications`).where('createdAt', '>=', since).limit(100).get();
  let sent = 0;
  for (const d of snap.docs) {
    const n: any = d.data() || {};
    if (n.pushedAt || !n.message) continue;
    if (!buzzes(n.type)) {   // in the app's list, but not a buzz (reports, receipts, failures)
      await d.ref.update({ pushedAt: new Date().toISOString(), pushResult: 'in-app only (no buzz for this kind)' }).catch(() => null); continue;
    }
    // Claim it first — two runs can never send the same one twice.
    const mine = await db.runTransaction(async (tx: any) => { const cur: any = (await tx.get(d.ref)).data() || {}; if (cur.pushedAt) return false; tx.update(d.ref, { pushedAt: new Date().toISOString() }); return true; });
    if (!mine) continue;
    const people = n.userId === 'owner'
      ? (await db.collection(`${T}/staff`).where('role', '==', 'owner').get()).docs
      : !n.userId   // for nobody in particular → the people who run the floor
        ? (await db.collection(`${T}/staff`).where('role', 'in', ['owner', 'admin', 'manager']).get()).docs
        : [await db.doc(`${T}/staff/${n.userId}`).get()].filter((s: any) => s.exists);
    const outcome: string[] = [];
    if (!people.length) outcome.push('no staff record for this person');
    for (const p of people) {
      const tokens: string[] = (p.data() as any)?.fcmTokens || [];
      if (!tokens.length) { outcome.push('no phone registered'); continue; }
      const link = pushLink(base, tenantId, n.link, { role: (p.data() as any)?.role, type: n.type });   // per person — never somewhere that isn't theirs
      try {
        const res = await messaging.sendEachForMulticast({ tokens, notification: { title: titleFor(n.type, tenant?.name), body: String(n.message).slice(0, 180) },
          webpush: { fcmOptions: { link }, notification: { icon: `${base}/icon-192.png`, badge: `${base}/icon-192.png` } } });
        sent += res.successCount || 0;
        outcome.push(res.successCount ? `sent to ${res.successCount} device${res.successCount === 1 ? '' : 's'}` : `failed: ${String(res.responses.find((r: any) => r?.error)?.error?.code || 'unknown')}`);
        const dead = tokens.filter((_, i) => { const r = res.responses[i]; const code = String(r?.error?.code || ''); return !r?.success && (code.includes('registration-token-not-registered') || code.includes('invalid-argument')); });
        if (dead.length) await p.ref.set({ fcmTokens: FieldValue.arrayRemove(...dead) }, { merge: true }).catch(() => null);
      } catch (e: any) { outcome.push(`failed: ${String(e?.code || e?.message || e).slice(0, 120)}`); }   // a push must never break the job
    }
    // What happened, on the notification itself — so a missing buzz can be explained, not guessed at.
    await d.ref.update({ pushResult: outcome.join('; ') || 'nothing to send' }).catch(() => null);
  }
  return sent;
}

/** Push this business's brand-new notifications right now — called straight after an urgent one is saved. Never
 *  throws (a push must never break the request that made it); anything it misses, the 1-minute job sends. */
export async function pushNow(db: any, tenantId: string) {
  try {
    const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
    const { getAdminMessaging } = await import('@/lib/firebase-admin'); const { linkOrigin } = await import('@/lib/app-origin');
    await pushNewNotifications(db, getAdminMessaging(), tenantId, tenant, linkOrigin(tenant), 2 * 60000);
  } catch (e: any) {   // the 1-minute job will send it — but say why it failed, where it can be seen
    await db.doc('platformHealth/push_last_error').set({ at: new Date().toISOString(), tenantId, error: String(e?.message || e).slice(0, 300), where: 'instant' }).catch(() => null);
  }
}
