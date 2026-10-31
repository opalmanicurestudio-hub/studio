// src/lib/claim-reminder.ts — A REPORT NOBODY HAS DECIDED ON IN TWO DAYS. Once a night (cron/nightly) the owner and the
// people who can decide on reports (allowed to refund, or a manager) get one note listing every report that has waited
// two days since it last came back to the shop: reported, appealed, or answered (lib/claim-view claimSince). A report
// waiting on the customer's answer is theirs, not the shop's, so it's left out until they answer. Each report is
// reminded once per wait (remindedFor), never every night.
import { claimSince, claimWaiting } from './claim-view';

export const CLAIM_REMIND_DAYS = 2;
const WORDS: Record<string, string> = { missing: 'missing', damaged: 'damaged', wrong_item: 'wrong item', not_received: 'never arrived', defective: 'doesn’t work' };

export async function remindWaitingClaims(db: any, tenantId: string, o: { now?: number; tenant?: any } = {}): Promise<{ reminded: number; told: number }> {
  const now = o.now ?? Date.now(); const T = `tenants/${tenantId}`;
  const tenant: any = o.tenant ?? ((await db.doc(T).get()).data() || {});
  if (tenant.accessLocked === true || ['cancelled', 'canceled'].includes(String(tenant.subscriptionStatus || ''))) return { reminded: 0, told: 0 };
  const snap = await db.collection(`${T}/retailClaims`).where('status', '==', 'in_review').limit(300).get();
  const due = snap.docs.map((d: any) => ({ ...(d.data() || {}), id: d.id }))
    .filter((c: any) => !c.isTest && !claimWaiting(c))
    .map((c: any) => ({ c, since: claimSince(c) }))
    .filter((x: any) => x.since > 0 && now - x.since >= CLAIM_REMIND_DAYS * 864e5 && String(x.c.remindedFor || '') !== String(x.since))
    .sort((a: any, b: any) => a.since - b.since);
  if (!due.length) return { reminded: 0, told: 0 };

  const { can, isManagerRole } = await import('./permissions');
  const staff = (await db.collection(`${T}/staff`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((s: any) => s.archived !== true && s.isActive !== false && s.role !== 'renter' && s.isRenter !== true && (can(tenant, s, 'checkout.refund') || isManagerRole(tenant, s.role)));
  const to = [...new Set([tenant.userId, ...staff.map((s: any) => s.id)].filter(Boolean))].slice(0, 20) as string[];
  if (!to.length) return { reminded: 0, told: 0 };

  const first = (n: any) => { const p = String(n || '').trim().split(/\s+/); return p[0] ? `${p[0]}${p[1] ? ` ${p[1][0]}.` : ''}` : 'A customer'; };
  const line = (c: any) => `${first(c.customerName)}: ${c.lineName || 'their order'}${WORDS[String(c.type)] ? `, ${WORDS[String(c.type)]}` : ''}`;
  const n = due.length;
  const message = `${due.slice(0, 3).map((x: any) => line(x.c)).join('; ')}${n > 3 ? `; and ${n - 3} more` : ''}. ${n === 1 ? 'It has' : 'They have'} waited ${CLAIM_REMIND_DAYS} days for a decision.`;
  const at = new Date(now).toISOString();
  const b = db.batch();
  for (const u of to) { const ref = db.collection(`${T}/notifications`).doc(); b.set(ref, { id: ref.id, userId: u, type: 'claim_waiting', title: n === 1 ? 'A problem report is waiting for you' : `${n} problem reports are waiting for you`, message, link: '/retail-orders/problems?show=claims', createdAt: at, read: false }); }
  for (const x of due) b.update(db.doc(`${T}/retailClaims/${x.c.id}`), { remindedFor: String(x.since), remindedAt: at });
  await b.commit();
  return { reminded: n, told: to.length };
}
