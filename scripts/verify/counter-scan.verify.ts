// Checks barcodes scanned at the counter and the drive-thru (lib/counter-scan-server; api/counter 'scan', 'codeOn';
// components/pos/CounterScan; lib/use-wedge-scanner on both screens).
// - A code is the menu item it's on (lib/code-index), added like a tap, once per scan; a case's code adds its case.
// - An item with choices opens them; a product off the menu is said so; a code on nothing asks which item it is, and a
//   manager puts it on one (it scans everywhere from then on); a code on another item is refused.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/counter-scan.verify.ts
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
  await db.doc(`${T}/inventory/water`).set({ type: 'refreshment', name: 'Sparkling water', category: 'Drinks', price: 2.75, totalStock: 200, barcode: '012345678905', caseBarcode: '10012345678902', casePack: 6 });
  await db.doc(`${T}/inventory/latte`).set({ type: 'refreshment', name: 'Latte', category: 'Coffee', price: 5, totalStock: 200, barcode: '036000291452',
    choices: [{ id: 'size', name: 'Size', required: true, options: [{ id: 's', name: 'Small', price: 0 }, { id: 'l', name: 'Large', price: 1 }] }] });
  await db.doc(`${T}/inventory/chips`).set({ type: 'refreshment', name: 'Sea salt chips', category: 'Snacks', price: 2, totalStock: 50 });
  await db.doc(`${T}/inventory/shampoo`).set({ type: 'retail', name: 'Shampoo', price: 18, totalStock: 5, barcode: '042100005264' });
  await db.doc(`${T}/staff/m9`).set({ name: 'Mo Diaz', role: 'manager', isActive: true });
  const key = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Window', kind: 'drive-thru' }))).body.key;
  const P = (b: any) => POST(req({ tenantId: 't1', key, ...b })) as Promise<any>;
  const passOf = async (id: string, name: string) => { const { createHash, randomBytes } = await import('crypto'); const pass = randomBytes(24).toString('hex'); const h = createHash('sha256').update(key).digest('hex');
    await db.doc(`kitchenScreens/${h}`).set({ passes: { [createHash('sha256').update(pass).digest('hex')]: { id, name, exp: Date.now() + 3600000 } } }, { merge: true }); return pass; };
  const mpass = await passOf('m9', 'Mo Diaz');
  const start = async (n: string) => (await P({ action: 'car', carKey: `scan-${n}` })).body.orderId as string;
  const lines = async (id: string) => (await get(`${T}/counterOrders/${id}`)).lines || [];

  console.log('a scan adds the item');
  const o1 = await start('a');
  let r = await P({ action: 'scan', orderId: o1, code: '012345678905', tapKey: 'tap-scan-0001' });
  check('its code: the menu item it’s on, added like a tap', r.body.ok && r.body.name === 'Sparkling water' && (await lines(o1)).length === 1 && (await lines(o1))[0].quantity === 1, r.body);
  await P({ action: 'scan', orderId: o1, code: '012345678905', tapKey: 'tap-scan-0001' });
  check('…the same scan sent twice: once', (await lines(o1))[0].quantity === 1);
  await P({ action: 'scan', orderId: o1, code: ' 0 12345 67890 5 ', tapKey: 'tap-scan-0002' });
  check('…scanned again (typed with spaces): one more', (await lines(o1))[0].quantity === 2);
  r = await P({ action: 'scan', orderId: o1, code: '10012345678902', tapKey: 'tap-scan-0003' });
  check('a case’s code: as many as are in it', r.body.ok && r.body.pack === 6 && (await lines(o1))[0].quantity === 8, r.body);
  r = await P({ action: 'scan', orderId: o1, code: 'clarityflow://product/chips', tapKey: 'tap-scan-0004' });
  check('a printed product label works too', r.body.ok && r.body.name === 'Sea salt chips', r.body);

  r = await P({ action: 'scan', orderId: o1, code: '012345678905' });
  check('a scan without its own key: refused (one sent twice would be added twice)', r.status === 400 && r.body.code === 'key', r.body);
  await db.doc(`${T}/inventory/water`).set({ palletBarcode: '20012345678909', palletPack: 48 }, { merge: true });
  await db.doc(`${T}/private/codeIndex`).set({ builtAt: null }, { merge: true });
  r = await P({ action: 'scan', orderId: o1, code: '20012345678909', tapKey: 'tap-scan-0099' });
  check('a pallet’s code, more than a line takes: refused, never short', r.status === 409 && r.body.code === 'case' && (await lines(o1))[0].quantity === 8, r.body);

  console.log('what a scan can’t add by itself');
  r = await P({ action: 'scan', orderId: o1, code: '036000291452', tapKey: 'tap-scan-0005' });
  check('an item with choices: its choices open on the screen', r.status === 409 && r.body.code === 'choices' && r.body.itemId === 'latte', r.body);
  r = await P({ action: 'scan', orderId: o1, code: '042100005264', tapKey: 'tap-scan-0006' });
  check('a product that isn’t on the menu: said so, nothing added', r.status === 409 && r.body.code === 'not_menu' && /Shampoo isn’t on the menu/.test(r.body.error), r.body);
  r = await P({ action: 'scan', orderId: o1, code: '9780201379624', tapKey: 'tap-scan-0007' });
  check('a code on nothing yet: asked which item it is', r.status === 404 && r.body.code === 'unknown' && r.body.scanned === '9780201379624', r.body);

  console.log('putting a code on an item');
  r = await P({ action: 'codeOn', orderId: o1, code: '9780201379624', itemId: 'chips', tapKey: 'tap-scan-0008' });
  check('a manager’s: without one, it asks', r.status === 403 && r.body.needsManager === true, r.body);
  r = await P({ action: 'codeOn', orderId: o1, code: '9780201379624', itemId: 'chips', tapKey: 'tap-scan-0008', staffPass: mpass });
  const chips = await get(`${T}/inventory/chips`);
  check('okayed: on the item from now on, and added to the order', r.body.ok && chips.barcode === '9780201379624' && (await lines(o1)).find((l: any) => l.itemId === 'chips')?.quantity === 2, [r.body, chips.barcode]);
  r = await P({ action: 'scan', orderId: o1, code: '9780201379624', tapKey: 'tap-scan-0009' });
  check('…and it scans from then on', r.body.ok && r.body.name === 'Sea salt chips', r.body);
  r = await P({ action: 'codeOn', orderId: o1, code: '012345678905', itemId: 'chips', tapKey: 'tap-scan-0010', staffPass: mpass });
  check('a code already on another item: refused, naming it', r.status >= 400 && /Sparkling water/.test(r.body.error), r.body);

  console.log('after it’s sent');
  await P({ action: 'send', orderId: o1 });
  r = await P({ action: 'scan', orderId: o1, code: '012345678905', tapKey: 'tap-scan-0011' });
  check('scanned onto an order the kitchen has: refused', r.status === 409 && /kitchen/.test(r.body.error), r.body);

  console.log('the screens');
  const page = src('src/app/(app)/counter/page.tsx'), dt = src('src/app/drive-thru/[tenantId]/page.tsx'), cs = src('src/components/pos/CounterScan.tsx');
  check('the counter and the drive-thru hear any scanner that types, behind anything open in front', /useWedgeScanner\(scan, [^)]*\{ layer: 'background' \}\)/.test(page) && /useWedgeScanner\(scan, [^)]*\{ layer: 'background' \}\)/.test(dt));
  check('…choices open, and a code on nothing asks which item it is', page.includes("if (d.code === 'choices')") && page.includes('<CodeOnSheet') && dt.includes("if (d.code === 'choices')") && dt.includes('<CodeOnSheet'));
  check('the sheet: find the item, a manager’s PIN', cs.includes('Which item is it?') && cs.includes('A manager’s PIN') && cs.includes('isn’t on anything yet'));
  check('house style', !/ · |\buppercase\b|font-black|\{\/\*/.test(cs) && !/[Ss]alon|[Ss]tylist|\bbooth\b|\bchair\b/.test(cs + src('src/lib/counter-scan-server.ts')));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
