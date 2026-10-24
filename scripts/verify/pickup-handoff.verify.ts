// Checks Phase B, round 5: someone else collecting, a pickup code nobody can read from the database, and every
// handoff recording who and how (lib/pickup-pass, lib/retail-fulfill, api/retail/fulfil, api/retail/self-serve).
//   - the pickup code: 4 digits, the same every time for an order, different between orders, worked out by the server
//     (never written down); a wrong code counts a try, and after five in a row it stops working for that order;
//   - the customer names someone else (only with their pass, only while it's waiting); the team's screens show it;
//   - each handoff (QR code, pickup code, a check of name and phone) records who handed it over, who collected it and
//     how, on the order and its history; the customer is told when someone else collected it, once;
//   - the parts of an order split for a back-ordered item share its QR code: a scan hands over the right part;
//   - the live order page names nobody; the order page shows the code and the collector only with the pass.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/pickup-handoff.verify.ts
import Module from 'module';
import fs from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.CRON_SECRET = 'test-secret';
let db: any = strictTransactions(makeDb());
const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
const afterJobs: Promise<any>[] = [];
const notified: any[] = [];
let notifyResult: any = { ok: true, status: 'sent' };
let actor: any = { uid: 'k1', name: 'Kai Park', role: 'staff', isManager: false, isTenantOwner: false, caps: [] };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (fn: any) => { afterJobs.push(Promise.resolve().then(fn)); } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/app') return { getApps: () => [{ name: 'admin-retail-selfserve' }], initializeApp: () => ({}), cert: () => ({}) };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) });
  if (request === '@/lib/notify' || /\/src\/lib\/notify(\.ts)?$/.test(request)) return fake(request, { sendNotification: async (_db: any, input: any) => { notified.push(input); return notifyResult; } });
  if (request === '@/lib/email-shell' || /\/src\/lib\/email-shell(\.ts)?$/.test(request)) return fake(request, { getEmailBrand: async () => ({ shopName: 'Opal' }), brandedEmail: (_b: any, html: string) => html, emailButton: () => '' });
  return load.call(this, request, ...rest);
};
const fetched: string[] = [];
(globalThis as any).fetch = async (url: any) => { fetched.push(String(url)); return { ok: true, status: 200, json: async () => ({ ok: true, sent: true }) }; };

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const src = (p: string) => fs.readFileSync(p, 'utf8');
const settle = async () => { while (afterJobs.length) await afterJobs.shift(); };
const req = (body: any, headers: Record<string, string> = {}) => ({ json: async () => body, clone: () => ({ json: async () => body }), headers: { get: (k: string) => headers[k.toLowerCase()] ?? null }, nextUrl: { origin: 'https://app.example', searchParams: new URLSearchParams() } }) as any;
const ready = (id: string, x: any = {}) => ({ id, tenantId: 't1', orderNumber: 1400, stage: 'ready', method: 'counter', qrToken: `${id}.tok`, customerName: 'Jordan Kim', customerEmail: 'jordan@example.com', totalCents: 1500,
  lines: [{ lineId: 'A', productId: 'gel', name: 'Gel polish', unitPriceCents: 1500, qtyOrdered: 1, qtyScanned: 1, qtyShorted: 0, status: 'picked' }], ...x });
const fresh = async () => {
  db = strictTransactions(makeDb()); notified.length = 0; fetched.length = 0;
  await db.doc(T).set({ name: 'Opal', retailSettings: {} });
  await db.doc(`${T}/inventory/gel`).set({ id: 'gel', name: 'Gel polish', type: 'retail', status: 'active', totalStock: 10, stockReserved: 3, batches: [{ id: 'b1', stock: 10, costPerUnit: 4, receivedDate: '2026-01-01' }] });
};

(async () => {
  const PP = await import('../../src/lib/pickup-pass');
  const OE = await import('../../src/lib/order-events');
  const OT = await import('../../src/lib/order-tracking');
  const { makePass } = await import('../../src/lib/order-pass');
  const { POST: FULFIL } = await import('../../src/app/api/retail/fulfil/route');
  const step = async (action: string, args: any = {}) => { const r: any = await FULFIL(req({ tenantId: 't1', action, ...args }, { authorization: 'Bearer t' })); await settle(); return r; };

  // ── The pickup code ──
  const pa = PP.pickupPin('t1', 'o1');
  const many = Array.from({ length: 40 }, (_, i) => PP.pickupPin('t1', `o${i}`));
  check('the pickup code is 4 digits, the same every time for an order, and different between orders', /^\d{4}$/.test(pa) && PP.pickupPin('t1', 'o1') === pa && many.every((x) => /^\d{4}$/.test(x)) && new Set(many).size >= 38);
  check('…spaces and dashes are fine, anything else isn’t', PP.pinMatches('t1', 'o1', `${pa.slice(0, 2)} ${pa.slice(2)}`) && !PP.pinMatches('t1', 'o1', '') && !PP.pinMatches('t1', 'o1', 'abcd') && !PP.pinMatches('t1', 'o1', String((Number(pa) + 1) % 10000).padStart(4, '0')));
  check('the parts of a split order share one code (it comes from their shared QR code)', PP.pinKeyOf({ qrToken: 'fam.tok' }, 'p1') === PP.pinKeyOf({ qrToken: 'fam.tok' }, 'p2') && PP.pinKeyOf({}, 'p9') === 'p9');
  { const s = process.env.CRON_SECRET; delete process.env.CRON_SECRET; check('…and without the server’s secret there’s no code at all (never a guessable one)', PP.pickupPin('t1', 'o1') === ''); process.env.CRON_SECRET = s; }

  await fresh();
  await db.doc(`${T}/retailOrders/o1`).set(ready('o1', { collector: { name: 'Alex Morgan', at: '2026-10-24T15:00:00Z' } }));
  const p1 = PP.pickupPin('t1', 'o1.tok');
  const wrong = String((Number(p1) + 1) % 10000).padStart(4, '0');
  let r = await step('handoffPin', { orderId: 'o1', pin: wrong });
  check('a wrong code isn’t a handoff, and counts a try', r.body.ok === false && /doesn’t match order #1400/.test(r.body.message) && (await get(`${T}/retailOrders/o1`)).stage === 'ready' && (await get(`${T}/retailOrders/o1`)).pinTries === 1, r.body);
  r = await step('handoffPin', { orderId: 'o1', pin: p1 });
  let o = await get(`${T}/retailOrders/o1`);
  check('the right code hands it over: stock out of the shelf, completed', r.body.ok === true && o.stage === 'completed' && (await get(`${T}/inventory/gel`)).totalStock === 9, r.body);
  check('…and the order records who handed it over, who collected it and how', o.handoff?.method === 'pin' && o.handoff.byName === 'Kai Park' && o.handoff.byId === 'k1' && o.handoff.collectedBy === 'someone_else' && o.handoff.collectorName === 'Alex Morgan' && !!o.handoff.at, o.handoff);
  const ev = (await all(`${T}/retailOrders/o1/events`)).find((e: any) => e.type === 'handoff_scanned');
  check('…and so does its history, in words', !!ev && ev.meta.method === 'pin' && OE.eventWords(ev).text === 'Pickup code checked, collected by Alex Morgan · Kai Park', ev);
  const q = (await all('messageOutbox')).find((m: any) => m.kind === 'order_collected');
  check('the customer is told someone else collected it, from the queue', !!q && q.orderId === 'o1' && fetched.some((u) => /collected-notify$/.test(u)), { q, fetched });

  await db.doc(`${T}/retailOrders/o2`).set(ready('o2'));
  const p2 = PP.pickupPin('t1', 'o2.tok'); const bad = String((Number(p2) + 5) % 10000).padStart(4, '0');
  for (let i = 0; i < 4; i++) await step('handoffPin', { orderId: 'o2', pin: bad });
  r = await step('handoffPin', { orderId: 'o2', pin: bad });
  check('five wrong codes in a row and the code stops working for that order', r.body.ok === false && r.body.locked === true && (await get(`${T}/retailOrders/o2`)).pinTries === 5, r.body);
  r = await step('handoffPin', { orderId: 'o2', pin: p2 });
  check('…even the right one, after that (the QR code or a check of their name still works)', r.body.ok === false && r.body.locked === true && (await get(`${T}/retailOrders/o2`)).stage === 'ready' && (await all(`${T}/retailOrders/o2/events`)).some((e: any) => e.type === 'note' && /no longer works/.test(e.meta?.text)), r.body);
  r = await step('handoffNoScan', { orderId: 'o2', verifiedBy: 'Photo ID' });
  o = await get(`${T}/retailOrders/o2`);
  check('a check of their name records how it was checked, and that they collected it themselves', r.body.ok === true && o.handoff?.method === 'checked' && o.handoff.check === 'Photo ID' && o.handoff.collectedBy === 'customer' && o.handoff.byName === 'Kai Park', o.handoff);
  check('…and nobody is told “someone else collected it” when they collected it themselves', !(await all('messageOutbox')).some((m: any) => m.kind === 'order_collected' && m.orderId === 'o2'));

  // ── The parts of a split order share a QR code ──
  await fresh();
  await db.doc(`${T}/retailOrders/p1`).set(ready('p1', { stage: 'completed', qrToken: 'fam.tok' }));
  await db.doc(`${T}/retailOrders/p2`).set(ready('p2', { qrToken: 'fam.tok', parentOrderId: 'p1', orderNumber: 1401 }));
  r = await step('handoffScan', { value: 'fam.tok' });
  check('a scan hands over the part that’s ready, not the one already collected', r.body.ok === true && (await get(`${T}/retailOrders/p2`)).stage === 'completed' && (await get(`${T}/retailOrders/p2`)).handoff?.method === 'qr', r.body);
  await db.doc(`${T}/retailOrders/p3`).set(ready('p3', { qrToken: 'two.tok' }));
  await db.doc(`${T}/retailOrders/p4`).set(ready('p4', { qrToken: 'two.tok', parentOrderId: 'p3', orderNumber: 1402 }));
  r = await step('handoffScan', { value: 'two.tok' });
  check('two parts ready with one code: it asks which, rather than guess', r.body.ok === false && /2 parts/.test(r.body.message) && (await get(`${T}/retailOrders/p3`)).stage === 'ready' && (await get(`${T}/retailOrders/p4`)).stage === 'ready', r.body);
  r = await step('handoffScan', { value: 'two.tok', orderId: 'p4' });
  check('…and the part the screen has open is the one handed over', r.body.ok === true && (await get(`${T}/retailOrders/p4`)).stage === 'completed' && (await get(`${T}/retailOrders/p3`)).stage === 'ready', r.body);
  r = await step('handoffScan', { value: 'two.tok', orderId: 'other' });
  check('…a code for a different order is refused', r.body.ok === false && /different order/.test(r.body.message));

  // ── Who's collecting, from the order page ──
  const { POST: SELF } = await import('../../src/app/api/retail/self-serve/route');
  await fresh();
  await db.doc(`${T}/retailOrders/c1`).set(ready('c1', { stage: 'packed' }));
  let sr: any = await SELF(req({ tenantId: 't1', orderId: 'c1', qrToken: 'c1.tok', action: 'collector', name: 'Alex Morgan' })); await settle();
  check('naming someone else takes the customer’s pass, not just the link', sr.status === 401 && sr.body.code === 'pass_needed' && !(await get(`${T}/retailOrders/c1`)).collector);
  const pass = makePass('t1', 'c1.tok');
  sr = await SELF(req({ tenantId: 't1', orderId: 'c1', qrToken: 'c1.tok', pass, action: 'collector', name: '  Alex   <b>Morgan</b> ' })); await settle();
  o = await get(`${T}/retailOrders/c1`);
  check('with it, the name is saved as one plain line (no markup), and the team’s history says so', sr.status === 200 && o.collector?.name === 'Alex b Morgan /b' && (await all(`${T}/retailOrders/c1/events`)).some((e: any) => e.meta?.text === 'Alex b Morgan /b is collecting it'), { sr: sr.body, c: o.collector });
  sr = await SELF(req({ tenantId: 't1', orderId: 'c1', qrToken: 'c1.tok', pass, action: 'collector', name: '' })); await settle();
  check('…and “Me” clears it', sr.status === 200 && !(await get(`${T}/retailOrders/c1`)).collector);
  await db.doc(`${T}/retailOrders/c1`).update({ stage: 'completed' });
  sr = await SELF(req({ tenantId: 't1', orderId: 'c1', qrToken: 'c1.tok', pass, action: 'collector', name: 'Sam' }));
  check('…only while it’s waiting to be collected', sr.status === 409);
  await db.doc(`${T}/retailOrders/s1`).set(ready('s1', { method: 'ship', stage: 'paid' }));
  sr = await SELF(req({ tenantId: 't1', orderId: 's1', qrToken: 's1.tok', pass: makePass('t1', 's1.tok'), action: 'collector', name: 'Sam' }));
  check('…and only for a pickup', sr.status === 409);

  await db.doc(`${T}/retailOrders/c2`).set(ready('c2', { stage: 'paid', qrToken: 'fam2.tok' }));
  await db.doc(`${T}/retailOrders/c3`).set(ready('c3', { stage: 'paid', qrToken: 'fam2.tok', parentOrderId: 'c2' }));
  sr = await SELF(req({ tenantId: 't1', orderId: 'c2', qrToken: 'fam2.tok', pass: makePass('t1', 'fam2.tok'), action: 'collector', name: 'Sam Lee' })); await settle();
  check('whoever they name collects every part of a split order', sr.status === 200 && (await get(`${T}/retailOrders/c2`)).collector?.name === 'Sam Lee' && (await get(`${T}/retailOrders/c3`)).collector?.name === 'Sam Lee');
  check('…and a part split off later takes the name with it', (src('src/lib/retail-fulfill.ts').match(/collector\?\.name \? \{ collector: \(order as any\)\.collector \}/g) || []).length === 2);

  // ── The note that someone else collected it ──
  const { POST: COLLECTED } = await import('../../src/app/api/retail/collected-notify/route');
  await fresh();
  await db.doc(`${T}/retailOrders/n1`).set(ready('n1', { stage: 'completed', customerPhone: '5551234567', handoff: { at: '2026-10-24T19:42:00Z', method: 'pin', byId: 'k1', byName: 'Kai Park', collectedBy: 'someone_else', collectorName: 'Alex Morgan' } }));
  const internal = { 'x-cf-internal': 'test-secret' };
  notifyResult = { ok: false, status: 'failed' };
  let cr: any = await COLLECTED(req({ tenantId: 't1', orderId: 'n1' }, internal));
  check('if neither the text nor the email went, it gives its mark back and says to try again', cr.status === 503 && cr.body.retry === true && !(await get(`${T}/retailOrders/n1`)).collectedNotifiedAt);
  notifyResult = { ok: true, status: 'sent' }; notified.length = 0;
  cr = await COLLECTED(req({ tenantId: 't1', orderId: 'n1' }, internal));
  check('the customer is told who collected it, and when', cr.body.sent === true && notified.length === 2 && /Alex Morgan collected your order #1400 from Opal at \d{1,2}:\d{2}/.test(String(notified[0].text || notified[0].html)), notified.map((n) => n.text || ''));
  cr = await COLLECTED(req({ tenantId: 't1', orderId: 'n1' }, internal));
  check('…once', cr.body.sent === false && notified.length === 2);
  await db.doc(`${T}/retailOrders/n2`).set(ready('n2', { stage: 'completed', handoff: { collectedBy: 'customer' } }));
  check('…and never when they collected it themselves', ((await COLLECTED(req({ tenantId: 't1', orderId: 'n2' }, internal))) as any).body.sent === false);

  // ── What the customer sees ──
  const view = OT.buildTracking('t1', ready('v1', { stage: 'completed', handoff: { collectedBy: 'someone_else', collectorName: 'Alex Morgan' } }), [{ id: 'e1', type: 'completed', at: '2026-10-24T19:42:00Z' }]);
  check('the live order page says it was picked up by the person they named, without the name (it holds no names)', view.steps.some((x: any) => x.text === 'Picked up by the person you named') && !JSON.stringify(view).includes('Alex'));
  const status = src('src/app/api/retail/order-status/route.ts');
  check('the order page is given the code and the collector only with the customer’s pass', /pickupPin: passOk && isPickup && active && order\.stage !== 'placed' && Number\(order\.pinTries \|\| 0\) < PIN_TRIES/.test(status) && /collector: passOk && isPickup/.test(status) && /collectorName: passOk && order\.handoff\.collectedBy === 'someone_else'/.test(status));
  const page = src('src/app/shop/[tenantId]/order/[orderId]/page.tsx'); const pc = src('src/components/shop/PickupCollector.tsx');
  check('the order page shows the code under the QR code, and asks who’s collecting', /<PickupCollector/.test(page) && /action: 'collector'/.test(page) && /Who’s collecting\?/.test(pc) && /Someone else/.test(pc) && /Anyone you name can collect it with your code\./.test(pc));

  check('without the pass, the shop’s notes on the order page don’t name who collected it', /hide\.push\(\[v, 'The person you named'\]\)/.test(status));
  check('they can say who’s collecting whenever it’s waiting and they have the pass (not only when there’s a code)', /collectorEditable: passOk && isPickup/.test(status) && /canChange=\{!!order\.collectorEditable\}/.test(page) && /is collecting it\./.test(pc));
  const inbox = src('src/lib/order-inbox.ts');
  check('a nudge the text or email service didn’t take gives its place back, so a retry or the email after a failed text goes', /r\?\.status === 'failed'[^]*nudges: \{ \[newsKey\]: null \}/.test(inbox) && (inbox.match(/return sendNudge\(/g) || []).length === 2);

  // ── The team's screens ──
  const sheet = src('src/components/orders/HandoverSheet.tsx'); const desk = src('src/components/pos/desk/OrderPickup.tsx');
  check('the handoff sheet says who’s collecting, and takes the code they say', /is collecting for/.test(sheet) && /Or the pickup code they say/.test(sheet) && /pin \}\)/.test(sheet));
  check('…the desk takes the code too (until it’s locked, and typing it drops a check chosen before), and hands over the part it has open', /handoffByPin\(tenantId, sel\.id, pin\)/.test(desk) && /if \(r\.locked\) \{ setPin\(''\); setPinOff\(true\); \}/.test(desk) && /setCheck\(''\); setMsg\(null\)/.test(desk) && /handoffByScan\(firestore, tenantId, sel\.qrToken, actor, sel\.id\)/.test(desk) && /is collecting for/.test(desk));
  check('the board and the order screen show who’s collecting', /\{o\.collector\.name\} is collecting/.test(src('src/components/orders/OrdersApp.tsx')) && /order\.collector\.name\} is collecting for/.test(src('src/components/orders/workspace/ShipPane.tsx')));

  // ── The database ──
  const rules = src('firestore.rules');
  check('a browser can’t name a collector, reset the code’s tries, or write how it was handed over', /'collector', 'pinTries', 'collectedNotifiedAt'\];/.test(rules) && /'holdUntilRestock', 'handoff'\];/.test(rules));
  check('the code is never written down: nothing stores it', !/pickupPin\s*:/.test(src('src/lib/retail-fulfill.ts')) && !/pickupPin\(/.test(src('src/lib/retail-fulfill.ts')));
  check('the words: no mention of the tool', ![sheet, pc, src('src/lib/pickup-pass.ts'), src('src/app/api/retail/collected-notify/route.ts')].some((t) => /claude|anthropic/i.test(t)));

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
