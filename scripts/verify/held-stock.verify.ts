// Checks the desk can't sell units held for paid online orders without a manager's yes (api/checkout/complete,
// lib/held-stock, lib/approvals): what's free sells as usual; selling into what's held is refused for the front desk,
// goes through with a manager's approval (used once) or a manager at the desk, and is written down for the manager.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/held-stock.verify.ts
import Module from 'module';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';
import * as webMock from './web-firestore-mock';

process.env.STRIPE_SECRET_KEY = 'sk_test_x';
let db: any = strictTransactions(makeDb());
const desk: any = { uid: 'k1', name: 'Kai Park', role: 'front_desk', isManager: false, caps: [] };
const boss: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
let actor: any = desk;
const audits: any[] = [];
function StripeMock(this: any) { return { paymentIntents: { retrieve: async () => { throw new Error('no card here'); } } }; }
const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return Object.assign(StripeMock, { default: StripeMock });
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === '@/lib/route-guard') return { requireRole: async () => ({ actor }) };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async (_db: any, _t: string, e: any) => { audits.push(e); }, auditEntry: () => ({}) });
  if (request === 'firebase/firestore') return webMock;
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ ...d.data(), id: d.id }));
const req = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body), headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://studio.test' } }) as any;
const oil = (quantity: number) => [{ id: 'p1', type: 'product', quantity, price: 45, name: 'Cuticle oil' }];
const fresh = async () => {
  db = strictTransactions(makeDb()); actor = desk; audits.length = 0;
  await db.doc(T).set({ name: 'Opal', timezone: 'America/New_York', salesTax: { configured: true, productsPct: 0 } });
  await db.doc(`${T}/staff/k1`).set({ name: 'Kai Park', role: 'front_desk' });
  await db.doc(`${T}/staff/m1`).set({ name: 'Ana Ruiz', role: 'manager' });
  await db.doc(`${T}/clients/c1`).set({ name: 'Maya Lopez', email: 'maya@example.com' });
  // Three on the shelf, two of them held for paid online orders: one is free to sell.
  await db.doc(`${T}/inventory/p1`).set({ name: 'Cuticle oil', msrp: 45, totalStock: 3, stockReserved: 2 });
};
const approval = (id: string, x: any = {}) => db.doc(`${T}/approvals/${id}`).set({ id, kind: 'held_stock', status: 'approved', approverId: 'm1', approverName: 'Ana Ruiz', expiresAt: new Date(Date.now() + 600e3).toISOString(), ...x });

(async () => {
  const { POST: complete } = await import('../../src/app/api/checkout/complete/route');
  const sell = (n: number, x: any = {}) => complete(req({ tenantId: 't1', clientId: 'c1', items: oil(n), expectedTotal: 45 * n, payment: { method: 'cash', amountTendered: 45 * n }, ...x })) as any;

  console.log('what’s free');
  await fresh();
  let r: any = await sell(1);
  check('one (the one that isn’t held) sells as usual', r.status === 200 && r.body.ok !== false && (await all(`${T}/receipts`)).length === 1 && (await get(`${T}/inventory/p1`)).totalStock === 2, r.body);

  console.log('into what’s held');
  await fresh();
  r = await sell(2);
  check('two at the front desk: refused, and it says why', r.status === 409 && r.body.code === 'held_stock' && /held/.test(r.body.error) && r.body.held?.[0]?.free === 1, r.body);
  check('…nothing sold, nothing taken off the shelf', (await all(`${T}/receipts`)).length === 0 && (await get(`${T}/inventory/p1`)).totalStock === 3);
  await approval('ap1', { kind: 'recovery' });
  r = await sell(2, { heldStock: { approvalToken: 'ap1' } });
  check('an approval for something else doesn’t count', r.status === 409 && r.body.code === 'held_stock');
  await approval('ap2');
  r = await sell(2, { heldStock: { approvalToken: 'ap2' } });
  check('with a manager’s approval: sold', r.status === 200 && (await all(`${T}/receipts`)).length === 1 && (await get(`${T}/inventory/p1`)).totalStock === 1, r.body);
  check('…the approval is used', (await get(`${T}/approvals/ap2`)).used === true);
  check('…and the manager can see it was sold from held units, and who said yes', audits.some((a) => a.action === 'checkout.held_stock_sold' && /Ana Ruiz/.test(a.summary)), audits.map((a) => a.action));
  await db.doc(`${T}/inventory/p1`).set({ totalStock: 3, stockReserved: 2 }, { merge: true });
  r = await sell(2, { heldStock: { approvalToken: 'ap2' } });
  check('…once: the same approval again is refused', r.status === 409 && r.body.code === 'held_stock' && (await all(`${T}/receipts`)).length === 1);
  await approval('ap3', { expiresAt: new Date(Date.now() - 1000).toISOString() });
  r = await sell(2, { heldStock: { approvalToken: 'ap3' } });
  check('an expired approval: refused', r.status === 409);

  console.log('a manager at the desk');
  await fresh(); actor = boss;
  r = await sell(2);
  check('a manager sells it without asking anyone', r.status === 200 && (await all(`${T}/receipts`)).length === 1 && audits.some((a) => a.action === 'checkout.held_stock_sold'), r.body);

  if (failures) { console.error(`${failures} failed`); process.exit(1); }
  console.log('held-stock ok');
})();
