// Checks one item on the house at the counter and the window (design board "Register tools, part 2", part 2;
// lib/counter-comp-server, lib/counter-comp; api/counter 'comp' and 'uncomp'; components/pos/CounterComp; the receipt
// and the night report).
// - A manager's, with why: the item is $0 with its price kept; while it's being taken, some of a line (split off), once
//   it's with the kitchen the whole line; the order's discount stays beside it. Charged for again: its price again.
// - On the house can't grow without another okay; paid already: a refund instead (and a refund gives nothing for it).
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/counter-comp.verify.ts
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
  await db.doc(T).set({ name: 'Northside', timezone: 'UTC', retailSettings: { taxRatePercent: 10 }, salesTax: { configured: true }, counterDiscounts: [{ id: 'ten', label: 'Ten off', kind: 'pct', value: 10 }] });
  await db.doc(`${T}/inventory/chips`).set({ type: 'refreshment', name: 'Sea salt chips', category: 'Snacks', price: 2, totalStock: 50 });
  await db.doc(`${T}/inventory/water`).set({ type: 'refreshment', name: 'Sparkling water', category: 'Drinks', price: 3, totalStock: 40 });
  await db.doc(`${T}/inventory/bun`).set({ type: 'retail', name: 'Buns', totalStock: 100, unit: 'units' });
  await db.doc(`${T}/inventory/burger`).set({ type: 'refreshment', name: 'Burger', category: 'Food', price: 10, totalStock: 50, formula: [{ id: 'bun', name: 'Bun', quantityUsed: 1, unit: 'units' }] });
  await db.doc(`${T}/staff/m9`).set({ name: 'Mo Diaz', role: 'manager', isActive: true });
  const key = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Window', kind: 'drive-thru' }))).body.key;
  const P = (b: any) => POST(req({ tenantId: 't1', key, ...b })) as Promise<any>;
  const passOf = async (id: string, name: string) => { const { createHash, randomBytes } = await import('crypto'); const pass = randomBytes(24).toString('hex'); const h = createHash('sha256').update(key).digest('hex');
    await db.doc(`kitchenScreens/${h}`).set({ passes: { [createHash('sha256').update(pass).digest('hex')]: { id, name, exp: Date.now() + 3600000 } } }, { merge: true }); return pass; };
  const mpass = await passOf('m9', 'Mo Diaz');
  const start = async (n: string) => (await P({ action: 'car', carKey: `comp-${n}` })).body.orderId as string;
  const lines = async (id: string) => (await get(`${T}/counterOrders/${id}`)).lines || [];




  const C = await import('../../src/lib/counter-comp');
  const order = (id: string) => get(`${T}/counterOrders/${id}`);
  const lineOf = async (id: string, itemId: string, comp = false) => (await lines(id)).find((l: any) => l.itemId === itemId && !!l.comp === comp);

  console.log('the rules');
  check('how it reads, and the reasons offered', C.compWords({ comp: { reason: 'Long wait' } }) === 'On the house: Long wait' && C.compWords({}) === '' && C.COMP_REASONS.includes('Made wrong'));

  console.log('while it’s being taken');
  const o1 = await start('a');
  await P({ action: 'add', orderId: o1, itemId: 'chips', quantity: 3, tapKey: 'tap-comp-0001' });
  const chips = (await lineOf(o1, 'chips')).lineId;
  let r = await P({ action: 'comp', orderId: o1, lineId: chips, qty: 1, reason: 'Long wait' });
  check('a manager’s: without one, it asks', r.status === 403 && r.body.needsManager === true && (await lines(o1)).length === 1, r.body);
  r = await P({ action: 'comp', orderId: o1, lineId: chips, qty: 1, reason: ' ', staffPass: mpass });
  check('…and why', r.status === 400 && r.body.code === 'reason', r.body);
  r = await P({ action: 'comp', orderId: o1, lineId: chips, qty: 1, reason: 'Long wait', staffPass: mpass });
  let od = await order(o1); let free = await lineOf(o1, 'chips', true); let paidL = await lineOf(o1, 'chips');
  check('one of three on the house: split off at $0, its price and why kept, okayed by the manager', r.body.ok && r.body.cents === 200 && free.quantity === 1 && free.unitPrice === 0 && free.comp.from === 2 && free.comp.reason === 'Long wait' && free.comp.approvedBy === 'Mo Diaz' && paidL.quantity === 2 && paidL.lineId === chips, [r.body, od.lines]);
  check('…the money: $4 of chips and its tax', od.subtotal === 4 && od.tax === 0.4 && od.total === 4.4 && od.comps?.length === 1, [od.subtotal, od.tax, od.total]);
  r = await P({ action: 'qty', orderId: o1, lineId: free.lineId, quantity: 2, tapKey: 'tap-comp-0002' });
  check('more on the house takes another okay', r.status === 409 && (await lineOf(o1, 'chips', true)).quantity === 1, r.body);
  await P({ action: 'add', orderId: o1, itemId: 'chips', quantity: 1, tapKey: 'tap-comp-0003' });
  check('another from the menu joins the line that’s charged for, not the free one', (await lineOf(o1, 'chips')).quantity === 3 && (await lineOf(o1, 'chips', true)).quantity === 1);
  r = await P({ action: 'uncomp', orderId: o1, lineId: free.lineId });
  od = await order(o1);
  check('charged for again: its price again (no manager needed)', r.body.ok && !(await lineOf(o1, 'chips', true)) && od.subtotal === 8 && od.comps[0].undoneAt, [r.body, od.subtotal]);

  console.log('with the kitchen');
  await P({ action: 'add', orderId: o1, itemId: 'burger', quantity: 2, tapKey: 'tap-comp-0004' });
  await P({ action: 'send', orderId: o1 }); await P({ action: 'discount', orderId: o1, discountId: 'ten' });
  const burger = (await lineOf(o1, 'burger')).lineId;
  r = await P({ action: 'comp', orderId: o1, lineId: burger, qty: 1, reason: 'Made wrong', staffPass: mpass });
  check('sent: the whole line or none', r.status === 409 && r.body.code === 'whole', r.body);
  const bun0 = (await get(`${T}/inventory/bun`)).totalStock;
  r = await P({ action: 'comp', orderId: o1, lineId: burger, qty: 2, reason: 'Made wrong', staffPass: mpass });
  od = await order(o1);
  check('both burgers on the house: their $20 off, the 10% on what’s left, still made (their buns stay used)', r.body.ok && od.subtotal === 7.2 && od.markdown.cents === 80 && od.total === 7.92 && (await get(`${T}/inventory/bun`)).totalStock === bun0 && (await lineOf(o1, 'burger', true)).lineId === burger, [od.subtotal, od.markdown, od.total]);
  r = await P({ action: 'comp', orderId: o1, lineId: burger, qty: 2, reason: 'Again', staffPass: mpass });
  check('on the house already: said so', r.status === 409 && r.body.code === 'already', r.body);

  console.log('paid');
  r = await P({ action: 'paid', orderId: o1, method: 'card' });
  od = await order(o1);
  const RC = await import('../../src/lib/counter-receipt');
  const rec = RC.counterReceipt(od, o1);
  check("the receipt says it was on the house, at $0", rec.detail.lines.some((l: any) => /Burger, on the house/.test(l.label) && l.amount === 0), rec.detail.lines);
  r = await P({ action: 'comp', orderId: o1, lineId: (await lineOf(o1, 'chips')).lineId, qty: 3, reason: 'Late', staffPass: mpass });
  check('paid already: a refund instead', r.status === 409 && r.body.code === 'paid', r.body);
  r = await P({ action: 'refundPreview', orderId: o1, all: false, lines: [{ lineId: burger, qty: 1 }], reason: 'Wrong order' });
  check('…and refunding what was on the house gives nothing back', !r.body.ok || r.body.plan?.cents === 0, r.body);

  const route = src('src/app/api/counter/route.ts');
  check('the guest’s screens say it’s on the house (never why or who okayed it)', (route.match(/\.\.\.\(l\.comp \? \{ comp: true \} : \{\}\)/g) || []).length === 3
    && ['board', 'window', 'guest'].every((f) => /On the house(<\/|'\)\}<\/)/.test(src(`src/app/drive-thru/[tenantId]/${f}/page.tsx`))) && /lastPrice: num\(l\.comp\?\.from \?\? l\.unitPrice\)/.test(src('src/lib/counter-server.ts')));
  console.log('the night report and the screens');
  const night = src('src/lib/night-close-server.ts');
  check('the night report counts what was given at the counter and the window, as comps, by why', /adjustments\.push\(\{ kind: 'comp', amount: Math\.round\(num\(l\.comp\.from\) \* num\(l\.quantity\) \* 100\) \/ 100, reason:/.test(night));
  const counter = src('src/app/(app)/counter/page.tsx'), window = src('src/app/drive-thru/[tenantId]/page.tsx'), sheet = src('src/components/pos/CounterComp.tsx');
  check('“On the house” and “Charge for it” on each line, at the counter and the window', counter.includes('<CompSheet') && window.includes('<CompSheet') && counter.includes('Charge for it') && window.includes('Charge for it') && counter.includes('const canComp = ') && window.includes('const canComp = '));
  check('the sheet: why, how many while it’s being taken, a manager’s PIN', sheet.includes('COMP_REASONS') && sheet.includes('Something else') && sheet.includes('PinPad') && sheet.includes('whole'));
  const mine = sheet + src('src/lib/counter-comp-server.ts') + src('src/lib/counter-comp.ts');
  check('house style', !/ · |\buppercase\b|font-black|\{\/\*/.test(mine) && !/[Ss]alon|[Ss]tylist|\bbooth\b|\bchair\b|[Ss]tudio/.test(mine));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
