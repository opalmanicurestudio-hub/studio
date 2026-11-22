// Checks cash in and out of the drawer from the counter and the window (design board "Register tools, part 2", part 3;
// lib/drawer-moves-server; api/counter 'drawer' and 'drawerView'; components/pos/DrawerMove; the till's count and slip;
// the night report).
// - Pay out: a manager's, what for, an expense on the books (Supplies, cash), with a photo of the receipt if there is one.
// - Put in: on the drawer's count only. To the safe: a manager's, off the count only, never more than should be there.
// - One move however often it's sent; refused with no drawer open, or two.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/drawer-moves.verify.ts
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
  const start = async (n: string) => (await P({ action: 'car', carKey: `drawer-${n}` })).body.orderId as string;
  const lines = async (id: string) => (await get(`${T}/counterOrders/${id}`)).lines || [];


  const till = () => get(`${T}/tillSessions/till1`);
  await db.doc(`${T}/tillSessions/till1`).set({ id: 'till1', status: 'open', openedBy: 'Ana', openedAt: new Date().toISOString(), openingFloat: 100, expectedCash: 150, totalCashSales: 50 });

  console.log('put in');
  let r = await P({ action: 'drawerView' });
  check('what should be in the drawer now', r.body.ok && r.body.drawer.open === true && r.body.drawer.expectedCash === 150, r.body);
  r = await P({ action: 'drawer', kind: 'in', cents: 2000, note: 'More change', moveKey: 'drawer-move-0001' });
  check('put in is a manager’s too (one that never happened would hide cash taken)', r.status === 403 && r.body.needsManager === true && (await till()).expectedCash === 150, r.body);
  r = await P({ action: 'drawer', kind: 'in', cents: 2000, note: 'More change', moveKey: 'drawer-move-0001', staffPass: mpass });
  let t = await till();
  check('put in: on the count', r.body.ok && t.expectedCash === 170 && t.totalPaidIn === 20 && t.cashMoves.length === 1 && t.cashMoves[0].note === 'More change', [r.body, t]);
  await P({ action: 'drawer', kind: 'in', cents: 2000, note: 'More change', moveKey: 'drawer-move-0001', staffPass: mpass });
  check('…the same move sent twice: once', (await till()).expectedCash === 170 && (await till()).cashMoves.length === 1);

  console.log('pay out');
  r = await P({ action: 'drawer', kind: 'out', cents: 1840, note: 'Milk from the store', moveKey: 'drawer-move-0002' });
  check('a pay out is a manager’s', r.status === 403 && r.body.needsManager === true && (await till()).expectedCash === 170, r.body);
  r = await P({ action: 'drawer', kind: 'out', cents: 1840, note: '', moveKey: 'drawer-move-0002', staffPass: mpass });
  check('…and says what for', r.status === 400 && r.body.code === 'note', r.body);
  const photo = 'https://firebasestorage.googleapis.com/v0/b/demo.appspot.com/o/tenants%2Ft1%2Fuploads%2Freceipt.jpg?alt=media&token=abc';
  r = await P({ action: 'drawer', kind: 'out', cents: 1840, note: 'Milk from the store', moveKey: 'drawer-move-0002', receiptUrl: photo, staffPass: mpass });
  t = await till(); const tx = await get(`${T}/transactions/drawer_till1_drawer-move-0002`);
  check('paid out: off the count, okayed by the manager', r.body.ok && t.expectedCash === 151.6 && t.totalPaidOut === 18.4 && t.cashMoves[1].approvedBy === 'Mo Diaz' && r.body.approvedBy === 'Mo Diaz', [r.body, t]);
  check('…an expense on the books: Supplies, paid in cash, with its receipt', tx && tx.type === 'expense' && tx.category === 'Supplies' && tx.taxBucket === 'operating_cost' && tx.clientOrVendor === 'Paid out of the drawer' && tx.amount === 18.4 && tx.paymentMethod === 'Cash' && tx.hasReceipt === true && tx.receiptUrl === photo && tx.tillSessionId === 'till1', tx);
  r = await P({ action: 'drawer', kind: 'out', cents: 500, note: 'Stamps', moveKey: 'drawer-move-0003', receiptUrl: 'https://firebasestorage.googleapis.com/v0/b/demo.appspot.com/o/tenants%2Fother%2Fuploads%2Fx.jpg', staffPass: mpass });
  check('…a photo from another business’s uploads isn’t kept', r.body.ok && (await get(`${T}/transactions/drawer_till1_drawer-move-0003`)).hasReceipt === false, r.body);
  r = await P({ action: 'drawer', kind: 'out', cents: 100, note: 'Tape', moveKey: 'drawer-move-0013', receiptUrl: 'https://firebasestorage.googleapis.com/v0/b/demo.appspot.com/o/tenants%2Fother%2Fx.jpg?n=/o/tenants%2Ft1%2Fuploads%2F', staffPass: mpass });
  check('…nor one that only says this business’s folder after the “?”', r.body.ok && (await get(`${T}/transactions/drawer_till1_drawer-move-0013`)).hasReceipt === false, r.body);
  await P({ action: 'drawerUndo', moveKey: 'drawer-move-0013', staffPass: mpass });
  r = await P({ action: 'drawerUndo', moveKey: 'drawer-move-0003' });
  check('undoing one is a manager’s', r.status === 403 && r.body.needsManager === true, r.body);
  r = await P({ action: 'drawerUndo', moveKey: 'drawer-move-0003', staffPass: mpass });
  t = await till(); const back = await get(`${T}/transactions/drawer_till1_drawer-move-0003_undo`);
  check('…undone: the count back, its expense given back on the books, kept as undone', r.body.ok && t.expectedCash === 151.6 && t.totalPaidOut === 18.4 && back?.type === 'reversal' && back.amount === 5 && !!t.cashMoves.find((m: any) => m.key === 'drawer-move-0003').undoneAt, [r.body, t.expectedCash, back]);
  r = await P({ action: 'drawerUndo', moveKey: 'drawer-move-0003', staffPass: mpass });
  check('…undone twice: once', r.body.ok && r.body.already === true && (await till()).expectedCash === 151.6, r.body);

  console.log('to the safe');
  r = await P({ action: 'drawer', kind: 'drop', cents: 50000, moveKey: 'drawer-move-0004', staffPass: mpass });
  check('never more than should be in the drawer', r.status === 409 && r.body.code === 'more_than', r.body);
  r = await P({ action: 'drawer', kind: 'drop', cents: 10000, moveKey: 'drawer-move-0005' });
  check('a manager’s', r.status === 403 && r.body.needsManager === true, r.body);
  r = await P({ action: 'drawer', kind: 'drop', cents: 10000, moveKey: 'drawer-move-0005', staffPass: mpass });
  t = await till();
  check('to the safe: off the count, no note needed, not an expense', r.body.ok && t.expectedCash === 51.6 && t.totalDrops === 100 && !(await get(`${T}/transactions/drawer_till1_drawer-move-0005`)), [r.body, t.expectedCash]);

  console.log('no drawer, or two');
  await db.doc(`${T}/tillSessions/till2`).set({ id: 'till2', status: 'open', expectedCash: 0 });
  r = await P({ action: 'drawer', kind: 'in', cents: 100, note: 'Coins', moveKey: 'drawer-move-0006', staffPass: mpass });
  check('two drawers open: says to close the extra one', r.status === 409 && r.body.code === 'two', r.body);
  await db.doc(`${T}/tillSessions/till2`).set({ status: 'closed' }, { merge: true }); await db.doc(`${T}/tillSessions/till1`).set({ status: 'closed' }, { merge: true });
  r = await P({ action: 'drawer', kind: 'in', cents: 100, note: 'Coins', moveKey: 'drawer-move-0007', staffPass: mpass });
  check('none open: says to open it first', r.status === 409 && r.body.code === 'closed' && (await P({ action: 'drawerView' })).body.drawer.open === false, r.body);

  console.log('the night report, the till and the screens');
  const NC = await import('../../src/lib/night-close');
  const text = NC.reportText('Northside', NC.nightReport({ day: '2026-11-22', timeZone: 'UTC', sales: [], tables: [], adjustments: [], tills: [{ openedBy: 'Ana', openingFloat: 100, expectedCash: 51.6, actualCash: null, status: 'open', moves: (await till()).cashMoves.filter((m: any) => !m.undoneAt).map((m: any) => ({ kind: m.kind, cents: m.cents, note: m.note, by: m.by, approvedBy: m.approvedBy || null })) }], tips: { mode: 'off', rows: [] }, items: [], checks: {} } as any));
  check('the night report lists each move under its drawer', /Paid out \$18\.40: Milk from the store, by Mo Diaz/.test(text) && /Put in \$20\.00: More change/.test(text) && /To the safe \$100\.00/.test(text) && !/Stamps/.test(text) && /filter\(\(m: any\) => !m\?\.undoneAt\)/.test(src('src/lib/night-close-server.ts')), text);
  const tm = src('src/components/pos/TillManagement.tsx');
  check('the till’s count and its slip show them', tm.includes("row('Paid out',") && tm.includes("row('To the safe',") && tm.includes("row('Put in',") && tm.includes(', paid out −'));
  const counter = src('src/app/(app)/counter/page.tsx'), window = src('src/app/drive-thru/[tenantId]/page.tsx'), sheet = src('src/components/pos/DrawerMove.tsx');
  check('“Cash in or out” at the counter (with a receipt photo) and the window', counter.includes('Cash in or out') && window.includes('Cash in or out') && counter.includes('<DrawerSheet') && window.includes('<DrawerSheet') && /photo=\{\(set\) => <ImageUpload/.test(counter) && /storageFolder="uploads"/.test(counter));
  check('the sheet: pay out, put in, to the safe; the count before and after; a manager’s PIN', sheet.includes("'Pay out'") && sheet.includes("'Put in'") && sheet.includes("'To the safe'") && sheet.includes('In the drawer now') && sheet.includes('PinPad') && sheet.includes('moveKey'));
  const mine = sheet + src('src/lib/drawer-moves-server.ts');
  check('house style', !/ · |\buppercase\b|font-black|\{\/\*/.test(mine) && !/[Ss]alon|[Ss]tylist|\bbooth\b|\bchair\b|[Ss]tudio/.test(mine) && !/ · /.test(tm.slice(tm.indexOf('Sales {money(activeTill.totalCashSales)}'), tm.indexOf('Sales {money(activeTill.totalCashSales)}') + 600)));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
