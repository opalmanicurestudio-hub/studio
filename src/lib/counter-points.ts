// src/lib/counter-points.ts — POINTS ON A DRIVE-THRU OR ORDER-AHEAD ORDER (the business's own rewards program,
// lib/loyalty-server). The guest gives their phone number (to the order-taker, or on the order-ahead page); the order is
// then theirs in the client book, and once it's paid it earns points like any sale, once (the ledger keys it by the
// sale), and a refund at the desk takes them back (lib/money-refund). Someone who isn't a member yet is added only when they say yes (a program you join
// asks first). Nothing is earned while the program is off.
//   counterOrders/{id}.clientId, .points = { phone (last 4 only), linkedAt, linkedBy, earned, at }
import { loyaltyOf } from '@/lib/loyalty';
import { earnForSale, balanceFor } from '@/lib/loyalty-server';
import { clientByPhone } from '@/lib/conversation';
import { searchFields } from '@/lib/client-search';
import { createHash } from 'crypto';
import { cleanName } from '@/lib/counter-server';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const nowIso = () => new Date().toISOString();
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const last10 = (v: unknown) => String(v ?? '').replace(/\D/g, '').slice(-10);
type Fail = { ok: false; error: string; status: number; code?: string };
const fail = (error: string, status: number, code?: string): Fail => ({ ok: false, error, status, ...(code ? { code } : {}) });

export const pointsOn = (tenant: any) => loyaltyOf(tenant).on;
const unitOf = (tenant: any) => (loyaltyOf(tenant).earn?.mode === 'punch' ? 'punches' : 'points');

/** The points a paid order earns (once; a later call changes nothing). */
export async function earnForOrder(db: any, tenantId: string, tenant: any, orderId: string): Promise<number> {
  if (!ID.test(orderId)) return 0;
  if (!tenant) tenant = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
  if (!pointsOn(tenant)) return 0;
  const ref = db.doc(`tenants/${tenantId}/counterOrders/${orderId}`);
  const o: any = (await ref.get()).data();
  if (!o?.clientId || !o.paidAt || o.status === 'voided') return 0;
  const r: any = await earnForSale(db, tenantId, tenant, {
    clientId: String(o.clientId), saleId: `counter_${orderId}`, by: String(o.paidBy || 'Order'), at: o.paidAt,
    // What was paid for each item (before tax), as products; one order is one visit (a visit with nothing charged for
    // it, so a points-per-visit program or a punch card counts it, and points per dollar count only the items).
    sale: { services: [{ serviceId: null, cents: 0 }], products: (o.lines || []).map((l: any) => ({ productId: String(l.itemId || '') || null, cents: Math.round(num(l.unitPrice) * num(l.quantity) * 100) })), giftSpentCents: 0, giftBoughtCents: 0, visits: 1, rebooked: false, renter: false },
  }).catch((e: any) => { console.error('[counter-points] not earned', orderId, e?.message); return { points: 0 }; });
  const pts = Math.max(0, Math.floor(num(r?.points)));
  if (pts > 0) await ref.set({ points: { earned: pts, at: nowIso() } }, { merge: true });
  return pts;
}

/** The order is theirs: by phone, for someone in the client book; for someone new only when `join` (they said yes),
 *  added with the name on the order. Paid already, it earns now. */
export async function linkOrder(db: any, tenantId: string, tenant: any, orderId: string, b: { phone?: unknown; join?: unknown; name?: unknown }, by: string) {
  if (!pointsOn(tenant)) return fail('The rewards program isn’t on.', 409, 'off');
  if (!ID.test(orderId)) return fail('Which order?', 400);
  const d = last10(b.phone); if (d.length !== 10) return fail('A 10-digit phone number.', 400, 'phone');
  const ref = db.doc(`tenants/${tenantId}/counterOrders/${orderId}`);
  const o: any = (await ref.get()).data(); if (!o) return fail('That order is gone.', 404);
  if (o.status === 'voided' || o.status === 'cancelled') return fail('That order was voided.', 409);
  const S = loyaltyOf(tenant);
  let clientId: string | null = (await clientByPhone(db, tenantId, d))?.id || null;
  const joinNow = b.join === true;
  if (!clientId) {
    if (!joinNow) return fail('No one in the program has that number. Ask if they’d like to join.', 404, 'not_found');
    // (Never added for an order whose points already went to someone: asked again just before adding.)
    const now2: any = (await ref.get()).data() || {};
    if (num(now2.points?.earned) > 0 || (now2.paidAt && now2.clientId)) return fail('This order’s points went to someone already.', 409, 'earned');
    const name = cleanName(b.name) || cleanName(o.guestName) || 'Guest';
    // One client per number, even when two screens add the same new number at once (named after the number).
    const cRef = db.doc(`tenants/${tenantId}/clients/ph_${createHash('sha256').update(`${tenantId}/${d}`).digest('hex').slice(0, 24)}`);
    const client = { id: cRef.id, name, firstName: name.split(' ')[0], email: null, phone: `+1${d}`, status: 'active', lifetimeValue: 0, createdAt: nowIso(), createdVia: o.channel === 'ahead' ? 'order-ahead' : 'drive-thru', createdBy: by, loyaltyJoinedAt: nowIso() };
    try { await cRef.create({ ...client, ...searchFields(client) }); }
    catch (e: any) {
      if (e?.code !== 6 && !/already exists/i.test(String(e?.message || ''))) throw e;
      // Added before under this number: only if they're still an active member is the order theirs.
      const had: any = (await cRef.get()).data() || {};
      if (had.archived || had.status === 'archived') return fail('That number belongs to a client who was archived. Restore them in Clients first.', 409, 'archived');
      if (had.loyaltyOptOut === true) return fail('They’ve asked not to be in the rewards program.', 409, 'opted_out');
    }
    clientId = cRef.id;
  } else if (S.join === 'opt_in') {
    const c: any = (await db.doc(`tenants/${tenantId}/clients/${clientId}`).get()).data() || {};
    if (c.loyaltyOptOut === true) return fail('They’ve asked not to be in the rewards program.', 409, 'opted_out');
    if (c.loyaltyJoinedAt == null) {
      if (!joinNow) return fail('They’re in the client book but haven’t joined the rewards program. Ask if they’d like to.', 409, 'not_member');
      await db.doc(`tenants/${tenantId}/clients/${clientId}`).set({ loyaltyJoinedAt: nowIso() }, { merge: true });
    }
  } else {
    const c: any = (await db.doc(`tenants/${tenantId}/clients/${clientId}`).get()).data() || {};
    if (c.loyaltyOptOut === true) return fail('They’ve asked not to be in the rewards program.', 409, 'opted_out');
  }
  // In one step with what the order has now: never moved to someone else once it has earned.
  const r: any = await db.runTransaction(async (tx: any) => {
    const x: any = (await tx.get(ref)).data() || {};
    const earnedRef = db.doc(`tenants/${tenantId}/loyaltyLedger/earn_counter_${orderId}`);
    const earnedAlready = (await tx.get(earnedRef)).exists;
    if (x.clientId === clientId) return { already: true };
    // A paid order earns the moment it's linked: once linked (or earned), it stays with that person.
    if (num(x.points?.earned) > 0 || earnedAlready || (x.paidAt && x.clientId)) return fail('This order’s points went to someone already.', 409, 'earned');
    tx.set(ref, { clientId, points: { phone: d.slice(-4), linkedAt: nowIso(), linkedBy: by } }, { merge: true });
    return { ok: true };
  });
  if (r.ok === false) return r;
  // Paid (now, or at this very moment): it earns. Asked again, it earns nothing twice (the ledger keys it by the sale).
  const earned = await earnForOrder(db, tenantId, tenant, orderId);
  const after: any = (await ref.get()).data() || {};
  return { ok: true as const, clientId: String(clientId), already: !!r.already, earned: earned || num(after.points?.earned), balance: await balanceFor(db, tenantId, String(clientId)), unit: unitOf(tenant) };
}
