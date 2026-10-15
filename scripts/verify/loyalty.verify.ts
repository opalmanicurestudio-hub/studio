// scripts/verify/loyalty.verify.ts — the loyalty rules (lib/loyalty), the ledger (lib/loyalty-server) against an in-memory
// database, and a reward in the checkout maths (lib/checkout-calc).
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/loyalty.verify.ts
import { makeDb, check, failures } from './fake-db';

(async () => {
  const L = await import('../../src/lib/loyalty'); const LS = await import('../../src/lib/loyalty-server');
  const off = L.loyaltyOf({}); check('off unless the business switches it on, with one starter reward', !off.on && off.rewards.length === 1 && off.version === 1);
  const tenant: any = { loyalty: { on: true, earn: { mode: 'per_dollar', perDollar: 1, rebookBonus: 25 }, rewards: [{ id: 'r10', name: '$10 off any service', points: 300, kind: 'amount_off', cents: 1000 }, { id: 'para', name: 'Free paraffin add-on', points: 600, kind: 'free_service', serviceId: 'para', costCents: 400 }] } };
  const S = L.loyaltyOf(tenant);
  const sale = { services: [{ serviceId: 'gel', cents: 5500 }], products: [{ productId: 'oil', cents: 1800 }], giftSpentCents: 0, giftBoughtCents: 0, visits: 1, rebooked: true, renter: false };
  check('1 point per $1 on services and products, plus the rebooking bonus', L.pointsFor(S, sale).points === 73 + 25);
  check('a renter’s sale earns nothing for the studio', L.pointsFor(S, { ...sale, renter: true }).points === 0);
  const SB = L.loyaltyOf({ loyalty: { ...tenant.loyalty, counts: { giftCards: 'bought' } } });
  check('gift card money earns once: "when bought" takes paying-with-a-card out, adds buying one', L.pointsFor(SB, { ...sale, rebooked: false, giftSpentCents: 2000, giftBoughtCents: 5000 }).points === 53 + 50);
  check('left-out services don’t earn', L.pointsFor(L.loyaltyOf({ loyalty: { ...tenant.loyalty, leaveOut: { serviceIds: ['gel'] } } }), { ...sale, rebooked: false }).points === 18);
  const PV = L.loyaltyOf({ loyalty: { on: true, earn: { mode: 'per_visit', perVisit: 10 }, rewards: tenant.loyalty.rewards } });
  check('per visit: 10 a visit', L.pointsFor(PV, { ...sale, rebooked: false, visits: 2 }).points === 20);
  check('a version only moves when the rules change', L.nextLoyalty(S, { ...tenant.loyalty }).version === S.version && L.nextLoyalty(S, { ...tenant.loyalty, earn: { mode: 'per_dollar', perDollar: 2 } }).version === S.version + 1);
  check('free service reward covers that line only', L.rewardCents(S.rewards[1], { lines: [{ serviceId: 'gel', cents: 5500 }, { serviceId: 'para', cents: 1200 }], discountableCents: 6700 }) === 1200);
  check('money-off never goes past what’s left to discount', L.rewardCents(S.rewards[0], { lines: [], discountableCents: 600 }) === 600);
  check('ready rewards and the next to aim for', (() => { const r = L.rewardsFor(S, 400); return r.ready.length === 1 && r.next?.toGo === 200; })());
  check('terms in plain words', /1 point for every \$1/.test(L.termsOf(S)) && /12 months/.test(L.termsOf(S)));

  // The ledger
  const db = makeDb(); await db.doc('tenants/t/clients/c1').set({ name: 'Maria' });
  const e1 = await LS.earnForSale(db, 't', tenant, { clientId: 'c1', saleId: 's1', sale, by: 'Desk' });
  const e2 = await LS.earnForSale(db, 't', tenant, { clientId: 'c1', saleId: 's1', sale, by: 'Desk' });
  check('a sale earns once, however often checkout retries', e1.points === 98 && e2.points === 0 && (await LS.balanceFor(db, 't', 'c1')) === 98);
  await LS.earnForSale(db, 't', tenant, { clientId: 'c1', saleId: 's2', sale: { ...sale, services: [{ serviceId: 'gel', cents: 52500 }] }, by: 'Desk' });
  const bal = await LS.balanceFor(db, 't', 'c1');
  const r1 = await LS.redeemForSale(db, 't', tenant, { clientId: 'c1', saleId: 's3', reward: S.rewards[1], cents: 1200, by: 'Desk' });
  check('a reward comes off the ledger', r1.ok && (await LS.balanceFor(db, 't', 'c1')) === bal - 600);
  const r2 = await LS.redeemForSale(db, 't', tenant, { clientId: 'c1', saleId: 's4', reward: { ...S.rewards[1], points: 100000 }, cents: 1200, by: 'Desk' });
  check('…never more than they have', !r2.ok);
  const before = await LS.balanceFor(db, 't', 'c1');
  await LS.reverseSale(db, 't', { saleId: 's1', refundCents: 3650, refundId: 'x1', by: 'Desk' });
  check('a half refund takes back half of what that sale earned', (await LS.balanceFor(db, 't', 'c1')) === before - 49);
  await LS.reverseSale(db, 't', { saleId: 's1', refundCents: 99999, refundId: 'x2', by: 'Desk' });
  check('…and refunds never take back more than it earned', (await LS.balanceFor(db, 't', 'c1')) === before - 98, { got: await LS.balanceFor(db, 't', 'c1'), before });
  const b2 = await LS.balanceFor(db, 't', 'c1'); await LS.reverseSale(db, 't', { saleId: 's3', full: true, by: 'Desk' });
  check('undoing a sale gives back the reward it used', (await LS.balanceFor(db, 't', 'c1')) === b2 + 600);
  const adj = await LS.adjustPoints(db, 't', { clientId: 'c1', points: 50, note: '', by: 'Jess' });
  check('an adjustment needs a reason', !adj.ok);
  await db.doc('tenants/t/clients/c1').set({ loyalty: { lastVisitAt: '2024-01-01T00:00:00Z' } }, { merge: true });
  const ex = await LS.expirySweep(db, 't', tenant, Date.parse('2026-10-14T12:00:00Z'));
  check('no visit in 12 months: the balance expires, as its own entry', ex.expired === 1 && (await LS.balanceFor(db, 't', 'c1')) === 0);

  // Checkout maths
  const { computeCheckout } = await import('../../src/lib/checkout-calc');
  const base: any = { tenant: { loyalty: { on: true } }, visits: [{ appointment: { id: 'a1', staffId: 's' }, service: { id: 'gel', price: 55 }, addOnServices: [] }], staff: [{ id: 's' }], redeemedOffer: null, waivedIds: [], items: [], fees: [], discounts: [], client: null, memberships: [], tip: 0, storeCredit: 0 };
  const c0: any = computeCheckout(base); const c1: any = computeCheckout({ ...base, loyaltyReward: { cents: 1000, label: 'Reward', rewardId: 'r10' } });
  check('a reward takes $10 off the bill', Math.abs(c0.total - c1.total - 10) < 0.001 && c1.loyaltyDiscount === 10);
  check('…and commission stays on the full price by default', c1.discountShare === 0);
  const c2: any = computeCheckout({ ...base, tenant: { loyalty: { on: true, commission: 'paid' } }, loyaltyReward: { cents: 1000, label: 'Reward', rewardId: 'r10' } });
  check('…unless the business chose "what the client paid"', c2.discountShare > 0);

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed'); process.exit(failures ? 1 : 0);
})();
