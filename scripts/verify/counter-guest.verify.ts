// Checks the guest screen at the counter (app/drive-thru/[tenantId]/guest; api/counter 'show', 'guest', 'guestTip').
// - The counter says which order it's on; the screen facing the guest shows it as it's rung, then its total and the
//   business's tips (one of them or none, picked there, once), then thank you, change and a code for the receipt.
// - Its key only shows: it can't pay, or choose what it shows; a drive-thru screen can't put orders on it.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/counter-guest.verify.ts
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
  await db.doc(T).set({ name: 'Linden Coffee', timezone: 'UTC', retailSettings: { taxRatePercent: 10 }, salesTax: { configured: true }, counterTips: { on: true, pcts: [15, 18, 20] } });
  await db.doc(`${T}/inventory/latte`).set({ type: 'refreshment', name: 'Oat latte', category: 'Coffee', price: 5, totalStock: 200 });
  await db.doc(`${T}/tillSessions/till1`).set({ status: 'open', expectedCash: 100, totalCashSales: 0 });
  const gkey = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Guest screen', kind: 'drive-thru-board', guest: true }))).body.key;
  const bkey = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Ready board', kind: 'drive-thru-board' }))).body.key;
  const lkey = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Window', kind: 'drive-thru' }))).body.key;
  const C = (b: any) => POST(req({ tenantId: 't1', channel: 'counter', ...b })) as Promise<any>;
  const G = (b: any) => POST(req({ tenantId: 't1', key: gkey, ...b })) as Promise<any>;

  console.log('nothing on it yet');
  let r = await G({ action: 'guest' });
  check('a welcome: no order shown', r.body.ok && r.body.show === null && r.body.business.name === 'Linden Coffee', r.body);

  console.log('the order as it’s rung');
  const c = (await C({ action: 'car', carKey: 'guest-car-0001' })).body; const oid = c.orderId;
  await C({ action: 'show', orderId: oid });
  await C({ action: 'add', orderId: oid, itemId: 'latte', quantity: 2, tapKey: 'guest-tap-0001' });
  r = await G({ action: 'guest' });
  check('the counter’s order, as it’s rung: its lines and what it comes to so far, no tip asked yet', r.body.show?.mode === 'ringing' && r.body.show.lines.length === 1 && r.body.show.lines[0].quantity === 2 && r.body.show.total === 11 && r.body.show.tips === null, r.body.show);

  console.log('the tip, on the guest’s screen');
  await C({ action: 'send', orderId: oid });
  r = await G({ action: 'guest' });
  check('sent: the total, and the business’s three tips on what it comes to', r.body.show?.mode === 'pay' && r.body.show.tips?.length === 3 && r.body.show.tips[0].pct === 15 && r.body.show.tips[0].cents === 165, r.body.show);
  r = await G({ action: 'guestTip', orderId: oid, cents: 999 });
  check('only one of the tips shown (or none)', r.status === 400, r.body);
  r = await G({ action: 'guestTip', orderId: 'someoneelse', cents: 165 });
  check('only on the order shown', r.status === 409, r.body);
  r = await G({ action: 'guestTip', orderId: oid, cents: 198 });
  let o = await get(`${T}/counterOrders/${oid}`);
  check('picked: on the order, its total with it, kept as the guest’s', r.body.ok && o.tipCents === 198 && o.total === 12.98 && o.tipChosenBy === 'guest', [r.body, o.tipCents, o.total]);
  r = await G({ action: 'guest' });
  check('…not asked again; the total shows it', r.body.show.tips === null && r.body.show.tip === 1.98 && r.body.show.total === 12.98, r.body.show);
  r = await G({ action: 'guestTip', orderId: oid, cents: 0 });
  check('…and can’t be changed from there once picked', r.status === 409, r.body);

  console.log('what the guest screen can’t do');
  r = await G({ action: 'paid', orderId: oid, method: 'cash' });
  const r2 = await G({ action: 'show', orderId: oid });
  check('it can only show (and take the tip): paying or choosing what it shows is refused', r.status === 401 && r2.status === 401, [r.body, r2.body]);
  const rb = await POST(req({ tenantId: 't1', key: bkey, action: 'guest' })) as any; const rb2 = await POST(req({ tenantId: 't1', key: bkey, action: 'guestTip', orderId: oid, cents: 0 })) as any;
  check('another showing screen (a ready board on the wall) can’t read it or pick its tip', rb.status === 401 && rb2.status === 401, [rb.body, rb2.body]);
  r = await POST(req({ tenantId: 't1', key: lkey, action: 'show', orderId: oid })) as any;
  check('the drive-thru’s screen doesn’t put orders on the counter’s guest screen', r.status === 409, r.body);

  console.log('a tip the cashier typed, and two taps at once');
  const c2 = (await C({ action: 'car', carKey: 'guest-car-0002' })).body; const o2 = c2.orderId;
  await C({ action: 'show', orderId: o2 }); await C({ action: 'add', orderId: o2, itemId: 'latte', quantity: 1, tapKey: 'guest-tap-0002' }); await C({ action: 'send', orderId: o2 });
  await C({ action: 'tip', orderId: o2, cents: 200 });
  r = await G({ action: 'guest' });
  check('a tip on it already: not asked on the guest’s screen', r.body.show?.mode === 'pay' && r.body.show.tips === null, r.body.show);
  await C({ action: 'tip', orderId: o2, cents: 0 });
  r = await G({ action: 'guest' }); const pick = r.body.show.tips?.[0]?.cents;
  const [t1, t2] = await Promise.all([G({ action: 'guestTip', orderId: o2, cents: pick }), G({ action: 'guestTip', orderId: o2, cents: 0 })]);
  const o2d = await get(`${T}/counterOrders/${o2}`);
  check('two taps at once: one lands, the other is refused', [t1, t2].filter((x: any) => x.body.ok).length === 1 && (o2d.tipCents === pick || o2d.tipCents === 0) && o2d.tipChosenBy === 'guest', [t1.body, t2.body, o2d.tipCents]);
  await db.doc(`${T}/counterGuest/main`).set({ at: new Date(Date.now() - 4 * 60000).toISOString() }, { merge: true });
  r = await G({ action: 'guest' });
  check('the counter not saying it’s on the order for a few minutes: it drops off the guest’s screen', r.body.show === null, r.body.show);
  await C({ action: 'show', orderId: oid });

  console.log('paid');
  await C({ action: 'paid', orderId: oid, method: 'cash', tendered: 20 });
  r = await G({ action: 'guest' });
  check('thank you, their change, and a code for their receipt', r.body.show?.mode === 'thanks' && r.body.show.change === 7.02 && /\/r\/t1\/co_/.test(String(r.body.show.receiptUrl)), r.body.show);
  const again = await G({ action: 'guest' });
  check('…the receipt’s link made once', again.body.show.receiptUrl === r.body.show.receiptUrl && (await get(`${T}/counterGuest/main`)).receiptFor === oid);

  console.log('the screens');
  const page = src('src/app/(app)/counter/page.tsx'), gs = src('src/app/drive-thru/[tenantId]/guest/page.tsx');
  check('the counter says which order it’s on (every minute while it’s open), and links the guest screen', page.includes("void post({ action: 'show', orderId: id })") && page.includes('.catch(() => null), 60000);') && page.includes('>Open the guest screen</a>'));
  check('the guest screen: welcome, the order as it’s rung, the tip, thank you and the receipt code', gs.includes('Your order shows here as it’s rung up.') && gs.includes('Add a tip?') && gs.includes('>No tip</button>') && gs.includes('Scan for your receipt') && gs.includes('<ScreenSetup guest'));
  check('house style', !/ · |\buppercase\b|font-black|\{\/\*/.test(gs) && !/[Ss]alon|[Ss]tylist|\bbooth\b|\bchair\b/.test(gs));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
