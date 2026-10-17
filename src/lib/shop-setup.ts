// src/lib/shop-setup.ts — GETTING A SHOP READY TO OPEN. Six steps, each checked from what's really set up rather than
// ticked by hand. While the shop isn't open yet, Setup leads with these; once it's open, Setup is just the list. Pure.
export interface SetupStep { id: string; title: string; note: string; done: boolean; href?: string; action?: 'test' | 'open' }

export function setupSteps(tenant: any, liveCount: number): SetupStep[] {
  const rs = tenant?.retailSettings || {};
  const pickup = rs.pickupEnabled !== false; const ship = rs.shippingEnabled !== false && rs.shippingOffered !== false;
  const from = rs.shipFrom || {}; const shipReady = !!(from.street1 && from.city && from.state && from.zip);
  const paid = !!(tenant?.stripeAccountId || tenant?.stripeConnectAccountId);
  return [
    { id: 'products', title: 'Put products online', note: liveCount ? `${liveCount} product${liveCount === 1 ? '' : 's'} in your shop` : 'Each needs a price, a photo helps', done: liveCount > 0, href: '/retail-orders/settings' },
    { id: 'delivery', title: 'Choose pickup, shipping or both', note: ship && !shipReady ? 'Add the address you ship from' : [pickup ? 'Pickup' : '', ship ? 'shipping' : ''].filter(Boolean).join(' and ') || 'Nothing chosen yet', done: (pickup || ship) && (!ship || shipReady), href: '/retail-orders/settings' },
    { id: 'payments', title: 'Connect payments', note: paid ? 'Payments go to your Stripe account' : 'So customers can pay and you get paid', done: paid, href: '/settings?tab=payments' },
    { id: 'policies', title: 'Check your policies', note: 'Returns, refunds and what customers read', done: !!rs.policiesReviewedAt, href: '/retail-orders/policies' },
    { id: 'test', title: 'Try a test order', note: rs.testOrderAt ? 'Done. Run another any time' : 'Walk one through packing and handing over. Free, no stock used', done: !!rs.testOrderAt, action: 'test' },
    { id: 'open', title: 'Open your shop', note: 'Customers can start buying', done: !!rs.shopOpenedAt && rs.storePaused !== true, action: 'open' },
  ];
}

/** Lead with the steps until the shop has opened. Shops that were already selling count as open. */
export function showGuided(tenant: any, liveCount: number): boolean {
  const rs = tenant?.retailSettings || {};
  if (rs.shopOpenedAt) return false;
  const paid = !!(tenant?.stripeAccountId || tenant?.stripeConnectAccountId);
  return rs.storePaused === true || liveCount === 0 || !paid;
}
