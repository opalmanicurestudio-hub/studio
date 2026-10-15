// Checks lib/gift-limits: advanced limits on a card and what locations owe each other.
// Run: npx tsx scripts/verify/gift-limits.verify.ts
import { cleanLimits, giftCap, limitsText, locationSettlement } from '../../src/lib/gift-limits';
let bad = 0; const ok = (c: boolean, m: string) => { if (!c) { bad++; console.log('✗', m); } else console.log('✓', m); };
const lines = [{ kind: 'service' as const, cents: 6000, serviceId: 'gel', staffId: 'ana' }, { kind: 'service' as const, cents: 4000, serviceId: 'pedi', staffId: 'bea' }, { kind: 'product' as const, cents: 2000 }, { kind: 'tip' as const, cents: 1000 }];
ok(cleanLimits({}) === null && cleanLimits({ channels: ['desk', 'online', 'shop'] }) === null, 'empty or "everywhere" means no limits');
ok(giftCap({ code: 'A', limits: { serviceIds: ['gel'] } }, { channel: 'desk', lines }, false).cap === null, 'limits do nothing while the business has them off');
ok(giftCap({ code: 'A', limits: { serviceIds: ['gel'] } }, { channel: 'desk', lines }, true).cap === 6000, 'a service limit pays only for that service');
ok(giftCap({ code: 'A', limits: { staffIds: ['bea'] } }, { channel: 'desk', lines }, true).cap === 4000, 'a provider limit pays only for their work');
ok(giftCap({ code: 'A', limits: { serviceIds: ['gel'], staffIds: ['bea'] } }, { channel: 'desk', lines }, true).error !== null, 'both limits with nothing matching: it can’t be used');
ok(!!giftCap({ code: 'A', limits: { channels: ['online'] } }, { channel: 'desk', lines }, true).error, 'channel limit blocks the front desk');
ok(!!giftCap({ code: 'A', limits: { minSpendCents: 20000 } }, { channel: 'desk', lines }, true).error, 'minimum bill not met');
ok(giftCap({ code: 'A', limits: { minSpendCents: 5000 } }, { channel: 'desk', lines }, true).cap === null, 'minimum bill met: no cap');
ok(!!giftCap({ code: 'A', limits: { notWithDiscounts: true } }, { channel: 'desk', lines, hasDiscount: true }, true).error, 'not with discounts');
ok(!!giftCap({ code: 'A', limits: { serviceIds: ['gel'] } }, { channel: 'shop', lines: [{ kind: 'product', cents: 3000 }] }, true).error, 'a service-only card can’t buy products in the shop');
ok(limitsText({ serviceIds: ['gel'], minSpendCents: 5000 }, { services: { gel: 'Gel manicure' } }).join('|') === 'For Gel manicure|On a bill of $50 or more', 'limits read in plain words');
const cards = [
  { soldAtLocationId: 'A', history: [{ type: 'issue', cents: 10000 }, { type: 'spend', cents: -3000, locationId: 'B' }, { type: 'spend', cents: -2000, locationId: 'A' }] },
  { soldAtLocationId: 'B', history: [{ type: 'spend', cents: -1000, locationId: 'A' }] },
  { soldAtLocationId: 'A', promo: true, history: [{ type: 'spend', cents: -5000, locationId: 'B' }] },
  { history: [{ type: 'spend', cents: -5000, locationId: 'B' }] },
];
const s = locationSettlement(cards);
ok(s.length === 1 && s[0].from === 'A' && s[0].to === 'B' && s[0].cents === 2000 && s[0].spends === 2, 'A owes B $20 net ($30 − $10); bonus and unplaced cards skipped');
console.log(bad ? `\n${bad} failed` : '\nAll passed'); process.exit(bad ? 1 : 0);
