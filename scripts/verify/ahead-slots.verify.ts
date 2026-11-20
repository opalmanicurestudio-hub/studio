// Checks pickup times that fill (L20 round 21, design canvas "Pickup times that fill"): lib/ahead-slots (the items a
// time takes, fewer when the kitchen is busy; what counts against a time), lib/counter-ahead (the menu says which times are
// full; an order is refused for a full time, in the same step it's made), api/menu (the setting), and the pages.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/ahead-slots.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_fake';
process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_fake';
process.env.ORDER_TRACK_SECRET = 'test-secret-for-links';
let db: any = strictTransactions(makeDb());
let actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };

const S: any = { pis: new Map<string, any>(), keys: new Map<string, string>(), refunds: [] as any[], n: 0, event: null as any };
const clone = (x: any) => JSON.parse(JSON.stringify(x));
const err = (code: string) => Object.assign(new Error(code), { code, raw: { code } });
class FakeStripe {
  paymentIntents = {
    create: async (p: any, o: any) => {
      if (o?.idempotencyKey && S.keys.has(o.idempotencyKey)) return clone(S.pis.get(S.keys.get(o.idempotencyKey)));
      const id = `pi_${++S.n}`; const pi = { id, amount: p.amount, status: 'requires_payment_method', automatic_payment_methods: p.automatic_payment_methods, metadata: { ...p.metadata }, amount_received: 0, client_secret: `${id}_secret`, account: o?.stripeAccount };
      S.pis.set(id, pi); if (o?.idempotencyKey) S.keys.set(o.idempotencyKey, id); return clone(pi);
    },
    retrieve: async (id: string) => { const pi = S.pis.get(id); if (!pi) throw err('resource_missing'); return clone(pi); },
    cancel: async (id: string) => { const pi = S.pis.get(id); if (pi.status === 'succeeded') throw err('payment_intent_unexpected_state'); pi.status = 'canceled'; return clone(pi); },
  };
  refunds = { create: async (p: any) => { S.refunds.push(p); return { id: `re_${S.refunds.length}`, status: 'succeeded', amount: p.amount }; } };
  paymentMethodDomains = { list: async () => ({ data: [] }), create: async (p: any) => ({ id: 'pmd_1', domain_name: p.domain_name, enabled: true, apple_pay: { status: 'active' }, google_pay: { status: 'active' } }), update: async () => ({}), validate: async () => ({}) };
  webhooks = { constructEvent: () => S.event };
}
const paid = (piId: string) => { const pi = S.pis.get(piId); pi.status = 'succeeded'; pi.amount_received = pi.amount; };

const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return Object.assign(FakeStripe, { default: FakeStripe });
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  if (request === '@/lib/rate-limit' || /\/src\/lib\/rate-limit(\.ts)?$/.test(request)) return fake(request, { limitPublic: async () => null });
  if (request === '@/lib/stripe-fee' || /\/src\/lib\/stripe-fee(\.ts)?$/.test(request)) return fake(request, { recordChargeFee: async () => 0 });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const read = (p: string) => readFileSync(p, 'utf8');
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : String(k).toLowerCase() === 'stripe-signature' ? 'sig' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const slot = (minutes: number) => { const step = 15 * 60000; return new Date(Math.ceil((Date.now() + minutes * 60000) / step) * step).toISOString(); };


(async () => {
  const SL = await import('../../src/lib/ahead-slots');
  console.log('how a time fills');
  check('the items a time takes: the business’s number, three-quarters when busy, half when slammed, never none; no number, no limit', SL.slotCap(12, 'calm') === 12 && SL.slotCap(12, 'busy') === 9 && SL.slotCap(12, 'slammed') === 6 && SL.slotCap(1, 'slammed') === 1 && SL.slotCap(null, 'slammed') === null);
  check('saved only when sensible', SL.cleanSlotItems(12) === 12 && SL.cleanSlotItems(null) === null && SL.cleanSlotItems('') === null && SL.cleanSlotItems(0) === null && SL.cleanSlotItems(201) === undefined && SL.cleanSlotItems(2.5) === undefined);
  const now = Date.now(); const t1 = new Date(Math.ceil((now + 3600000) / SL.SLOT_MS) * SL.SLOT_MS).toISOString();
  const o = (id: string, state: string, qty: number[], ago = 0, extra: any = {}) => ({ id, channel: 'ahead', createdAt: new Date(now - ago * 60000).toISOString(), lines: qty.map((q) => ({ quantity: q })), ahead: { state, slot: t1 }, ...extra });
  const used = SL.itemsBySlot([o('a', 'paid', [2, 1]), o('b', 'awaiting_pay', [1], 10), o('c', 'awaiting_pay', [5], 40), o('d', 'abandoned', [4]), o('e', 'paid', [3], 0, { channel: 'counter' }), o('f', 'paid', [2])], now, 'f');
  check('a time’s items: paid orders, and ones still being paid for in the last half hour (not one left unpaid, given up, another kind of order, or the one being placed)', used.get(t1) === 4, Array.from(used.entries()));
  const voided = SL.itemsBySlot([o('a', 'paid', [2, 1], 0, { status: 'voided' }), o('b', 'paid', [1])], now);
  check('an order voided at the counter gives its room back', voided.get(t1) === 1);
  check('an order fits while there’s room; a time with nothing in it takes any one order', SL.fits(3, 4, 1) && !SL.fits(3, 4, 2) && SL.fits(0, 4, 9) && SL.fits(99, null, 9));
  check('full times', SL.fullTimes([t1, 'x'], new Map([[t1, 4]]), 4).join() === t1 && SL.fullTimes([t1], new Map([[t1, 4]]), null).length === 0);
  check('as soon as it’s ready counts against the first time that could be ready', Date.parse(SL.asapSlot(now)) >= now + 20 * 60000 && Date.parse(SL.asapSlot(now)) % SL.SLOT_MS === 0 && Date.parse(SL.asapSlot(now, 10)) >= now + 30 * 60000);

  const { POST: AHEAD } = await import('../../src/app/api/counter/ahead/route');
  const { POST: MENU } = await import('../../src/app/api/menu/route');
  // A time zone where it's mid-morning now, so there are always later times today whenever this runs.
  const off = ((10 - new Date().getUTCHours() + 36) % 24) - 12; const zone = off >= 0 ? `Etc/GMT-${off}` : `Etc/GMT+${-off}`;
  await db.doc(T).set({ name: 'Northside', timezone: zone, stripeAccountId: 'acct_1', stripeChargesEnabled: true, retailSettings: { taxRatePercent: 10 }, salesTax: { configured: true } });
  await db.doc(`${T}/inventory/burger`).set({ type: 'refreshment', name: 'Burger', category: 'Burgers', price: 5, totalStock: 80, makeSeconds: 240 });
  const A = (b: any) => AHEAD(req({ tenantId: 't1', ...b }));
  const Mn = (b: any) => MENU(req({ tenantId: 't1', ...b }));
  let k = 0; const nextKey = () => `slotkey${++k}xyz`;
  actor = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
  console.log('the setting');
  let r: any = await Mn({ action: 'ahead', on: true, laterHours: 3, slotItems: 4 });
  check('a manager sets the most items for one pickup time', r.body.ok && r.body.ahead.slotItems === 4 && (await get(T)).orderAhead.slotItems === 4, r.body);
  const badSet: any = await Mn({ action: 'ahead', slotItems: 500 });
  check('…not one out of range', badSet.status === 400);
  console.log('ordering');
  r = await A({ action: 'menu' });
  const times: string[] = r.body.times; const X = times[4]; const Y = times[6];
  check('the menu says which times are full (none yet)', r.body.ok && Array.isArray(r.body.full) && r.body.full.length === 0 && r.body.asapFull === false, r.body);
  const place = (at: string | null, qty: number, name = 'Jo') => A({ action: 'place', key: nextKey(), name, way: 'inside', at, lines: [{ itemId: 'burger', quantity: qty }] });
  const p1: any = await place(X, 3);
  const p2: any = await place(X, 2);
  check('an order takes its time; one that would go over is told to pick another time', p1.body.ok && p2.status === 409 && p2.body.code === 'slot_full' && /just filled up/.test(p2.body.error), [p1.body, p2.body]);
  const p3: any = await place(X, 1);
  r = await A({ action: 'menu' });
  check('…one that fits the last of it goes in, and then the time shows as full', p3.body.ok && r.body.full.includes(X) && !r.body.full.includes(Y), r.body.full);
  const big: any = await place(Y, 9);
  check('a big order has an empty time to itself', big.body.ok);
  const stored = (await all(`${T}/counterOrders`)).find((x: any) => x.id === p1.body.orderId);
  check('the order keeps its time', stored.ahead.slot === X, stored.ahead);
  const asap: any = await place(null, 4); const asap2: any = await place(null, 1);
  r = await A({ action: 'menu' });
  check('as soon as it’s ready fills the first time that could be ready, and the menu says so', asap.body.ok && asap2.status === 409 && /full for the next few minutes/.test(asap2.body.error) && r.body.asapFull === true, [asap2.body, r.body.asapFull]);
  // An order left unpaid for half an hour gives its room back.
  await db.doc(`${T}/counterOrders/${p1.body.orderId}`).set({ createdAt: new Date(Date.now() - 40 * 60000).toISOString() }, { merge: true });
  const AH = await import('../../src/lib/counter-ahead'); void AH;
  await new Promise((res) => setTimeout(res, 10));
  const p4: any = await A({ action: 'place', key: nextKey(), name: 'Late', way: 'inside', at: X, lines: [{ itemId: 'burger', quantity: 2 }] });
  check('an order left unpaid for half an hour gives its room back', p4.body.ok, p4.body);
  await Mn({ action: 'ahead', slotItems: null });
  const free: any = await place(X, 6);
  r = await A({ action: 'menu' });
  check('no limit: every time open, as before', free.body.ok && r.body.full.length === 0 && r.body.asapFull === false && (await get(T)).orderAhead.slotItems === null);

  // A late order for a time after midnight is placed on one day and picked up the next: it's still counted.
  const lateRef = db.doc(`${T}/counterOrders/late1`);
  await lateRef.set({ id: 'late1', channel: 'ahead', day: '1999-12-31', status: 'building', createdAt: new Date().toISOString(), lines: [{ quantity: 6 }], ahead: { state: 'paid', slot: times[8] } });
  await Mn({ action: 'ahead', slotItems: 4 });
  const crossed: any = await place(times[8], 1);
  check('the room in a time counts every order for it, whatever day it was placed', crossed.status === 409 && crossed.body.code === 'slot_full', crossed.body);
  await lateRef.set({ status: 'voided' }, { merge: true });
  const after: any = await place(times[8], 1);
  check('…and a voided one gives its room back', after.body.ok, after.body);

  console.log('the pages');
  const page = read('src/app/order/[tenantId]/page.tsx'); const card = read('src/components/menu/OrderAheadCard.tsx');
  check('the guest’s page: times to tap, full ones marked and not choosable, the soonest open chosen when a time fills', page.includes('function TimeButton') && page.includes('fullWord="Full"') && page.includes("d.code === 'slot_full'") && page.includes('firstOpen(') && page.includes('pickup times fill faster')
    && page.includes('disabled={placing || !cart.length || chosenFull || closedNow}') && page.includes('The kitchen’s full right now. Please try again in a few minutes.') && page.includes('menu.times.indexOf(at) >= 7'));
  check('the setting on the menu page', card.includes('Most items for one pickup time') && card.includes('three-quarters as many'));
  const mine = read('src/lib/ahead-slots.ts');
  check('house style in the new code', !/salon|stylist|booth|chair/i.test(mine + page) && !/uppercase|font-black/.test(mine) && !/ · /.test(mine) && !/\{\/\*/.test(page));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
