// Checks receipts at the drive-thru window, the kiosk and paying by phone (design board "Receipts at the counter";
// lib/receipt-actions-server, api/counter 'receipt', api/kiosk 'receipt', api/counter/pay, the screens).
// - The drive-thru screen asks with its own key, the same actions as the counter: printed, the drawer, sent.
// - Cash walked down the line into a pouch never opens the drawer.
// - The kiosk: "Get a receipt" texts or emails its private link, only for this kiosk's order and only just after it's
//   paid; the link is never shown on the kiosk.
// - Paid on the guest's own phone: the paid page links to the receipt (never one paid at the window).
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/lane-receipts.verify.ts
import Module from 'module';
import { readFileSync } from 'fs';
import { makeDb, check, failures, FV } from './fake-db';
process.env.ORDER_TRACK_SECRET = 'test-secret-for-links';
const db: any = makeDb();
const actor: any = { uid: 'm1', name: 'Ana Ruiz', role: 'manager', isManager: true, caps: [] };
const sent: any[] = [];
const M: any = Module as any; const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (fn: any) => { void Promise.resolve().then(fn); } };
  if (request === '@/lib/firebase-admin' || /\/src\/lib\/firebase-admin(\.ts)?$/.test(request)) return fake(request, { getAdminDb: () => db, getAdminAuth: () => ({}) });
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) });
  if (request === '@/lib/route-guard' || /\/src\/lib\/route-guard(\.ts)?$/.test(request)) return fake(request, { requireRole: async () => ({ actor }), requireCan: async () => ({ actor }) });
  if (request === '@/lib/audit' || /\/src\/lib\/audit(\.ts)?$/.test(request)) return fake(request, { logAuditAdmin: async () => {}, auditEntry: () => ({}) });
  if (request === '@/lib/rate-limit' || /\/src\/lib\/rate-limit(\.ts)?$/.test(request)) return fake(request, { limitPublic: async () => null });
  if (request === '@/lib/notify' || /\/src\/lib\/notify(\.ts)?$/.test(request)) return fake(request, { sendNotification: async (_db: any, m: any) => { sent.push(m); return { ok: true }; } });
  return load.call(this, request, ...rest);
};
const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const src = (p: string) => readFileSync(p, 'utf8');
const req = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (String(k).toLowerCase() === 'authorization' ? 'Bearer t' : null) }, nextUrl: { origin: 'https://app.example', searchParams: new URLSearchParams() } }) as any;
const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
const jobs = async () => (await db.collection(`${T}/printJobs`).get()).docs.map((d: any) => d.data());
const order = (x: any = {}) => ({ number: 'D31', channel: 'drive-thru', status: 'sent', guestName: 'Lee', paidAt: ago(1), payMethod: 'cash', paidBy: 'Window', createdAt: ago(3),
  lines: [{ lineId: 'a', itemId: 'latte', name: 'Latte', quantity: 1, unitPrice: 5, choicesText: null }], subtotal: 5, tax: 0.4, total: 5.4, cashTendered: 10, changeGiven: 4.6, ...x });

(async () => {
  const { POST: kitchen } = await import('../../src/app/api/kitchen/route');
  const { POST: LANE } = await import('../../src/app/api/counter/route');
  const { POST: KIOSK } = await import('../../src/app/api/kiosk/route');
  const { POST: PAY } = await import('../../src/app/api/counter/pay/route');
  const { screenOf } = await import('../../src/lib/screen-keys');
  await db.doc(T).set({ name: 'North Pier Coffee', timezone: 'UTC', businessType: 'hospitality', plan: 'pro' });
  await db.doc(`${T}/printers/front`).set({ name: 'Window printer', kind: 'star', cols: 48, stations: [], tickets: false, checks: false, buzz: false, receipts: true, drawer: true, key: 'k'.repeat(32) });
  const lane = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Window', kind: 'drive-thru' }))).body.key;
  const kiosk = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Kiosk by the door', kind: 'kiosk' }))).body.key;
  const kiosk2 = (await kitchen(req({ action: 'pair', tenantId: 't1', name: 'Kiosk two', kind: 'kiosk' }))).body.key;
  check('screens set up', typeof lane === 'string' && typeof kiosk === 'string' && typeof kiosk2 === 'string');
  const kioskId = (await screenOf(db, 't1', kiosk))!.ref.id;
  await db.doc(`${T}/counterOrders/d1`).set(order());
  await db.doc(`${T}/counterOrders/d2`).set(order({ number: 'D32', cashInPouch: true, pouchOpen: true }));
  await db.doc(`${T}/counterOrders/c1`).set(order({ number: 'C14', channel: 'counter' }));
  const L = (b: any) => LANE(req({ tenantId: 't1', key: lane, ...b })) as Promise<any>;

  console.log('the drive-thru window, with its own key');
  let r = await L({ action: 'receipt', orderId: 'd1', do: 'print', drawer: true });
  let j = await jobs();
  check('printed on the receipt printer, the drawer with it (cash, just paid)', r.body.ok && r.body.printer === 'Window printer' && r.body.drawer === true && j.length === 1 && j[0].kind === 'receipt' && j[0].doc.drawer === true, [r.body, j]);
  check('…once', (await L({ action: 'receipt', orderId: 'd1', do: 'drawer' })).status === 409);
  r = await L({ action: 'receipt', orderId: 'd2', do: 'print', drawer: true }); const d2 = await L({ action: 'receipt', orderId: 'd2', do: 'drawer' });
  check('cash into a pouch in line: the receipt prints, the drawer never opens', r.body.ok && r.body.drawer === false && d2.status === 409 && !(await get(`${T}/counterOrders/d2`)).drawerOpenedAt);
  r = await L({ action: 'receipt', orderId: 'd1', do: 'send', channel: 'sms', to: '5035550142' });
  check('sent by text, kept on the order by the screen’s name', r.body.ok && sent.length === 1 && /\/r\/t1\/co_d1\?k=/.test(sent[0].text) && (await get(`${T}/counterOrders/d1`)).receiptSends[0].by === 'Window');
  r = await L({ action: 'receipt', orderId: 'c1', do: 'link' });
  check('never the counter’s orders, nor a made-up action or order', r.status === 409 && (await L({ action: 'receipt', orderId: 'd1', do: 'open' })).status === 400 && (await L({ action: 'receipt', orderId: 'nope', do: 'link' })).status === 404);
  check('a wrong key does nothing', (await LANE(req({ tenantId: 't1', key: 'x'.repeat(40), action: 'receipt', orderId: 'd1', do: 'link' })) as any).status === 401);

  console.log('the kiosk');
  await db.doc(`${T}/counterOrders/k1`).set(order({ number: 'K12', channel: 'kiosk', payMethod: 'card', cashTendered: null, changeGiven: null, kiosk: { screen: kioskId, state: 'paid' } }));
  await db.doc(`${T}/counterOrders/k2`).set(order({ number: 'K13', channel: 'kiosk', payMethod: 'card', paidAt: ago(45), kiosk: { screen: kioskId, state: 'paid' } }));
  await db.doc(`${T}/counterOrders/k3`).set(order({ number: 'K14', channel: 'kiosk', payMethod: null, paidAt: null, kiosk: { screen: kioskId, state: 'paying' } }));
  const K = (b: any, kk = kiosk) => KIOSK(req({ tenantId: 't1', key: kk, ...b })) as Promise<any>;
  sent.length = 0;
  r = await K({ action: 'receipt', orderId: 'k1', channel: 'sms', to: '5035550142' });
  check('Get a receipt: texted, and the link isn’t shown on the kiosk', r.body.ok && !r.body.url && sent.length === 1 && sent[0].channel === 'sms' && /\/r\/t1\/co_k1\?k=/.test(sent[0].text), [r.body, sent]);
  check('…no name typed at the kiosk goes in the message', /^Hi there, here is your receipt/.test(sent[0].text) && !/Lee/.test(sent[0].text), sent[0].text);
  r = await K({ action: 'receipt', orderId: 'k1', channel: 'email', to: 'lee@example.com' });
  check('…or emailed', r.body.ok && sent.length === 2 && sent[1].channel === 'email' && sent[1].to === 'lee@example.com');
  const bads = await Promise.all([K({ action: 'receipt', orderId: 'k1', channel: 'sms', to: '555' }), K({ action: 'receipt', orderId: 'k1', channel: 'email', to: 'lee@' })]);
  check('ten digits, or an email that looks right', bads.every((x: any) => x.status === 400) && sent.length === 2);
  const late = await K({ action: 'receipt', orderId: 'k2', channel: 'sms', to: '5035550142' }); const unpaid = await K({ action: 'receipt', orderId: 'k3', channel: 'sms', to: '5035550142' });
  check('only just after it’s paid', late.status === 409 && unpaid.status === 409 && sent.length === 2);
  const other = await K({ action: 'receipt', orderId: 'k1', channel: 'sms', to: '5035550142' }, kiosk2); const lanes = await K({ action: 'receipt', orderId: 'd1', channel: 'sms', to: '5035550142' });
  check('only this kiosk’s own order', other.status === 404 && lanes.status === 404 && sent.length === 2);
  await K({ action: 'receipt', orderId: 'k1', channel: 'sms', to: '5035550199' });
  const fourth = await K({ action: 'receipt', orderId: 'k1', channel: 'sms', to: '5035550188' });
  check('…three at most for one order', fourth.status === 429 && sent.length === 3 && (await get(`${T}/counterOrders/k1`)).receiptSends.length === 3, [fourth.body, sent.length]);
  const kr = src('src/app/api/kiosk/route.ts');
  check('…so many an hour', kr.includes("limitPublic(req, 'kiosk_receipt', tenantId, { perHour: 120, perDay: 1500 })"));

  console.log('paid on their own phone');
  const CP = await import('../../src/lib/counter-phone');
  await db.doc(`${T}/counterOrders/p1`).set(order({ number: 'D40', payMethod: 'card', paidVia: 'phone', cashTendered: null, changeGiven: null }));
  await db.doc(`${T}/counterOrders/p2`).set(order({ number: 'D41', payMethod: 'cash' }));
  const v1: any = await PAY(req({ action: 'view', tenantId: 't1', o: 'p1', s: CP.phoneSig('t1', 'p1') }));
  const v2: any = await PAY(req({ action: 'view', tenantId: 't1', o: 'p2', s: CP.phoneSig('t1', 'p2') }));
  const key1 = (await get(`${T}/counterOrders/p1`)).receiptKey;
  check('the paid page links to the receipt', v1.body.ok && v1.body.paid && v1.body.receiptUrl === `https://app.example/r/t1/co_p1?k=${key1}`, v1.body);
  check('…never one paid at the window', v2.body.ok && v2.body.paid && !v2.body.receiptUrl && !(await get(`${T}/counterOrders/p2`)).receiptKey);

  console.log('the screens');
  const dt = src('src/app/drive-thru/[tenantId]/page.tsx');
  check('the drive-thru: the receipt after paying, cash in a pouch never the drawer', dt.includes("if (!d.paidOtherwise) setSlip({ orderId: order.id, title: `Order ${order.number}${order.guestName ? `, ${order.guestName}` : ''}`, cash: how === 'cash' && !d.inPouch,")
    && dt.includes('const cardSlip = (d: any) =>') && dt.includes('cardSlip(d); load();'));
  check('…asked with the screen’s own key', dt.includes("const receiptVia = (orderId: string): ReceiptCall => async ({ action, ...rest }) => (await post({ ...rest, action: 'receipt', orderId, do: action })).d;") && dt.includes('call={receiptVia(slip.orderId)}'));
  check('…Receipt again at the pickup window, nothing printed by itself', dt.includes("order.paidAt && order.payMethod !== 'staff' && order.payMethod !== 'app' && slip?.orderId !== order.id") && dt.includes('cash: false, change: null, later: true })}'));
  const ks = src('src/app/drive-thru/[tenantId]/kiosk/page.tsx');
  check('the kiosk: Get a receipt, by text or email, nothing kept on the screen', (ks.includes('>Get a receipt</button>') || ks.includes(">{t('Get a receipt')}</button>")) && ks.includes("action: 'receipt', tenantId, key: kioskKey, orderId, channel: way") && ks.includes('Nothing is kept on this screen.') && ks.includes('setReceipting(false); setReceiptSent(\'\');'));
  check('…it waits while they type, then starts over', ks.includes('if (texting || receipting ? now - touched.current > IDLE_MS : now - paidAt.current > PAID_MS) startOver();'));
  const pp = src('src/app/drive-thru/[tenantId]/pay/page.tsx');
  check('paying by phone: See your receipt', pp.includes('See your receipt') && pp.includes('v.receiptUrl'));
  check('house style', [ks, dt, pp].every((x) => !/\buppercase\b|font-black|\{\/\*/.test(x)));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
