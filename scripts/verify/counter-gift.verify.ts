// Checks gift cards sold at the counter and the window (design board "Gift cards at the counter"; lib/counter-gift,
// lib/counter-gift-server; api/counter 'giftCard' and 'giftIssue'; components/pos/CounterGift; the receipt, points, the
// books and the night report).
// - A line of its own: $1 to $5,000, who it's for, on the receipt or by text or email. Not taxed, no discount or reward on
//   it, never part of what's sold; one a line, never on the house.
// - Paid in cash or by card (a gift card or store credit pays only for the rest), booked as Gift Card Sales, then made
//   once (the same as the front desk's) and sent, with the buyer's bonus while an offer is on. One that wasn't made is
//   made when asked again; asking again never makes a second.
// - Never refunded at the counter; the night report counts it apart from sales; points only where gift cards count
//   when they're bought.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/counter-gift.verify.ts
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

const sent: any[] = []; let sendDown = false; let failMakes = 0; let giftMod: any = null;
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
  // Texts and emails, as they'd go out (lib/notify).
  if (request === '@/lib/notify' || /\/src\/lib\/notify(\.ts)?$/.test(request)) return fake(request, { sendNotification: async (_db: any, m: any) => { sent.push(m); return { status: sendDown ? 'failed' : 'sent' }; } });
  // Gift cards as the front desk makes them, with a way to have the next one not made (lib/gift-cards).
  if (request === '@/lib/gift-cards') { if (!giftMod) { const real = load.call(this, request, ...rest); giftMod = { ...real, issueGiftCard: (...a: any[]) => (failMakes > 0 ? (failMakes--, Promise.resolve({ ok: false, error: 'down' })) : real.issueGiftCard(...a)) }; } return giftMod; }
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
  await db.doc(T).set({ name: 'Northside', timezone: 'UTC', retailSettings: { taxRatePercent: 10 }, salesTax: { configured: true }, counterDiscounts: [{ id: 'ten', label: 'Ten off', kind: 'pct', value: 10 }],
    counterTips: { on: true, pcts: [10, 15, 20], where: 'both' }, giftCardSettings: { amounts: [20, 40, 80] } });
  await db.doc(`${T}/inventory/latte`).set({ type: 'refreshment', name: 'Oat latte', category: 'Drinks', price: 6, totalStock: 50 });
  await db.doc(`${T}/staff/m9`).set({ name: 'Mo Diaz', role: 'manager', isActive: true });
  await db.doc(`${T}/tillSessions/till1`).set({ id: 'till1', status: 'open', openedBy: 'Ana', openedAt: new Date().toISOString(), openingFloat: 100, expectedCash: 100, totalCashSales: 0 });
  const key = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Window', kind: 'drive-thru' }))).body.key;
  const P = (b: any) => POST(req({ tenantId: 't1', key, ...b })) as Promise<any>;
  const passOf = async (id: string, name: string) => { const { createHash, randomBytes } = await import('crypto'); const pass = randomBytes(24).toString('hex'); const h = createHash('sha256').update(key).digest('hex');
    await db.doc(`kitchenScreens/${h}`).set({ passes: { [createHash('sha256').update(pass).digest('hex')]: { id, name, exp: Date.now() + 3600000 } } }, { merge: true }); return pass; };
  const mpass = await passOf('m9', 'Mo Diaz');
  const start = async (n: string) => (await P({ action: 'car', carKey: `gift-${n}` })).body.orderId as string;
  const order = (id: string) => get(`${T}/counterOrders/${id}`);
  const lines = async (id: string) => (await order(id)).lines || [];
  const giftL = async (id: string) => (await lines(id)).filter((l: any) => l.giftCard);
  const G = await import('../../src/lib/counter-gift');
  const GCS = await import('../../src/lib/gift-cards');
  const CM = await import('../../src/lib/counter-money');

  console.log('the line');
  check('$1 to $5,000', !G.giftLine({ cents: 99 }, 'a').ok && !G.giftLine({ cents: 500001 }, 'a').ok && G.giftLine({ cents: 500000 }, 'a').ok);
  check('by text takes a 10-digit mobile number, by email an address', !G.giftLine({ cents: 2000, via: 'text', phone: '555' }, 'a').ok && !G.giftLine({ cents: 2000, via: 'email', email: 'sam@' }, 'a').ok
    && (G.giftLine({ cents: 2000, via: 'text', phone: '(415) 212-4567' }, 'a') as any).line.giftCard.phone === '+14152124567');
  const ln: any = (G.giftLine({ cents: 5000, to: '  Sam\u0007 ', via: 'email', email: 'Sam@Example.com' }, 'x') as any).line;
  check('one of it, not taxed, no kitchen, named for who it’s for', ln.quantity === 1 && ln.untaxed && ln.oneOff && ln.name === 'Gift card for Sam' && ln.unitPrice === 50 && ln.giftCard.email === 'sam@example.com', ln);
  check('how it reads on the order', G.giftWords(ln.giftCard) === 'By email to sam@example.com, not taxed' && G.giftWords({ ...ln.giftCard, via: 'print', code: 'K7QX-2M9P' }) === 'K7QX-2M9P');

  console.log('on the order');
  let r = await P({ action: 'lane' });
  check('the screen gets the business’s own amounts', JSON.stringify(r.body.gift?.amounts) === '[20,40,80]', r.body.gift);
  const o1 = await start('a');
  await P({ action: 'add', orderId: o1, itemId: 'latte', quantity: 1, tapKey: 'tap-gift-0001' });
  r = await P({ action: 'giftCard', orderId: o1, cents: 4000, to: 'Sam', via: 'text', phone: '4152124567', tapKey: 'tap-gift-0002' });
  let od = await order(o1);
  check('added: the latte and its tax, then the gift card, untaxed', r.body.ok && od.subtotal === 6 && od.tax === 0.6 && od.total === 46.6 && (await giftL(o1)).length === 1, [od.subtotal, od.tax, od.total]);
  await P({ action: 'giftCard', orderId: o1, cents: 4000, to: 'Sam', via: 'text', phone: '4152124567', tapKey: 'tap-gift-0002' });
  check('one tap is one gift card', (await giftL(o1)).length === 1);
  const g1 = (await giftL(o1))[0];
  r = await P({ action: 'qty', orderId: o1, lineId: g1.lineId, quantity: 2, tapKey: 'tap-gift-0003' });
  check('one gift card a line', r.status === 409);
  r = await P({ action: 'giftCard', orderId: o1, cents: 50, tapKey: 'tap-gift-0004' });
  check('under $1 is refused', r.status === 400);
  await P({ action: 'send', orderId: o1 });
  r = await P({ action: 'comp', orderId: o1, lineId: g1.lineId, qty: 1, reason: 'Birthday', staffPass: mpass });
  check('never on the house', r.status === 409 && r.body.code === 'gift', r.body);
  await P({ action: 'discount', orderId: o1, discountId: 'ten' });
  od = await order(o1);
  check('a discount is only on what’s sold: 10% of the latte, and its tax after it', od.markdown?.cents === 60 && od.subtotal === 5.4 && od.tax === 0.54 && od.total === 45.94, [od.markdown, od.subtotal, od.tax, od.total]);
  check('a tip’s percents leave the gift card out', CM.tipBaseOf(od) === 594, CM.tipBaseOf(od));
  r = await P({ action: 'tip', orderId: o1, cents: 4000 });
  check('…and a tip is never more than the rest of the order', r.body.ok && (await order(o1)).tipCents === 594, [r.body, (await order(o1)).tipCents]);
  await P({ action: 'tip', orderId: o1, cents: 0 });

  console.log('paid for');
  await db.doc(`${T}/giftCards/old1`).set({ id: 'old1', code: 'OLD1-CARD', codeKey: 'OLD1CARD', initialCents: 10000, balanceCents: 10000, status: 'active', history: [] });
  r = await P({ action: 'tender', orderId: o1, do: 'gift', code: 'OLD1-CARD' });
  od = await order(o1);
  check('another gift card pays only for the latte, never the gift card', r.body.ok && od.tenders?.[0]?.cents === 594, [r.body, od.tenders]);
  r = await P({ action: 'tender', orderId: o1, do: 'gift', code: 'OLD1-CARD' });
  check('…twice is refused', r.status === 409);
  sent.length = 0;
  const cash0 = (await get(`${T}/tillSessions/till1`)).expectedCash;
  r = await P({ action: 'paid', orderId: o1, method: 'cash', tendered: 50 });
  od = await order(o1);
  const made = (await giftL(o1))[0].giftCard;
  const card: any = made.id ? await get(`${T}/giftCards/${made.id}`) : null;
  check('the rest in cash: $40 for the gift card, change from $50', r.body.ok && r.body.change === 10 && Math.round(((await get(`${T}/tillSessions/till1`)).expectedCash - cash0) * 100) === 4000, [r.body, (await get(`${T}/tillSessions/till1`)).expectedCash]);
  check('made once it’s paid: the same gift card as the front desk’s, $40, sold here, for this sale', !!card && card.initialCents === 4000 && card.balanceCents === 4000 && card.source === 'desk' && card.recipientName === 'Sam' && card.transactionId === `counter_${o1}_giftsale` && card.orderId === o1 && made.id === `cgift_${o1}_${g1.lineId}`, card);
  check('texted to them, and the code is on the line and on the screen', made.sent === true && made.code === card.code && sent.some((m) => m.channel === 'sms' && m.to === '+14152124567' && m.text.includes(card.code)) && r.body.gifts?.[0]?.code === card.code && r.body.gifts[0].sent === true, [made, r.body.gifts]);
  const sale = await get(`${T}/transactions/counter_${o1}`), gs = await get(`${T}/transactions/counter_${o1}_giftsale`);
  check('the books: the latte as a sale, the gift card as Gift Card Sales (held for the guest)', sale.amount === 5.4 && sale.category === 'Retail' && gs.category === 'Gift Card Sales' && gs.taxBucket === 'transfer' && gs.amount === 40 && gs.type === 'income', [sale.amount, gs]);
  check('the old card paid $5.94, never the gift card', (await get(`${T}/giftCards/old1`)).balanceCents === 10000 - 594);

  console.log('asked again');
  const n0 = (await db.collection(`${T}/giftCards`).get()).docs.length; const s0 = sent.length;
  r = await P({ action: 'paid', orderId: o1, method: 'cash', tendered: 50 });
  check('paid again: it says so, and no second gift card or text', r.body.ok && r.body.already && (await db.collection(`${T}/giftCards`).get()).docs.length === n0 && sent.length === s0 && r.body.gifts?.[0]?.code === card.code, [r.body, n0]);
  r = await P({ action: 'giftIssue', orderId: o1 });
  check('asking for its gift cards gives the same one', r.body.ok && r.body.gifts.length === 1 && r.body.gifts[0].code === card.code && (await db.collection(`${T}/giftCards`).get()).docs.length === n0, r.body);

  console.log('one that wasn’t made');
  const o2 = await start('b');
  await P({ action: 'giftCard', orderId: o2, cents: 2000, via: 'print', tapKey: 'tap-gift-0010' });
  await P({ action: 'send', orderId: o2 });
  od = await order(o2);
  check('a gift card on its own: nothing for the kitchen, $20 with no tax', od.kitchenNone === true && od.total === 20 && od.tax === 0 && od.subtotal === 0, [od.kitchenNone, od.total]);
  r = await P({ action: 'tender', orderId: o2, do: 'gift', code: 'OLD1-CARD' });
  check('another gift card can’t pay for it', r.status === 409 && /cash or a card/.test(r.body.error), r.body);
  failMakes = 1;
  r = await P({ action: 'paid', orderId: o2, method: 'card' });
  let gl = (await giftL(o2))[0].giftCard;
  check('paid, but the gift card wasn’t made: said so, nothing half made', r.body.ok && r.body.gifts?.[0]?.failed === true && !gl.id && gl.failed && !gl.claim, [r.body.gifts, gl]);
  r = await P({ action: 'giftIssue', orderId: o2 });
  gl = (await giftL(o2))[0].giftCard;
  check('asked again: made, its code on the receipt', r.body.ok && r.body.gifts[0].code && gl.code === r.body.gifts[0].code && !gl.failed && r.body.gifts[0].via === 'print', r.body);
  const RC = await import('../../src/lib/counter-receipt');
  let rec = RC.counterReceipt(await order(o2), o2);
  check('the receipt shows its code', rec.detail.lines.some((l: any) => l.kind === 'gift' && l.label.includes(`code ${gl.code}`) && l.amount === 20), rec.detail.lines);
  rec = RC.counterReceipt(await order(o1), o1);
  check('…and says a texted one was texted, never its code', rec.detail.lines.some((l: any) => l.label === 'Gift card for Sam, by text') && !JSON.stringify(rec).includes(card.code), rec.detail.lines);
  console.log('paid, and not made: found again');
  check('the order is marked while one isn’t made, and the screen is told', (await order(o2)).giftsOpen === false && (await order(o1)).giftsOpen === false);
  failMakes = 1;
  const o7 = await start('g');
  await P({ action: 'giftCard', orderId: o7, cents: 1500, via: 'print', tapKey: 'tap-gift-0060' });
  await P({ action: 'send', orderId: o7 }); await P({ action: 'paid', orderId: o7, method: 'card' });
  r = await P({ action: 'lane' });
  check('a paid order whose gift card wasn’t made is on the screen to make', (await order(o7)).giftsOpen === true && r.body.gift.open.some((g: any) => g.orderId === o7 && g.number), r.body.gift);
  await P({ action: 'giftIssue', orderId: o7 });
  r = await P({ action: 'lane' });
  check('…and off it once it’s made', (await order(o7)).giftsOpen === false && !r.body.gift.open.some((g: any) => g.orderId === o7));
  console.log('never for nothing');
  const o8 = await start('h');
  await P({ action: 'giftCard', orderId: o8, cents: 5000, via: 'print', tapKey: 'tap-gift-0070' });
  await P({ action: 'send', orderId: o8 });
  r = await P({ action: 'staffMeal', orderId: o8, for: 'Rio', staffPass: mpass });
  check('a staff meal can’t carry a gift card', !r.body.ok && /gift card is on this order/.test(r.body.error || '') && (await order(o8)).paidAt == null, r.body);
  await db.doc(`${T}/counterOrders/${o8}`).set({ paidAt: new Date().toISOString(), payMethod: 'staff', staffMeal: { for: 'Rio' } }, { merge: true });
  r = await P({ action: 'giftIssue', orderId: o8 });
  check('…and one settled with no money never makes one', (r.body.gifts || []).length === 0 && !(await giftL(o8))[0].giftCard.id, r.body);
  console.log('a text that didn’t go');
  sendDown = true;
  const o6 = await start('f');
  await P({ action: 'giftCard', orderId: o6, cents: 2500, to: 'Kai', via: 'email', email: 'kai@example.com', tapKey: 'tap-gift-0050' });
  await P({ action: 'send', orderId: o6 }); r = await P({ action: 'paid', orderId: o6, method: 'card' });
  sendDown = false;
  check('made, and said it wasn’t sent (the receipt too)', r.body.gifts?.[0]?.code && r.body.gifts[0].sent === false && RC.counterReceipt(await order(o6), o6).detail.lines.some((l: any) => l.label === 'Gift card for Kai, by email, not sent yet'), r.body.gifts);

  console.log('two screens at once');
  const o3 = await start('c');
  await P({ action: 'giftCard', orderId: o3, cents: 3000, via: 'print', tapKey: 'tap-gift-0020' });
  await P({ action: 'giftCard', orderId: o3, cents: 3000, via: 'print', tapKey: 'tap-gift-0021' });
  await P({ action: 'send', orderId: o3 });
  await P({ action: 'paid', orderId: o3, method: 'card' });
  const I = await import('../../src/lib/counter-gift-server');
  const both = await Promise.all([I.issueCounterGifts(db, 't1', o3, 'A'), I.issueCounterGifts(db, 't1', o3, 'B')]);
  const ids3 = (await giftL(o3)).map((l: any) => l.giftCard.id);
  check('two gift cards, each made once', new Set(ids3).size === 2 && ids3.every(Boolean) && (await db.collection(`${T}/giftCards`).get()).docs.filter((d: any) => d.data().orderId === o3).length === 2 && both.every((b) => b.length === 2), ids3);

  console.log('refunds');
  r = await P({ action: 'refundPreview', orderId: o2, all: true, reason: 'Wrong order' });
  check('“all of it” on a gift card alone says to pick it', !r.body.ok && /Pick it under Some items/.test(r.body.error || ''), r.body);
  r = await P({ action: 'refundPreview', orderId: o1, all: true, reason: 'Wrong order' });
  check('all of it is everything but the gift card, back on the gift card that paid for it', r.body.ok && r.body.plan?.cents === 594 && !r.body.plan.lines.some((l: any) => l.lineId === g1.lineId) && r.body.back.length === 1 && r.body.back[0].kind === 'gift', r.body);
  r = await P({ action: 'refundPreview', orderId: o1, all: false, lines: [{ lineId: g1.lineId, qty: 1 }], reason: 'Wrong order' });
  check('picking the gift card: all of it, no tax, back in cash (as it was paid), never onto the other gift card', r.body.ok && r.body.plan.cents === 4000 && r.body.plan.giftCents === 4000 && r.body.plan.taxCents === 0 && r.body.back.length === 1 && r.body.back[0].kind === 'cash' && r.body.back[0].cents === 4000, r.body);
  r = await P({ action: 'paidToday' });
  const row1 = r.body.orders.find((x: any) => x.id === o1);
  check('today’s list says which gift cards can be refunded', row1.lines.find((l: any) => l.lineId === g1.lineId)?.left === 1 && row1.lines.find((l: any) => l.lineId === g1.lineId)?.gift?.code === card.code, row1.lines);
  const cashA = (await get(`${T}/tillSessions/till1`)).expectedCash;
  r = await P({ action: 'refund', orderId: o1, all: false, lines: [{ lineId: g1.lineId, qty: 1 }], reason: 'Changed their mind', staffPass: mpass });
  od = await order(o1); const void1 = await get(`${T}/giftCards/${card.id}`);
  check('refunded: $40 in cash from the drawer, and the gift card cancelled with nothing on it', r.body.ok && r.body.cashCents === 4000 && Math.round((cashA - (await get(`${T}/tillSessions/till1`)).expectedCash) * 100) === 4000 && void1.status === 'void' && void1.balanceCents === 0 && !void1.holds?.[`crefund_${o1}`] && r.body.cancelled?.[0] === card.code, [r.body, void1.status]);
  const gb = await get(`${T}/transactions/crefund_${o1}_1`);
  check('on the books: Gift Card Sales given back, never a refund of sales', gb && gb.category === 'Gift Card Sales' && gb.taxBucket === 'transfer' && gb.amount === -40 && !(await get(`${T}/transactions/crefund_${o1}_1_gift`)), gb);
  check('the order keeps it: the line says so, and the refund says it was a gift card', od.refundedLines[g1.lineId] === 1 && (await giftL(o1))[0].giftCard.refundedAt && od.refunds[0].giftCents === 4000 && RC.counterReceipt(od, o1).detail.lines.some((l: any) => /refunded and cancelled/.test(l.label)), od.refunds);
  r = await P({ action: 'refundPreview', orderId: o1, all: false, lines: [{ lineId: g1.lineId, qty: 1 }], reason: 'Again' });
  check('…and it isn’t refunded twice', !r.body.ok, r.body);
  r = await P({ action: 'refund', orderId: o1, all: true, reason: 'Wrong order', staffPass: mpass });
  check('the latte after: back on the gift card that paid for it', r.body.ok && r.body.cents === 594 && (await get(`${T}/giftCards/old1`)).balanceCents === 10000 && !!(await get(`${T}/transactions/crefund_${o1}_2`)) && (await get(`${T}/transactions/crefund_${o1}_2`)).category === 'Refunds', r.body);
  // Spent from: it stays as it is.
  const [c3a] = (await giftL(o3)).map((l: any) => l.giftCard);
  await GCS.spendGiftCard(db, 't1', { id: c3a.id, cents: 500, by: 'Front desk' });
  r = await P({ action: 'refundPreview', orderId: o3, all: false, lines: [{ lineId: (await giftL(o3))[0].lineId, qty: 1 }], reason: 'Wrong order' });
  check('one something was spent from can’t be refunded', !r.body.ok && /has been used/.test(r.body.error || ''), r.body);
  r = await P({ action: 'paidToday' });
  const g3 = r.body.orders.find((x: any) => x.id === o3).lines.find((l: any) => l.gift?.id === c3a.id);
  check('…and today’s list says how much was spent', g3.left === 0 && g3.gift.spentCents === 500 && g3.gift.why === 'spent', g3);
  const c3b = (await giftL(o3))[1].giftCard;
  await GCS.holdGiftCard(db, 't1', { id: c3b.id, holdId: 'checkout_x', cents: 1000 });
  r = await P({ action: 'refundPreview', orderId: o3, all: false, lines: [{ lineId: (await giftL(o3))[1].lineId, qty: 1 }], reason: 'Wrong order' });
  check('one set aside at a checkout right now waits', !r.body.ok && /checkout right now/.test(r.body.error || ''), r.body);
  // Money back: the gift card's share keeps room on the card or cash it was paid with.
  const CR = await import('../../src/lib/counter-refund');
  const src2: any[] = [{ key: 'pi:1', kind: 'card', cents: 5000, pi: '1' }, { key: 'gift:g', kind: 'gift', cents: 1000, giftCardId: 'g' }];
  const food = CR.allocateWith(src2, 1000, 0, 5000);
  check('the food’s refund leaves the card for the gift card still on it', food.length === 1 && food[0].kind === 'gift' && food[0].back === 1000, food);
  const mixed = CR.allocateWith(src2, 6000, 5000, 0);
  check('…and the gift card’s goes to the card, never another gift card', mixed.find((b: any) => b.kind === 'card')?.back === 5000 && mixed.find((b: any) => b.kind === 'gift')?.back === 1000, mixed);
  check('with no gift cards, the same as before', JSON.stringify(CR.allocateWith(src2, 5500)) === JSON.stringify(CR.allocate(src2, 5500)));

  console.log('the night report and points');
  const NC = await import('../../src/lib/night-close');
  const rep = NC.nightReport({ day: '2026-11-22', timeZone: 'UTC', sales: [{ at: '2026-11-22T10:00:00Z', net: 5.4, total: 45.94, tip: 0, tax: 0.54, method: 'cash', giftCards: { count: 1, amount: 40 } }, { at: '2026-11-22T11:00:00Z', net: 0, total: 20, tip: 0, tax: 0, method: 'card', giftCards: { count: 1, amount: 20 } }],
    tables: [], adjustments: [], tills: [], tips: { mode: 'direct', rows: [] }, items: [], checks: {} });
  check('gift cards sold, apart from sales, in what was taken', rep.giftCards?.count === 2 && rep.giftCards.total === 60 && rep.sales.total === 5.4 && rep.sales.taken === 65.94 && NC.reportText('Northside', rep).includes('Gift cards sold: 2, $60.00'), [rep.giftCards, rep.sales]);
  const night = src('src/lib/night-close-server.ts');
  check('the night’s counter orders give their gift cards', /giftCards: giftCentsOf\(o\.lines\) > 0 \? \{ count: giftLineCount\(o\.lines\), amount: giftCentsOf\(o\.lines\) \/ 100 \} : null/.test(night));
  await db.doc(T).set({ loyalty: { on: true, earn: { mode: 'per_dollar', perDollar: 1 } } }, { merge: true });
  await db.doc(`${T}/clients/c1`).set({ name: 'Jordan Lee', firstName: 'Jordan' });
  const o4 = await start('d');
  await P({ action: 'add', orderId: o4, itemId: 'latte', quantity: 2, tapKey: 'tap-gift-0030' });
  await P({ action: 'giftCard', orderId: o4, cents: 5000, via: 'print', tapKey: 'tap-gift-0031' });
  await db.doc(`${T}/counterOrders/${o4}`).set({ clientId: 'c1', points: { verified: true } }, { merge: true });
  await P({ action: 'send', orderId: o4 });
  await P({ action: 'paid', orderId: o4, method: 'card' });
  check('points on the lattes only, never the gift card', (await order(o4)).points?.earned === 12, (await order(o4)).points);
  check('the buyer is on the gift card', (await get(`${T}/giftCards/${(await giftL(o4))[0].giftCard.id}`)).purchaserId === 'c1');

  console.log('a bonus while an offer is on');
  const today = new Date().toISOString().slice(0, 10);
  await db.doc(T).set({ giftCardSettings: { amounts: [20, 40, 80], offers: [{ name: 'Holiday bonus', tiers: [{ buyCents: 2500, bonusCents: 500 }], startsOn: today, endsOn: today, bonusDays: 90, desk: true, online: true }] } }, { merge: true });
  const o5 = await start('e');
  await P({ action: 'giftCard', orderId: o5, cents: 3000, via: 'print', tapKey: 'tap-gift-0040' });
  await P({ action: 'send', orderId: o5 });
  r = await P({ action: 'paid', orderId: o5, method: 'card' });
  const b5 = (await giftL(o5))[0].giftCard;
  check('the buyer’s bonus is given too, its code on the receipt', !!r.body.gifts?.[0]?.bonusCode && b5.bonusCode === r.body.gifts[0].bonusCode && RC.counterReceipt(await order(o5), o5).detail.lines.some((l: any) => l.label.includes(`your bonus card ${b5.bonusCode}`)), [r.body.gifts, b5]);

  const GC = await import('../../src/lib/gift-cards');
  const c5 = await get(`${T}/giftCards/${b5.id}`); const before = (await db.collection(`${T}/giftCards`).get()).docs.length;
  const again = await GC.giveBonus(db, 't1', await get(T), { channel: 'desk', forCard: { ...c5, bonusCardId: null }, buyer: { name: 'Jordan' }, by: 'A' });
  check('a bonus is made once for a card, however often it’s asked', again?.code === b5.bonusCode && (await db.collection(`${T}/giftCards`).get()).docs.length === before, [again?.code, b5.bonusCode]);

  console.log('while the money goes back');
  await db.doc(T).set({ stripeAccountId: 'acct_1' }, { merge: true });
  const o10 = await start('j');
  await P({ action: 'giftCard', orderId: o10, cents: 3000, via: 'print', tapKey: 'tap-gift-0090' });
  await P({ action: 'send', orderId: o10 }); await P({ action: 'paid', orderId: o10, method: 'card' });
  S.pis.set('pi_g', { id: 'pi_g', amount: 3000, status: 'succeeded', amount_received: 3000, metadata: {} });
  await db.doc(`${T}/counterOrders/${o10}`).set({ cardPaymentId: 'pi_g' }, { merge: true });
  const l10 = (await giftL(o10))[0]; const c10 = l10.giftCard.id;
  S.refundErr = { code: 'charge_disputed', type: 'StripeInvalidRequestError' };
  r = await P({ action: 'refund', orderId: o10, all: false, lines: [{ lineId: l10.lineId, qty: 1 }], reason: 'Changed their mind', staffPass: mpass });
  check('the card company says no: nothing changes, and the gift card is free to spend again', !r.body.ok && !(await order(o10)).refundClaim && (await get(`${T}/giftCards/${c10}`)).status === 'active' && !(await get(`${T}/giftCards/${c10}`)).holds?.[`crefund_${o10}`], [r.body, (await get(`${T}/giftCards/${c10}`)).holds]);
  S.refundErr = { code: 'api_connection_error' };
  r = await P({ action: 'refund', orderId: o10, all: false, lines: [{ lineId: l10.lineId, qty: 1 }], reason: 'Changed their mind', staffPass: mpass });
  const spendMid: any = await GCS.spendGiftCard(db, 't1', { id: c10, cents: 500, by: 'Front desk' });
  check('no answer: the refund waits, and nothing can be spent from the gift card meanwhile', r.status === 503 && !spendMid.ok && (await get(`${T}/giftCards/${c10}`)).balanceCents === 3000, [r.body, spendMid]);
  S.refundErr = null;
  r = await P({ action: 'refund', orderId: o10, resume: true, staffPass: mpass });
  check('finished: back to their card, the gift card cancelled', r.body.ok && r.body.back?.[0]?.kind === 'card' && (await get(`${T}/giftCards/${c10}`)).status === 'void' && S.refunds.some((x: any) => x.payment_intent === 'pi_g' && x.amount === 3000), [r.body, S.refunds]);

  console.log('a gift card with a bonus');
  r = await P({ action: 'refund', orderId: o5, all: false, lines: [{ lineId: (await giftL(o5))[0].lineId, qty: 1 }], reason: 'Changed their mind', staffPass: mpass });
  const bonus5 = (await db.collection(`${T}/giftCards`).get()).docs.map((d: any) => d.data()).find((x: any) => x.code === b5.bonusCode);
  check('refunded unused: its bonus card is cancelled too', r.body.ok && bonus5.status === 'void' && bonus5.balanceCents === 0 && (await get(`${T}/giftCards/${b5.id}`)).status === 'void', [r.body, bonus5?.status]);
  const o9 = await start('i');
  await P({ action: 'giftCard', orderId: o9, cents: 3000, via: 'print', tapKey: 'tap-gift-0080' });
  await P({ action: 'send', orderId: o9 }); r = await P({ action: 'paid', orderId: o9, method: 'card' });
  const bonus9 = (await db.collection(`${T}/giftCards`).get()).docs.map((d: any) => ({ id: d.id, ...d.data() })).find((x: any) => x.code === r.body.gifts?.[0]?.bonusCode);
  await GCS.spendGiftCard(db, 't1', { id: bonus9.id, cents: 100, by: 'Front desk' });
  r = await P({ action: 'refundPreview', orderId: o9, all: false, lines: [{ lineId: (await giftL(o9))[0].lineId, qty: 1 }], reason: 'Wrong order' });
  check('…but not once its bonus card was used', !r.body.ok && /bonus card that has been used/.test(r.body.error || ''), r.body);
  const rep2 = NC.nightReport({ day: '2026-11-22', timeZone: 'UTC', sales: [], tables: [], adjustments: [], tills: [], tips: { mode: 'direct', rows: [] }, items: [], checks: {}, counterRefunds: 5.94, giftRefunds: { count: 2, amount: 70 } });
  check('the night report counts gift cards refunded apart from sales', rep2.giftCards?.refunded?.count === 2 && rep2.giftCards.refunded.total === 70 && rep2.sales.refunds === 5.94 && NC.reportText('Northside', rep2).includes('Gift cards refunded: 2, $70.00'), rep2.giftCards);
  check('…from tonight’s counter refunds, their gift cards taken out of sales refunds', /net: Math\.max\(0, Math\.round\(num\(f\.cents\) - num\(f\.tipCents\) - num\(f\.taxCents\) - num\(f\.giftCents\)\)\)/.test(src('src/lib/night-close-server.ts')));

  console.log('the screens');
  const counter = src('src/app/(app)/counter/page.tsx'), window = src('src/app/drive-thru/[tenantId]/page.tsx'), sheet = src('src/components/pos/CounterGift.tsx');
  check('“A gift card” at the counter and the window, its sheet, and the codes once it’s paid', [counter, window].every((p) => p.includes('<GiftSheet') && p.includes('<GiftsMade') && p.includes('giftsPaidWords(d.gifts)') && p.includes("action: 'giftIssue'") && p.includes('tipBaseOf(order)') && p.includes('!(l as any).giftCard && !(l as any).priceChange && <PriceMenu') && p.includes(', not taxed</span>') && p.includes('giftsFailed(d.gifts) ? \'warn\' : \'good\'')));
  check('the sheet: amounts, other, who it’s for, on the receipt, by text or by email', sheet.includes('On the receipt') && sheet.includes('By text') && sheet.includes('By email') && sheet.includes('Other') && sheet.includes('Who it’s for'));
  const route = src('src/app/api/counter/route.ts');
  check('the guest screen’s tip leaves the gift card out', route.includes('const tipBase = o ? tipBaseOf(o) : 0;'));
  check('the guest’s window screen shows the gift card beside the subtotal (only when there is one)', route.includes('giftCentsOf(o.lines) > 0 ? { giftCards: giftCentsOf(o.lines) / 100 } : {}') && src('src/app/drive-thru/[tenantId]/window/page.tsx').includes('Gift card, not taxed'));
  const mine = sheet + src('src/lib/counter-gift.ts') + src('src/lib/counter-gift-server.ts');
  check('house style', !/ · |\buppercase\b|font-black|\{\/\*/.test(mine) && !/[Ss]alon|[Ss]tylist|\bbooth\b|\bchair\b|[Ss]tudio/.test(mine));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
