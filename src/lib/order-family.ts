// src/lib/order-family.ts — AN ORDER AND THE ORDERS MADE FROM IT. A backorder, pre-order items sent on later, and a
// replacement (for a return, or for a parcel that stopped moving) are each their own $0 order, linked by parentOrderId
// to the order they came from. The customer paid once, on the first order (the paying order), so:
//   · money for anything on one of them goes back to the paying order's card (api/retail/refund),
//   · every refund across the family counts against what that card was charged, and
//   · each item is worth what the customer paid for it: its price after any promo code (carried on the line as
//     unitPaidCents, lib/retail-swap effectiveUnitCents) with its share of the tax (the paying order's tax figures,
//     carried on the order as taxBasis, lib/restocking taxShareCents).
// A replacement that also carries items from another order that shipped in the same box is refunded to the card on the
// order it was made from (the one that bought the label), within what that card was charged.
// Pure apart from the two readers at the end, which take the database's own get (a transaction's, inside one).
import { cardPaidCents } from './retail-money';
import { roomCents } from './non-card-back';
import { effectiveUnitCents } from './retail-swap';
import { taxShareCents } from './restocking';

const n = (v: any): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const cents = (v: any): number => Math.max(0, Math.round(n(v)));

/** The customer paid for this order themselves: a card payment on file, or a total or a charge of its own. */
export function paidItself(o: any): boolean {
  return !!String(o?.stripePaymentIntentId || '').trim() || n(o?.totalCents) > 0 || n(o?.chargedCents) > 0;
}

/** A $0 order the shop made from another one: a backorder, pre-order items sent later, or a replacement. */
export function isFollowUp(o: any): boolean {
  return !!String(o?.parentOrderId || '').trim() && !paidItself(o);
}

/** What it is, in a few words, for the team's screens and the order's history. */
export function followUpLabel(o: any): string {
  if (o?.isReplacement) return o?.replacementFor === 'lost_in_transit' ? 'the replacement for the lost parcel' : 'the replacement';
  return o?.hasPreorder ? 'the pre-order items sent later' : 'the backorder';
}

export type TaxBasis = { subtotalCents: number; taxCents: number; discountCents: number };

/** The figures tax was worked out from on the order the customer paid on: this order's own, or the ones a follow-up
 *  carries. Null when there are none. */
export function taxBasisOf(o: any): TaxBasis | null {
  if (n(o?.subtotalCents) > 0 || n(o?.taxCents) > 0) return { subtotalCents: cents(o.subtotalCents), taxCents: cents(o.taxCents), discountCents: cents(o.discountCents) };
  const b = o?.taxBasis;
  return b && n(b.subtotalCents) > 0 ? { subtotalCents: cents(b.subtotalCents), taxCents: cents(b.taxCents), discountCents: cents(b.discountCents) } : null;
}

/** A copy of a line for `qty` of its units, for a follow-up: each unit keeps the price that was paid for it (worked out
 *  with the original line's quantity), and its promo and line discounts are shared down in proportion. */
export function lineFor(l: any, qty: number): any {
  const q0 = Math.max(1, Math.round(n(l?.qtyOrdered)) || 1);
  const out: any = { ...l, qtyOrdered: qty, unitPaidCents: effectiveUnitCents(l || {}) };
  if (qty === q0) return out;
  if (l?.promoCents != null) out.promoCents = Math.round(n(l.promoCents) / q0) * qty;
  if (l?.lineDiscountCents != null) out.lineDiscountCents = Math.round(n(l.lineDiscountCents) / q0) * qty;
  if (l?.offerCents != null) out.offerCents = Math.round(n(l.offerCents) / q0) * qty;
  return out;
}

/** What each unit on a follow-up's line was paid: the price the line carries, or, for a follow-up made before lines
 *  carried it, the price on the matching line of the order paid on (the copy kept the whole line's promo for fewer units). */
function unitPaid(l: any, from?: any): number {
  if (l && l.unitPaidCents == null && Array.isArray(from?.lines)) {
    const m = from.lines.find((x: any) => x && x !== l && x.productId === l.productId && n(x.unitPriceCents) === n(l.unitPriceCents)
      && String(x.optionsLabel || '') === String(l.optionsLabel || ''));
    if (m) return effectiveUnitCents(m);
  }
  return effectiveUnitCents(l || {});
}

/** What the customer paid for the items on a follow-up that are still theirs to get (or went in its box): each line's
 *  units, less any shorted (and, unless `lessReturned` is false, any returned), at the price paid, with their share of
 *  the tax. `basisFrom` is the paying order, for a follow-up made before follow-ups carried their price and tax figures. */
export function followUpItemsCents(o: any, basisFrom?: any, opts: { lessReturned?: boolean } = {}): number {
  const lessReturned = opts.lessReturned !== false;
  const items = (Array.isArray(o?.lines) ? o.lines : []).reduce((a: number, l: any) =>
    a + Math.max(0, n(l?.qtyOrdered) - n(l?.qtyShorted) - (lessReturned ? n(l?.qtyReturned) : 0)) * unitPaid(l, basisFrom), 0);
  const withBasis = o?.taxBasis || !basisFrom ? o || {} : { taxBasis: taxBasisOf(basisFrom) };
  return items + taxShareCents(withBasis, items);
}

/** The carrier delivered this parcel after all. */
export function parcelArrived(o: any): boolean {
  return !!o?.deliveredAt || String(o?.carrierTrail?.carrierStatus || o?.carrierStatus || '').toUpperCase() === 'DELIVERED'
    || (o?.method === 'ship' && o?.stage === 'completed');
}

/** The paying order has already given back everything: it was cancelled (its refund was all its card paid and its gift
 *  card or credit went back, the items on its follow-ups included), or the whole order was refunded to the card. An
 *  order part paid by gift card or store credit is never settled by card refunds alone: that part is still theirs. */
function settled(p: any): boolean {
  if (!p) return false;
  if (['cancelled'].includes(String(p.stage || ''))) return true;
  const paid = Math.max(cardPaidCents(p), cents(p.totalCents));
  return paid > 0 && cents(p.refundedCents) >= paid;
}

/** What cancelling a follow-up gives back to the customer: what they paid for its items still to be sent, within what
 *  the family still holds. Nothing for a replacement for a parcel that was delivered after all (they have the goods).
 *  `parent` is the order it was made from, `payer` the order paid on, `lostParcel` the parcel a replacement was made
 *  for when that's further up (a backorder of a replacement). With `family` (every order made from the payer), what's
 *  left is worked out across them, so a follow-up the payer's own cancellation kept back still gives back what it was
 *  kept back for; without it, nothing comes back once the payer has given everything back. */
export function followUpCancelCents(o: any, parent?: any, payer?: any, family?: any[], lostParcel?: any): number {
  if (String(o?.replacementFor || '') === 'lost_in_transit' && (lostParcel || parent) && parcelArrived(lostParcel || parent)) return 0;
  const items = followUpItemsCents(o, payer || parent);
  if (family && payer) return Math.min(items, familyLeftCents(payer, family));
  if (settled(payer || (parent && !isFollowUp(parent) ? parent : null))) return 0;
  return items;
}

/** What can still go back to the customer across a family: what the paying order's card hasn't had back, plus what its
 *  gift card or store credit paid that hasn't gone back, less every refund already waiting to go out on any of them. */
export function familyLeftCents(payer: any, followUps: any[]): number {
  const payerId = String(payer?.id || '');
  const seen = new Set<string>();
  const fam = (followUps || []).filter((f) => { const id = String(f?.id || ''); if (!id || id === payerId || seen.has(id) || !isFollowUp(f)) return false; seen.add(id); return true; });
  const queued = cents(payer?.pendingRefundCents) + fam.reduce((a, f) => a + cents(f.pendingRefundCents), 0);
  return Math.max(0, familyRefundableCents(payer, fam) + roomCents(payer) - queued);
}

const OPEN_STAGES = ['placed', 'paid', 'picking', 'packed', 'ready', 'arrived'];
const SENT_STAGES = ['shipped', 'completed'];

/** Cancelling the order the customer paid on. Its follow-ups that haven't gone out are cancelled with it, their items
 *  refunded on this order, and its card gets back everything it hasn't had back yet, less what's already queued on the
 *  follow-ups and what the customer keeps from any that went out. `followUps` are every order made from it;
 *  `cancellable` narrows which open ones may go (a customer can't cancel one that's being packed): one that stays is
 *  counted as theirs, like one that went out. `spokenCents` is what the follow-ups that stay hold against the payment:
 *  what the customer keeps from them, and what's already queued on them. */
export function cancelWithFollowUps(payer: any, followUps: any[], cancellable: (f: any) => boolean = () => true): { cancel: any[]; pendingCents: number; spokenCents: number } {
  const payerId = String(payer?.id || '');
  const seen = new Set<string>();
  const fam = (followUps || []).filter((f) => {
    const id = String(f?.id || '');
    if (!id || id === payerId || seen.has(id) || !isFollowUp(f)) return false;
    seen.add(id);
    return true;
  });
  let spoken = 0;
  const cancel: any[] = [];
  for (const f of fam) {
    const stage = String(f.stage || '');
    // A delivery out with its driver is in the van: it isn't canceled with the rest.
    const goes = OPEN_STAGES.includes(stage) && cancellable(f) && !(f.method === 'delivery' && f.delivery?.status === 'out');
    // Gone out, or going out: the customer has those items, less what's been refunded for them already (those refunds
    // are already off the room). Anything still queued on it goes back on its own.
    // What's been refunded for it counts whichever way it went back: to the card, or onto the gift card or as store credit.
    if (SENT_STAGES.includes(stage) || (OPEN_STAGES.includes(stage) && !goes)) { spoken += Math.max(0, followUpItemsCents(f, payer, { lessReturned: false }) - cents(f.refundedCents) - cents(f.refundedOtherCents)); continue; }
    // Not going out: anything queued on it goes back on its own; its items come back with this order.
    spoken += cents(f.pendingRefundCents);
    if (goes) cancel.push(f);
  }
  return { cancel, pendingCents: Math.max(0, familyRefundableCents(payer, fam) - spoken), spokenCents: spoken };
}

/** The shelf units an order is holding: each open unit of a paid order's physical items. A backorder still waiting for
 *  stock holds none (it takes its units when it's released), and digital items never hold any. */
export function heldUnits(o: any): Map<string, number> {
  const out = new Map<string, number>();
  if (!['paid', 'picking', 'packed', 'ready', 'arrived'].includes(String(o?.stage || '')) || o?.holdUntilRestock === true) return out;
  for (const l of Array.isArray(o?.lines) ? o.lines : []) {
    if (!l || l.digital === true || !l.productId) continue;
    const open = Math.max(0, n(l.qtyOrdered) - n(l.qtyShorted));
    if (open > 0) out.set(String(l.productId), (out.get(String(l.productId)) || 0) + open);
  }
  return out;
}

/** Card money still refundable across a family: what the paying order's card was charged, less every refund recorded
 *  on it and on the follow-ups made from it (each was sent to, or recorded against, that card). */
export function familyRefundableCents(payer: any, followUps: any[]): number {
  const payerId = String(payer?.id || '');
  const seen = new Set<string>();
  let refunded = cents(payer?.refundedCents);
  for (const f of followUps || []) {
    const id = String(f?.id || '');
    if (!id || id === payerId || seen.has(id) || !isFollowUp(f)) continue;
    seen.add(id);
    refunded += cents(f.refundedCents);
  }
  return Math.max(0, cardPaidCents(payer) - refunded);
}

/** The same customer: the follow-up was made from this order (they share the order's link key), or the same email. */
export function sameCustomer(a: any, b: any): boolean {
  const qa = String(a?.qrToken || ''); const qb = String(b?.qrToken || '');
  if (qa && qb) return qa === qb;
  const ea = String(a?.customerEmail || '').trim().toLowerCase();
  return !!ea && ea === String(b?.customerEmail || '').trim().toLowerCase();
}

type Getter = (refOrQuery: any) => Promise<any>;

/** The order the customer paid on: this one, or the first order up its parentOrderId chain that paid for itself.
 *  Null when the chain breaks (a missing order, a loop) or ends at another $0 order. `o` carries its id. */
export async function payingOrder(get: Getter, col: any, o: any): Promise<any | null> {
  let cur = o;
  const seen = new Set<string>([String(o?.id || '')]);
  for (let i = 0; i < 5 && isFollowUp(cur); i++) {
    const pid = String(cur.parentOrderId || '');
    if (!pid || seen.has(pid)) return null;
    seen.add(pid);
    const s = await get(col.doc(pid));
    if (!s?.exists) return null;
    cur = { ...(s.data() || {}), id: pid };
  }
  return isFollowUp(cur) ? null : cur;
}

/** Every order made from `rootId`, at any depth (a few at most), each with its id. */
export async function followUpsOf(get: Getter, col: any, rootId: string, max = 40): Promise<any[]> {
  const out: any[] = [];
  const seen = new Set<string>([rootId]);
  let frontier = [rootId];
  for (let depth = 0; depth < 4 && frontier.length && out.length < max; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      const snap = await get(col.where('parentOrderId', '==', id).limit(max));
      for (const d of snap?.docs || []) {
        if (seen.has(d.id) || out.length >= max) continue;
        seen.add(d.id);
        out.push({ ...(d.data() || {}), id: d.id });
        next.push(d.id);
      }
    }
    frontier = next;
  }
  return out;
}
