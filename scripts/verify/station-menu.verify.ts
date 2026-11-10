// Checks the station menu (/concierge/{tenant}) works with nobody signed in, and tells and charges only what it should:
//   - the menu comes from the server: what can be ordered, its price and whether it's available, the business's name,
//     color and logo; nothing about cost, stock counts or hidden items; a paused business shows none;
//   - a phone number alone tells nothing; with the texted code's pass the guest gets a first name, their membership
//     and a card that can really be charged (brand and last four; one that has run out is none), never ids or email;
//   - their card on file is charged by the server's own card step, under the order's own name, only for the guest the
//     code proved (never on the station's link alone, even for someone here today): declined orders nothing; still
//     going through or no answer orders nothing, keeps the order's name, and can only be tried on the card again;
//   - charged, then the order can't be written: the money goes back to the card, the refund is in the books, and that
//     order's name can't be charged or served again; the hourly sweep does the same for one left charged;
//   - one order's progress is told only by its own id; the board says nothing private;
//   - an item put away can't be ordered; a card total under $0.50 isn't charged; a used-up host allowance says so;
//   - the page reads no database itself, never charges a card itself, keeps the pass out of addresses, forgets the
//     guest and what they typed on a shared tablet, and follows the writing rules.
// The card step itself (api/stripe/charge-card) is stood in for here: one payment per key, or a no, a "still going
// through", or no answer. Its own behavior is checked by its own scripts.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/station-menu.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.STRIPE_SECRET_KEY = 'sk_test_x';
process.env.ORDER_PASS_SECRET = 'test-station-secret';
process.env.CRON_SECRET = 'sec';
let db: any = strictTransactions(makeDb());

// Stripe, for a payment read back and a refund.
let pis = new Map<string, any>(); let refunds: any[] = []; let refundFails = false;
function StripeMock(this: any) {
  return {
    paymentIntents: {
      retrieve: async (id: string) => pis.get(id) || null,
      list: async (q: any) => ({ data: Array.from(pis.values()).filter((p) => p.customer === q.customer) }),
    },
    refunds: { create: async (p: any, o: any) => {
      if (refundFails) { const e: any = new Error('insufficient balance'); e.type = 'StripeInvalidRequestError'; throw e; }
      if (!refunds.some((r) => r.o?.idempotencyKey === o?.idempotencyKey)) refunds.push({ p, o }); return { id: `re_${refunds.length}` };
    } },
  };
}

// The server's own card step, as the order route calls it.
let cardMode: 'ok' | 'decline' | 'lost' | 'unknown' | 'busy' = 'ok';
let cardCalls: any[] = [];
const byKey = new Map<string, string>();
const chargeCard = async (r: any) => {
  const body = await r.json(); const internal = r.headers.get('x-cf-internal');
  cardCalls.push({ body, internal });
  if (internal !== 'sec') return { status: 401, body: { ok: false, error: 'Sign in to take a card payment.' } };
  if (cardMode === 'lost') throw new Error('socket hang up');
  if (cardMode === 'unknown') return { status: 502, body: { ok: false, unknown: true } };
  if (cardMode === 'busy') return { status: 409, body: { ok: false, code: 'in_progress' } };
  if (cardMode === 'decline') return { status: 200, body: { ok: false, reason: 'Your card was declined.' } };
  let id = byKey.get(body.idempotencyKey);
  if (!id) { id = `pi_${byKey.size + 1}`; byKey.set(body.idempotencyKey, id); pis.set(id, { id, status: 'succeeded', customer: 'cus_c', amount_received: body.amountCents, metadata: { tenantId: body.tenantId, clientId: body.clientId, chargeKey: body.idempotencyKey } }); }
  return { status: 200, body: { ok: true, paymentIntentId: id } };
};

let texts: any[] = [];
const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
const deny = (status: number) => ({ deny: { status, body: { ok: false } } });
const desk = (r: any) => String(r?.headers?.get?.('authorization') || '') === 'Bearer desk';
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return Object.assign(StripeMock, { default: StripeMock, __esModule: true });
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, {
    requireRole: async (r: any) => (desk(r) ? { actor: { uid: 'd1', name: 'Desk' } } : deny(401)),
    requireCan: async (r: any) => (desk(r) ? { actor: { uid: 'd1', name: 'Desk', caps: ['checkout.take'] } } : deny(401)),
    staffOrServer: async () => false });
  if (request === '@/app/api/stripe/charge-card/route' || /\/src\/app\/api\/stripe\/charge-card\/route(\.ts)?$/.test(request)) return fake(request, { POST: chargeCard });
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => undefined, auditEntry: () => ({}) });
  if (request === '@/lib/notify' || /\/src\/lib\/notify(\.ts)?$/.test(request)) return fake(request, { sendNotification: async (_db: any, msg: any) => { texts.push(msg); return { ok: true, status: 'sent' }; } });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const today = new Date();
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ ...d.data(), id: d.id }));
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const headersOf = (h: Record<string, string>) => ({ get: (k: string) => h[String(k).toLowerCase()] ?? null });
const req = (body: any, h: Record<string, string> = {}) => ({ json: async () => body, headers: headersOf(h), nextUrl: { origin: 'https://studio.test', searchParams: new URLSearchParams() }, url: 'https://studio.test/api/x' }) as any;
const getReq = (q: Record<string, string>) => ({ headers: headersOf({}), nextUrl: { origin: 'https://studio.test', searchParams: new URLSearchParams(q) }, url: `https://studio.test/api/x?${new URLSearchParams(q)}` }) as any;
const fresh = async (tenant: any = {}) => {
  db = strictTransactions(makeDb()); pis = new Map(); refunds = []; refundFails = false; byKey.clear(); cardCalls = []; cardMode = 'ok'; texts = [];
  await db.doc(T).set({ name: 'Opal Lounge', userId: 'owner1', stripeAccountId: 'acct_1', kioskSettings: { primaryColor: '#1f4e5f' }, ...tenant });
  await db.doc(`${T}/inventory/latte`).set({ name: 'Oat latte', type: 'refreshment', price: 6, totalStock: 10, category: 'Coffee', description: 'Double shot.', costPrice: 1.1, supplier: 'Beans Co', sku: 'L-1' });
  await db.doc(`${T}/inventory/mint`).set({ name: 'Mint tea', type: 'refreshment', price: 3.5, totalStock: 0, category: 'Tea' });
  await db.doc(`${T}/inventory/old`).set({ name: 'Old blend', type: 'refreshment', price: 4, totalStock: 5, archived: true });
  await db.doc(`${T}/inventory/off`).set({ name: 'Seasonal', type: 'refreshment', price: 4, totalStock: 5, isActive: false });
  await db.doc(`${T}/inventory/hidden`).set({ name: 'Staff coffee', type: 'refreshment', price: 0, totalStock: 5, showInConcierge: false });
  await db.doc(`${T}/inventory/mint25`).set({ name: 'Mint', type: 'refreshment', price: 0.25, totalStock: 5 });
  await db.doc(`${T}/inventory/shampoo`).set({ name: 'Shampoo', type: 'retail', price: 20, totalStock: 5 });
  await db.doc(`${T}/clients/c1`).set({ name: 'Maya Lopez', phone: '+15553334444', email: 'maya@example.com', activeMembershipId: 'mem1',
    cardOnFile: { paymentMethodId: 'pm_c', customerId: 'cus_c', brand: 'Visa', last4: '4242', expMonth: 12, expYear: 2099 },
    subscription: { nextBillingDate: new Date(Date.now() + 20 * 864e5).toISOString() } });
  await db.doc(`${T}/clients/c2`).set({ name: 'Lee Park', phone: '+15556667777', cardOnFile: { paymentMethodId: 'pm_old', customerId: 'cus_l', brand: 'Visa', last4: '1111', expMonth: 1, expYear: 2020 } });
  await db.doc(`${T}/clients/c3`).set({ name: 'Ola Diaz', phone: '+15558889999', cardOnFile: { token: 'tok_legacy', brand: 'Visa', last4: '3333', expMonth: 12, expYear: 2099 } });
  // Good through the last day of this month: still usable today.
  await db.doc(`${T}/clients/c4`).set({ name: 'Ana Ruiz', phone: '+15550001111', cardOnFile: { paymentMethodId: 'pm_a', customerId: 'cus_a', brand: 'Visa', last4: '5555', expMonth: today.getMonth() + 1, expYear: today.getFullYear() } });
  await db.doc(`${T}/memberships/mem1`).set({ name: 'Morning Club', includedProducts: [{ id: 'latte', quantity: 2 }] });
  await db.doc(`${T}/booths/b1`).set({ name: 'Suite 4' });
  await db.doc(`${T}/leases/l1`).set({ boothId: 'b1', renterId: 'rt1', status: 'active' });
  await db.doc(`${T}/renters/rt1`).set({ firstName: 'Nia', lastName: 'Park', amenitiesEnabled: true, amenityPayer: 'client', amenityCompAllowance: 1 });
};

(async () => {
  const route = await import('../../src/app/api/concierge/requests/route');
  const { makeStationToken, stationLinkVersion } = await import('../../src/lib/station-token');
  const { loungeCardSweep } = await import('../../src/lib/lounge-card');
  const O = (body: any, h: Record<string, string> = {}) => route.POST(req({ tenantId: 't1', ...body }, h)) as any;
  const G = (q: Record<string, string>) => route.GET(getReq({ tenantId: 't1', ...q })) as any;
  const passFor = async (phone: string) => {
    const s: any = await O({ action: 'send-code', phone });
    const code = ((texts[texts.length - 1]?.text || '').match(/code is (\d{6})/) || [])[1] || '';
    return (await O({ action: 'check-code', phone, codeId: s.body.codeId, code })).body.pass as string;
  };

  console.log('the menu');
  await fresh();
  let r: any = await G({ menu: '1' });
  const ids = (r.body.menu || []).map((i: any) => i.id).sort();
  check('the menu lists what can be ordered here, sold-out items marked; hidden, put away, switched off and shop items left out', r.body.ok && JSON.stringify(ids) === '["latte","mint","mint25"]'
    && r.body.menu.find((i: any) => i.id === 'mint').available === false && r.body.menu.find((i: any) => i.id === 'latte').available === true, r.body);
  const keys = Array.from(new Set((r.body.menu || []).flatMap((i: any) => Object.keys(i)))).sort();
  check('…each item says only its name, price, section, words, picture, members-only and whether it’s available (no cost, supplier or stock count)',
    JSON.stringify(keys) === '["available","id","imageUrl","membersOnly","name","price","section","words"]', keys);
  check('…the price is the one an order is charged at', r.body.menu.find((i: any) => i.id === 'latte').price === 6 && r.body.menu.find((i: any) => i.id === 'latte').section === 'Coffee');
  check('the business: its name and color', r.body.business?.name === 'Opal Lounge' && r.body.business?.accent === '#1f4e5f' && r.body.business?.logoUrl === null, r.body.business);
  await fresh({ kioskSettings: { primaryColor: 'red;background:url(x)' }, logoUrl: 'http://insecure.test/logo.png' });
  r = await G({ menu: '1' });
  check('…a color that isn’t a plain hex color, or a logo that isn’t https, is left out', r.body.business?.accent === null && r.body.business?.logoUrl === null, r.body.business);
  await fresh({ accessLocked: true, accessLockedAt: new Date().toISOString() });
  r = await G({ menu: '1' });
  check('a paused business shows no menu', !r.body?.menu, r.body);

  console.log('who the guest is');
  await fresh();
  r = await G({ phone: '+15553334444' });
  check('a phone number alone: nothing about them, not even whether they’re a client', r.body.ok && r.body.guest === null && JSON.stringify(r.body.perkRemaining) === '{}', r.body);
  r = await O({ action: 'guest', phone: '+15553334444', pass: 'made-up' });
  check('…a made-up pass: the same', r.body.ok && r.body.guest === null, r.body);
  const pass = await passFor('+15553334444');
  r = await O({ action: 'guest', phone: '+15553334444', pass });
  check('with the texted code’s pass (sent in the body, not the address): a first name, the membership and the card', r.body.guest?.firstName === 'Maya' && r.body.guest?.member === true
    && r.body.guest?.membershipName === 'Morning Club' && r.body.guest?.card?.brand === 'Visa' && r.body.guest?.card?.last4 === '4242' && r.body.perkRemaining?.latte === 2, r.body);
  const said = JSON.stringify(r.body);
  check('…and nothing else about them (no id, phone, email, card id or customer)', !/c1|5553334444|maya@|pm_c|cus_c|Lopez/.test(said), said);
  r = await O({ action: 'guest', phone: '+15556667777', pass: await passFor('+15556667777') });
  check('a card that has run out counts as no card', r.body.guest?.firstName === 'Lee' && r.body.guest?.card === null, r.body);
  r = await O({ action: 'guest', phone: '+15558889999', pass: await passFor('+15558889999') });
  check('…so does one the card step can’t charge (no saved customer)', r.body.guest?.card === null, r.body);
  r = await O({ action: 'guest', phone: '+15550001111', pass: await passFor('+15550001111') });
  check('…a card good through this month still counts today', r.body.guest?.card?.last4 === '5555', r.body);

  console.log('their card on file, charged by the server');
  const order = (x: any = {}, h: Record<string, string> = {}) => O({ itemId: 'latte', quantity: 2, clientName: 'Maya', phone: '+15553334444', stationName: 'Seat 12', settle: 'card_on_file', orderKey: 'okey1', ...x }, h);
  r = await order();
  check('without the code: asked for it, and the card is never touched', r.status === 403 && r.body.needsCode === true && cardCalls.length === 0 && (await all(`${T}/refreshmentRequests`)).length === 0, r.body);
  // Here today, on the station's own link: enough to add to a visit, never to charge a card.
  await db.doc(`${T}/appointments/a1`).set({ clientId: 'c1', status: 'checked_in', startTime: new Date().toISOString() });
  const token = makeStationToken('t1', 'b1', 'rt1', await stationLinkVersion(db, 't1', 'b1'));
  r = await order({ boothId: 'b1', stationToken: token });
  check('the station’s link and someone here today: still no card charge without their code', r.status === 403 && r.body.needsCode === true && cardCalls.length === 0, r.body);
  r = await order({ guestPass: pass });
  const c0 = cardCalls[0];
  check('with the code: charged by the server’s own card step, under the order’s own name, the menu’s price ($12.00 for two)', r.body.ok && r.body.paidAtKiosk === true && cardCalls.length === 1
    && c0.internal === 'sec' && c0.body.idempotencyKey === 'lounge-okey1' && c0.body.amountCents === 1200 && c0.body.clientId === 'c1' && c0.body.mode === 'pos', { body: r.body, c0 });
  let reqs = await all(`${T}/refreshmentRequests`);
  check('…one order, paid, nothing to collect when it’s handed over, and its claim says ordered', reqs.length === 1 && reqs[0].settledBy === 'card_on_file' && reqs[0].paidAtKiosk === true
    && reqs[0].priceAtRequest === 0 && reqs[0].stripePaymentIntentId === 'pi_1' && (await get(`${T}/private/kiosk/cardOrders/${reqs[0].id}`))?.status === 'ordered', reqs);
  r = await order({ guestPass: pass });
  check('the same order sent again (a double tap, a retry): the same order, no second charge', r.body.ok && r.body.already === true && (await all(`${T}/refreshmentRequests`)).length === 1 && byKey.size === 1, r.body);
  r = await order({ guestPass: pass }, { authorization: 'Bearer desk' });
  check('the front desk signed in on the screen may use it too', r.body.ok, r.body);

  cardMode = 'decline';
  r = await order({ guestPass: pass, orderKey: 'okey2' });
  check('the card says no: nothing ordered, and the screen is told to choose another way', r.status === 402 && r.body.declined === true && (await all(`${T}/refreshmentRequests`)).length === 1, r.body);
  cardMode = 'ok';
  r = await order({ guestPass: pass, orderKey: 'okey2', settle: 'desk' });
  check('…then paying when it arrives, under the same name: fine (nothing was charged)', r.body.ok && r.body.settledBy === 'desk', r.body);

  cardMode = 'busy';
  r = await order({ guestPass: pass, orderKey: 'okey3' });
  check('the card step says it’s still going through: not a “no”; nothing ordered, try the card again', r.status === 503 && r.body.sameWay === true && !r.body.declined && (await all(`${T}/refreshmentRequests`)).length === 2, r.body);
  r = await order({ guestPass: pass, orderKey: 'okey3', settle: 'desk' });
  check('…while it might have gone through, that order can’t switch to paying when it arrives', r.status === 409 && r.body.sameWay === true && (await all(`${T}/refreshmentRequests`)).length === 2, r.body);
  r = await order({ guestPass: pass, orderKey: 'okey3', settle: 'balance' });
  check('…or to adding it to their visit', r.status === 409 && r.body.sameWay === true, r.body);
  cardMode = 'lost';
  r = await order({ guestPass: pass, orderKey: 'okey3' });
  check('no answer at all: nothing ordered, try again, never charged twice', r.status === 503 && /won’t be charged twice/.test(r.body.error) && (await all(`${T}/refreshmentRequests`)).length === 2, r.body);
  cardMode = 'unknown';
  r = await order({ guestPass: pass, orderKey: 'okey3' });
  check('…an answer that doesn’t say: the same', r.status === 503 && r.body.sameWay === true, r.body);
  cardMode = 'ok';
  r = await order({ guestPass: pass, orderKey: 'okey3' });
  check('…the card again once it answers: charged under the same name, one order', r.body.ok && cardCalls[cardCalls.length - 1].body.idempotencyKey === 'lounge-okey3' && (await all(`${T}/refreshmentRequests`)).length === 3, r.body);

  let before = cardCalls.length;
  r = await order({ guestPass: pass, orderKey: '' });
  check('an order with no name of its own isn’t charged (it couldn’t be made safe to send twice)', r.status === 400 && cardCalls.length === before, r.body);
  r = await order({ guestPass: pass, orderKey: 'okey4', itemId: 'mint25', quantity: 1 });
  check('a card total under $0.50 isn’t charged', r.status === 400 && /\$0\.50/.test(r.body.error) && cardCalls.length === before, r.body);
  delete process.env.CRON_SECRET;
  r = await order({ guestPass: pass, orderKey: 'okey5' });
  check('without the server’s own secret set: no charge, pay when it arrives', r.status === 400 && /Pay when it arrives/.test(r.body.error) && cardCalls.length === before, r.body);
  process.env.CRON_SECRET = 'sec';

  console.log('charged, but the order couldn’t be written');
  const real = db.runTransaction.bind(db); let failNext = 0;
  // Only the step that writes the order fails (the rate count and the claim's own steps go through).
  db.runTransaction = async (fn: any) => { if (failNext > 0 && /tx\.get\(reqRef\)/.test(String(fn))) { failNext--; throw new Error('contention'); } return real(fn); };
  failNext = 1;
  r = await order({ guestPass: pass, orderKey: 'okey6' });
  const pi6 = byKey.get('lounge-okey6');
  const claim6: any = (await all(`${T}/private/kiosk/cardOrders`)).find((c: any) => c.piId === pi6);
  check('the payment goes back to the card, and the screen is told to place it again', r.status === 500 && r.body.restart === true && /went back to your card/.test(r.body.error)
    && refunds.length === 1 && refunds[0].p.payment_intent === pi6 && refunds[0].o.stripeAccount === 'acct_1' && claim6?.status === 'refunded', { body: r.body, refunds, claim6 });
  const refundLine: any = (await all(`${T}/transactions`)).find((x: any) => x.refundOfPaymentIntent === pi6);
  check('…the refund is in the books (a refund line for the full amount)', refundLine?.type === 'expense' && refundLine?.category === 'Refunds' && refundLine?.amount === 12, refundLine);
  before = cardCalls.length;
  r = await order({ guestPass: pass, orderKey: 'okey6' });
  check('…that order’s name, sent again: not charged again, and never served for nothing', r.status === 409 && r.body.restart === true && cardCalls.length === before && !(await all(`${T}/refreshmentRequests`)).some((x: any) => x.stripePaymentIntentId === pi6), r.body);
  r = await order({ guestPass: pass, orderKey: 'okey6', settle: 'desk' });
  check('…not under another way to pay either', r.status === 409 && r.body.restart === true, r.body);

  // The refund itself fails: the guest is told it's being returned (not that it has been), and the owners are told
  // once it has failed three times.
  refundFails = true; failNext = 1;
  r = await order({ guestPass: pass, orderKey: 'okey7' });
  const claim7: any = (await all(`${T}/private/kiosk/cardOrders`)).find((c: any) => c.piId === byKey.get('lounge-okey7'));
  check('a refund that doesn’t go: “being returned”, never “went back”, and the claim keeps trying', r.body.restart === true && /being returned/.test(r.body.error) && !/went back/.test(r.body.error) && claim7?.status === 'refunding' && claim7?.refundTries === 1, { body: r.body, claim7 });
  db.runTransaction = real;
  const late = Date.now() + 11 * 60000;
  await loungeCardSweep(db, 't1', late); await loungeCardSweep(db, 't1', late + 11 * 60000);
  const told = (await all(`${T}/notifications`)).filter((x: any) => /couldn’t be refunded automatically/.test(x.message));
  check('…after three tries the owners are told to refund it from Money, once', told.length === 1 && told[0].userId === 'owner1' && told[0].link === '/money', told);
  refundFails = false;
  await loungeCardSweep(db, 't1', late + 22 * 60000);
  check('…and once it goes through, it’s refunded and in the books', (await get(`${T}/private/kiosk/cardOrders/${claim7.id}`))?.status === 'refunded' && (await all(`${T}/transactions`)).some((x: any) => x.refundOfPaymentIntent === claim7.piId), null);

  // Already placed another way under this name (the answer to it was lost, then the guest chose the card): no charge.
  r = await order({ guestPass: pass, orderKey: 'okey8', settle: 'desk' });
  before = cardCalls.length;
  r = await order({ guestPass: pass, orderKey: 'okey8' });
  check('an order already made under this name (to pay when it arrives): the card isn’t charged for it again', r.body.ok && r.body.already === true && r.body.settledBy === 'desk' && cardCalls.length === before, r.body);

  // A charge made for this name, asked again for a different order (another amount): given back, start over.
  r = await order({ guestPass: pass, orderKey: 'okey9' });
  const ord9 = (await all(`${T}/refreshmentRequests`)).find((x: any) => x.stripePaymentIntentId === byKey.get('lounge-okey9'));
  await db.doc(`${T}/refreshmentRequests/${ord9.id}`).delete();
  await db.doc(`${T}/private/kiosk/cardOrders/${ord9.id}`).set({ status: 'charged' }, { merge: true });
  before = cardCalls.length; const refundsBefore = refunds.length;
  r = await order({ guestPass: pass, orderKey: 'okey9', quantity: 1 });
  check('a charge under this name for a different amount isn’t used for this order: it goes back, and the screen starts over', r.status === 409 && r.body.restart === true
    && cardCalls.length === before && refunds.length === refundsBefore + 1 && !(await get(`${T}/refreshmentRequests/${ord9.id}`)), r.body);

  // Another request under this name is charging right now: not sent again.
  const k10 = 'okey10'; const { createHash } = await import('crypto');
  const id10 = `kq_${createHash('sha256').update(`t1|${k10}`).digest('hex').slice(0, 24)}`;
  await db.doc(`${T}/private/kiosk/cardOrders/${id10}`).set({ status: 'charging', at: new Date().toISOString(), clientId: 'c1', amountCents: 1200 });
  before = cardCalls.length;
  r = await order({ guestPass: pass, orderKey: k10 });
  check('a charge for this name going through right now isn’t sent a second time', r.status === 503 && r.body.sameWay === true && cardCalls.length === before, r.body);

  // Left charged with no order (the step stopped): the sweep gives it back after ten minutes; one with its order is left.
  await db.doc(`${T}/private/kiosk/cardOrders/kq_${'a'.repeat(24)}`).set({ status: 'charged', piId: 'pi_x', account: 'acct_1', amountCents: 600, item: 'Oat latte', chargedAt: new Date(Date.now() - 11 * 60000).toISOString() });
  await db.doc(`${T}/private/kiosk/cardOrders/kq_${'b'.repeat(24)}`).set({ status: 'charged', piId: 'pi_y', account: 'acct_1', amountCents: 600, chargedAt: new Date(Date.now() - 11 * 60000).toISOString() });
  await db.doc(`${T}/refreshmentRequests/kq_${'b'.repeat(24)}`).set({ status: 'pending', stripePaymentIntentId: 'pi_y', requestedAt: new Date().toISOString() });
  // Its order is there, but paid another way: this payment isn't needed, so it goes back.
  await db.doc(`${T}/private/kiosk/cardOrders/kq_${'g'.repeat(24)}`).set({ status: 'charged', piId: 'pi_w', account: 'acct_1', amountCents: 600, chargedAt: new Date(Date.now() - 11 * 60000).toISOString() });
  await db.doc(`${T}/refreshmentRequests/kq_${'g'.repeat(24)}`).set({ status: 'pending', settledBy: 'desk', requestedAt: new Date().toISOString() });
  await db.doc(`${T}/private/kiosk/cardOrders/kq_${'c'.repeat(24)}`).set({ status: 'charged', piId: 'pi_z', account: 'acct_1', amountCents: 600, chargedAt: new Date().toISOString() });
  // Never heard back after the charge (the step stopped): found by its key, and given back.
  pis.set('pi_lost', { id: 'pi_lost', status: 'succeeded', customer: 'cus_c', metadata: { chargeKey: 'lounge-lost1' } });
  await db.doc(`${T}/private/kiosk/cardOrders/kq_${'e'.repeat(24)}`).set({ status: 'charging', at: new Date(Date.now() - 11 * 60000).toISOString(), customer: 'cus_c', account: 'acct_1', chargeKey: 'lounge-lost1', amountCents: 600 });
  await db.doc(`${T}/private/kiosk/cardOrders/kq_${'f'.repeat(24)}`).set({ status: 'charging', at: new Date(Date.now() - 3 * 3600000).toISOString(), customer: 'cus_c', account: 'acct_1', chargeKey: 'lounge-never', amountCents: 600 });
  // A payment that's on another order (shouldn't happen): left with that order, and the owners told, never refunded.
  await db.doc(`${T}/private/kiosk/cardOrders/kq_${'h'.repeat(24)}`).set({ status: 'charged', piId: 'pi_v', account: 'acct_1', amountCents: 600, chargedAt: new Date(Date.now() - 11 * 60000).toISOString() });
  await db.doc(`${T}/private/kiosk/cardPayments/pi_v`).set({ id: 'pi_v', requestId: 'kq_other' });
  const n = await loungeCardSweep(db, 't1');
  check('…one left charging whose charge went through is found by its key and refunded; one that never reached the card is closed',
    (await get(`${T}/private/kiosk/cardOrders/kq_${'e'.repeat(24)}`))?.status === 'refunded' && refunds.some((x) => x.p.payment_intent === 'pi_lost') && (await get(`${T}/private/kiosk/cardOrders/kq_${'f'.repeat(24)}`))?.status === 'none', null);
  check('the hourly sweep: one left charged with no order is refunded; one with its order is marked ordered; a fresh one is left alone',
    n === 3 && (await get(`${T}/private/kiosk/cardOrders/kq_${'a'.repeat(24)}`))?.status === 'refunded' && (await get(`${T}/private/kiosk/cardOrders/kq_${'b'.repeat(24)}`))?.status === 'ordered'
    && (await get(`${T}/private/kiosk/cardOrders/kq_${'c'.repeat(24)}`))?.status === 'charged' && refunds.some((x) => x.p.payment_intent === 'pi_x') && !refunds.some((x) => x.p.payment_intent === 'pi_y'), refunds);
  check('…one whose payment is on another order isn’t refunded (that order was served); the owners are told', (await get(`${T}/private/kiosk/cardOrders/kq_${'h'.repeat(24)}`))?.status === 'none' && !refunds.some((x) => x.p.payment_intent === 'pi_v') && (await all(`${T}/notifications`)).some((x: any) => /on another order/.test(x.message)), null);
  check('…and one whose order was paid another way is refunded too (never paid twice)', (await get(`${T}/private/kiosk/cardOrders/kq_${'g'.repeat(24)}`))?.status === 'refunded' && refunds.some((x) => x.p.payment_intent === 'pi_w'), null);

  console.log('the rest of the order');
  r = await O({ itemId: 'old', quantity: 1, clientName: 'Sam', settle: 'desk', orderKey: 'k-old' });
  check('an item put away can’t be ordered', r.status === 404, r.body);
  r = await O({ itemId: 'off', quantity: 1, clientName: 'Sam', settle: 'desk', orderKey: 'k-off' });
  check('…nor one switched off', r.status === 404, r.body);
  await fresh();
  await db.doc(`${T}/renters/rt1`).set({ amenityCompAllowance: 1 }, { merge: true });
  const tk = makeStationToken('t1', 'b1', 'rt1', await stationLinkVersion(db, 't1', 'b1'));
  r = await O({ itemId: 'latte', quantity: 1, clientName: 'Sam', boothId: 'b1', stationToken: tk, settle: 'renter_comp', orderKey: 'comp1' });
  check('the host’s allowance: the first order on the house', r.body.ok && r.body.compedByRenter === true, r.body);
  r = await O({ itemId: 'latte', quantity: 1, clientName: 'Sam', boothId: 'b1', stationToken: tk, settle: 'renter_comp', orderKey: 'comp2' });
  check('…the next: told it’s used up today, so the screen offers other ways to pay', r.status === 409 && r.body.compUsedUp === true, r.body);

  console.log('one order’s progress, and the board');
  await db.doc(`${T}/refreshmentRequests/kq_${'d'.repeat(24)}`).set({ itemName: 'Oat latte', quantity: 1, status: 'ready', requestedAt: new Date().toISOString(), clientName: 'Maya Lopez', clientId: 'c1', bringingOutAt: new Date().toISOString(), stationName: 'Seat 12', priceAtRequest: 6 });
  await db.doc(`${T}/refreshmentRequests/b`).set({ itemName: 'Mint tea', quantity: 1, status: 'ready', requestedAt: new Date().toISOString(), clientName: 'Sam', stationName: 'Seat 3' });
  await db.doc(`${T}/refreshmentRequests/c`).set({ itemName: 'Cold brew', quantity: 1, status: 'pending', requestedAt: new Date().toISOString(), clientName: 'Ana', carriedBy: 'Sam', stationName: 'Seat 4' });
  r = await G({ order: `kq_${'d'.repeat(24)}` });
  check('one order’s progress, by its own id: ready, and someone has it in hand', r.body.ok && r.body.status === 'ready' && r.body.onItsWay === true && Object.keys(r.body).sort().join() === 'ok,onItsWay,status', r.body);
  r = await G({ order: 'b' });
  check('…an id that isn’t one the screen could have made: nothing', r.status === 404, r.body);
  r = await G({});
  const byId = Object.fromEntries((r.body.requests || []).map((x: any) => [x.id, x]));
  check('the board: only a ready order someone has in hand is on its way', byId[`kq_${'d'.repeat(24)}`]?.onItsWay === true && byId.b?.onItsWay === false && byId.c?.onItsWay === false, r.body);
  check('…and it says nothing private (no client id, last name or price)', !/c1|Lopez|priceAtRequest/.test(JSON.stringify(r.body)), r.body);

  console.log('the page');
  const page = readFileSync('src/app/concierge/[tenantId]/page.tsx', 'utf8');
  const code = page.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  check('reads no database itself (no client SDK, no team sign-in needed)', !/from ['"]firebase|from ['"]@\/firebase|useCollection|getDocs|useFirestore|useUser/.test(page));
  check('never charges a card itself; the order route does, after the code', !/\/api\/stripe\//.test(page) && /settle: s/.test(page));
  check('the menu comes from the server, and the pass travels in a request body, never an address', /menu=1/.test(page) && /action: 'guest', phone, pass: p/.test(page) && !/pass=\$\{/.test(page));
  check('asks about a day stay by phone only with the pass', /action: 'active-stay', tenantId, phone: `\+1\$\{phone\}`, guestPass: p/.test(page));
  check('a shared tablet forgets the guest, what they typed, the last order and its payment state', /QUIET_MS/.test(page) && /setLookFor\(''\); setNote\(''\)/.test(page) && /setDone\(null\)/.test(page) && /setStationFailed\(false\); setCardLocked\(false\)/.test(page) && /autoComplete="off"/.test(page));
  check('a station charge is retried only when it’s still going through or got no answer; any other no offers another way', /if \(!st \|\| st >= 500 \|\| d\?\.busy\)/.test(page) && !/st === 429/.test(page));
  check('a used-up host allowance where the renter pays goes on the station, and the guest is told', /if \(stationPays\) \{ setGood\(/.test(page));
  check('the quiet reset keeps an order still on its way (without how it was paid)', /summary: 'We’ll bring it over\.'/.test(page));
  check('a card still being checked can only be tried on the card again; a refunded order starts over', /d\?\.sameWay\) \{ setCardLocked\(true\)/.test(page) && /d\?\.restart\) \{ freshOrder\(\)/.test(page) && /show: !cardLocked/.test(page));
  check('after the code, the waiting order goes on from the newest screen (not a stale copy)', /setResumeWith\(\{ pass: p/.test(page) && /\[resumeWith, busy, isPerk\]/.test(page) && !/setTimeout\(\(\) => \{ void placeRef/.test(page));
  check('the done screen follows its own order, less often over time, and stops when it’s delivered', /&order=\$\{encodeURIComponent\(done\.requestId\)\}/.test(page) && /s === 'delivered' \|\| s === 'cancelled'/.test(page) && /WATCH_MS/.test(page) && /8000 : 20000/.test(page));
  check('text on the business’s color is whichever of white or ink reads better', /const onColor = \(hex: string\) => \(contrast\(lum\(hex\), 1\) >= contrast\(lum\(hex\), lum\(INK\)\)/.test(page));
  check('the quantity sheet is a real dialog: focus inside, Escape, Tab kept in, the page behind inert', /role="dialog" aria-modal="true" aria-labelledby/.test(page) && /e\.key === 'Escape'/.test(page) && /setAttribute\('inert'/.test(page));
  check('ways to pay are real radio buttons, and notices are announced', /type="radio" name="pay"/.test(page) && /role="alert"/.test(page));
  const ui = code.replace(/sp\.get\('booth'\)|boothParam|boothId|boothName|stationStay|stationToken|stationPays|stationFailed|stationOrderId|stationName|stationWhere|setStationWhere|setStationStay|setStationFailed/g, '');
  check('writing rules: no uppercase class, no comment blocks in the markup, no “call us”, no business-type words, US spelling',
    !/\buppercase\b/.test(page) && !/\{\/\*/.test(page) && !/call us|contact us/i.test(page) && !/\b(studio|salon|stylist|chair|booth)\b/i.test(ui) && !/label: 'Cancelled'|was cancelled/.test(page));
  const tools = [['cl', 'aude'], ['anth', 'ropic']].map((p) => p.join(''));
  check('names no outside tool', !new RegExp(tools.join('|'), 'i').test(page + readFileSync('src/app/api/concierge/requests/route.ts', 'utf8') + readFileSync('src/lib/lounge-card.ts', 'utf8')));

  if (failures) { console.error(`${failures} failed`); process.exit(1); }
  console.log('station-menu ok');
})();
