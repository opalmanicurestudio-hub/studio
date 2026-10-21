// Checks shipping a customer's orders together: which orders can share a box, and the shipping refunded.
// Run: npx tsx scripts/verify/ship-together.verify.ts
import { togetherKey, shipTogetherGroups, togetherRefunds } from '../../src/lib/ship-together';
let bad = 0; const ok = (c: boolean, m: string) => { if (!c) { bad++; console.log('✗', m); } else console.log('✓', m); };
const addr = { name: 'Dana Reyes', line1: '12 Oak St.', city: 'Austin', state: 'TX', postalCode: '78704-1234' };
const o = (id: string, n: number, extra: any = {}) => ({ id, orderNumber: n, stage: 'packed', method: 'ship', customerEmail: 'Dana@x.com', shippingAddress: addr, shippingCents: 695, ...extra });
const a = o('a', 1042, { shippingCents: 1295 }), b = o('b', 1047, { shippingAddress: { ...addr, line1: '12 OAK ST', postalCode: '78704' } });
ok(togetherKey(a) !== '' && togetherKey(a) === togetherKey(b), 'same person and address, however it was typed');
ok(shipTogetherGroups([b, a, o('c', 1050, { customerEmail: 'other@x.com' })]).length === 1 && shipTogetherGroups([b, a])[0][0].id === 'a', 'one group, oldest order first; another customer isn’t included');
ok(shipTogetherGroups([a, o('g', 1048, { gift: { to: 'Sam' } })]).length === 0, 'gift orders stay on their own');
ok(shipTogetherGroups([a, o('l', 1049, { labelUrl: 'https://x' })]).length === 0, 'an order that already has a label isn’t suggested');
ok(shipTogetherGroups([a, o('p', 1051, { stage: 'picking' })]).length === 0, 'only packed orders');
const k = togetherKey(a);
ok(shipTogetherGroups([{ ...a, shipTogetherDeclined: k }, { ...b, shipTogetherDeclined: k }]).length === 0, '“Keep separate” stops the suggestion');
ok(shipTogetherGroups([{ ...a, shipTogetherDeclined: k }, { ...b, shipTogetherDeclined: k }, o('n', 1052)]).length === 1, 'a new order brings it back');
const r = togetherRefunds([a, b], () => 10000);
ok(r.b === 695 && !r.a, 'the other order’s shipping is refunded, the first keeps its own');
ok(togetherRefunds([a, { ...b, pendingRefundCents: 9800 }], () => 10000).b === 200, 'never more than its card can take back');
if (bad) { console.log(`\n${bad} failed`); process.exit(1); } else console.log('\nall good');
