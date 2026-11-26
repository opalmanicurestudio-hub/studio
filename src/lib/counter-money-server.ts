// src/lib/counter-money-server.ts — A TIP AND A DISCOUNT ON A COUNTER ORDER (server; design board "Money at the counter";
// lib/counter-money). Both only on an order that's been sent and isn't paid yet, and never while the card reader or a
// scan-to-pay code is asking for the old total (as with a reward: lib/counter-points useReward).
// - setTip: the tip the guest picked (or none), into the order's total.
// - setDiscount: one of the business's discounts, or another amount a manager okays (the route checks the manager), or
//   none. It comes off before tax, beside a reward, and the tip stays as it was.
// - addTender / removeTender: a gift card (held on the card) or the guest's store credit, set aside for what's left; the
//   rest is paid by cash or card, and both are taken when it's paid (lib/counter-server payOrder).
import { totalsOf } from '@/lib/counter-orders';
import { cardBusy } from '@/lib/counter-server';
import { cleanTip, discountsOf, discountCents, discountWords, itemsCentsOf, rewardCentsOf, tipCentsOf, tendersOf, dueCentsOf, codeEnd, isPaidPart, paidPartsOf, tenderRoomOf, giftCentsOf, GIFT_CASH_WORDS, type Discount, type Tender } from '@/lib/counter-money';
import { findByCode, giftSpendPlan, holdGiftCard, releaseHold } from '@/lib/gift-cards';
import { creditBalance } from '@/lib/store-credit';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
type Fail = { ok: false; error: string; status: number; code?: string };
const fail = (error: string, status: number, code?: string): Fail => ({ ok: false, error, status, ...(code ? { code } : {}) });
const nowIso = () => new Date().toISOString();
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Why the money on it can't change now (null: it can). */
function notNow(o: any, what: 'tip' | 'discount' | 'tender'): Fail | null {
  if (!o) return fail('That order is gone.', 404);
  if (o.paidAt) return fail('It’s paid already.', 409, 'paid');
  // (A gift card or store credit is taken as it's paid, so it goes on an order the kitchen has finished, too.)
  if (o.status !== 'sent' && !(what === 'tender' && o.status === 'done')) return fail(o.status === 'building' ? `Send the order first, then ${what === 'tip' ? 'add the tip' : what === 'discount' ? 'add the discount' : 'take the payment'}.` : 'That order can’t change now.', 409, 'not_sent');
  if (o.staffMeal) return fail('A staff meal takes no money.', 409, 'staff');
  if (o.app?.code) return fail('A delivery app’s order is paid on the app.', 409, 'app');
  if (o.channel === 'kiosk') return fail('A kiosk order is paid at the kiosk.', 409, 'kiosk');
  if (cardBusy(o)) return fail('The card reader is asking for this order’s payment. Stop it first.', 409, 'card_busy');
  if (o.phone?.id && o.phone.state === 'open') return fail('A scan-to-pay code is open for this order. Close it first.', 409, 'phone_open');
  // (A split bill with a part paid: its total stays as it is, so the parts still add up. lib/counter-split-server.)
  if (what !== 'tender' && paidPartsOf(o).length) return fail(`Part of it is paid, so its total stays as it is. Give the parts back first to change the ${what}.`, 409, 'parts');
  return null;
}

/** The order's money with a discount of `markdownCents` beside its reward, keeping its tip. */
export function moneyWith(tenant: any, o: any, markdownCents: number) {
  const lines = Array.isArray(o.lines) ? o.lines : [];
  const off = rewardCentsOf(o) + Math.max(0, Math.round(markdownCents));
  const t = totalsOf(tenant, lines, off / 100, String(o?.locationId || '') || null);
  return { ...t, total: r2(t.total + tipCentsOf(o) / 100), discount: t.discount ?? 0, itemsTotal: t.itemsTotal ?? null };
}

/** The guest's tip (whole cents; 0 takes it off). The total is the order's before any tip, plus this one. */
export async function setTip(db: any, tenantId: string, orderId: string, cents: unknown, who: { id: string | null; name: string }, opts: { guestOnce?: boolean } = {}) {
  if (!ID.test(orderId)) return fail('Which order?', 400);
  const ref = db.doc(`tenants/${tenantId}/counterOrders/${orderId}`);
  return db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(ref)).data(); const no = notNow(o, 'tip'); if (no) return no;
    if (o.ahead?.way === 'delivery') return fail('A delivery’s tip is the driver’s, chosen when it was ordered.', 409, 'delivery');
    const base = Math.round(Number(o.total || 0) * 100) - tipCentsOf(o);
    // (Never more than the order without its gift cards: lib/counter-gift.)
    const tip = cleanTip(cents, base - giftCentsOf(o.lines)); if (tip === null) return fail('How much is the tip?', 400);
    // (Picked by the guest on their screen, app/drive-thru/[tenantId]/guest: once, and never over a tip already on it.)
    if (opts.guestOnce && (o.tipChosenAt || tipCentsOf(o) > 0)) return fail('The tip is picked at the counter now.', 409, 'chosen');
    const total = r2((base + tip) / 100);
    tx.set(ref, { tipCents: tip, total, tipBy: tip ? { id: who.id || null, name: who.name } : null, tipAt: tip ? nowIso() : null, updatedAt: nowIso(), ...(opts.guestOnce ? { tipChosenAt: nowIso(), tipChosenBy: 'guest' } : {}) }, { merge: true });
    return { ok: true as const, tipCents: tip, total, number: String(o.number || '') };
  });
}

export type DiscountAsk = { id?: string | null; custom?: { kind?: unknown; value?: unknown; reason?: unknown } | null };

/** One of the business's discounts (`id`), another amount okayed by `approver` (`custom`), or none (neither). */
export async function setDiscount(db: any, tenantId: string, tenant: any, orderId: string, ask: DiscountAsk, who: { id: string | null; name: string }, approver: { id: string; name: string } | null) {
  if (!ID.test(orderId)) return fail('Which order?', 400);
  let d: (Discount & { custom?: boolean; reason?: string | null }) | null = null;
  if (ask.custom) {
    const kind = ask.custom.kind === 'off' ? 'off' : ask.custom.kind === 'pct' ? 'pct' : null;
    const value = Math.round(Number(ask.custom.value));
    const reason = String(ask.custom.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!kind || !Number.isFinite(value) || (kind === 'pct' ? value < 1 || value > 100 : value < 1 || value > 50000)) return fail(kind === 'pct' ? 'A percent from 1 to 100.' : 'How much off?', 400);
    if (!reason) return fail('Say why, for the record.', 400, 'reason');
    if (!approver) return fail('Another amount takes a manager. Their PIN, or ask one to.', 403, 'needs_manager');
    // (Shown to the guest as just "Discount": the reason is for the record, the report and whoever okayed it.)
    d = { id: 'other', label: 'Discount', kind, value, custom: true, reason };
  } else if (ask.id) {
    d = discountsOf(tenant).find((x) => x.id === String(ask.id)) || null;
    if (!d) return fail('That discount isn’t on the list any more.', 409, 'gone');
  }
  const ref = db.doc(`tenants/${tenantId}/counterOrders/${orderId}`);
  return db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(ref)).data(); const no = notNow(o, 'discount'); if (no) return no;
    if (!d) {
      tx.set(ref, { markdown: null, ...moneyWith(tenant, o, 0), updatedAt: nowIso() }, { merge: true });
      return { ok: true as const, off: true, total: moneyWith(tenant, o, 0).total, number: String(o.number || '') };
    }
    const cents = discountCents(d, itemsCentsOf(o), rewardCentsOf(o));
    if (!cents) return fail('There’s nothing left on this order to take it off.', 409, 'nothing');
    const money = moneyWith(tenant, o, cents);
    const markdown = { id: d.id, label: d.label, kind: d.kind, value: d.value, words: discountWords(d), cents, by: who.name, byId: who.id || null,
      ...(d.custom ? { custom: true, reason: d.reason || null, okBy: approver!.name, okById: approver!.id } : {}), at: nowIso() };
    tx.set(ref, { markdown, ...money, updatedAt: nowIso() }, { merge: true });
    return { ok: true as const, cents, total: money.total, label: d.label, reason: d.reason || null, number: String(o.number || ''), custom: !!d.custom };
  });
}

/** The gift card hold for an order (one per card; the same order asking again changes it). */
export const holdIdOf = (orderId: string) => `counter_${orderId}`;

/** A gift card (by the code on it) or the guest's store credit (an order with a rewards member on it), set aside for
 *  what's left to pay: all of it, or what the card or the credit has. */
export async function addTender(db: any, tenantId: string, orderId: string, ask: { kind: 'gift' | 'credit'; code?: unknown; upTo?: unknown }, who: { id: string | null; name: string }) {
  if (!ID.test(orderId)) return fail('Which order?', 400);
  // (One guest's share of a split bill: no more than it, lib/counter-split-server.)
  const upTo = ask.upTo === undefined || ask.upTo === null || ask.upTo === '' ? null : Math.round(Number(ask.upTo));
  if (upTo !== null && (!Number.isFinite(upTo) || upTo < 1)) return fail('How much is this part?', 400);
  const cap = (n: number) => (upTo === null ? n : Math.min(n, upTo));
  const T = `tenants/${tenantId}`; const ref = db.doc(`${T}/counterOrders/${orderId}`);
  const o0: any = (await ref.get()).data(); const no0 = notNow(o0, 'tender'); if (no0) return no0;
  if (dueCentsOf(o0) <= 0) return fail('Nothing is left to pay on it.', 409, 'nothing');
  if (tenderRoomOf(o0) <= 0) return fail(GIFT_CASH_WORDS, 409, 'gift_line');
  let gift: { id: string; code: string; promo: boolean; cents: number } | null = null;
  if (ask.kind === 'gift') {
    const code = String(ask.code ?? '').trim().slice(0, 40); if (!code) return fail('Type or scan the gift card’s code.', 400);
    const g: any = await findByCode(db, tenantId, code);
    if (!g) return fail('That gift card code wasn’t found. Check it and try again.', 404, 'not_found');
    if (tendersOf(o0).some((t) => t.kind === 'gift' && t.giftCardId === g.id)) return fail('That gift card is on this order already.', 409, 'twice');
    const h: any = await holdGiftCard(db, tenantId, { id: g.id, holdId: holdIdOf(orderId), cents: cap(Math.min(dueCentsOf(o0), tenderRoomOf(o0))) });
    if (!h.ok) return fail(h.error || 'That gift card can’t be used.', 409, 'gift');
    if (!h.cents) { await releaseHold(db, tenantId, g.id, holdIdOf(orderId)); return fail('There’s nothing left on that gift card.', 409, 'empty'); }
    gift = { id: g.id, code: String(g.code || code), promo: g.promo === true, cents: h.cents };
  } else if (!o0.clientId) return fail('Store credit is theirs by their rewards number. Add it to the order first.', 409, 'no_member');
  // (Their rewards code, not a number someone said: as for a reward, lib/counter-points.)
  else if (o0.points?.verified !== true) return fail('Store credit is used with their rewards code.', 409, 'needs_code');
  const client: any = ask.kind === 'credit' ? (await db.doc(`${T}/clients/${o0.clientId}`).get()).data() || {} : null;
  const r: any = await db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(ref)).data(); const no = notNow(o, 'tender'); if (no) return no;
    const due0 = dueCentsOf(o); if (due0 <= 0) return fail('Nothing is left to pay on it.', 409, 'nothing');
    // (A gift card sold with it is paid in cash or by card: lib/counter-gift.)
    const room = tenderRoomOf(o); if (room <= 0) return fail(GIFT_CASH_WORDS, 409, 'gift_line');
    const due = Math.min(due0, room);
    const list = tendersOf(o);
    let t: Tender;
    if (gift) t = { kind: 'gift', giftCardId: gift.id, code: gift.code, cents: cap(Math.min(gift.cents, due)), ...(gift.promo ? { promo: true } : {}), ...(upTo !== null ? { part: true } : {}) };
    else {
      if (!o.clientId || o.points?.verified !== true) return fail('Store credit is used with their rewards code.', 409, 'needs_code');
      if (list.some((x) => x.kind === 'credit')) return fail('Their store credit is on this order already.', 409, 'twice');
      const have = Math.round(creditBalance(client) * 100); if (have <= 0) return fail('They have no store credit to use.', 409, 'empty');
      t = { kind: 'credit', clientId: String(o.clientId), cents: cap(Math.min(have, due)), ...(upTo !== null ? { part: true } : {}) };
    }
    tx.set(ref, { tenders: [...list, t], updatedAt: nowIso(), tenderBy: { id: who.id || null, name: who.name } }, { merge: true });
    return { ok: true as const, tender: t, due: due0 - t.cents, number: String(o.number || '') };
  });
  // (Not set aside after all: the hold on the card is let go.)
  if (!r.ok && gift) await releaseHold(db, tenantId, gift.id, holdIdOf(orderId));
  // (Less than the card holds is needed: the hold is only what's used.)
  else if (r.ok && gift && r.tender.cents < gift.cents) await holdGiftCard(db, tenantId, { id: gift.id, holdId: holdIdOf(orderId), cents: r.tender.cents }).catch(() => null);
  return r;
}

/** Take one off (a gift card by its id, or the store credit): its hold on the card is let go. */
export async function removeTender(db: any, tenantId: string, orderId: string, which: { giftCardId?: unknown; credit?: boolean }) {
  if (!ID.test(orderId)) return fail('Which order?', 400);
  const ref = db.doc(`tenants/${tenantId}/counterOrders/${orderId}`);
  const r: any = await db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(ref)).data(); const no = notNow(o, 'tender'); if (no) return no;
    const list = tendersOf(o); const gid = String(which.giftCardId || '');
    const keep = list.filter((t) => !(which.credit ? t.kind === 'credit' : t.kind === 'gift' && t.giftCardId === gid));
    if (keep.length === list.length) return fail('That isn’t on the order.', 404);
    tx.set(ref, { tenders: keep, updatedAt: nowIso() }, { merge: true });
    return { ok: true as const, due: dueCentsOf({ ...o, tenders: keep }) };
  });
  if (r.ok && !which.credit && ID.test(String(which.giftCardId || ''))) await releaseHold(db, tenantId, String(which.giftCardId), holdIdOf(orderId));
  return r;
}

/** Whether its gift cards and store credit still cover their part, read in the caller's step before the card reader or
 *  scan to pay asks the guest for the rest (so the guest is never charged for an order that then can't be paid). The
 *  words to show when one doesn't; null when they do. */
export async function tendersStillCover(tx: any, db: any, tenantId: string, o: any, orderId: string): Promise<string | null> {
  let room = Math.round(Number(o?.total || 0) * 100);
  const all = tendersOf(o);
  for (const t of [...all.filter(isPaidPart), ...all.filter((x) => !isPaidPart(x))]) {
    const need = Math.min(t.cents, room); room -= need; if (need <= 0 || isPaidPart(t)) continue;
    if (t.kind === 'gift') {
      const cur: any = (await tx.get(db.doc(`tenants/${tenantId}/giftCards/${t.giftCardId}`))).data();
      // (The same test the sale makes as it's paid: cancelled, expired, or not enough left besides this order's hold.)
      if (!giftSpendPlan(cur, null, { cents: need, holdId: holdIdOf(orderId), by: '' }).ok) return `Gift card ${codeEnd(t.code)} doesn’t cover its part any more. Take it off, then take the payment.`;
    } else if (t.kind === 'credit') {
      if (t.clientId !== o?.clientId || o?.points?.verified !== true) return 'Store credit is used with their rewards code. Take it off, or add their code again.';
      const c: any = (await tx.get(db.doc(`tenants/${tenantId}/clients/${t.clientId}`))).data() || {};
      if (Math.round(creditBalance(c) * 100) < need) return 'Their store credit changed. Take it off and set it aside again.';
    }
  }
  return null;
}
