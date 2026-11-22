// Checks selling by weight at the counter and the window (design board "Sold by weight"; lib/menu-weight,
// lib/counter-orders lineFor, lib/counter-server editOrder and sendOrder; api/counter 'add' with a weight;
// components/pos/CounterWeight; the Menu page's switch; the kiosk, ordering ahead and the voice leaving it off).
// - The price is the weight times the price per unit, to the cent, with its choices' extras once; one weighing a line.
// - Stock counted in a weight comes off in its own unit (beans sold by the pound, counted in ounces), and a void puts
//   that much back.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/menu-weight.verify.ts
import { readFileSync } from 'fs';
import Module from 'module';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
let db: any = strictTransactions(makeDb());
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };

// A pretend card company: payments, readers and refunds, as the server sees them.
const S: any = { pis: new Map<string, any>(), keys: new Map<string, string>(), readers: new Map<string, any>(), refunds: [] as any[], refundKeys: new Map<string, any>(), calls: [] as string[], n: 0, listCalls: 0, down: false,
  onCreate: null as null | (() => Promise<void>), onProcess: null as null | (() => Promise<void>), refundErr: null as null | string };
const clone = (x: any) => JSON.parse(JSON.stringify(x));
const err = (code: string, msg = code) => Object.assign(new Error(msg), { code, raw: { code } });
class FakeStripe {
  paymentIntents = {
    create: async (p: any, o: any) => {
      if (S.down) throw err('api_connection_error');
      if (o?.idempotencyKey && S.keys.has(o.idempotencyKey)) return clone(S.pis.get(S.keys.get(o.idempotencyKey)));
      const id = `pi_${++S.n}`; const pi = { id, amount: p.amount, description: p.description, currency: p.currency, status: 'requires_payment_method', capture_method: p.capture_method, metadata: { ...p.metadata }, amount_received: 0, latest_charge: null, account: o?.stripeAccount };
      S.pis.set(id, pi); if (o?.idempotencyKey) S.keys.set(o.idempotencyKey, id); S.calls.push(`create ${id}`);
      if (S.onCreate) { const f = S.onCreate; S.onCreate = null; await f(); }
      return clone(pi);
    },
    retrieve: async (id: string) => { if (S.down) throw err('api_connection_error'); const pi = S.pis.get(id); if (!pi) throw Object.assign(err('resource_missing'), { statusCode: 404 }); return clone(pi); },
    capture: async (id: string) => { const pi = S.pis.get(id); if (pi.status !== 'requires_capture') throw err('payment_intent_unexpected_state'); pi.status = 'succeeded'; pi.amount_received = pi.amount; S.calls.push(`capture ${id}`); return clone(pi); },
    cancel: async (id: string) => { const pi = S.pis.get(id); if (pi.status === 'succeeded') throw err('payment_intent_unexpected_state'); pi.status = 'canceled'; S.calls.push(`cancel ${id}`); return clone(pi); },
  };
  refunds = { create: async (p: any, o?: any) => {
    if (S.refundErr) { const e: any = err(S.refundErr.code || S.refundErr); if (S.refundErr.type) e.type = S.refundErr.type; throw e; }
    if (o?.idempotencyKey && S.refundKeys.has(o.idempotencyKey)) return S.refundKeys.get(o.idempotencyKey);
    S.refunds.push({ ...p, key: o?.idempotencyKey || null }); const pi = S.pis.get(p.payment_intent); if (pi) pi.refunded = true;
    const r = { id: `re_${S.refunds.length}`, status: 'succeeded', amount: p.amount }; if (o?.idempotencyKey) S.refundKeys.set(o.idempotencyKey, r); return r; } };
  terminal = { readers: {
    list: async () => { S.listCalls++; return { data: Array.from(S.readers.values()).map(clone) }; },
    retrieve: async (id: string) => { const r = S.readers.get(id); if (!r) throw Object.assign(err('resource_missing'), { statusCode: 404 }); return clone(r); },
    processPaymentIntent: async (id: string, p: any) => {
      const r = S.readers.get(id); if (!r) throw Object.assign(err('resource_missing'), { statusCode: 404 });
      if (r.status !== 'online') throw err('terminal_reader_offline');
      if (r.action?.status === 'in_progress') throw err('terminal_reader_busy');
      if (S.onProcess) { const f = S.onProcess; S.onProcess = null; await f(); }
      r.action = { type: 'process_payment_intent', status: 'in_progress', process_payment_intent: { payment_intent: p.payment_intent }, failure_message: null };
      S.calls.push(`process ${id} ${p.payment_intent} tip:${p.process_config?.skip_tipping === true ? 'no' : 'yes'}`); return clone(r);
    },
    cancelAction: async (id: string) => { const r = S.readers.get(id); r.action = null; S.calls.push(`cancelAction ${id}`); return clone(r); },
  } };
  testHelpers = { terminal: { readers: { presentPaymentMethod: async (id: string) => { approve(id); return clone(S.readers.get(id)); } } } };
}
/** The guest taps a card the reader approves / declines. */
const approve = (readerId: string) => { const r = S.readers.get(readerId); const piId = r.action.process_payment_intent.payment_intent; S.pis.get(piId).status = 'requires_capture'; r.action.status = 'succeeded'; };
const decline = (readerId: string, msg = 'Your card was declined.') => { const r = S.readers.get(readerId); r.action.status = 'failed'; r.action.failure_message = msg; };

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
  if (request === '@/lib/route-guard') return { requireRole: async () => ({ actor }), requireCan: async () => ({ actor }) };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');

(async () => {
  const { POST: kitchen } = await import('../../src/app/api/kitchen/route');
  const { POST } = await import('../../src/app/api/counter/route');
  await db.doc(T).set({ name: 'Northside', timezone: 'UTC', retailSettings: { taxRatePercent: 10 }, salesTax: { configured: true } });
  await db.doc(`${T}/inventory/beans`).set({ type: 'refreshment', name: 'House blend beans', category: 'Coffee', price: 18, totalStock: 160, unit: 'oz', byWeight: { unit: 'lb' },
    choices: [{ id: 'grind', name: 'Grind', pick: 'one', required: false, max: 1, options: [{ id: 'whole', name: 'Whole bean', price: 0 }, { id: 'ground', name: 'Ground', price: 1 }] }] });
  await db.doc(`${T}/inventory/fudge`).set({ type: 'refreshment', name: 'Fudge', category: 'Sweets', price: 2.4, totalStock: 50, unit: 'units', byWeight: { unit: 'oz' } });
  await db.doc(`${T}/inventory/latte`).set({ type: 'refreshment', name: 'Oat latte', category: 'Drinks', price: 5.25, totalStock: 50 });
  const key = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Counter', kind: 'drive-thru' }))).body.key;
  const P = (b: any) => POST(req({ tenantId: 't1', key, ...b })) as Promise<any>;
  await db.doc(`${T}/staff/m9`).set({ name: 'Mo Diaz', role: 'manager', isActive: true });
  const { createHash, randomBytes } = await import('crypto'); const mpass = randomBytes(24).toString('hex');
  await db.doc(`kitchenScreens/${createHash('sha256').update(key).digest('hex')}`).set({ passes: { [createHash('sha256').update(mpass).digest('hex')]: { id: 'm9', name: 'Mo Diaz', exp: Date.now() + 3600000 } } }, { merge: true });
  const order = (id: string) => get(`${T}/counterOrders/${id}`);
  const lines = async (id: string) => (await order(id)).lines || [];
  const W = await import('../../src/lib/menu-weight');
  const CO = await import('../../src/lib/counter-orders');

  console.log('the rules');
  check('weights kept to their unit: two places, three for kg, none for g; more than nothing, about 50 lb at most', W.cleanWeight('0.756', 'lb') === 0.76 && W.cleanWeight('1.2345', 'kg') === 1.235 && W.cleanWeight('250.4', 'g') === 250 && W.cleanWeight('0', 'lb') === null && W.cleanWeight('51', 'lb') === null && W.cleanWeight('800', 'oz') === 800);
  check('units of weight, however inventory spells them', W.massUnitOf('lbs') === 'lb' && W.massUnitOf('Ounces') === 'oz' && W.massUnitOf('grams') === 'g' && W.massUnitOf('units') === null);
  check('the weight in the item’s own stock unit', W.stockAmountOf(0.75, 'lb', { unit: 'oz' }) === 12 && W.stockAmountOf(500, 'g', { unit: 'kg' }) === 0.5 && W.stockAmountOf(3, 'oz', { unit: 'units' }) === 3);
  check('how it reads', W.weightText(0.75, 'lb') === '0.75 lb' && W.weightText(2, 'lb') === '2 lb' && W.perText(18, 'lb') === '$18.00/lb' && W.unitsOf({ quantity: 1, weight: { stock: 12 } }) === 12 && W.unitsOf({ quantity: 3 }) === 3);
  const beansDoc = await get(`${T}/inventory/beans`);
  let made: any = CO.lineFor(beansDoc, 'beans', 1, {}, 'x');
  check('no weight: weighed at the counter', !made.ok && /weighed at the counter/.test(made.error), made);
  made = CO.lineFor(beansDoc, 'beans', 2, {}, 'x', undefined, 20, '0.5');
  check('one weighing a line', !made.ok, made);
  made = CO.lineFor(beansDoc, 'beans', 1, { grind: ['ground'] }, 'x', undefined, 20, '0.75');
  check('0.75 lb at $18/lb, ground (+$1 once): $14.50, its weight and what comes off stock kept', made.ok && made.line.unitPrice === 14.5 && made.line.quantity === 1 && made.line.weight.amount === 0.75 && made.line.weight.unit === 'lb' && made.line.weight.per === 18 && made.line.weight.stock === 12 && made.line.choicesText === '0.75 lb at $18.00/lb, Ground', made.line);
  const lat: any = CO.lineFor(await get(`${T}/inventory/latte`), 'latte', 1, {}, 'y', undefined, 20, '3');
  check('an item not sold by weight ignores one', lat.ok && lat.line.unitPrice === 5.25 && !lat.line.weight);

  console.log('at the counter');
  const o1 = (await P({ action: 'car', carKey: 'weigh-a' })).body.orderId;
  let r = await P({ action: 'add', orderId: o1, itemId: 'beans', quantity: 1, tapKey: 'tap-weigh-0001' });
  check('added without a weight: asks for it', r.status === 400 && /weighed/.test(r.body.error), r.body);
  r = await P({ action: 'add', orderId: o1, itemId: 'beans', quantity: 1, choices: { grind: ['whole'] }, weight: 0.75, tapKey: 'tap-weigh-0002' });
  await P({ action: 'add', orderId: o1, itemId: 'beans', quantity: 1, choices: { grind: ['whole'] }, weight: 0.75, tapKey: 'tap-weigh-0003' });
  let ls = await lines(o1);
  check('each weighing is its own line, never merged', r.body.ok && ls.length === 2 && ls.every((l: any) => l.unitPrice === 13.5 && l.weight?.amount === 0.75), ls);
  r = await P({ action: 'qty', orderId: o1, lineId: ls[0].lineId, quantity: 2, tapKey: 'tap-weigh-0004' });
  check('more of a weighing is weighing it again', r.status === 409, r.body);
  await P({ action: 'remove', orderId: o1, lineId: ls[1].lineId, tapKey: 'tap-weigh-0005' });
  await P({ action: 'add', orderId: o1, itemId: 'fudge', quantity: 1, weight: 3, tapKey: 'tap-weigh-0006' });
  let od = await order(o1);
  check('the money: $13.50 of beans and $7.20 of fudge, taxed', od.subtotal === 20.7 && od.tax === 2.07 && od.total === 22.77, [od.subtotal, od.tax, od.total]);
  r = await P({ action: 'send', orderId: o1 });
  check('sent: 12 oz of beans off stock (0.75 lb, counted in ounces), and 3 fudge (counted as it is)', r.body.ok && (await get(`${T}/inventory/beans`)).totalStock === 148 && (await get(`${T}/inventory/fudge`)).totalStock === 47, [r.body, (await get(`${T}/inventory/beans`)).totalStock, (await get(`${T}/inventory/fudge`)).totalStock]);
  r = await P({ action: 'void', orderId: o1, reason: 'Wrong order', staffPass: mpass });
  check('voided before the kitchen started: the 12 oz go back', r.body.ok && (await get(`${T}/inventory/beans`)).totalStock === 160 && (await get(`${T}/inventory/fudge`)).totalStock === 50, [r.body, (await get(`${T}/inventory/beans`)).totalStock]);
  const o2 = (await P({ action: 'car', carKey: 'weigh-b' })).body.orderId;
  await P({ action: 'add', orderId: o2, itemId: 'beans', quantity: 1, weight: 11, tapKey: 'tap-weigh-0010' });
  r = await P({ action: 'send', orderId: o2 });
  check('more than there is: said before it goes', !r.body.ok && /left|ran out/.test(r.body.error || ''), r.body);
  await P({ action: 'remove', orderId: o2, lineId: (await lines(o2))[0].lineId, tapKey: 'tap-weigh-0011' });
  await P({ action: 'add', orderId: o2, itemId: 'beans', quantity: 1, weight: 1, tapKey: 'tap-weigh-0012' });
  await P({ action: 'send', orderId: o2 }); await P({ action: 'paid', orderId: o2, method: 'card' });
  const RC = await import('../../src/lib/counter-receipt');
  check('the receipt says what it weighed', RC.counterReceipt(await order(o2), o2).detail.lines.some((l: any) => l.label === 'House blend beans (1 lb at $18.00/lb)' && l.amount === 18), RC.counterReceipt(await order(o2), o2).detail.lines);

  console.log('where it can’t be ordered');
  const kiosk = src('src/lib/kiosk.ts'), ahead = src('src/lib/counter-ahead.ts'), voice = src('src/app/api/counter/voice/route.ts');
  check('the kiosk, ordering ahead and the voice leave it off', kiosk.includes('!m.byWeight && servedNow') && ahead.includes('!m.membersOnly && !m.byWeight') && voice.includes('menuItems.filter((m) => !m.byWeight)'));
  const MS = await import('../../src/lib/menu-server');
  check('the menu says it’s sold by weight (never a combo)', MS.menuItemOf('beans', beansDoc).byWeight === 'lb' && MS.menuItemOf('c', { ...beansDoc, combo: true }).byWeight === null && MS.menuItemOf('latte', await get(`${T}/inventory/latte`)).byWeight === null);
  const menuRoute = src('src/app/api/menu/route.ts');
  check('the Menu page saves it: lb, oz, kg or g, never a combo or part of one', menuRoute.includes("if (x.byWeight !== null && !(WEIGHT_UNITS as string[]).includes(String(x.byWeight))) return bad('Pick lb, oz, kg or g.');") && menuRoute.includes('is sold by weight, so it’s weighed on its own'));
  check('the menu board shows the price per unit', src('src/app/api/counter/route.ts').includes('...(m.byWeight ? { per: m.byWeight } : {})') && src('src/app/drive-thru/[tenantId]/menu/page.tsx').includes('/{i.per}'));
  check('food cost counts a weighing by its weight (sold, and a staff meal)', src('src/app/api/food-cost/route.ts').includes('qty: unitsOf(l)') && src('src/app/api/food-cost/route.ts').includes('each * unitsOf(l)'));
  check('taken off after it was made: its weight is the waste', src('src/lib/counter-takeoff-server.ts').includes('const units = line.weight ? unitsOf(line) : q;'));
  check('counted for the whole business, never store by store (whose numbers are whole)', src('src/lib/counter-server.ts').includes('...(byWeightOf(d.data) ? {} : { ...tookAt(id, d.data, storeMoveNested(d.data, soldAt, { stock: -own })) })'));
  check('the voice assistant leaves it off too', src('src/app/api/counter/assistant/route.ts').includes(".filter((m) => !m.byWeight);"));
  check('already part of a combo: taken out of it first', menuRoute.includes('Take it out of the combo first, then sell it by weight.'));
  check('a scanned one asks for its weight', src('src/lib/counter-scan-server.ts').includes("'weigh', { itemId: f.itemId"));

  console.log('the screens');
  const counter = src('src/app/(app)/counter/page.tsx'), window = src('src/app/drive-thru/[tenantId]/page.tsx'), sheet = src('src/components/pos/CounterWeight.tsx'), builder = src('src/components/menu/ItemBuilder.tsx');
  check('the counter and the window weigh it first, and say its price per unit', [counter, window].every((p) => p.includes('<WeightSheet') && p.includes("d.code === 'weigh'") && p.includes('<RegisterTiles') && p.includes('!!(l as any).weight}')) && src('src/components/pos/RegisterTiles.tsx').includes('m.byWeight ?'));
  check('the sheet: what the scale reads, quick weights, the price as it’s typed', sheet.includes('What the scale reads') && sheet.includes('QUICK[unit]') && sheet.includes('Add to the order'));
  check('the Menu page: Sold by weight, and its unit', builder.includes('Sold by weight') && builder.includes('WEIGHT_UNITS.map'));
  const mine = sheet + src('src/lib/menu-weight.ts');
  check('house style', !/ · |\buppercase\b|font-black|\{\/\*/.test(mine) && !/[Ss]alon|[Ss]tylist|\bbooth\b|\bchair\b|[Ss]tudio/.test(mine));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
