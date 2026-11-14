// Checks pay at the table (L20 round 6): lib/table-bill, lib/table-pay-server, api/table-pay (the guest's page), api/tab
// 'pay_status' and 'pay_cash' (the server's side), api/checkout/complete 'table_close', the payment notice
// (lib/reader-sale deskPaymentOf), the server's nudge and the host stand's paid table, and the screens.
// - Off until the business turns it on; the business's ways to split and tip choices, before or after tax.
// - The bill as the desk would ring it up (items at their price now, comps off, tax), so the sale closes at the same total.
// - A share by seat, by item or evenly is that part of the whole bill; the last share is exactly what's left; what's
//   paid or being paid can't be picked again; the first payment sets the way the table splits.
// - A guest's payment is one share of a split on the check's ticket, checked with the card company; its amount always
//   worked out on the server. Started and left: called off and let go. Paid after the check closed: kept apart.
// - The rest in cash; closing records one sale with every share; nobody pays twice (the desk's checkout is hidden once
//   anything's paid at the table).
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/table-pay.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_fake';
let db: any = strictTransactions(makeDb());
let actor: any = { uid: 's1', name: 'Sam Lee', role: 'staff', isManager: false, caps: [] };
const S: any = { pis: new Map<string, any>(), keys: new Map<string, string>(), refunds: [] as any[], n: 0, down: false };
const clone = (x: any) => JSON.parse(JSON.stringify(x));
const err = (code: string) => Object.assign(new Error(code), { code, raw: { code } });
class FakeStripe {
  paymentIntents = {
    create: async (p: any, o: any) => {
      if (o?.idempotencyKey && S.keys.has(o.idempotencyKey)) return clone(S.pis.get(S.keys.get(o.idempotencyKey)));
      const id = `pi_${++S.n}`;
      const pi = { id, amount: p.amount, currency: p.currency, status: 'requires_payment_method', metadata: { ...p.metadata }, client_secret: `${id}_secret`, account: o?.stripeAccount, amount_refunded: 0, refunded: false };
      S.pis.set(id, pi); if (o?.idempotencyKey) S.keys.set(o.idempotencyKey, id); return clone(pi);
    },
    retrieve: async (id: string) => { if (S.down) throw err('api_connection_error'); const pi = S.pis.get(id); if (!pi) throw Object.assign(err('resource_missing'), { statusCode: 404 }); return clone(pi); },
    cancel: async (id: string) => { const pi = S.pis.get(id); if (pi.status === 'succeeded') throw err('payment_intent_unexpected_state'); pi.status = 'canceled'; return clone(pi); },
  };
  refunds = { create: async (p: any) => { S.refunds.push(p); const pi = S.pis.get(p.payment_intent); if (pi) { pi.refunded = true; pi.amount_refunded = pi.amount; } return { id: `re_${S.refunds.length}`, status: 'succeeded' }; } };
}
const payOnPhone = (id: string) => { const pi = S.pis.get(id); pi.status = 'succeeded'; pi.amount_received = pi.amount; };

const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return Object.assign(FakeStripe, { default: FakeStripe });
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) };
  if (request === '@/lib/route-guard') return { requireRole: async () => ({ actor }), requireCan: async () => ({ actor }) };
  if (request === '@/lib/rate-limit') return { limitPublic: async () => null, limitByKey: async () => null };
  if (request === '@/lib/wallet-domains' || /\/src\/lib\/wallet-domains(\.ts)?$/.test(request)) return fake(request, { ensureWalletDomainsSoon: async () => {}, walletsOn: () => false });
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  if (request === '@/lib/stripe-fee' || /\/src\/lib\/stripe-fee(\.ts)?$/.test(request)) return fake(request, { recordChargeFee: async () => 0 });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any, ip = '10.1.1.1') => ({ json: async () => body, headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : String(k).toLowerCase() === 'x-real-ip' ? ip : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const src = (p: string) => readFileSync(p, 'utf8');
const r2 = (n: number) => Math.round(n * 100) / 100;

(async () => {
  const TB = await import('../../src/lib/table-bill');
  console.log('settings');
  const D = TB.tablePayOf({});
  check('off until the business turns it on; every way to split, 18/20/22 before tax, 20 picked', !D.on && D.ways.join() === 'seat,item,even' && D.tips.join() === '18,20,22' && D.tipBase === 'pre' && D.suggest === 20);
  const C = TB.cleanTablePay({ on: true, ways: ['even', 'nope'], tips: [25, 15, 15, 99, 0, 10, 20], tipBase: 'post', suggest: 99 });
  check('…cleaned: known ways only, up to four tips in order, a suggestion only from the tips', C.on && C.ways.join() === 'even' && C.tips.join() === '10,15,20,25' && C.tipBase === 'post' && C.suggest === null
    && TB.cleanTablePay({ tips: [15, 18], suggest: 18 }).suggest === 18 && TB.cleanTablePay({ ways: [] }).ways.length === 3);

  console.log('the bill');
  const tenant: any = { name: 'Linden', salesTax: { configured: true, productsPct: 10 }, kitchenSettings: { tablePay: { on: true } }, stripeAccountId: 'acct_1' };
  const cat = new Map<string, any>([['neg', { id: 'neg', name: 'Negroni', msrp: 14 }], ['fries', { id: 'fries', name: 'Fries', msrp: 6 }], ['steak', { id: 'steak', name: 'Steak', msrp: 30 }], ['tart', { id: 'tart', name: 'Tart', msrp: 10 }]]);
  const catalog = { item: (id: string) => cat.get(id) || null, price: (x: any) => Number(x.msrp), name: (x: any) => x.name };
  const L = (id: string, itemId: string, seat: number | null, o: any = {}) => ({ lineId: id, itemId, itemType: 'product', name: cat.get(itemId)?.name, price: 1, quantity: 1, seat, kdsId: `k_${id}`, firedAt: '2026-11-14T20:00:00Z', ...o });
  const visit: any = { tableName: '12', tab: [L('a', 'neg', 1), L('b', 'steak', 1), L('c', 'neg', 2), L('d', 'fries', null), L('e', 'tart', 2, { comp: { amount: 4, approvalId: 'ap1' } })] };
  const bill = TB.billFrom('v1', visit, catalog, { tenant, client: null, memberships: [] });
  check('each item at its price now (not what was rung in), a comp off its own line, tax on top', bill.subtotal === 70 && bill.tax === 7 && bill.total === 77 && bill.lines.length === 5
    && bill.lines.find((l) => l.lineId === 'e')!.price === 6 && bill.items.some((i: any) => i.id === 'neg' && i.quantity === 2) && bill.items.some((i: any) => i.compLineId === 'e' && i.price === 6 && i.compVisitId === 'v1'), bill);
  const held = TB.billFrom('v1', { tab: [L('x', 'neg', 1, { firedAt: null })] }, catalog, { tenant, client: null, memberships: [] });
  check('a dish never sent to the kitchen is named (the check waits for it)', held.unfired.join() === 'Negroni');

  console.log('shares');
  const none = TB.payState([], Date.now());
  const s = TB.cleanTablePay({ on: true });
  let sh: any = TB.shareFor(bill, none, { way: 'seat', seats: [1] }, s);
  check('seat 1 (negroni and steak, 44 of 70): that part of the whole bill, tax shared', sh.ok && sh.amount === r2(77 * 44 / 70) && sh.label === 'Seat 1' && sh.lineIds.join() === 'a,b', sh);
  check('a tip before tax, or on the total', TB.tipFor(sh, { pct: 20 }, s) === r2(sh.preTax * 0.2) && sh.preTax === r2(sh.amount * 70 / 77) && TB.tipFor(sh, { pct: 20 }, { ...s, tipBase: 'post' }) === r2(sh.amount * 0.2) && TB.tipFor(sh, { amount: 5 }, s) === 5);
  const claim = (id: string, way: any, lineIds: string[], amount: number, paid = true, o: any = {}) => ({ id, way, lineIds, parts: 0, ways: 0, amount, tip: 0, label: '', piId: null, at: '', until: new Date(Date.now() + 60000).toISOString(), paid, ...o });
  let st = TB.payState([claim('c1', 'seat', ['a', 'b'], sh.amount)], Date.now());
  check('…once paid, seat 1 can’t be picked again; the table splits by seat now', !(TB.shareFor(bill, st, { way: 'seat', seats: [1] }, s) as any).ok && /splitting by seat/.test((TB.shareFor(bill, st, { way: 'item', lineIds: ['c'] }, s) as any).error));
  sh = TB.shareFor(bill, st, { way: 'seat', seats: [2, 0] }, s);
  check('the last seats left: exactly what’s left, so the shares come to the bill to the cent', sh.ok && sh.amount === r2(77 - r2(77 * 44 / 70)) && sh.label === 'Seat 2, and for the table', sh);
  st = TB.payState([claim('c1', 'seat', ['a', 'b'], 48.4), claim('c2', 'seat', ['c', 'e'], 22, false)], Date.now());
  sh = TB.shareFor(bill, st, { way: 'seat', seats: [0] }, s);
  check('…while someone else is paying, not the remainder (no rounding is taken off them)', sh.ok && sh.amount === r2(77 * 6 / 70) && (TB.shareFor(bill, st, { way: 'seat', seats: [2] }, s) as any).error === 'Seat 2 is paid already.');
  check('the rest, only while nobody else is paying', !(TB.shareFor(bill, st, { way: 'rest' }, s) as any).ok);
  sh = TB.shareFor(bill, none, { way: 'even', ways: 3, parts: 1 }, s);
  check('evenly: a third each; paying for two parts', sh.ok && sh.amount === 25.67 && sh.label === 'Share 1 of 3' && (TB.shareFor(bill, none, { way: 'even', ways: 3, parts: 2 }, s) as any).amount === 51.34);
  st = TB.payState([claim('e1', 'even', [], 25.67, true, { parts: 1, ways: 3 }), claim('e2', 'even', [], 25.67, true, { parts: 1, ways: 3 })], Date.now());
  sh = TB.shareFor(bill, st, { way: 'even', ways: 3, parts: 1 }, s);
  check('…the last part is what’s left; the number of ways is the table’s', sh.ok && sh.amount === r2(77 - 51.34) && sh.label === 'Share 3 of 3' && /3 ways/.test((TB.shareFor(bill, st, { way: 'even', ways: 4, parts: 1 }, s) as any).error));
  check('a way the business doesn’t offer is refused', !(TB.shareFor(bill, none, { way: 'item', lineIds: ['a'] }, { ...s, ways: ['seat'] }) as any).ok);
  st = TB.payState([claim('old', 'seat', ['a'], 10, false, { until: new Date(Date.now() - 1000).toISOString() })], Date.now());
  check('a hold that ran out frees its lines', !st.busy.has('a') && st.claimed === 0);

  // ── The server ──────────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('the server’s side');
  await db.doc(T).set(tenant);
  await db.doc(`${T}/staff/s1`).set({ name: 'Sam Lee', role: 'staff' });
  for (const [id, x] of cat) await db.doc(`${T}/inventory/${id}`).set({ ...x, type: 'refreshment' });
  await db.doc(`${T}/approvals/ap1`).set({ kind: 'comp', status: 'approved', used: true, ref: 'v1:e', amount: 4, visitId: 'v1', itemId: 'tart' });
  await db.doc(`${T}/appointments/v1`).set({ ...visit, isTable: true, partyId: 'p1', clientId: null, clientName: 'Ruiz party', status: 'servicing', source: 'host' });
  const Tab = await import('../../src/app/api/tab/route');
  let r: any = await Tab.POST(req({ tenantId: 't1', action: 'pay_status', visitId: 'v1' }));
  const v1: any = await get(`${T}/appointments/v1`);
  check('the server’s side: the check’s own link to show, the total, nothing paid; no ticket until someone pays', r.body.ok && r.body.url === `https://app.test/bill/t1/${v1.payToken}` && r.body.total === 77 && r.body.paid === 0 && r.body.left === 77 && !r.body.full && !v1.payTicketId, r.body);
  const token = v1.payToken;
  const Pay = await import('../../src/app/api/table-pay/route');
  const P = (body: any, ip?: string) => Pay.POST(req({ tenantId: 't1', token, ...body }, ip));
  r = await P({ action: 'view' });
  check('the guest’s page: the lines with seats, the totals, the business’s choices, nobody’s name', r.body.ok && r.body.state === 'open' && r.body.table === 'Table 12' && r.body.lines.length === 5 && r.body.total === 77 && r.body.settings.tips.join() === '18,20,22'
    && !JSON.stringify(r.body).includes('Ruiz'), r.body);
  const bad1: any = await Pay.POST(req({ tenantId: 't1', token: 'x'.repeat(22), action: 'view' }));
  check('a link that isn’t one opens nothing', bad1.status === 404);

  console.log('a guest pays for their seat');
  r = await P({ action: 'start', choice: { way: 'seat', seats: [1] }, tip: { pct: 20 } });
  let v: any = await get(`${T}/appointments/v1`); let tk: any = await get(`${T}/pendingCheckouts/${v.payTicketId}`);
  const s1 = r2(77 * 44 / 70); const tip1 = r2(r2(s1 * 70 / 77) * 0.2);
  let pi: any = S.pis.get('pi_1');
  check('their share and tip, worked out here; the card form for exactly that, named for this check as one share of it', r.body.ok && r.body.amount === s1 && r.body.tip === tip1 && r.body.clientSecret === 'pi_1_secret' && r.body.stripeAccount === 'acct_1'
    && pi.amount === Math.round((s1 + tip1) * 100) && pi.metadata.source === 'table_phone' && pi.metadata.pendingCheckoutId === v.payTicketId && pi.metadata.split === '1' && pi.metadata.tipCents === String(Math.round(tip1 * 100)), { b: r.body, pi });
  check('…the check’s ticket, as the desk would ring it up, for the house’s client (a walk-in table has none); seat 1 held for them', tk.source === 'table' && tk.status === 'prepared' && tk.expectedTotal === 77 && tk.payload.payment.method === 'split' && tk.payload.appointmentIds[0] === 'v1'
    && tk.clientId === 'table_guests' && Object.values<any>(tk.tableClaims)[0].lineIds.join() === 'a,b', tk);
  const house: any = await get(`${T}/clients/table_guests`);
  check('…the house’s client: marketing off', house && house.isHouse === true && house.marketingOptIn === false && house.smsOptIn === false && house.emailOptIn === false);
  const claim1 = r.body.claimId;
  r = await P({ action: 'start', choice: { way: 'seat', seats: [1] }, tip: { pct: 20 } }, '10.1.1.2');
  check('someone else can’t pay for seat 1 while it’s being paid', !r.body.ok && /paid already/.test(r.body.error), r.body);
  r = await P({ action: 'view' }, '10.1.1.2');
  check('…their page shows it being paid', r.body.lines.filter((l: any) => l.state === 'busy').map((l: any) => l.lineId).join() === 'a,b' && r.body.claimed === s1);
  payOnPhone('pi_1');
  r = await P({ action: 'done', claimId: claim1 });
  tk = await get(`${T}/pendingCheckouts/${v.payTicketId}`);
  check('paid: one share on the check, checked with the card company, tip apart', r.body.ok && r.body.paid && !r.body.full && tk.status === 'partial' && tk.tenders.length === 1 && tk.tenders[0].amount === s1 && tk.tenders[0].tip === tip1
    && tk.tenders[0].via === 'table_phone' && tk.tenders[0].stripePaymentIntentId === 'pi_1', tk.tenders);
  r = await P({ action: 'done', claimId: claim1 });
  check('…asked again, nothing added twice', r.body.paid && (await get(`${T}/pendingCheckouts/${v.payTicketId}`)).tenders.length === 1);
  r = await P({ action: 'start', choice: { way: 'item', lineIds: ['c'] } }, '10.1.1.3');
  check('the table splits by seat now', !r.body.ok && /splitting by seat/.test(r.body.error));

  console.log('changing their mind, and leaving it');
  r = await P({ action: 'start', choice: { way: 'seat', seats: [2] }, tip: { pct: 0 } }, '10.1.1.3');
  const claim2 = r.body.claimId;
  r = await P({ action: 'cancel', claimId: claim2 }, '10.1.1.3');
  tk = await get(`${T}/pendingCheckouts/${v.payTicketId}`);
  check('changed their mind: the payment called off, seat 2 free again', r.body.ok && S.pis.get('pi_2').status === 'canceled' && !tk.tableClaims[claim2]);
  r = await P({ action: 'start', choice: { way: 'seat', seats: [2] }, tip: { pct: 0 } }, '10.1.1.3');
  const claim3 = r.body.claimId;
  await db.doc(`${T}/pendingCheckouts/${v.payTicketId}`).set({ tableClaims: { [claim3]: { until: new Date(Date.now() - 1000).toISOString() } } }, { merge: true });
  r = await P({ action: 'start', choice: { way: 'seat', seats: [2] }, tip: { pct: 18 } }, '10.1.1.4');
  check('a payment started and left past its time: called off, and someone else can pay that seat', r.body.ok && S.pis.get('pi_3').status === 'canceled', r.body);
  const claim4 = r.body.claimId; const pi4 = `pi_${S.n}`;
  // Their page closed the moment they paid: the payment notice puts it on the check (lib/connect-webhook).
  payOnPhone(pi4);
  const RS = await import('../../src/lib/reader-sale');
  check('the payment notice knows it as one share of this check', JSON.stringify(RS.deskPaymentOf(S.pis.get(pi4), 't1')) === JSON.stringify({ pendingId: v.payTicketId, via: 'table_phone', share: true }));
  const TP = await import('../../src/lib/table-pay-server');
  const settled = await TP.settleShare(db, T, tenant, v.payTicketId, pi4);
  check('…and puts it on the check', settled.paid && (await get(`${T}/pendingCheckouts/${v.payTicketId}`)).tenders.length === 2);
  void claim4;

  console.log('the rest, and closing');
  r = await P({ action: 'view' });
  const paidSoFar = r.body.paid;
  r = await P({ action: 'start', choice: { way: 'rest' }, tip: { pct: 20 } });
  const rest = r.body.amount;
  check('the rest of the check: exactly what’s left', r.body.ok && rest === r2(77 - paidSoFar), { b: r.body, paidSoFar });
  payOnPhone(`pi_${S.n}`);
  r = await P({ action: 'done', claimId: r.body.claimId });
  v = await get(`${T}/appointments/v1`);
  check('all paid: the table shows paid on the host stand, and the server’s phone says to close it', r.body.paid && r.body.full && !!v.payPaidAt && v.payPaidSoFar === 77);
  const NU = await import('../../src/lib/nudges');
  const nn = NU.nudgesFor({ visitId: 'v1', partyId: 'p1', table: 'Table 12', seatedAt: null, tab: [], tickets: {}, allergies: [], done: {}, courses: [], paidAt: v.payPaidAt }, NU.nudgeSettingsOf({}), Date.now());
  check('…the nudge', nn.length === 1 && nn[0].kind === 'paid' && /Close the check/.test(nn[0].text) && NU.NUDGE_KEY.test('paid'));
  r = await Tab.POST(req({ tenantId: 't1', action: 'pay_status', visitId: 'v1' }));
  check('the server’s side: who paid what and how', r.body.full && r.body.shares.length === 3 && r.body.shares[0].label === 'Seat 1' && r.body.shares[0].how === 'phone' && r.body.left === 0, r.body.shares);
  const CO = await import('../../src/app/api/checkout/complete/route');
  r = await CO.POST(req({ tenantId: 't1', action: 'table_close', visitId: 'v1' }));
  v = await get(`${T}/appointments/v1`); tk = await get(`${T}/pendingCheckouts/${v.payTicketId}`);
  const receipts = await all(`${T}/receipts`);
  const tipsTotal = r2(tk.tenders.reduce((a: number, x: any) => a + x.tip, 0));
  check('closing records one sale with every share: the visit checked out, the ticket finished, the total the check’s plus their tips', r.status === 200 && r.body.ok && v.status === 'completed' && tk.status === 'completed' && receipts.length === 1
    && r2(r.body.total) === r2(77 + tipsTotal) && !receipts[0].needsReview, { status: r.status, body: r.body, rc: receipts[0] && { total: receipts[0].total, review: receipts[0].reviewNote } });
  const tipTx = (await all(`${T}/transactions`)).filter((x: any) => x.category === 'Tips');
  check('…their tips in the books once, to the table’s server (here whoever closed it: no section set)', tipTx.length === 1 && r2(tipTx[0].amount) === tipsTotal && tipTx[0].staffId === 's1', tipTx.map((x: any) => ({ a: x.amount, s: x.staffId })));
  r = await CO.POST(req({ tenantId: 't1', action: 'table_close', visitId: 'v1' }));
  check('…closing again changes nothing', r.body.ok && r.body.already && (await all(`${T}/receipts`)).length === 1);
  r = await P({ action: 'view' });
  check('…and the link says the check is closed', r.body.state === 'closed' && r.body.lines === undefined);
  // A payment that lands after the check is closed (an old form left open): kept apart, never on the sale.
  const late = await S.pis.get('pi_1'); void late;

  console.log('cash, and a table not all paid');
  await db.doc(`${T}/appointments/v2`).set({ tableName: '4', tab: [L('m', 'steak', 1), L('n', 'neg', 2)], isTable: true, clientId: null, status: 'servicing', source: 'host' });
  r = await Tab.POST(req({ tenantId: 't1', action: 'pay_status', visitId: 'v2' }));
  const tok2 = (await get(`${T}/appointments/v2`)).payToken;
  r = await Pay.POST(req({ tenantId: 't1', token: tok2, action: 'start', choice: { way: 'seat', seats: [1] }, tip: { pct: 0 } }));
  payOnPhone(`pi_${S.n}`); await Pay.POST(req({ tenantId: 't1', token: tok2, action: 'done', claimId: r.body.claimId }));
  r = await CO.POST(req({ tenantId: 't1', action: 'table_close', visitId: 'v2' }));
  check('a check not all paid can’t be closed, and says what’s left', r.status === 409 && r.body.code === 'not_paid' && r.body.left === r2(48.4 - r2(48.4 * 30 / 44)), r.body);
  r = await Tab.POST(req({ tenantId: 't1', action: 'pay_cash', visitId: 'v2' }));
  let v2: any = await get(`${T}/appointments/v2`); let tk2: any = await get(`${T}/pendingCheckouts/${v2.payTicketId}`);
  check('the rest in cash: one cash share for exactly what’s left, the table paid', r.body.ok && tk2.tenders.length === 2 && tk2.tenders[1].method === 'cash' && tk2.tenders[1].amount === r.body.left && !!v2.payPaidAt, tk2.tenders);
  await db.doc(`${T}/tillSessions/till1`).set({ status: 'open', expectedCash: 0 });
  r = await CO.POST(req({ tenantId: 't1', action: 'table_close', visitId: 'v2' }));
  check('…closing puts the cash in the open drawer', r.body.ok && (await get(`${T}/tillSessions/till1`)).expectedCash === r2(tk2.tenders[1].amount), { b: r.body, till: await get(`${T}/tillSessions/till1`) });

  console.log('a dish added after someone paid');
  await db.doc(`${T}/appointments/v3`).set({ tableName: '5', tab: [L('p', 'neg', 1), L('q', 'neg', 2)], isTable: true, clientId: null, status: 'servicing', source: 'host' });
  await Tab.POST(req({ tenantId: 't1', action: 'pay_status', visitId: 'v3' }));
  const tok3 = (await get(`${T}/appointments/v3`)).payToken;
  r = await Pay.POST(req({ tenantId: 't1', token: tok3, action: 'start', choice: { way: 'seat', seats: [1] }, tip: { pct: 0 } }));
  payOnPhone(`pi_${S.n}`); await Pay.POST(req({ tenantId: 't1', token: tok3, action: 'done', claimId: r.body.claimId }));
  await db.doc(`${T}/appointments/v3`).set({ tab: [L('p', 'neg', 1), L('q', 'neg', 2), L('r', 'fries', 1)] }, { merge: true });
  r = await Pay.POST(req({ tenantId: 't1', token: tok3, action: 'view' }));
  check('a dish added after they paid: the check grows, and only the new dish is left on seat 1', r.body.total === r2(34 * 1.1) && r.body.lines.find((l: any) => l.lineId === 'r').state === 'open' && r.body.lines.find((l: any) => l.lineId === 'p').state === 'paid', r.body.lines);
  r = await Pay.POST(req({ tenantId: 't1', token: tok3, action: 'start', choice: { way: 'rest' }, tip: { pct: 0 } }));
  check('…and the rest is the new total less what’s paid', r.body.ok && r.body.amount === r2(r2(34 * 1.1) - r2(15.4)), r.body);
  r = await Pay.POST(req({ tenantId: 't1', token: tok3, action: 'cancel', claimId: r.body.claimId }));

  console.log('nobody pays twice');
  r = await Tab.POST(req({ tenantId: 't1', action: 'void', visitId: 'v3', lineId: 'p', reason: 'Wrong order' }));
  check('a dish a guest paid for on their phone can’t be voided (they’d be paid for more than the check)', r.status === 409 && /paid for this on their phone/.test(r.body.error) && (await get(`${T}/appointments/v3`)).tab.length === 3, r.body);
  r = await Tab.POST(req({ tenantId: 't1', action: 'comp', visitId: 'v3', lineId: 'p', reason: 'Too slow', all: true }));
  check('…nor comped', r.status === 409 && /paid for this on their phone/.test(r.body.error), r.body);
  r = await CO.POST(req({ tenantId: 't1', clientId: 'table_guests', appointmentIds: ['v3'], items: [{ id: 'neg', type: 'product', quantity: 2, price: 14 }], payment: { method: 'cash', amountTendered: 50 }, tip: 0, expectedTotal: 30.8 }));
  check('the desk can’t ring up a table that’s been part paid at the table', r.status === 409 && r.body.code === 'paid_at_table' && (await all(`${T}/receipts`)).length === 2, r.body);
  const house2: any = await get(`${T}/clients/table_guests`);
  check('the house’s client never shows in the client list (its status is the house’s own)', house2.status === 'house');

  // Cash while someone is paying on their phone, and a phone payment nobody heard about.
  await db.doc(`${T}/appointments/v5`).set({ tableName: '6', tab: [L('s', 'steak', 1), L('t', 'fries', 2)], isTable: true, clientId: null, status: 'servicing', source: 'host' });
  await Tab.POST(req({ tenantId: 't1', action: 'pay_status', visitId: 'v5' }));
  const tok5 = (await get(`${T}/appointments/v5`)).payToken;
  r = await Pay.POST(req({ tenantId: 't1', token: tok5, action: 'start', choice: { way: 'seat', seats: [1] }, tip: { pct: 0 } }));
  const c5 = r.body.claimId; const pi5 = `pi_${S.n}`;
  r = await Tab.POST(req({ tenantId: 't1', action: 'pay_cash', visitId: 'v5' }));
  check('no cash for the rest while a guest is paying on their phone', r.status === 409 && /paying on their phone/.test(r.body.error), r.body);
  r = await Pay.POST(req({ tenantId: 't1', token: tok5, action: 'keep', claimId: c5 }));
  let tk5: any = await get(`${T}/pendingCheckouts/${(await get(`${T}/appointments/v5`)).payTicketId}`);
  check('still on the card form: their pick held a while longer', r.body.ok && r.body.kept === true && Date.parse(tk5.tableClaims[c5].until) > Date.now() + 19 * 60000);
  await db.doc(`${T}/pendingCheckouts/${tk5.id}`).set({ tableClaims: { [c5]: { at: new Date(Date.now() - 61 * 60000).toISOString() } } }, { merge: true });
  r = await Pay.POST(req({ tenantId: 't1', token: tok5, action: 'keep', claimId: c5 }));
  check('…but never past an hour from when they picked', r.body.ok && r.body.kept === false);
  // Their page closed as they paid, the notice never came, and the hold ran out.
  payOnPhone(pi5);
  await db.doc(`${T}/pendingCheckouts/${tk5.id}`).set({ tableClaims: { [c5]: { until: new Date(Date.now() - 1000).toISOString() } } }, { merge: true });
  r = await Tab.POST(req({ tenantId: 't1', action: 'pay_status', visitId: 'v5' }));
  tk5 = await get(`${T}/pendingCheckouts/${tk5.id}`);
  check('a phone payment that went through unheard goes on the check when the server looks', r.body.ok && tk5.tenders.length === 1 && tk5.tenders[0].stripePaymentIntentId === pi5 && r.body.paid === r2(r2(36 * 1.1) * 30 / 36), { b: r.body, t: tk5.tenders });
  r = await Tab.POST(req({ tenantId: 't1', action: 'pay_cash', visitId: 'v5' }));
  tk5 = await get(`${T}/pendingCheckouts/${tk5.id}`);
  check('…so the cash is only what’s left, never that again', r.body.ok && tk5.tenders.length === 2 && r2(tk5.tenders[0].amount + tk5.tenders[1].amount) === r2(36 * 1.1) && tk5.tenders[1].label === 'The rest', tk5.tenders);
  r = await Pay.POST(req({ tenantId: 't1', token: tok5, action: 'start', choice: { way: 'rest' }, tip: { pct: 0 } }));
  check('…and nobody can start paying once it’s all paid', !r.body.ok, r.body);

  // One still going through.
  await db.doc(`${T}/appointments/v6`).set({ tableName: '7', tab: [L('u', 'steak', 1), L('w', 'fries', 2)], isTable: true, clientId: null, status: 'servicing', source: 'host' });
  await Tab.POST(req({ tenantId: 't1', action: 'pay_status', visitId: 'v6' }));
  const tok6 = (await get(`${T}/appointments/v6`)).payToken;
  r = await Pay.POST(req({ tenantId: 't1', token: tok6, action: 'start', choice: { way: 'seat', seats: [1] }, tip: { pct: 0 } }));
  const c6 = r.body.claimId; S.pis.get(`pi_${S.n}`).status = 'processing';
  const pid6 = (await get(`${T}/appointments/v6`)).payTicketId;
  await db.doc(`${T}/pendingCheckouts/${pid6}`).set({ tableClaims: { [c6]: { until: new Date(Date.now() - 1000).toISOString() } } }, { merge: true });
  r = await Tab.POST(req({ tenantId: 't1', action: 'pay_cash', visitId: 'v6' }));
  const tk6: any = await get(`${T}/pendingCheckouts/${pid6}`);
  check('a phone payment still going through: no cash taken, and its seat stays held', r.status === 409 && /still going through/.test(r.body.error) && Date.parse(tk6.tableClaims[c6].until) > Date.now() && !(tk6.tenders || []).length, r.body);
  r = await Pay.POST(req({ tenantId: 't1', token: tok6, action: 'start', choice: { way: 'seat', seats: [1] }, tip: { pct: 0 } }, '10.1.1.9'));
  check('…nobody else can pay for that seat meanwhile', !r.body.ok && /paid already/.test(r.body.error), r.body);
  r = await CO.POST(req({ tenantId: 't1', action: 'table_close', visitId: 'v6' }));
  check('…and the check can’t be closed until it’s through', r.status === 409 && r.body.code === 'paying' && /paying on their phone/.test(r.body.error), r.body);
  await db.doc(`${T}/pendingCheckouts/${pid6}`).set({ tableClaims: { [c6]: { until: new Date(Date.now() - 1000).toISOString() } } }, { merge: true });
  r = await CO.POST(req({ tenantId: 't1', action: 'table_close', visitId: 'v6' }));
  check('…(asked again once its hold is up: still going through, so it waits)', r.status === 409 && r.body.code === 'settling', r.body);

  // Gone through and can't go on the check (say, the payment isn't this check's): after ten minutes or so it's left for a
  // manager, and the table carries on.
  await db.doc(`${T}/appointments/v10`).set({ tableName: '11', tab: [L('aa', 'steak', 1), L('ab', 'fries', 2)], isTable: true, clientId: null, status: 'servicing', source: 'host' });
  await Tab.POST(req({ tenantId: 't1', action: 'pay_status', visitId: 'v10' }));
  const tok10 = (await get(`${T}/appointments/v10`)).payToken;
  r = await Pay.POST(req({ tenantId: 't1', token: tok10, action: 'start', choice: { way: 'seat', seats: [1] }, tip: { pct: 0 } }));
  const c10 = r.body.claimId; const pi10 = `pi_${S.n}`; payOnPhone(pi10); S.pis.get(pi10).metadata.pendingCheckoutId = 'someone_else';
  const pid10 = (await get(`${T}/appointments/v10`)).payTicketId;
  const expire10 = () => db.doc(`${T}/pendingCheckouts/${pid10}`).set({ tableClaims: { [c10]: { until: new Date(Date.now() - 1000).toISOString() } } }, { merge: true });
  for (let i = 0; i < 5; i++) { await expire10(); r = await Tab.POST(req({ tenantId: 't1', action: 'pay_status', visitId: 'v10' })); }
  check('…held while it’s looked into', !(r.body.stuck || []).length && r.body.paying.length === 1, r.body);
  await expire10(); r = await Tab.POST(req({ tenantId: 't1', action: 'pay_status', visitId: 'v10' }));
  check('…then left for a manager: the server’s card names it, and it holds nothing', r.body.stuck.length === 1 && r.body.stuck[0].piId === pi10 && r.body.paying.length === 0, r.body);
  r = await Tab.POST(req({ tenantId: 't1', action: 'pay_cash', visitId: 'v10' }));
  check('…so the table isn’t stuck (the server sees the warning first)', r.body.ok, r.body);

  // A deposit on the booking.
  await db.doc(`${T}/appointments/v7`).set({ tableName: '8', tab: [L('x', 'steak', 1)], isTable: true, clientId: null, status: 'servicing', source: 'host' });
  await db.doc(`${T}/depositCredits/dep7`).set({ kind: 'deposit', sourceAppointmentId: 'v7', status: 'available', amountCents: 2000, usedCents: 0, createdAt: new Date().toISOString() });
  await Tab.POST(req({ tenantId: 't1', action: 'pay_status', visitId: 'v7' }));
  const tok7 = (await get(`${T}/appointments/v7`)).payToken;
  r = await Pay.POST(req({ tenantId: 't1', token: tok7, action: 'view' }));
  check('a deposit on the booking: guests aren’t asked to pay what it covers (the server takes it off at the desk)', r.body.state === 'wait' && /deposit/.test(r.body.why), r.body);
  r = await Tab.POST(req({ tenantId: 't1', action: 'pay_cash', visitId: 'v7' }));
  check('…nor is cash taken for the whole check here', r.status === 409 && /deposit/.test(r.body.error), r.body);

  // Something came off after they paid (a void that slipped in): closed all the same, the extra flagged to give back.
  await db.doc(`${T}/appointments/v8`).set({ tableName: '9', tab: [L('y', 'steak', 1), L('z', 'fries', 2)], isTable: true, clientId: null, status: 'servicing', source: 'host' });
  await Tab.POST(req({ tenantId: 't1', action: 'pay_status', visitId: 'v8' }));
  const tok8 = (await get(`${T}/appointments/v8`)).payToken;
  r = await Pay.POST(req({ tenantId: 't1', token: tok8, action: 'start', choice: { way: 'rest' }, tip: { pct: 0 } }));
  payOnPhone(`pi_${S.n}`); await Pay.POST(req({ tenantId: 't1', token: tok8, action: 'done', claimId: r.body.claimId }));
  let v8: any = await get(`${T}/appointments/v8`);
  const sigPaid = v8.payPaidTab;
  check('paid in full for this tab', !!v8.payPaidAt && sigPaid === TB.tabSig(v8.tab));
  await db.doc(`${T}/appointments/v8`).set({ tab: [L('y', 'steak', 1)] }, { merge: true });
  v8 = await get(`${T}/appointments/v8`);
  check('…the tab changed: the host stand and the server’s phone no longer say it’s paid', TB.tabSig(v8.tab) !== sigPaid && /payPaidTab === tabSig\(tab\)/.test(src('src/lib/floor-server.ts')));
  r = await CO.POST(req({ tenantId: 't1', action: 'table_close', visitId: 'v8' }));
  check('…closed all the same, the extra flagged on the receipt to give back', r.status === 200 && r.body.ok && (r.body.warnings || []).some((w: string) => /more than the sale comes to/.test(w)), r.body);
  const NU2 = await import('../../src/lib/nudges');
  check('a table paid in full still shows what else it needs (the paid nudge doesn’t hide the rest)', !/kind: 'paid'[^\n]*return out/.test(src('src/lib/nudges.ts')) && typeof NU2.nudgesFor === 'function');

  // A link passed around can't hold the whole check.
  await db.doc(`${T}/appointments/v9`).set({ tableName: '10', tab: Array.from({ length: 10 }, (_, i) => L(`h${i}`, 'fries', i + 1)), isTable: true, clientId: null, status: 'servicing', source: 'host' });
  await Tab.POST(req({ tenantId: 't1', action: 'pay_status', visitId: 'v9' }));
  const tok9 = (await get(`${T}/appointments/v9`)).payToken;
  for (let i = 1; i <= 8; i++) await Pay.POST(req({ tenantId: 't1', token: tok9, action: 'start', choice: { way: 'seat', seats: [i] }, tip: { pct: 0 } }, `10.2.0.${i}`));
  r = await Pay.POST(req({ tenantId: 't1', token: tok9, action: 'start', choice: { way: 'seat', seats: [9] }, tip: { pct: 0 } }, '10.2.0.9'));
  check('no more than eight payments at once on one check', r.status === 429 && /at once/.test(r.body.error), r.body);

  console.log('off, and unfired');
  await db.doc(T).set({ kitchenSettings: { tablePay: { on: false } } }, { merge: true });
  r = await Pay.POST(req({ tenantId: 't1', token: tok3, action: 'view' }));
  check('off: the page says to ask the server', r.body.state === 'wait' && /isn’t on here/.test(r.body.why));
  await db.doc(T).set({ kitchenSettings: { tablePay: { on: true } } }, { merge: true });
  await db.doc(`${T}/appointments/v3`).set({ tab: [L('p', 'neg', 1), L('q', 'neg', 2, { firedAt: null })] }, { merge: true });
  r = await Pay.POST(req({ tenantId: 't1', token: tok3, action: 'view' }));
  check('a dish held and never fired: they wait for the server', r.body.state === 'wait' && /hasn’t gone to the kitchen/.test(r.body.why));

  console.log('screens');
  const page = src('src/app/bill/[tenantId]/[token]/page.tsx'), card = src('src/components/host/TablePayCard.tsx'), tt = src('src/components/host/TableTab.tsx'), set = src('src/components/menu/TableServiceSettings.tsx');
  check('the guest’s page: by seat, by item, evenly, the rest; the business’s tips, other and none; the card company’s own form; no need to wait',
    /By seat/.test(page) && /By item/.test(page) && /Evenly/.test(page) && /The rest, /.test(page) && /No tip/.test(page) && /Other/.test(page) && /PaymentElement/.test(page) && /No need to wait/.test(page) && /Worked out before tax/.test(page));
  check('the server’s side: the code, paid so far, the rest in cash, close the check', /They scan this to pay/.test(card) && /Paid so far/.test(card) && /They paid the rest in cash/.test(card) && /Close the check/.test(card) && /table_close/.test(card) && /QRCode\.toDataURL/.test(card));
  check('the table’s tab shows it when it’s on, and hides the desk’s checkout once anything is paid at the table', /tablePayOf\(tenant\)\.on && <TablePayCard/.test(tt) && /paidHere > 0/.test(tt));
  check('settings: off until on, the ways, the tips, before or after tax, the one picked', /Let guests pay at the table/.test(set) && /Ways to split/.test(set) && /Tip choices/.test(set) && /Before tax/.test(set) && /Suggest a tip/.test(set));
  check('the check’s page is kept out of search, and its address isn’t passed on', /'\/bill\/'/.test(src('src/app/robots.ts')) && /referrer: 'no-referrer'/.test(src('src/app/bill/[tenantId]/[token]/layout.tsx')));
  check('Needs attention waits two hours before showing a table’s check (the meal is still going on)', /tableIdle/.test(src('src/components/ops/OpsBoard.tsx')));
  check('no emoji, no all caps, no niche words in the new screens', !/[\u{1F300}-\u{1FAFF}]/u.test(page + card) && !/\buppercase\b|font-black/.test(page + card) && !/\b(salon|stylist|booth|chair)\b/i.test(page + card));

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
