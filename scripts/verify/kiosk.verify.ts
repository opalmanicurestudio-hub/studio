// Checks the kiosk (design canvas: Self-order kiosk): lib/kiosk, api/kiosk, the 'kiosk' screen key, the unpaid tickets
// in lib/counter-server (sendOrder / payOrder / voidOrder), the counter taking paid kiosk orders, and the page.
// - Its key works only on api/kiosk, and no other screen's key works there; it sees and pays only its own orders.
// - The menu as at the counter now: what's on at this time of day, happy hour, sold out; members-only items not shown.
// - Pay sends the order with its stock held but its tickets unpaid: no kitchen screen, board or count sees them.
// - Paid on its own reader: the kitchen gets it then, it's counted as sold, and it waits at the counter.
// - Not paid (Cancel, the next guest, or left for 10 minutes): voided, everything back on the shelf, nothing made.
// - Its card reader is picked by a manager only (signed in, or their PIN).
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/kiosk.verify.ts
import Module from 'module';
import * as fs from 'fs';
import { makeDb, check, failures, FV } from './fake-db';

process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
const db: any = makeDb();
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
let signedIn = true;

// A pretend card company: payments and readers, as the server sees them.
const S: any = { pis: new Map<string, any>(), keys: new Map<string, string>(), readers: new Map<string, any>(), refunds: [] as any[], calls: [] as string[], n: 0, down: false };
const clone = (x: any) => JSON.parse(JSON.stringify(x));
const err = (code: string) => Object.assign(new Error(code), { code, raw: { code } });
class FakeStripe {
  paymentIntents = {
    create: async (p: any, o: any) => {
      if (o?.idempotencyKey && S.keys.has(o.idempotencyKey)) return clone(S.pis.get(S.keys.get(o.idempotencyKey)));
      const id = `pi_${++S.n}`; const pi = { id, amount: p.amount, currency: p.currency, description: p.description, status: 'requires_payment_method', capture_method: p.capture_method, metadata: { ...p.metadata }, amount_received: 0 };
      S.pis.set(id, pi); if (o?.idempotencyKey) S.keys.set(o.idempotencyKey, id); return clone(pi);
    },
    retrieve: async (id: string) => { if (S.down) throw err('api_connection_error'); const pi = S.pis.get(id); if (!pi) throw Object.assign(err('resource_missing'), { statusCode: 404 }); return clone(pi); },
    capture: async (id: string) => { const pi = S.pis.get(id); pi.status = 'succeeded'; pi.amount_received = pi.amount; return clone(pi); },
    cancel: async (id: string) => { const pi = S.pis.get(id); pi.status = 'canceled'; S.calls.push(`cancel ${id}`); return clone(pi); },
  };
  refunds = { create: async (p: any) => { S.refunds.push(p); return { id: `re_${S.refunds.length}`, status: 'succeeded', amount: p.amount }; } };
  terminal = { readers: {
    list: async () => ({ data: Array.from(S.readers.values()).map(clone) }),
    retrieve: async (id: string) => clone(S.readers.get(id)),
    processPaymentIntent: async (id: string, p: any) => { const r = S.readers.get(id); r.action = { type: 'process_payment_intent', status: 'in_progress', process_payment_intent: { payment_intent: p.payment_intent }, failure_message: null }; S.calls.push(`process ${id} ${p.payment_intent}`); return clone(r); },
    cancelAction: async (id: string) => { const r = S.readers.get(id); r.action = null; S.calls.push(`cancelAction ${id}`); return clone(r); },
  } };
}
const approve = (readerId: string) => { const r = S.readers.get(readerId); S.pis.get(r.action.process_payment_intent.payment_intent).status = 'requires_capture'; r.action.status = 'succeeded'; };
const decline = (readerId: string) => { const r = S.readers.get(readerId); r.action.status = 'failed'; r.action.failure_message = 'Your card was declined.'; };

const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'stripe') return Object.assign(FakeStripe, { default: FakeStripe });
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { initializeApp: () => ({ name: 'admin' }), getApps: () => [{ name: 'admin' }], cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth') return { verifyStaffActor: async () => (signedIn ? { ok: true, actor, tenant: {} } : { ok: false, status: 401 }) };
  if (request === '@/lib/route-guard') return { requireRole: async () => (signedIn ? { actor } : { deny: { status: 401, body: { ok: false } } }), requireCan: async () => ({ actor }) };
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  if (request === '@/lib/rate-limit' || /\/src\/lib\/rate-limit(\.ts)?$/.test(request)) return fake(request, { limitPublic: async () => null });
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const src = (p: string) => fs.readFileSync(p, 'utf8');
const req = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer test' : null) }, nextUrl: { origin: 'https://app.test' } }) as any;
const hhmm = (h: number) => `${String(((h % 24) + 24) % 24).padStart(2, '0')}:00`;

(async () => {
  const { POST: kitchen } = await import('../../src/app/api/kitchen/route');
  const { POST: KIOSK } = await import('../../src/app/api/kiosk/route');
  const { POST: LANE } = await import('../../src/app/api/counter/route');
  const { POST: FLOOR } = await import('../../src/app/api/floor/route');
  const { POST: BACK } = await import('../../src/app/api/back/route');
  const K = await import('../../src/lib/kiosk');
  const CS = await import('../../src/lib/counter-server');
  const h = new Date().getUTCHours();
  await db.doc(T).set({ name: 'North Pier Coffee', timezone: 'UTC', stripeAccountId: 'acct_1', retailSettings: { taxRatePercent: 10 }, salesTax: { configured: true }, ownerId: 'own1',
    menuSettings: { dayparts: [{ id: 'later', name: 'Supper', from: hhmm(h + 3), to: hhmm(h + 4) }], happyHour: { on: true, days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '23:59' } } });
  await db.doc(`${T}/inventory/latte`).set({ type: 'refreshment', name: 'Latte', category: 'Coffee', price: 4.5, happyPrice: 4, totalStock: 50, upgrades: { size: false, items: ['scone', 'vip'] } });
  await db.doc(`${T}/inventory/scone`).set({ type: 'refreshment', name: 'Scone', category: 'Pastries', price: 3, totalStock: 2 });
  await db.doc(`${T}/inventory/vip`).set({ type: 'refreshment', name: 'Members brew', category: 'Coffee', price: 2, totalStock: 50, isMembersOnly: true });
  await db.doc(`${T}/inventory/stew`).set({ type: 'refreshment', name: 'Stew', category: 'Supper', price: 9, totalStock: 50, dayparts: ['later'] });
  await db.doc(`${T}/inventory/pie`).set({ type: 'refreshment', name: 'Pie', category: 'Pastries', price: 4, totalStock: 0 });
  await db.doc(`${T}/staff/m9`).set({ name: 'Mo Diaz', role: 'manager', isActive: true });
  await db.doc(`${T}/staff/b1`).set({ name: 'Bo Lin', role: 'barista', isActive: true });
  const P = await import('../../src/lib/pin');
  await P.setStaffPin(db, 't1', 'm9', '4321'); await P.setStaffPin(db, 't1', 'b1', '1111');
  S.readers.set('tmr_door1', { id: 'tmr_door1', label: 'By the door', device_type: 'stripe_s700', status: 'online', action: null });
  S.readers.set('tmr_door2', { id: 'tmr_door2', label: 'Second kiosk', device_type: 'stripe_s700', status: 'online', action: null });

  console.log('its key');
  const key = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Kiosk by the door', kind: 'kiosk' }))).body.key;
  const key2 = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Kiosk two', kind: 'kiosk' }))).body.key;
  const lane = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Window', kind: 'drive-thru' }))).body.key;
  const kds = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Kitchen' }))).body.key;
  const k = (b: any, kk = key) => KIOSK(req({ tenantId: 't1', key: kk, ...b }));
  const sc = await get(`kitchenScreens/${(await import('crypto')).createHash('sha256').update(key).digest('hex')}`);
  check('a manager sets a kiosk up as its own kind of screen', !!key && sc?.kind === 'kiosk' && sc.name === 'Kiosk by the door');
  const elsewhere = [await LANE(req({ tenantId: 't1', key, action: 'lane' })), await kitchen(req({ tenantId: 't1', key, action: 'tickets' })), await FLOOR(req({ tenantId: 't1', key, action: 'board' })), await BACK(req({ tenantId: 't1', key, action: 'calls' }))];
  check('its key opens nothing else: not the lane or counter, the kitchen, the floor or the back', elsewhere.every((x: any) => x.status === 401), elsewhere.map((x: any) => x.status));
  const others = [await k({ action: 'menu' }, lane), await k({ action: 'menu' }, kds), await k({ action: 'menu' }, 'x'.repeat(64))];
  check('…and no other screen’s key works on the kiosk', others.every((x: any) => x.status === 401), others.map((x: any) => x.status));

  console.log('the menu');
  let r: any = await k({ action: 'menu' });
  const ids = r.body.sections.flatMap((s: any) => s.items.map((i: any) => i.id));
  const latte = r.body.sections.flatMap((s: any) => s.items).find((i: any) => i.id === 'latte');
  check('as at the counter now: members-only and not-on-now items aren’t shown; happy hour priced; sold out says so', r.body.ok && !ids.includes('vip') && !ids.includes('stew') && latte.price === 4 && latte.happy === true
    && r.body.sections.flatMap((s: any) => s.items).find((i: any) => i.id === 'pie').soldOut === true && JSON.stringify(latte.upgrades.items) === '["scone"]', r.body);
  check('…and it says it can’t take payments until its reader is picked; the tax rate for the total', r.body.payments === true && r.body.reader === false && r.body.taxPct === 10, r.body);
  r = await k({ action: 'place', orderKey: 'order-key-001', lines: [{ itemId: 'latte', quantity: 1 }] });
  check('no reader picked: no order taken', r.status === 409 && r.body.code === 'no_reader' && (await all(`${T}/counterOrders`)).length === 0, r.body);

  console.log('its card reader');
  signedIn = false;
  r = await k({ action: 'readers' });
  check('only a manager picks it: not signed in, a PIN is asked for', r.status === 403 && r.body.needsManager === true, r.body);
  r = await k({ action: 'readers', pin: '1111' });
  const r2: any = await k({ action: 'setReader', pin: '1111', readerId: 'tmr_door1' });
  check('…a team member’s PIN that isn’t a manager’s doesn’t', r.status === 403 && r2.status === 403 && !(await get(`kitchenScreens/${(await import('crypto')).createHash('sha256').update(key).digest('hex')}`)).readerId, [r.body, r2.body]);
  r = await k({ action: 'readers', pin: '4321' });
  check('a manager’s PIN lists the business’s readers', r.body.ok && r.body.readers.map((x: any) => x.id).sort().join(',') === 'tmr_door1,tmr_door2' && r.body.current === null, r.body);
  r = await k({ action: 'setReader', pin: '4321', readerId: 'tmr_nope99' });
  check('…and only one of them can be picked', r.status === 400, r.body);
  r = await k({ action: 'setReader', pin: '4321', readerId: 'tmr_door1' });
  signedIn = true;
  const r3: any = await k({ action: 'setReader', readerId: 'tmr_door2' }, key2);
  check('picked, with the PIN or signed in as a manager; kept on the kiosk’s own record', r.body.ok && r3.body.ok && ((await k({ action: 'menu' })) as any).body.reader === true, [r.body, r3.body]);

  console.log('pay: the order goes in unpaid');
  r = await k({ action: 'place', orderKey: 'order-key-001', name: 'Kim Park', lines: [{ itemId: 'latte', quantity: 2, price: 0.01 }, { itemId: 'scone', quantity: 1, offer: 'item' }] });
  const id1 = r.body.orderId; let o: any = await get(`${T}/counterOrders/${id1}`);
  check('priced from the menu (happy hour), never the page; numbered K; the name kept; an offer taken marked', r.body.ok && r.body.number === 'K1' && o.channel === 'kiosk' && o.subtotal === 11 && o.total === 12.1 && o.guestName === 'Kim Park'
    && o.lines.find((l: any) => l.itemId === 'scone').offer === 'item' && o.kiosk.state === 'awaiting_pay', { body: r.body, o });
  let tix = (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === id1);
  check('sent with its stock held, its tickets unpaid (named for the order)', o.status === 'sent' && (await get(`${T}/inventory/scone`)).totalStock === 1 && tix.length === 2 && tix.every((t: any) => t.status === 'unpaid' && t.guestName === 'Kim Park, K1'), tix);
  const kt: any = await kitchen(req({ tenantId: 't1', key: kds, action: 'tickets' }));
  check('…so the kitchen screen doesn’t show them, or count them today', kt.body.ok && !kt.body.tickets.some((t: any) => t.orderId === id1) && !kt.body.today.some((t: any) => String(t.item).includes('Latte')), kt.body.tickets);
  const board = await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Ready board', kind: 'drive-thru-board' }));
  const rb: any = await LANE(req({ tenantId: 't1', key: board.body.key, action: 'readyBoard' }));
  check('…nor the ready board, and it isn’t counted as sold yet', rb.body.ok && rb.body.making.length === 0 && !Object.keys((await all(`${T}/menuSales`))[0] || {}).some((x) => x.startsWith('n_')), rb.body);
  r = await k({ action: 'place', orderKey: 'order-key-001', name: 'Kim Park', lines: [{ itemId: 'latte', quantity: 2 }, { itemId: 'scone', quantity: 1, offer: 'item' }] });
  check('a second tap is the same order', r.body.orderId === id1 && (await all(`${T}/counterOrders`)).length === 1, r.body);
  r = await k({ action: 'place', orderKey: 'order-key-002', lines: [{ itemId: 'vip', quantity: 1 }] });
  const r4: any = await k({ action: 'place', orderKey: 'order-key-002', lines: [{ itemId: 'stew', quantity: 1 }] });
  check('members-only and not-on-now items can’t be ordered from here', r.status === 409 && r4.status === 409, [r.body, r4.body]);

  console.log('paid on its own reader');
  r = await k({ action: 'pay', orderId: id1 }, key2);
  const r5: any = await k({ action: 'cancel', orderId: id1 }, key2);
  check('another kiosk can’t pay or let go of this one’s order', r.status === 404 && r5.status === 404 && S.pis.size === 0);
  r = await k({ action: 'pay', orderId: id1 });
  const pi1: any = Array.from(S.pis.values()).pop();
  check('the total goes to this kiosk’s reader, named as a kiosk order', r.body.ok && r.body.state === 'on_reader' && pi1.amount === 1210 && pi1.description === 'Kiosk order K1' && S.calls.includes(`process tmr_door1 ${pi1.id}`), { body: r.body, pi1 });
  decline('tmr_door1');
  r = await k({ action: 'check', orderId: id1 });
  check('declined: the reader’s words, and it can be tried again', r.body.ok && r.body.state === 'declined' && /declined/i.test(r.body.message || ''), r.body);
  r = await k({ action: 'pay', orderId: id1 });
  approve('tmr_door1');
  r = await k({ action: 'check', orderId: id1 });
  o = await get(`${T}/counterOrders/${id1}`); tix = (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === id1);
  check('approved: paid, and the kitchen gets it now (timed from now)', r.body.ok && r.body.state === 'paid' && r.body.number === 'K1' && o.paidAt && o.kiosk.state === 'paid' && tix.every((t: any) => t.status === 'pending' && t.createdAt === o.paidAt && t.requestedAt === o.paidAt) && o.sentAt === o.paidAt, { o, tix });
  check('…counted as sold, and in the books', Object.values((await all(`${T}/menuSales`))[0] || {}).includes(2) && (await get(`${T}/transactions/counter_${id1}`))?.amount === 11);
  const car = await get(`${T}/driveThruCars/kiosk_${id1}`);
  const ln: any = await LANE(req({ tenantId: 't1', channel: 'counter', action: 'lane' }));
  check('…and it waits at the counter to be handed over (never in the drive-thru)', car?.stage === 'pickup' && car.channel === 'kiosk' && ln.body.cars.some((c: any) => c.id === `kiosk_${id1}`)
    && !(await LANE(req({ tenantId: 't1', key: lane, action: 'lane' }))).body.cars.some((c: any) => c.id === `kiosk_${id1}`), ln.body.cars);
  r = await LANE(req({ tenantId: 't1', channel: 'counter', action: 'move', carId: `kiosk_${id1}`, to: 'gone' }));
  check('the counter hands it over', r.body.ok && (await get(`${T}/driveThruCars/kiosk_${id1}`)).stage === 'gone', r.body);
  r = await k({ action: 'cancel', orderId: id1 });
  check('paid already: Cancel says it’s paid, nothing let go', r.body.state === 'paid' && (await get(`${T}/counterOrders/${id1}`)).status !== 'voided', r.body);

  console.log('not paid: let go');
  r = await k({ action: 'place', orderKey: 'order-key-003', lines: [{ itemId: 'scone', quantity: 1 }] });
  const id2 = r.body.orderId;
  await k({ action: 'pay', orderId: id2 });
  check('the last scone held while they pay', (await get(`${T}/inventory/scone`)).totalStock === 0);
  r = await k({ action: 'cancel', orderId: id2 });
  o = await get(`${T}/counterOrders/${id2}`); tix = (await all(`${T}/kdsTickets`)).filter((t: any) => t.orderId === id2);
  const pi2: any = Array.from(S.pis.values()).pop();
  check('Cancel: the reader stops asking, the payment can never go through, the order is voided and the scone goes back', r.body.ok && r.body.state === 'let_go' && S.calls.includes(`cancel ${pi2.id}`) && o.status === 'voided' && o.kiosk.state === 'let_go'
    && (await get(`${T}/inventory/scone`)).totalStock === 1 && tix.every((t: any) => t.status === 'cancelled') && o.returnedQty === 1 && !o.wastedQty, { o, tix });
  r = await k({ action: 'place', orderKey: 'order-key-004', lines: [{ itemId: 'scone', quantity: 1 }] });
  const id3 = r.body.orderId;
  r = await k({ action: 'place', orderKey: 'order-key-005', lines: [{ itemId: 'latte', quantity: 1 }] });
  check('the next guest starting lets the one left waiting go first: a kiosk holds one order at a time', (await get(`${T}/counterOrders/${id3}`)).status === 'voided' && (await get(`${T}/inventory/scone`)).totalStock === 1 && r.body.ok, r.body);
  const id4 = r.body.orderId;
  await db.doc(`${T}/counterOrders/${id4}`).set({ createdAt: new Date(Date.now() - 11 * 60000).toISOString() }, { merge: true });
  const sw = await K.sweepKiosk(db, 't1', await get(T), { stripe: new FakeStripe() });
  check('left waiting over 10 minutes (the kiosk went off): the sweep lets it go', sw.letGo === 1 && (await get(`${T}/counterOrders/${id4}`)).status === 'voided', sw);
  r = await k({ action: 'place', orderKey: 'order-key-005', lines: [{ itemId: 'latte', quantity: 1 }] });
  check('…and that order can’t be paid now: start again', r.status === 409 && r.body.code === 'closed', r.body);

  console.log('when the card can’t be called off yet');
  r = await k({ action: 'place', orderKey: 'order-key-006', lines: [{ itemId: 'scone', quantity: 1 }] });
  const id5 = r.body.orderId; await k({ action: 'pay', orderId: id5 });
  const pi5: any = Array.from(S.pis.values()).pop(); S.pis.get(pi5.id).status = 'processing';
  r = await k({ action: 'cancel', orderId: id5 });
  const r6: any = await k({ action: 'place', orderKey: 'order-key-007', lines: [{ itemId: 'latte', quantity: 1 }] });
  check('the card still being processed: Cancel says so, and the next order waits (the reader does one at a time); the scone stays held, nothing voided', r.status === 409 && r.body.code === 'processing' && r6.status === 409 && r6.body.code === 'processing'
    && (await get(`${T}/counterOrders/${id5}`)).status === 'sent' && (await get(`${T}/inventory/scone`)).totalStock === 0 && (await all(`${T}/counterOrders`)).every((x: any) => !String(x.id).includes('007')), [r.body, r6.body]);
  S.pis.get(pi5.id).status = 'requires_payment_method'; S.down = true;
  r = await k({ action: 'cancel', orderId: id5 });
  check('payments can’t be reached: said as that (not “still processing”), and nothing voided yet', r.status === 503 && r.body.code === 'unknown' && !/processed/.test(r.body.error) && (await get(`${T}/counterOrders/${id5}`)).status === 'sent', r.body);
  S.down = false;
  const { screenOf } = await import('../../src/lib/screen-keys');
  const noAcct = { ...(await get(T)), stripeAccountId: null };
  const r7: any = await K.kioskCancel(db, 't1', noAcct, (await screenOf(db, 't1', key))!, id5, { stripe: new FakeStripe() });
  check('card payments no longer set up: the order is let go anyway, never held for good', r7.ok && r7.state === 'let_go' && (await get(`${T}/counterOrders/${id5}`)).status === 'voided' && (await get(`${T}/inventory/scone`)).totalStock === 1, r7);
  check('who a kiosk ticket is for: the first name and number', CS.ticketWho({ channel: 'kiosk', number: 'K7', guestName: 'Kim' }) === 'Kim, K7' && CS.ticketWho({ channel: 'kiosk', number: 'K7' }) === 'K7');
  const cron = src('src/app/api/cron/retail-payments/route.ts');
  check('the sweep runs with the payments sweep', /K\.sweepKiosk\(db, t\.id, tenant\)/.test(cron));

  console.log('the page');
  const page = src('src/app/drive-thru/[tenantId]/kiosk/page.tsx');
  check('set up like the other screens; reads only api/kiosk; the reader under Team', /<ScreenSetup kiosk tenantId=\{tenantId\}/.test(page) && /fetch\('\/api\/kiosk'/.test(page) && !/api\/counter/.test(page) && /ReaderSheet/.test(page) && /kind: kiosk \? 'kiosk'/.test(src('src/components/drive-thru/ScreenSetup.tsx')));
  check('starts over by itself: Still ordering? after a minute, the paid screen after a while; paying, the order is let go first', /IDLE_MS = 60000, ASK_MS = 15000, PAY_IDLE_MS = 120000, PAID_MS = 20000/.test(page) && /Still ordering\?/.test(page) && /void letGo\('start'\)/.test(page));
  check('…and a let-go that didn’t go through when it was left alone is tried again shortly, never left on the reader', /if \(then === 'start'\) \{ setLeaving\(false\); setAsk\(Date\.now\(\)\); \}/.test(page));
  check('in the business’s own color, laid out like a cafe menu board: sections down the side, the featured item big, the order like a receipt', /accent: pageAccent\(tenant\)/.test(src('src/lib/kiosk.ts')) && /const A = menu\?\.accent && HEX\.test\(menu\.accent\) \? menu\.accent : INK/.test(page)
    && /const hero = items\.find\(\(m\) => m\.featured && !m\.soldOut\)/.test(page) && /aria-orientation="vertical"/.test(page) && /borderBottom: '1px dashed #cfd2d6'/.test(page) && />On today</.test(page));
  check('opened from the counter and the lane', /Open a kiosk/.test(src('src/app/(app)/counter/page.tsx')) && /Open a kiosk/.test(src('src/app/drive-thru/[tenantId]/page.tsx')));
  check('in the app’s own words', !/font-black|\buppercase\b|call us|contact us|salon|stylist|booth|studio/i.test((page + src('src/lib/kiosk.ts') + src('src/app/api/kiosk/route.ts')).replace(/^import .*$/gm, '')) && !/ · /.test(page));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
