// src/lib/hq-signals.ts
//
// The numbers behind HQ's health and setup scores, read from one business
// (server only — Admin SDK). Shared by /api/hq and the daily HQ job.

import { getAdminAuth } from '@/lib/firebase-admin';
import type { TenantSignals } from '@/lib/hq-health';

const DAY = 86400000;

export async function count(q: any): Promise<number> { try { return (await q.count().get()).data().count; } catch { return 0; } }

export async function signals(db: any, t: any, lastSignIn: string | null): Promise<TenantSignals> {
  const base = `tenants/${t.id}`;
  const now = Date.now();
  const d7 = new Date(now - 7 * DAY).toISOString(), d14 = new Date(now - 14 * DAY).toISOString();
  const appts = db.collection(`${base}/appointments`);
  const msgs = db.collection(`${base}/messageLog`);
  // Single-field queries only, so no composite indexes are needed: this
  // week's messages and this business's tickets are read and tallied here.
  const [services, clients, staff, appointmentsTotal, bookings7d, bookings14d, msgWeek, tickets] = await Promise.all([
    count(db.collection(`${base}/services`)), count(db.collection(`${base}/clients`)), count(db.collection(`${base}/staff`)),
    count(appts), count(appts.where('createdAt', '>=', d7)), count(appts.where('createdAt', '>=', d14)),
    msgs.where('sentAt', '>=', d7).select('status').limit(2000).get().then((r: any) => r.docs.map((d: any) => (d.data() as any).status)).catch(() => [] as string[]),
    db.collection('platformTickets').where('tenantId', '==', t.id).select('status').limit(200).get().then((r: any) => r.docs.map((d: any) => (d.data() as any).status)).catch(() => [] as string[]),
  ]);
  const sent7 = (msgWeek as string[]).filter((x) => x === 'sent').length;
  const failed7 = (msgWeek as string[]).filter((x) => x === 'failed').length;
  const openTickets = (tickets as string[]).filter((x) => x === 'open' || x === 'waiting_on_us').length;
  return {
    services, clients, staff, appointmentsTotal, bookings7d, bookingsPrev7d: Math.max(0, bookings14d - bookings7d),
    messagesSent7d: sent7, messagesFailed7d: failed7, openTickets,
    daysSinceOwnerSignIn: lastSignIn ? Math.floor((now - new Date(lastSignIn).getTime()) / DAY) : null,
    stripeConnected: !!(t.stripeAccountId && t.stripeChargesEnabled !== false),
    active: t.subscriptionStatus === 'active', teamSize: t.teamSize || 'solo',
    ageDays: t.createdAt ? Math.floor((now - new Date(t.createdAt).getTime()) / DAY) : 999,
  };
}

export async function ownersLastSignIn(uids: string[]): Promise<Record<string, { email: string | null; lastSignIn: string | null }>> {
  const out: Record<string, any> = {};
  const auth = getAdminAuth();
  for (let i = 0; i < uids.length; i += 100) {
    try {
      const r = await auth.getUsers(uids.slice(i, i + 100).map((uid) => ({ uid })));
      for (const u of r.users) out[u.uid] = { email: u.email || null, lastSignIn: u.metadata.lastRefreshTime || u.metadata.lastSignInTime || null };
    } catch { /* keep going */ }
  }
  return out;
}
