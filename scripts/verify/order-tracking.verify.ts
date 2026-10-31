// Checks Phase B, round 3: the customer's order page changes as each step happens (lib/order-tracking).
//   - the live view holds only real steps of the order (never the team's notes, holds or wrong scans), when each
//     happened, and how many items are collected out of how many; never a name, contact, address or the items' names;
//   - its key is signed from the order, different for every order and shop; it's removed once the order's link expires;
//   - it's brought up to date by the order steps (as they happen), by a check-in and a payment, and by the order page's
//     own ask (written only when something changed);
//   - only the server writes it, and it's read one at a time by its key;
//   - the order page listens to it, shows the items collected and the steps so far, and asks for the whole order less
//     often while it hears it.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/order-tracking.verify.ts
import Module from 'module';
import fs from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
const afterJobs: Promise<any>[] = [];
let actor: any = { uid: 'k1', name: 'Kai Park', role: 'staff', isManager: false, isTenantOwner: false, caps: [] };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (fn: any) => { afterJobs.push(Promise.resolve().then(fn)); } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === 'firebase-admin/app') return fake(request, { initializeApp: () => ({ name: 'x' }), getApps: () => [{ name: 'admin-retail-status' }, { name: 'x' }], cert: () => ({}) });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) });
  return load.call(this, request, ...rest);
};
(globalThis as any).fetch = async () => ({ ok: true, json: async () => ({ ok: true }) });
process.env.CRON_SECRET = 'test-secret';

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const src = (p: string) => fs.readFileSync(p, 'utf8');
const settle = async () => { while (afterJobs.length) await afterJobs.shift(); };
const line = (x: any = {}) => ({ lineId: 'A', productId: 'gel', barcode: '012345678905', name: 'Gel polish', unitPriceCents: 1500, qtyOrdered: 2, qtyScanned: 0, qtyShorted: 0, qtyReturned: 0, status: 'pending', ...x });
const order = (x: any = {}) => ({ id: 'o1', tenantId: 't1', orderNumber: 1201, stage: 'paid', method: 'counter', lines: [line(), line({ lineId: 'B', name: 'Top coat', barcode: '036000291452', qtyOrdered: 1 })], customerName: 'Dana Whitfield', customerEmail: 'dana@example.com', customerPhone: '+15551234567', shippingAddress: { line1: '88 Pine St' }, qrToken: 'o1.abcdef', totalCents: 4500, placedAt: '2026-10-24T10:00:00Z', paidAt: '2026-10-24T10:01:00Z', ...x });

(async () => {
  const OT = await import('../../src/lib/order-tracking');

  // ── What it holds ──
  const evs = [
    { id: 'e1', type: 'placed', at: '2026-10-24T10:00:00Z', actorName: 'Dana Whitfield' },
    { id: 'e2', type: 'payment_confirmed', at: '2026-10-24T10:01:00Z', actorName: 'Stripe' },
    { id: 'e3', type: 'batch_claimed', at: '2026-10-24T10:05:00Z', actorName: 'Kai Park' },
    { id: 'e4', type: 'item_scanned', at: '2026-10-24T10:06:00Z', actorName: 'Kai Park', meta: { lineId: 'A' } },
    { id: 'e5', type: 'scan_mismatch', at: '2026-10-24T10:06:30Z', actorName: 'Kai Park' },
    { id: 'e6', type: 'note', at: '2026-10-24T10:07:00Z', actorName: 'Kai Park', meta: { text: 'Customer is rude' } },
    { id: 'e7', type: 'held_for_review', at: '2026-10-24T10:08:00Z', actorName: 'Mia' },
    { id: 'e8', type: 'order_cancelled', at: '2026-10-24T11:00:00Z' },
  ];
  const t = OT.buildTracking('t1', order({ lines: [line({ qtyScanned: 1 }), line({ lineId: 'B', qtyOrdered: 1, qtyShorted: 1, status: 'refunded' })] }), evs);
  check('the steps so far are the real steps of the order, in order, with when each happened', t.steps.map((x) => x.text).join(' | ') === 'Order placed | Paid | We started getting it ready | Canceled' && t.steps[1].at === '2026-10-24T10:01:00Z', t.steps);
  check('…never the team’s notes, holds, wrong scans or each scan (those become the item counts)', !t.steps.some((x) => /rude|review|Wrong|Scanned/i.test(x.text)));
  check('the items collected out of how many, a missing one not counted as still to come', t.items.collected === 1 && t.items.total === 2 && t.items.lines.find((l) => l.lineId === 'B')?.missing === 1, t.items);
  const raw = JSON.stringify(t);
  check('nothing in it names the customer, how to reach them, where they live, the items, or the team', !/Dana|Whitfield|dana@|5551234567|Pine|Gel polish|Top coat|Kai|Mia|Stripe|012345678905/.test(raw), raw);
  const withOut = OT.buildTracking('t1', order({ stage: 'arrived', method: 'curbside', curbside: { bringingOutAt: '2026-10-24T12:00:00Z', bringingOutBy: 'Kai Park', bringingOutPhoto: 'https://x/p.jpg' } }), []);
  check('who’s bringing it out: their first name and photo only', withOut.bringingOut?.name === 'Kai' && withOut.bringingOut?.photo === 'https://x/p.jpg');
  check('its key is signed from the order: different for every order and every shop, and the same each time', OT.trackingKey('t1', 'o1') === OT.trackingKey('t1', 'o1') && OT.trackingKey('t1', 'o1') !== OT.trackingKey('t1', 'o2') && OT.trackingKey('t1', 'o1') !== OT.trackingKey('t2', 'o1') && !OT.trackingKey('t1', 'o1').includes('o1') && OT.trackingKey('t1', 'o1').length >= 30);

  // ── Kept up to date by the order steps ──
  await db.doc(T).set({ name: 'Opal', retailSettings: {} });
  await db.doc(`${T}/inventory/gel`).set({ id: 'gel', name: 'Gel polish', type: 'retail', totalStock: 10, stockReserved: 3, batches: [{ id: 'b1', stock: 10, costPerUnit: 4 }] });
  await db.doc(`${T}/retailOrders/o1`).set(order());
  const key = OT.trackingKey('t1', 'o1');
  const { POST } = await import('../../src/app/api/retail/fulfil/route');
  const step = async (action: string, args: any = {}) => { const r: any = await POST({ json: async () => ({ tenantId: 't1', action, ...args }), headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? 'Bearer t' : null) }, nextUrl: { origin: 'https://app.example' } } as any); await settle(); return r; };
  await step('claimOrder', { orderId: 'o1' });
  let tv = await get(`orderTracking/${key}`);
  check('claiming the order updates its live view as it happens', tv?.stage === 'picking' && tv.steps.some((x: any) => x.type === 'batch_claimed'), tv);
  await step('scanItem', { orderId: 'o1', value: '012345678905' });
  tv = await get(`orderTracking/${key}`);
  check('…and each scan, item by item', tv?.items?.collected === 1 && tv.items.total === 3 && tv.items.lines.find((l: any) => l.lineId === 'A')?.collected === 1, tv?.items);

  // ── …and by the order page's own ask, written only when something changed ──
  const { GET: STATUS } = await import('../../src/app/api/retail/order-status/route');
  const ask = async () => { const r: any = await STATUS({ nextUrl: { searchParams: new URLSearchParams({ tenantId: 't1', orderId: 'o1' }) }, headers: { get: () => null } } as any); return r; };
  let r = await ask();
  check('the order page is given the live view’s key, the steps so far and each item collected', r.body?.track?.key === key && r.body.track.items.collected === 1 && r.body.order.lines.find((l: any) => l.lineId === 'A')?.qtyCollected === 1, r.body?.track);
  const before = (await get(`orderTracking/${key}`)).updatedAt;
  await new Promise((res) => setTimeout(res, 5));
  await ask();
  check('…and asking again with nothing changed doesn’t write it again', (await get(`orderTracking/${key}`)).updatedAt === before);
  await db.doc(`${T}/retailOrders/o1/events/x1`).set({ id: 'x1', type: 'address_updated', at: '2026-10-24T10:30:00Z', actorName: 'Dana' });
  await ask();
  check('…while a step another route wrote shows within one ask', (await get(`orderTracking/${key}`)).steps.some((x: any) => x.type === 'address_updated'));

  // ── A check-in and a payment ──
  await db.doc(`${T}/retailOrders/o2`).set(order({ id: 'o2', stage: 'ready', method: 'curbside', qrToken: 'o2.tok' }));
  const { POST: ARRIVE } = await import('../../src/app/api/retail/arrive/route');
  await ARRIVE({ json: async () => ({ tenantId: 't1', orderId: 'o2', qrToken: 'o2.tok', spotOrVehicle: 'Spot 3' }), headers: { get: () => null } } as any);
  check('a check-in shows on the live view as it happens', (await get(`orderTracking/${OT.trackingKey('t1', 'o2')}`))?.stage === 'arrived');
  check('a payment does too (order-paid brings it up to date when the order is paid)', /if \(out\?\.won\) \{ try \{ const \{ syncTracking \} = await import\('\.\/order-tracking'\); await syncTracking\(db, tenantId, orderId\);/.test(src('src/lib/order-paid.ts')));

  // ── Gone once the link expires ──
  await db.doc(`${T}/retailOrders/o3`).set(order({ id: 'o3', stage: 'completed', completedAt: '2025-01-01T00:00:00Z' }));
  await db.doc(`orderTracking/${OT.trackingKey('t1', 'o3')}`).set({ v: 1, stage: 'completed' });
  await OT.syncTracking(db, 't1', 'o3');
  check('an order whose link has expired has no live view any more', !(await get(`orderTracking/${OT.trackingKey('t1', 'o3')}`)));

  // ── The rules and the page ──
  const rules = src('firestore.rules');
  check('the live view is read one at a time by its key, never listed, and only the server writes it', /match \/orderTracking\/\{key\} \{\s*allow get: if true;\s*allow list, write: if false;\s*\}/.test(rules));
  const page = src('src/app/shop/[tenantId]/order/[orderId]/page.tsx');
  // ── What the review found ──
  const shuffled = (x: any): any => Array.isArray(x) ? x.map(shuffled) : x && typeof x === 'object' ? Object.keys(x).sort().reverse().reduce((o: any, k) => { o[k] = shuffled(x[k]); return o; }, {}) : x;
  const b1 = OT.buildTracking('t1', order(), evs);
  check('a view read back with its fields in another order (Firestore sorts them) has the same fingerprint, so it isn’t written again', OT.trackingSig(shuffled(b1)) === b1.sig && OT.trackingSig(b1) === b1.sig);
  await db.doc(`orderTracking/${key}`).set(shuffled(await get(`orderTracking/${key}`)));
  const u0 = (await get(`orderTracking/${key}`)).updatedAt; await ask();
  check('…and the order page’s ask leaves such a view alone (no write, so no listener fires, so no loop)', (await get(`orderTracking/${key}`)).updatedAt === u0);
  const dig = OT.buildTracking('t1', order({ lines: [line(), { lineId: 'D', name: 'Nail art course', digital: true, qtyOrdered: 1, qtyScanned: 0, qtyShorted: 0 }] }), []);
  check('a download isn’t counted as an item to collect, and the page doesn’t show it as “0 of 1 collected”', dig.items.total === 2 && !dig.items.lines.some((l) => l.lineId === 'D') && /\(l as any\)\.digital === true\) return null;/.test(src('src/app/shop/[tenantId]/order/[orderId]/page.tsx')));
  const done = OT.buildTracking('t1', order({ stage: 'completed', method: 'curbside', curbside: { bringingOutAt: '2026-10-24T12:00:00Z', bringingOutBy: 'Kai Park', bringingOutPhoto: 'https://x/p.jpg' } }), []);
  check('who brought it out is gone once it’s handed over', done.bringingOut === null);
  const reo = OT.buildTracking('t1', order({ lines: [line({ qtyShorted: 0 })] }), [{ id: 'a', type: 'line_shorted', at: '2026-10-24T10:10:00Z' }, { id: 'b', type: 'line_reopened', at: '2026-10-24T10:12:00Z' }, { id: 'c', type: 'pick_complete', at: '2026-10-24T10:13:00Z' }]);
  check('a missing item found after all says so, after it said out of stock', reo.steps.map((x) => x.text).join(' | ') === 'An item is out of stock | The missing item was found after all | Everything is collected', reo.steps);
  const sh = OT.buildTracking('t1', order({ lines: [line({ qtyShorted: 1, qtyScanned: 1 })] }), [{ id: 'c', type: 'pick_complete', at: '2026-10-24T10:13:00Z' }]);
  check('…and “everything is collected” doesn’t claim what’s missing', sh.steps[0]?.text === 'Everything we have is collected');
  check('the history it reads is only the steps the customer sees (never every scan), so a long order’s later steps still show', !OT.STEP_TYPES.includes('item_scanned' as any) && OT.STEP_TYPES.includes('completed' as any) && /where\('type', 'in', STEP_TYPES\.slice/.test(src('src/lib/order-tracking.ts')) && !/orderBy\('at', 'asc'\)\.limit\(300\)/.test(src('src/lib/order-tracking.ts') + src('src/app/api/retail/order-status/route.ts')));
  await db.doc('orderTracking/told').set({ v: 1, expiresAt: '2020-01-01T00:00:00Z' }); await db.doc('orderTracking/fresh').set({ v: 1, expiresAt: '2099-01-01T00:00:00Z' });
  const swept = await OT.sweepTracking(db);
  check('the nightly sweep removes live views past their time, and only those', swept >= 1 && !(await get('orderTracking/told')) && !!(await get('orderTracking/fresh')) && /sweepTracking\(db\)/.test(src('src/app/api/cron/retail-nightly/route.ts')));
  check('every view carries when it goes (the order link’s expiry, or a while after its last step)', typeof b1.expiresAt === 'string' && b1.expiresAt > b1.updatedAt);
  const saved = process.env.CRON_SECRET; delete process.env.CRON_SECRET;
  check('without the server’s own secret there’s no live view (never a key anyone could work out)', OT.trackingKey('t1', 'o1') === '' && !/'order-track'|STRIPE_SECRET_KEY/.test(src('src/lib/order-tracking.ts')));
  process.env.CRON_SECRET = saved;
  check('a delivery recorded by the carrier is the order’s “Delivered” step, once', /doc\(eventIdFor\('completed', 'delivered'\)\)/.test(src('src/app/api/retail/shippo-webhook/route.ts')) && /type: 'completed', at:/.test(src('src/app/api/retail/shippo-webhook/route.ts')) && /syncTracking\(db, tenantId, d\.id\)/.test(src('src/app/api/retail/shippo-webhook/route.ts')));
  check('refunds and the customer’s own changes show on the live view as they happen', ['src/app/api/retail/refund/route.ts', 'src/app/api/retail/self-serve/route.ts'].every((p) => /const res: any = await handle\(req\);[^]*syncTracking\(getAdminDbForTracking\(\), t, id\)/.test(src(p))));
  const pg = src('src/app/shop/[tenantId]/order/[orderId]/page.tsx');
  check('the page starts from the fingerprint the order came with, counts a kept copy as heard but never as news, and asks for the order on a real change only while it’s going and showing',
    /if \(data\.track\.sig\) sigRef\.current = String\(data\.track\.sig\);/.test(pg) && /setListening\(true\);\s*if \(snap\.metadata\.fromCache\) return;/.test(pg) && /const changed = sig !== sigRef\.current;/.test(pg) && /if \(changed && activeRef\.current && document\.visibilityState === 'visible'\) void load\(\);/.test(pg));
  check('…and catches up when the customer comes back to the tab', /document\.addEventListener\('visibilitychange', onShow\)/.test(pg) && /removeEventListener\('visibilitychange', onShow\)/.test(pg));
  check('the order page is given the live view’s fingerprint with its key', /track = \{ key: trackingKey\(tenantId, orderId\), sig: built\.sig,/.test(src('src/app/api/retail/order-status/route.ts')));
  check('steps written under older names (ready, arrived, paid, order_cancelled) are read too', /Object\.keys\(OLD_NAMES\)/.test(src('src/lib/order-tracking.ts')));
  check('the progress line doesn’t say everything is collected when an item is missing', /'Everything we have is collected' : 'Everything is collected'/.test(pg));
  await db.doc(`orderTracking/${key}`).set({ ...(await get(`orderTracking/${key}`)), expiresAt: new Date(Date.now() + 2 * 864e5).toISOString() });
  await ask();
  check('an order still going keeps its live view: one nearly due to go is given more time', (await get(`orderTracking/${key}`)).expiresAt > new Date(Date.now() + 30 * 864e5).toISOString());

  check('the order page listens to the live view, and asks for the whole order every minute while it hears it (it used to ask every 4 seconds)',
    /onSnapshot\(doc\(fs, 'orderTracking', trackKey\)/.test(page) && /const LISTEN_POLL_MS = 60000;/.test(page) && /listening \|\| slowPoll \? LISTEN_POLL_MS : ACTIVE_POLL_MS/.test(page) && !/ACTIVE_POLL_MS = 4000/.test(page));
  check('…and shows the items collected, item by item, and the steps so far with their times', /Collecting your items/.test(page) && /of \$\{want\} collected/.test(page) && />So far</.test(page) && /stepTime\(st\.at, order\.timeZone\)/.test(page) && /role="progressbar"/.test(page));
  check('the words: no mention of the tool, US spelling, no "call us"', !new RegExp(['cl', 'aude|anth', 'ropic|call us'].join(''), 'i').test(src('src/lib/order-tracking.ts')) && /Canceled/.test(src('src/lib/order-tracking.ts')));

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
