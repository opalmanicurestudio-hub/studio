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
  return out;
}

/** What the customer paid for the items on a follow-up that are still theirs to get (or went in its box): each line's
 *  units, less any shorted or returned, at the price paid, with their share of the tax. `basisFrom` is the paying order,
 *  for a follow-up made before follow-ups carried their tax figures. */
export function followUpItemsCents(o: any, basisFrom?: any): number {
  const items = (Array.isArray(o?.lines) ? o.lines : []).reduce((a: number, l: any) =>
    a + Math.max(0, n(l?.qtyOrdered) - n(l?.qtyShorted) - n(l?.qtyReturned)) * effectiveUnitCents(l || {}), 0);
  const withBasis = o?.taxBasis || !basisFrom ? o || {} : { taxBasis: taxBasisOf(basisFrom) };
  return items + taxShareCents(withBasis, items);
}

/** The carrier delivered this parcel after all. */
export function parcelArrived(o: any): boolean {
  return !!o?.deliveredAt || String(o?.carrierTrail?.carrierStatus || o?.carrierStatus || '').toUpperCase() === 'DELIVERED'
    || (o?.method === 'ship' && o?.stage === 'completed');
}

/** What cancelling a follow-up gives back to the customer's card: what they paid for its items still to be sent. A
 *  replacement for a parcel that was delivered after all gives nothing back: they have the goods. `parent` is the order
 *  it was made from (the lost parcel, for a replacement), `payer` the order paid on, if that's further up. */
export function followUpCancelCents(o: any, parent?: any, payer?: any): number {
  if (String(o?.replacementFor || '') === 'lost_in_transit' && parent && parcelArrived(parent)) return 0;
  return followUpItemsCents(o, payer || parent);
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
