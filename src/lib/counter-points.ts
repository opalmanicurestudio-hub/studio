// src/lib/counter-points.ts — POINTS ON A DRIVE-THRU OR ORDER-AHEAD ORDER (the business's own rewards program,
// lib/loyalty-server). The guest gives their phone number (to the order-taker, or on the order-ahead page); the order is
// then theirs in the client book, and once it's paid it earns points like any sale, once (the ledger keys it by the
// sale), and a refund at the desk takes them back (lib/money-refund). Someone who isn't a member yet is added only when they say yes (a program you join
// asks first). Nothing is earned while the program is off.
//   counterOrders/{id}.clientId, .points = { phone (last 4 only), linkedAt, linkedBy, earned, at, verified? }
// Using a reward takes their rewards code (lib/rewards-code; `points.verified`), never just a number someone said: it's
// held for the order in the ledger as its redeem entry (redeem_counter_{orderId}, `held: true`) once the order is sent,
// taken off the order's subtotal before tax, and let go if it's taken off or the order is voided; once paid, it's used
// (and a full refund gives it back, lib/loyalty-server reverseSale).
//   counterOrders/{id}.reward = { id, name, points, cents }, .discount, .itemsTotal
import { loyaltyOf, balanceOf, rewardsFor, rewardCents, type Reward } from '@/lib/loyalty';
import { earnForSale, balanceFor, refreshMember } from '@/lib/loyalty-server';
import { memberByCode } from '@/lib/rewards-code';
import { FieldValue } from 'firebase-admin/firestore';
import { clientByPhone } from '@/lib/conversation';
import { searchFields } from '@/lib/client-search';
import { createHash } from 'crypto';
import { cleanName, cardBusy } from '@/lib/counter-server';
import { moneyWith } from '@/lib/counter-money-server';
import { markdownCentsOf, paidPartsOf, giftCentsOf } from '@/lib/counter-money';
import { noteUsual, usualNow } from '@/lib/counter-usual-server';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const nowIso = () => new Date().toISOString();
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const last10 = (v: unknown) => String(v ?? '').replace(/\D/g, '').slice(-10);
type Fail = { ok: false; error: string; status: number; code?: string };
const fail = (error: string, status: number, code?: string): Fail => ({ ok: false, error, status, ...(code ? { code } : {}) });

export const pointsOn = (tenant: any) => loyaltyOf(tenant).on;
const unitOf = (tenant: any) => (loyaltyOf(tenant).earn?.mode === 'punch' ? 'punches' : 'points');

/** What share of the items' own total was paid (a reward used on the order takes the rest). */
const paidShare = (o: any) => (num(o.discount) > 0 && num(o.itemsTotal) > 0 ? Math.max(0, Math.min(1, num(o.subtotal) / num(o.itemsTotal))) : 1);

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
    // (A reward used on it takes its share off each item: points are earned on what was paid.)
    // (A gift card sold with it isn't an item: it earns only where the business counts gift cards when they're bought,
    // and one it was paid with counts as spent, so the same money never earns twice: lib/loyalty pointsFor.)
    sale: { services: [{ serviceId: null, cents: 0 }], products: (o.lines || []).filter((l: any) => !l?.giftCard).map((l: any) => ({ productId: String(l.itemId || '') || null, cents: Math.round(num(l.unitPrice) * num(l.quantity) * 100 * paidShare(o)) })),
      giftSpentCents: (Array.isArray(o.tenders) ? o.tenders : []).filter((t: any) => t?.kind === 'gift').reduce((s: number, t: any) => s + Math.max(0, Math.round(num(t.cents))), 0), giftBoughtCents: giftCentsOf(o.lines), visits: 1, rebooked: false, renter: false },
  }).catch((e: any) => { console.error('[counter-points] not earned', orderId, e?.message); return { points: 0 }; });
  const pts = Math.max(0, Math.floor(num(r?.points)));
  if (pts > 0) await ref.set({ points: { earned: pts, at: nowIso() } }, { merge: true });
  // What they got, added to their usual (lib/counter-usual-server): once, with their code.
  await noteUsual(db, tenantId, orderId);
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
    const client = { id: cRef.id, name, firstName: name.split(' ')[0], email: null, phone: `+1${d}`, status: 'active', lifetimeValue: 0, createdAt: nowIso(), createdVia: o.channel === 'ahead' ? 'order-ahead' : o.channel === 'counter' ? 'counter' : 'drive-thru', createdBy: by, loyaltyJoinedAt: nowIso() };
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
    if (x.reward) return fail('A reward is on this order. Take it off first.', 409, 'reward');
    // A paid order earns the moment it's linked: once linked (or earned), it stays with that person.
    if (num(x.points?.earned) > 0 || earnedAlready || (x.paidAt && x.clientId)) return fail('This order’s points went to someone already.', 409, 'earned');
    // (By phone number: it earns, but never spends, even where a code was given for someone else before.)
    tx.set(ref, { clientId, points: { phone: d.slice(-4), linkedAt: nowIso(), linkedBy: by, verified: false, via: 'phone' } }, { merge: true });
    return { ok: true };
  });
  if (r.ok === false) return r;
  // Paid (now, or at this very moment): it earns. Asked again, it earns nothing twice (the ledger keys it by the sale).
  const earned = await earnForOrder(db, tenantId, tenant, orderId);
  const after: any = (await ref.get()).data() || {};
  return { ok: true as const, clientId: String(clientId), already: !!r.already, earned: earned || num(after.points?.earned), balance: await balanceFor(db, tenantId, String(clientId)), unit: unitOf(tenant) };
}

const TRIES_MAX = 30, TRIES_MIN = 10, ORDER_TRIES_MAX = 5;
const firstOf = (c: any) => String(c?.firstName || c?.name || '').trim().split(/\s+/)[0] || 'Member';

/** The guest's rewards code (lib/rewards-code): the order is theirs, and they can use a reward on it. Codes that don't
 *  match are counted for the business: after a few dozen in ten minutes, codes wait a few minutes. */
export async function linkByCode(db: any, tenantId: string, tenant: any, orderId: string, code: unknown, by: string) {
  if (!pointsOn(tenant)) return fail('The rewards program isn’t on.', 409, 'off');
  if (!ID.test(orderId)) return fail('Which order?', 400);
  const ref = db.doc(`tenants/${tenantId}/counterOrders/${orderId}`);
  const o: any = (await ref.get()).data(); if (!o) return fail('That order is gone.', 404);
  if (o.status === 'voided' || o.status === 'cancelled') return fail('That order was voided.', 409);
  if (!/^\d{6}$/.test(String(code ?? '').replace(/\D/g, ''))) return fail('Rewards codes are 6 digits.', 400, 'code');
  if (num(o.codeTries) >= ORDER_TRIES_MAX) return fail('Too many codes that didn’t match on this order. Use their phone number instead (it earns points only).', 429, 'order_tries');
  // Each try is counted before the code is looked up (in one step, so tries sent all at once are counted too), and
  // given back when it matches.
  const triesRef = db.doc(`tenants/${tenantId}/private/rewardCodeTries_${Math.floor(Date.now() / (TRIES_MIN * 60000))}`);
  const room = await db.runTransaction(async (tx: any) => {
    const n = num((await tx.get(triesRef)).data()?.n); if (n >= TRIES_MAX) return false;
    tx.set(triesRef, { n: n + 1 }, { merge: true }); return true;
  });
  if (!room) return fail('Too many codes that didn’t match. Try again in a few minutes, or use their phone number.', 429, 'tries');
  const clientId = await memberByCode(db, tenantId, code);
  if (!clientId) {
    await ref.set({ codeTries: FieldValue.increment(1) }, { merge: true }).catch(() => {});
    return fail('That code doesn’t match. Ask them to read it from their rewards page again (it changes every few minutes).', 404, 'no_match');
  }
  await triesRef.set({ n: FieldValue.increment(-1) }, { merge: true }).catch(() => {});
  const c: any = (await db.doc(`tenants/${tenantId}/clients/${clientId}`).get()).data() || {};
  if (c.archived || c.status === 'archived' || c.loyaltyOptOut === true) return fail('That member’s rewards aren’t active.', 409, 'inactive');
  const r: any = await db.runTransaction(async (tx: any) => {
    const x: any = (await tx.get(ref)).data() || {};
    const earnedAlready = (await tx.get(db.doc(`tenants/${tenantId}/loyaltyLedger/earn_counter_${orderId}`))).exists;
    if (x.clientId && x.clientId !== clientId && (x.reward || num(x.points?.earned) > 0 || earnedAlready || x.paidAt)) return fail(x.reward ? 'A reward is on this order for someone else. Take it off first.' : 'This order’s points went to someone already.', 409, 'earned');
    const phone = String(c.phone || '').replace(/\D/g, '').slice(-4) || null;
    tx.set(ref, { clientId, points: { ...(x.clientId === clientId ? x.points || {} : {}), phone, verified: true, via: 'code', linkedAt: nowIso(), linkedBy: by } }, { merge: true });
    return { ok: true, already: x.clientId === clientId };
  });
  if (r.ok === false) return r;
  const earned = await earnForOrder(db, tenantId, tenant, orderId);
  return { ok: true as const, clientId, already: !!r.already, earned, ...(await rewardsOn(db, tenantId, tenant, orderId)) };
}

/** For an order a member's code was given on: their first name, balance, what they can use on it now, and the one in use. */
export async function rewardsOn(db: any, tenantId: string, tenant: any, orderId: string) {
  const o: any = ID.test(orderId) ? (await db.doc(`tenants/${tenantId}/counterOrders/${orderId}`).get()).data() : null;
  if (!o?.clientId || o.points?.verified !== true || !pointsOn(tenant)) return { member: null };
  const S = loyaltyOf(tenant); const c: any = (await db.doc(`tenants/${tenantId}/clients/${o.clientId}`).get()).data() || {};
  // (One already held for this order counts as theirs to swap.)
  const held = Math.max(0, -num((await db.doc(`tenants/${tenantId}/loyaltyLedger/redeem_counter_${orderId}`).get()).data()?.points));
  const balance = await balanceFor(db, tenantId, String(o.clientId));
  const bill = billOf(o);
  const ready = rewardsFor(S, balance + (o.paidAt ? 0 : held)).ready.map((x) => ({ id: x.id, name: x.name, points: x.points, cents: rewardCents(x, bill) })).filter((x) => x.cents > 0);
  // (Their usual, lib/counter-usual: for the staff's screen only, never the guest's.)
  return { member: { name: firstOf(c), balance, unit: unitOf(tenant), ready, using: o.reward ? { id: String(o.reward.id), name: String(o.reward.name), cents: num(o.reward.cents) } : null, usual: await usualNow(db, tenantId, c.counterUsual) } };
}

/** The order as a bill a reward can come off: each item one at a time (a free item is one of it). */
// (Never a gift card sold with it: a reward comes off what's sold, lib/counter-gift.)
const billOf = (o: any) => { const sold = (Array.isArray(o.lines) ? o.lines : []).filter((l: any) => !l?.giftCard);
  return { lines: sold.map((l: any) => ({ serviceId: null, itemId: String(l.itemId || '') || null, cents: Math.round(num(l.unitPrice) * 100) })),
    discountableCents: Math.round((num(o.itemsTotal) || sold.reduce((t: number, l: any) => t + num(l.unitPrice) * num(l.quantity), 0)) * 100) }; };

/** Use a reward on a sent, unpaid order (one at a time; another replaces it), or take it off (`rewardId` null). The
 *  points are held for the order in the same step that checks the balance, and the total changes with it. Never while the
 *  card reader or a scan-to-pay code is asking for the old total. */
export async function useReward(db: any, tenantId: string, tenant: any, orderId: string, rewardId: unknown, by: string) {
  if (!pointsOn(tenant)) return fail('The rewards program isn’t on.', 409, 'off');
  if (!ID.test(orderId)) return fail('Which order?', 400);
  const S = loyaltyOf(tenant); const T = `tenants/${tenantId}`;
  const ref = db.doc(`${T}/counterOrders/${orderId}`); const redeemRef = db.doc(`${T}/loyaltyLedger/redeem_counter_${orderId}`);
  const want: Reward | null = rewardId === null || rewardId === undefined || rewardId === '' ? null : S.rewards.find((x) => x.on && x.id === String(rewardId)) || null;
  if (rewardId && !want) return fail('That reward isn’t offered any more.', 409, 'gone');
  const r: any = await db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(ref)).data(); if (!o) return fail('That order is gone.', 404);
    const held: any = (await tx.get(redeemRef)).data() || null;
    const ledger = o.clientId ? (await tx.get(db.collection(`${T}/loyaltyLedger`).where('clientId', '==', String(o.clientId)))).docs.map((d: any) => d.data()) : [];
    if (o.paidAt) return fail('It’s paid already.', 409, 'paid');
    if (o.status !== 'sent') return fail(o.status === 'building' ? 'Send the order first, then use a reward on it.' : 'That order can’t take a reward now.', 409, 'not_sent');
    if (o.channel === 'kiosk') return fail('A kiosk order is paid at the kiosk.', 409, 'kiosk');
    if (cardBusy(o)) return fail('The card reader is asking for this order’s payment. Stop it first.', 409, 'card_busy');
    if (o.phone?.id && o.phone.state === 'open') return fail('A scan-to-pay code is open for this order. Close it first.', 409, 'phone_open');
    // (A split bill with a part paid: its total stays as it is, so the parts still add up. lib/counter-split-server.)
    if (paidPartsOf(o).length) return fail('Part of it is paid, so its total stays as it is. Give the parts back first to use a reward.', 409, 'parts');
    if (!o.clientId || o.points?.verified !== true) return fail('A reward is used with their rewards code.', 409, 'needs_code');
    if (!want) {
      if (held && held.held === true) tx.delete(redeemRef);
      // (A discount on it stays, and comes out again beside no reward; its tip stays as it was: lib/counter-money.)
      const o2 = { ...o, reward: null }; const md = markdownCentsOf(o2);
      tx.set(ref, { reward: null, ...moneyWith(tenant, o2, md), ...(o.markdown ? { markdown: { ...o.markdown, cents: md } } : {}) }, { merge: true });
      return { ok: true, off: true };
    }
    const balance = balanceOf(ledger) + (held && held.held === true ? -num(held.points) : 0);
    if (balance < want.points) return fail(`They have ${balance} ${unitOf(tenant)}; ${want.name} needs ${want.points}.`, 409, 'short');
    const cents = rewardCents(want, billOf(o));
    if (!cents) return fail(want.kind === 'free_item' ? `${want.name}: that item isn’t on this order.` : `${want.name} can’t be used on this order.`, 409, 'nothing');
    tx.set(redeemRef, { clientId: String(o.clientId), type: 'redeem', points: -want.points, at: nowIso(), by, saleId: `counter_${orderId}`, rewardId: want.id, rewardName: want.name, cents, costCents: want.costCents ?? cents,
      version: S.version, why: `Used: ${want.name}`, held: true });
    const reward = { id: want.id, name: want.name, points: want.points, cents };
    const o2 = { ...o, reward }; const md = markdownCentsOf(o2);
    tx.set(ref, { reward, ...moneyWith(tenant, o2, md), ...(o.markdown ? { markdown: { ...o.markdown, cents: md } } : {}) }, { merge: true });
    return { ok: true };
  });
  if (r.ok === false) return r;
  const now: any = (await ref.get()).data() || {};
  if (ID.test(String(now.clientId || ''))) await refreshMember(db, tenantId, String(now.clientId)).catch(() => null);
  return { ok: true as const, total: num(now.total), ...(await rewardsOn(db, tenantId, tenant, orderId)) };
}
