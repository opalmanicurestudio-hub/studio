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

  // The online shop
  { const db2 = makeDb(); await db2.doc('tenants/t/clients/c2').set({ name: 'Ana' });
    const order = { clientId: 'c2', lines: [{ productId: 'oil', unitPriceCents: 1800, qtyOrdered: 2 }], creditAppliedCents: 600, shippingCents: 900 };
    const o1 = await LS.earnForShopOrder(db2, 't', tenant, 'o1', order); const o2 = await LS.earnForShopOrder(db2, 't', tenant, 'o1', order);
    check('a paid shop order earns on its products (not shipping or store credit), once', o1.points === 30 && o2.points === 0);
    await LS.reverseSale(db2, 't', { saleId: 'order_o1', refundCents: 1800, refundId: 'rf1', by: 'Refund' });
    check('…and a shop refund takes back its share', (await LS.balanceFor(db2, 't', 'c2')) === 30 - 18); }

  // Phase 4: tiers, milestones, quiet-time bonus, messages
  { const T4: any = { timezone: 'America/New_York', name: 'Opal', loyalty: { ...tenant.loyalty, tiers: [{ id: 'gold', name: 'Gold', points: 100, multiplier: 1.5, perks: ['priority booking'] }], milestones: [{ visits: 2, points: 50 }], quiet: { on: true, windows: [{ id: 'q', days: [2], from: '13:00', to: '16:00', serviceIds: ['gel'], bonus: 25 }] }, auto: { rewardReady: true, tierUp: true } } };
    const S4 = L.loyaltyOf(T4);
    check('tiers by points earned in a year; a grace period before stepping down', L.tierFor(S4, 120).tier?.id === 'gold' && L.tierFor(S4, 20).tier === null && L.tierFor(S4, 20, { id: 'gold', until: '2099-01-01' }).tier?.id === 'gold');
    check('quiet-time bonus only in the window and for the chosen service', L.quietBonus(S4, 2, 14 * 60, 'gel')?.points === 25 && !L.quietBonus(S4, 2, 17 * 60, 'gel') && !L.quietBonus(S4, 3, 14 * 60, 'gel') && !L.quietBonus(S4, 2, 14 * 60, 'pedi'));
    const db3 = makeDb(); await db3.doc('tenants/t/clients/c3').set({ name: 'Lia Park', phone: '+15550600', smsMarketingOptIn: true });
    const v = { services: [{ serviceId: 'gel', cents: 10000 }], products: [], giftSpentCents: 0, giftBoughtCents: 0, visits: 1, rebooked: false, renter: false };
    const a1 = await LS.earnForSale(db3, 't', T4, { clientId: 'c3', saleId: 'v1', sale: v, by: 'D', quiet: [{ day: 2, min: 14 * 60, serviceId: 'gel' }] });
    check('first visit: 100 points plus the quiet-time bonus, and they reach Gold', a1.points === 125 && (a1 as any).tier === 'Gold');
    const a2 = await LS.earnForSale(db3, 't', T4, { clientId: 'c3', saleId: 'v2', sale: v, by: 'D' });
    check('second visit: ×1.5 for Gold, plus the visit-2 milestone', a2.points === 150 + 50);
    await LS.reverseSale(db3, 't', { saleId: 'v1', full: true, by: 'D' });
    check('undoing a sale takes back its bonus too', (await LS.balanceFor(db3, 't', 'c3')) === 200);
    const texts: string[] = []; const now = Date.parse('2026-10-14T15:00:00Z');
    const sw = await LS.automationSweep(db3, 't', T4, now, async (_to, text) => { texts.push(text); return true; });
    check('messages: the tier-up text goes first, one a month', sw.sent === 1 && /now Gold/.test(texts[0]));
    const sw2 = await LS.automationSweep(db3, 't', T4, now + 864e5, async (_to, text) => { texts.push(text); return true; });
    check('…and nothing more inside 30 days', sw2.sent === 0);
    await db3.doc('tenants/t/clients/c4').set({ name: 'No Consent', phone: '+15550700', loyalty: { balance: 900, tier: { id: 'gold' } } });
    const sw3 = await LS.automationSweep(db3, 't', T4, now + 40 * 864e5, async (_to, text) => { texts.push(text); return true; });
    check('…never without marketing consent', !texts.some((x) => /No/.test(x.split(',')[0])) && sw3.sent >= 0); }

  // Phase 5: holdouts
  { const n = Array.from({ length: 2000 }, (_, i) => L.heldOut(`c${i}`, 'unused', '2026-10', 10)).filter(Boolean).length;
    check('about 10% are left alone, and the same client gets the same answer', n > 150 && n < 250 && L.heldOut('c7', 'unused', '2026-10', 10) === L.heldOut('c7', 'unused', '2026-10', 10));
    const rows = [...Array.from({ length: 40 }, (_, i) => ({ held: false, cameBack: i < 16 })), ...Array.from({ length: 20 }, (_, i) => ({ held: true, cameBack: i < 5 }))];
    const lf = L.liftOf(rows); check('what the message changed: 40% came back vs 25% left alone → +15 points', lf.enough && lf.lift === 15);
    check('…and too few to say → it says so', !L.liftOf(rows.slice(0, 30)).enough && L.liftOf(rows.slice(0, 30)).lift === null); }

  // Phase 6: the builder
  { const sp = L.suggestProgram({ encourage: ['return', 'quiet'], givebackPct: 5, avgTicket: 60, visitsPerYear: 8 });
    const S6 = L.loyaltyOf({ loyalty: { ...sp.settings, on: true } });
    check('builder: 5% back → $10 off every 200 points; off until the owner saves it', !sp.settings.on && S6.rewards.find((r) => r.id === 'off10')?.points === 200);
    check('…a client spending $480 a year earns about $24 back', /about \$24 back/.test(sp.notes[0]));
    check('…a quiet-time bonus instead of a discount, and messages only suggested', S6.quiet.on && /Nothing is saved/.test(sp.notes[sp.notes.length - 1])); }

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
