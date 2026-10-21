// src/lib/ship-together.ts — ONE CUSTOMER, SEVERAL ORDERS, ONE BOX. When a customer's packed orders are going to the
// same name and address and none has a label yet, the board suggests shipping them together. Staff decide (nothing
// combines on its own). One label covers them all; its tracking goes on every order; the shipping paid on the other
// orders is refunded automatically, because it was never needed.
//
// Left out: gift orders (their slip and the recipient's exchange are their own), orders held for review, orders with an
// address change waiting, and orders already labelled or shipped.

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

/** The same person at the same address, or '' when an order can't be combined. */
export function togetherKey(o: any, opts: { labelled?: boolean } = {}): string {
  if (!o || o.method !== 'ship' || o.gift || o.holdForReview || o.digitalOnly) return '';
  // An address change waiting for the team (lib/address-flow): it may not be going to the same place after all.
  if (['waiting', 'approving'].includes(String(o.addressRequest?.status || ''))) return '';
  if (!opts.labelled && (o.labelUrl || o.trackingNumber || o.shippoTransactionId)) return '';
  const a = o.shippingAddress || {};
  const email = String(o.customerEmail || '').trim().toLowerCase();
  if (!email || !a.line1 || !a.postalCode) return '';
  return [email, norm(a.name), norm(a.line1), norm(a.line2), norm(a.city), norm(a.state), String(a.postalCode).replace(/\D/g, '').slice(0, 5)].join('|');
}

/** Groups of two or more packed orders that could go in one box, oldest order first. Groups staff kept apart are left out. */
export function shipTogetherGroups(orders: any[]): any[][] {
  const by = new Map<string, any[]>();
  for (const o of orders) {
    if (o?.stage !== 'packed') continue;
    const k = togetherKey(o); if (!k) continue;
    (by.get(k) || by.set(k, []).get(k)!).push(o);
  }
  return [...by.entries()]
    .filter(([k, g]) => g.length > 1 && !g.every((o) => o.shipTogetherDeclined === k))
    .map(([, g]) => g.sort((a, b) => (Number(a.orderNumber) || 0) - (Number(b.orderNumber) || 0)));
}

/** Shipping refunded on each order other than the first: what it paid for shipping, never more than its card can take back. */
export function togetherRefunds(group: any[], refundable: (o: any) => number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of group.slice(1)) {
    const cents = Math.min(Math.max(0, Math.round(Number(o.shippingCents) || 0)), Math.max(0, refundable(o) - Math.max(0, Number(o.pendingRefundCents) || 0)));
    if (cents > 0) out[o.id] = cents;
  }
  return out;
}

export const orderNo = (o: any) => `#${String(o?.orderNumber ?? '').padStart(4, '0')}`;
