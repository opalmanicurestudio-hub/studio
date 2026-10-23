// Checks owed fees paid at the desk are paid once (api/checkout/complete with lib/fee-pay's lock): a fee a card payment
// is going through for right now (automatic collection, Charge card) isn't taken at the desk as well; two desk sales
// paying the same fee at the same moment pay it once (the second finds the fees changed and records nothing).
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/desk-fees.verify.ts
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
const fresh = async (fee: any = {}) => {
  db = strictTransactions(makeDb()); actor = desk; audits.length = 0;
  await db.doc(T).set({ name: 'Opal', timezone: 'America/New_York', salesTax: { configured: true, productsPct: 0 } });
  await db.doc(`${T}/staff/k1`).set({ name: 'Kai Park', role: 'front_desk' });
  await db.doc(`${T}/clients/c1`).set({ name: 'Maya Lopez', email: 'maya@example.com', outstandingBalance: 15,
    unpaidFees: [{ feeId: 'f1', feeAmount: 15, reason: 'Late-cancellation fee', appointmentId: 'a9', ...fee }] });
};
const feeLines = async () => (await all(`${T}/transactions`)).filter((t: any) => t.category === 'Fee Recovery');

(async () => {
  const { POST: complete } = await import('../../src/app/api/checkout/complete/route');
  const pay = () => complete(req({ tenantId: 't1', clientId: 'c1', items: [], feeIds: ['f1'], expectedTotal: 15, payment: { method: 'cash', amountTendered: 15 } })) as any;

  console.log('a fee being collected by card right now');
  await fresh({ collectingAt: new Date().toISOString(), collectingKey: 'fees_c1_x' });
  let r: any = await pay();
  check('the desk waits for that payment: refused, nothing recorded, the fee still owed', r.status === 409 && r.body.code === 'fee_busy' && (await feeLines()).length === 0 && (await get(`${T}/clients/c1`)).unpaidFees.length === 1 && (await get(`${T}/clients/c1`)).outstandingBalance === 15, r.body);

  console.log('paid at the desk');
  await fresh();
  r = await pay();
  check('paid: off her list and her balance, one line in the books', r.status === 200 && (await get(`${T}/clients/c1`)).unpaidFees.length === 0 && (await get(`${T}/clients/c1`)).outstandingBalance === 0 && (await feeLines()).length === 1, r.body);

  console.log('two desk sales paying the same fee at once');
  await fresh();
  const two: any[] = await Promise.all([pay(), pay()]);
  const c: any = await get(`${T}/clients/c1`);
  check('paid once: one line, nothing owed, the balance never below zero', (await feeLines()).length === 1 && c.unpaidFees.length === 0 && c.outstandingBalance === 0, { c, two: two.map((x) => [x.status, x.body?.code]) });
  check('…the other records nothing and says to finish again', two.some((x) => x.status === 409 && x.body?.code === 'fees_changed'), two.map((x) => [x.status, x.body?.code, x.body?.error]));

  if (failures) { console.error(`${failures} failed`); process.exit(1); }
  console.log('desk-fees ok');
})();
