// Checks rewards points on drive-thru and order-ahead orders (lib/counter-points, api/counter 'points', and orders
// placed ahead with a phone number in lib/counter-ahead).
// - The guest's phone number puts the order in their name; someone new joins only when they say yes, and a program you
//   join asks first. Points are earned once the order is paid, once (whichever way it's paid), never before.
// - Points per dollar count the items (not tax); a points-per-visit program or punch card counts the order as a visit.
// - Nothing happens while the program is off.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/drive-thru-points.verify.ts
import Module from 'module';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_fake';
process.env.ORDER_TRACK_SECRET = 'test-secret-for-links';
let db: any = strictTransactions(makeDb());
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const S: any = { pis: new Map<string, any>(), n: 0 };
class FakeStripe {
  paymentIntents = {
    create: async (p: any) => { const id = `pi_${++S.n}`; const pi = { id, amount: p.amount, status: 'requires_payment_method', metadata: { ...p.metadata }, client_secret: `${id}_s` }; S.pis.set(id, pi); return { ...pi }; },
    retrieve: async (id: string) => ({ ...S.pis.get(id) }),
    cancel: async (id: string) => { S.pis.get(id).status = 'canceled'; return {}; },
  };
  refunds = { create: async () => ({ id: 're_1', status: 'succeeded' }) };
  paymentMethodDomains = { list: async () => ({ data: [] }), create: async () => ({ id: 'pmd', enabled: true, apple_pay: { status: 'active' }, google_pay: { status: 'active' } }), update: async () => ({}), validate: async () => ({}) };
}
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
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;

(async () => {
  const { POST: kitchen } = await import('../../src/app/api/kitchen/route');
  const { POST } = await import('../../src/app/api/counter/route');
  const { POST: AHEAD } = await import('../../src/app/api/counter/ahead/route');
  await db.doc(T).set({ name: 'Northside', timezone: 'UTC', stripeAccountId: 'acct_1', stripeChargesEnabled: true, retailSettings: { taxRatePercent: 10 }, salesTax: { configured: true },
    loyalty: { on: false, earn: { mode: 'per_dollar', perDollar: 2 } }, orderAhead: { on: true } });
  await db.doc(`${T}/inventory/burger`).set({ type: 'refreshment', name: 'Burger', category: 'Burgers', price: 5, totalStock: 100 });
  await db.doc(`${T}/clients/c1`).set({ name: 'Jordan Lee', firstName: 'Jordan', phone: '(555) 123-4567', status: 'active' });
  await db.doc(`${T}/tillSessions/d1`).set({ status: 'open' });
  const key = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Window', kind: 'drive-thru' }))).body.key;
  const P = (b: any) => POST(req({ tenantId: 't1', key, ...b }));
  let n = 0;
  const newOrder = async (qty = 2) => {
    const c = (await P({ action: 'car', carKey: `carkey-pts-${++n}` })).body;
    await P({ action: 'add', orderId: c.orderId, itemId: 'burger', quantity: qty, tapKey: `tap-pts-${n}` });
    await P({ action: 'send', orderId: c.orderId });
    return c;
  };
  const ledger = async () => all(`${T}/loyaltyLedger`);

  console.log('the program off');
  let c = await newOrder();
  let r: any = await P({ action: 'points', orderId: c.orderId, phone: '555-123-4567' });
  let lane: any = await P({ action: 'lane' });
  check('off: nothing to add, and the lane doesn’t offer it', r.status === 409 && r.body.code === 'off' && lane.body.pointsOn === false, [r.body, lane.body.pointsOn]);

  console.log('a member');
  await db.doc(T).set({ loyalty: { on: true } }, { merge: true });
  r = await P({ action: 'points', orderId: c.orderId, phone: '555-123-4567' });
  check('their phone number (written any way) puts the order in their name; not paid yet, nothing earned', r.body.ok && r.body.earned === 0 && (await get(`${T}/counterOrders/${c.orderId}`)).clientId === 'c1' && (await ledger()).length === 0, r.body);
  lane = await P({ action: 'lane' });
  check('…the lane shows the last 4 of the phone, and that it earns when paid', lane.body.pointsOn === true && lane.body.orders[c.orderId]?.points?.phone === '4567', lane.body.orders[c.orderId]?.points);
  r = await P({ action: 'paid', orderId: c.orderId, method: 'cash', tendered: 20 });
  const earn = (await ledger()).find((e: any) => e.saleId === `counter_${c.orderId}`);
  check('paid: points per dollar on the items, not the tax (2 × $10 = 20)', r.body.ok && earn?.points === 20 && earn.clientId === 'c1' && (await get(`${T}/counterOrders/${c.orderId}`)).points.earned === 20, { earn, body: r.body });
  await P({ action: 'paid', orderId: c.orderId, method: 'cash', tendered: 20 });
  check('…paid again (a second tap): earned once', (await ledger()).filter((e: any) => e.saleId === `counter_${c.orderId}`).length === 1);

  console.log('added after it was paid');
  c = await newOrder(1);
  await P({ action: 'paid', orderId: c.orderId, method: 'cash', tendered: 10 });
  r = await P({ action: 'points', orderId: c.orderId, phone: '5551234567' });
  check('paid first, the number given after: it earns right then', r.body.ok && r.body.earned === 10, r.body);
  r = await P({ action: 'points', orderId: c.orderId, phone: '5559999999', join: true, name: 'Sam' });
  check('…and its points can’t then go to someone else', r.status === 409 && r.body.code === 'earned', r.body);

  console.log('someone new');
  c = await newOrder(1);
  r = await P({ action: 'points', orderId: c.orderId, phone: '555-222-3333' });
  check('a number nobody has: asks whether they’d like to join, and adds no one', r.status === 404 && r.body.code === 'not_found' && (await all(`${T}/clients`)).length === 1, r.body);
  r = await P({ action: 'points', orderId: c.orderId, phone: '555-222-3333', join: true, name: 'Sam' });
  const sam = (await all(`${T}/clients`)).find((x: any) => x.phone === '+15552223333');
  check('they said yes: added with their first name and phone, joined, and the order is theirs', r.body.ok && sam && sam.firstName === 'Sam' && sam.loyaltyJoinedAt && sam.createdVia === 'drive-thru' && (await get(`${T}/counterOrders/${c.orderId}`)).clientId === sam.id, { body: r.body, sam });

  check('…saved like any other client (found by the desk’s client search)', Array.isArray(sam?.searchKeys) && sam.searchKeys.length > 0 && sam.lifetimeValue === 0 && sam.email === null, sam);
  const ca = await newOrder(1); const cb = await newOrder(1);
  await Promise.all([P({ action: 'points', orderId: ca.orderId, phone: '555-666-1010', join: true, name: 'Lu' }), P({ action: 'points', orderId: cb.orderId, phone: '(555) 666-1010', join: true, name: 'Lu' })]);
  check('the same new number added on two screens at once: one client', (await all(`${T}/clients`)).filter((x: any) => x.phone === '+15556661010').length === 1);
  const cx = await newOrder(1);
  await P({ action: 'points', orderId: cx.orderId, phone: '5552223333' });
  r = await P({ action: 'points', orderId: cx.orderId, phone: '5550003333', join: true, name: 'Max' });
  const cxo = await get(`${T}/counterOrders/${cx.orderId}`);
  check('another number ending in the same 4 digits isn’t taken for the first (not paid yet, so it can be changed)', r.body.ok && r.body.already === false && cxo.clientId !== sam.id && cxo.points.phone === '3333', { body: r.body, cxo });
  const { reverseSale } = await import('../../src/lib/loyalty-server');
  const firstPaid = (await ledger()).find((e: any) => e.type === 'earn');
  await reverseSale(db, 't1', { saleId: firstPaid.saleId, full: true, by: 'Refund' });
  const back = (await ledger()).filter((e: any) => e.saleId === firstPaid.saleId && e.type === 'reverse');
  const refundSrc = require('fs').readFileSync(require('path').resolve('src/lib/money-refund.ts'), 'utf8');
  check('refunded at the desk: its points come back off (the refund names the drive-thru sale; its tax line earns nothing)', back.length === 1 && Number(back[0].points) === -Number(firstPaid.points) && /transactionId === `counter_\$\{x\.orderId\}`/.test(refundSrc), back);

  console.log('a program you join');
  await db.doc(T).set({ loyalty: { join: 'opt_in' } }, { merge: true });
  await db.doc(`${T}/clients/c2`).set({ name: 'Priya Shah', firstName: 'Priya', phone: '555-444-5555', status: 'active' });
  c = await newOrder(1);
  r = await P({ action: 'points', orderId: c.orderId, phone: '5554445555' });
  check('in the client book but not in the program: asked first', r.status === 409 && r.body.code === 'not_member' && !(await get(`${T}/counterOrders/${c.orderId}`)).clientId, r.body);
  r = await P({ action: 'points', orderId: c.orderId, phone: '5554445555', join: true });
  check('…they said yes: joined, and the order is theirs', r.body.ok && (await get(`${T}/clients/c2`)).loyaltyJoinedAt, r.body);
  await db.doc(`${T}/clients/c3`).set({ name: 'Ray', phone: '555-777-8888', loyaltyOptOut: true });
  r = await P({ action: 'points', orderId: c.orderId, phone: '5557778888', join: true });
  check('someone who asked not to be in the program isn’t put in it', r.status === 409, r.body);

  console.log('a punch card');
  await db.doc(T).set({ loyalty: { join: 'auto', earn: { mode: 'punch', punchVisits: 10 } } }, { merge: true });
  c = await newOrder(3);
  await P({ action: 'points', orderId: c.orderId, phone: '5551234567' });
  await P({ action: 'paid', orderId: c.orderId, method: 'cash', tendered: 20 });
  const punch = (await ledger()).find((e: any) => e.saleId === `counter_${c.orderId}`);
  check('a punch card: the order is one punch, however much is in it', punch?.points === 1, punch);
  await db.doc(T).set({ loyalty: { earn: { mode: 'per_dollar', perDollar: 2 } } }, { merge: true });

  console.log('ordered ahead');
  r = await AHEAD(req({ tenantId: 't1', action: 'menu' }));
  check('the order-ahead page asks for a phone for points while the program is on', r.body.points?.unit === 'points', r.body.points);
  r = await AHEAD(req({ tenantId: 't1', action: 'place', key: 'keykeykeyP1', name: 'Jordan', way: 'inside', phone: '(555) 123-4567', lines: [{ itemId: 'burger', quantity: 1 }] }));
  const oa = await get(`${T}/counterOrders/${r.body.orderId}`);
  check('placed with a phone number: nothing linked or earned before it’s paid', r.body.ok && oa.ahead.pointsPhone === '5551234567' && !oa.clientId, oa.ahead);
  S.pis.get(oa.ahead.payId).status = 'succeeded';
  await AHEAD(req({ tenantId: 't1', action: 'done', o: r.body.orderId, s: r.body.sig }));
  const ob = await get(`${T}/counterOrders/${r.body.orderId}`);
  const tr: any = await AHEAD(req({ tenantId: 't1', action: 'track', o: r.body.orderId, s: r.body.sig }));
  check('paid: the order is theirs and earns, and their page says what it earned (never their balance)', ob.clientId === 'c1' && ob.points?.earned === 10 && tr.body.earned === 10 && !('balance' in tr.body), { ob, track: tr.body });
  check('…and the full phone number isn’t kept on the order after', !(await get(`${T}/counterOrders/${tr.body && r.body.orderId}`))?.ahead?.pointsPhone);
  r = await AHEAD(req({ tenantId: 't1', action: 'place', key: 'keykeykeyP3', name: 'Zed', way: 'inside', phone: '555-909-0909', lines: [{ itemId: 'burger', quantity: 1 }] }));
  const oz = await get(`${T}/counterOrders/${r.body.orderId}`); S.pis.get(oz.ahead.payId).status = 'succeeded';
  await AHEAD(req({ tenantId: 't1', action: 'done', o: r.body.orderId, s: r.body.sig }));
  check('a number nobody has, typed on the page without ticking to join: no one is added', !(await all(`${T}/clients`)).some((x: any) => x.phone === '+15559090909') && !(await get(`${T}/counterOrders/${r.body.orderId}`)).clientId);
  r = await AHEAD(req({ tenantId: 't1', action: 'place', key: 'keykeykeyP2', name: 'Jo', way: 'inside', phone: '555-12', lines: [{ itemId: 'burger', quantity: 1 }] }));
  check('a phone number that isn’t one: said so before paying', r.status === 400 && r.body.code === 'phone', r.body);

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
