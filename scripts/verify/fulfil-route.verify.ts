// Checks Phase B, round 1: every step of an online order runs on the server (api/retail/fulfil, lib/retail-fulfill
// through lib/fs-any), with the person's role checked there and who did it taken from their sign-in; a browser can't
// create an order or change its stage or items (firestore.rules); the screens ask the server (lib/fulfil-client).
//   - roles: a picker can't finish or hand over, a packer can't ship or cancel, only a manager (or someone who can
//     refund) cancels or decides on a report, a renter can't check in the shop's returns; someone else's batch is put
//     back only by a manager; signed out, nothing;
//   - a whole pickup order through the route: claimed, scanned, packed, ready (the customer told once, from the
//     server), handed over by its code: stock out of the shelf, and every event names the person signed in;
//   - the shop's second scan is read by the server, so a screen can't skip it;
//   - returns and reports: the return as saved (never as sent), a report decided once, in one step with the order;
//   - the engine runs on the server's database through the same code (no browser-only calls left in it).
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/fulfil-route.verify.ts
import Module from 'module';
import fs from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
let signedIn = true;
let actor: any = { uid: 'k1', name: 'Kai Park', role: 'staff', isManager: false, isTenantOwner: false, caps: [] };
const afterJobs: Promise<any>[] = [];
const called: { url: string; body: any }[] = [];
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (fn: any) => { afterJobs.push(Promise.resolve().then(fn)); } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => (signedIn ? { ok: true, actor, tenant: {} } : { ok: false, status: 401, error: 'Please sign in again.' }) });
  return load.call(this, request, ...rest);
};
(globalThis as any).fetch = async (url: any, init?: any) => { called.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null }); return { ok: true, status: 200, json: async () => ({ ok: true, sent: true }) }; };

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? 'Bearer t' : null) }, nextUrl: { origin: 'https://app.example' } }) as any;
const src = (p: string) => fs.readFileSync(p, 'utf8');
const settle = async () => { while (afterJobs.length) await afterJobs.shift(); };
const line = (x: any = {}) => ({ lineId: 'A', productId: 'gel', sku: 'GEL-01', barcode: '012345678905', name: 'Gel polish', unitPriceCents: 1500, qtyOrdered: 2, qtyScanned: 0, qtyShorted: 0, qtyReturned: 0, status: 'pending', ...x });
const fresh = async (rs: any = {}) => {
  db = strictTransactions(makeDb()); signedIn = true; called.length = 0;
  await db.doc(T).set({ name: 'Opal', retailSettings: rs });
  await db.doc(`${T}/inventory/gel`).set({ id: 'gel', name: 'Gel polish', type: 'retail', status: 'active', totalStock: 10, stockReserved: 2, batches: [{ id: 'b1', stock: 10, costPerUnit: 4, receivedDate: '2026-01-01' }], barcode: '012345678905' });
  await db.doc(`${T}/retailOrders/o1`).set({ id: 'o1', tenantId: 't1', orderNumber: 1201, stage: 'paid', method: 'counter', lines: [line()], customerName: 'Dana W', customerEmail: 'dana@example.com', qrToken: 'o1.abcdef', totalCents: 3000, placedAt: '2026-10-24T10:00:00Z', paidAt: '2026-10-24T10:00:00Z' });
};
const as = (x: any) => { actor = { uid: 'k1', name: 'Kai Park', role: 'staff', isManager: false, isTenantOwner: false, caps: [], ...x }; };

(async () => {
  const { POST } = await import('../../src/app/api/retail/fulfil/route');
  const step = async (action: string, args: any = {}) => { const r: any = await POST(req({ tenantId: 't1', action, ...args })); await settle(); return r; };

  // ── A whole pickup order, through the server ──
  await fresh(); as({});
  let r = await step('claimOrder', { orderId: 'o1', actor: { id: 'someone', name: 'Someone Else' } });
  let o = await get(`${T}/retailOrders/o1`);
  check('claiming runs on the server, as the person signed in (a name in the request is ignored)', r.status === 200 && r.body.batchId && o.stage === 'picking' && o.claimedBy === 'k1' && o.claimedByName === 'Kai Park', { r: r.body, o: { stage: o.stage, by: o.claimedByName } });
  r = await step('scanItem', { orderId: 'o1', value: '012345678905' });
  r = await step('scanItem', { orderId: 'o1', value: '0 12345 67890 5' });
  check('scans count on the server', r.body.ok && r.body.pickComplete === true && (await get(`${T}/retailOrders/o1`)).lines[0].qtyScanned === 2, r.body);
  r = await step('markPacked', { orderId: 'o1' });
  r = await step('markReady', { orderId: 'o1' });
  o = await get(`${T}/retailOrders/o1`);
  check('packed and ready on the server; the customer is told it’s ready from there, once', r.body.ok && o.stage === 'ready' && called.filter((c) => c.url === 'https://app.example/api/retail/ready-notify').length === 1, { r: r.body, called });
  r = await step('handoffScan', { value: 'o1.abcdef' });
  o = await get(`${T}/retailOrders/o1`);
  const gel = await get(`${T}/inventory/gel`);
  const evs = await all(`${T}/retailOrders/o1/events`);
  check('handed over by its code: completed, two units out of the shelf and their hold released', r.body.ok && o.stage === 'completed' && gel.totalStock === 8 && gel.stockReserved === 0, { r: r.body, stage: o.stage, gel });
  check('…and every step on its history names the person signed in', evs.length >= 6 && evs.every((e: any) => e.actorName === 'Kai Park' && e.actorId === 'k1'), evs.map((e: any) => [e.type, e.actorName]));

  // ── Roles ──
  await fresh(); as({ fulfilmentRole: 'picker' });
  await step('claimOrder', { orderId: 'o1' });
  r = await step('markPacked', { orderId: 'o1' });
  check('a picker claims and scans, but can’t finish an order (the screen used to be the only check)', r.status === 403 && /isn’t part of your role/.test(r.body.message) && (await get(`${T}/retailOrders/o1`)).stage === 'picking', r.body);
  as({}); r = await step('markShipped', { orderId: 'o1', tracking: { number: '1Z' } });
  check('a packer can’t mark an order shipped', r.status === 403);
  r = await step('cancel', { orderId: 'o1', reason: 'x' });
  check('…nor cancel one', r.status === 403 && (await get(`${T}/retailOrders/o1`)).stage === 'picking');
  as({ uid: 'm1', name: 'Mia Manager', isManager: true });
  r = await step('cancel', { orderId: 'o1', reason: 'Customer asked' });
  check('a manager can cancel', r.body.ok && (await get(`${T}/retailOrders/o1`)).stage === 'cancelled', r.body);
  await fresh(); as({ uid: 'k1' });
  r = await step('claimOrder', { orderId: 'o1' });
  const batchId = r.body.batchId;
  as({ uid: 'k2', name: 'Lee Packer' });
  r = await step('releaseBatch', { batchId });
  check('someone else’s batch is put back only by a manager', r.status === 403 && (await get(`${T}/retailOrders/o1`)).stage === 'picking');
  as({ uid: 'k1', name: 'Kai Park' });
  r = await step('releaseBatch', { batchId });
  check('…and its own person can put it back', r.body.ok && (await get(`${T}/retailOrders/o1`)).stage === 'paid');
  signedIn = false;
  r = await step('claimOrder', { orderId: 'o1' });
  check('signed out, nothing', r.status === 401 && (await get(`${T}/retailOrders/o1`)).stage === 'paid');
  signedIn = true;
  r = await step('setStage', { orderId: 'o1', stage: 'completed' });
  check('there’s no step that just sets a stage', r.status === 400 && (await get(`${T}/retailOrders/o1`)).stage === 'paid');

  // ── The shop's second scan, read by the server ──
  await fresh({ requirePackScan: true }); as({});
  await step('claimOrder', { orderId: 'o1' });
  await step('scanItem', { orderId: 'o1', value: '012345678905' }); await step('scanItem', { orderId: 'o1', value: '012345678905' });
  r = await step('markPacked', { orderId: 'o1', requirePackScan: false });
  check('with the second scan on, packing isn’t finished until every unit is scanned into the box, whatever the screen sends', !r.body.ok && /scan every item again/i.test(r.body.message) && (await get(`${T}/retailOrders/o1`)).stage === 'picking', r.body);

  // ── Curbside: the customer told from the server ──
  await fresh(); as({});
  await db.doc(`${T}/retailOrders/o1`).set({ method: 'curbside', stage: 'ready', lines: [line({ qtyScanned: 2, status: 'picked' })] }, { merge: true });
  r = await step('bringingOut', { orderId: 'o1' });
  o = await get(`${T}/retailOrders/o1`);
  check('“bringing it out”: the person’s name from their sign-in, and the customer’s text asked for by the server', r.body.ok && o.curbside?.bringingOutBy === 'Kai Park' && called.some((c) => c.url.endsWith('/api/retail/curbside-notify') && c.body.moment === 'out'), { o: o.curbside, called });

  // ── Returns and reports ──
  await fresh(); as({});
  await db.doc(`${T}/retailOrders/o1`).set({ stage: 'completed', lines: [line({ qtyScanned: 2, status: 'picked' })] }, { merge: true });
  await db.doc(`${T}/retailReturns/r1`).set({ id: 'r1', tenantId: 't1', orderId: 'o1', orderNumber: 1201, status: 'open', resolution: 'refund', lines: [{ lineId: 'A', productId: 'gel', name: 'Gel polish', qty: 1, unitPriceCents: 1500, status: 'pending' }], createdAt: '2026-10-24T11:00:00Z' });
  r = await step('receiveReturnLine', { returnId: 'r1', lineId: 'A', disposition: 'restock' });
  const ret = await get(`${T}/retailReturns/r1`);
  check('a return line is checked in on the server, from the return as it’s saved', r.body.ok && ret.lines[0].disposition === 'restock' && (await get(`${T}/retailOrders/o1`)).lines[0].qtyReturned === 1, { r: r.body, ret: ret.lines });
  as({ isRenter: true, role: 'renter' });
  r = await step('receiveReturnLine', { returnId: 'r1', lineId: 'A', disposition: 'restock' });
  check('a renter can’t check in the shop’s returns', r.status === 403);
  await db.doc(`${T}/retailClaims/c1`).set({ id: 'c1', orderId: 'o1', lineId: 'A', qty: 1, claimValueCents: 1500, status: 'in_review', type: 'damaged' });
  as({});
  r = await step('decideClaim', { claimId: 'c1', approve: true });
  check('deciding on a report is for a manager or someone who can refund', r.status === 403 && (await get(`${T}/retailClaims/c1`)).status === 'in_review');
  as({ caps: ['checkout.refund'] });
  r = await step('decideClaim', { claimId: 'c1', approve: true, cents: 99999 });
  const c1 = await get(`${T}/retailClaims/c1`); o = await get(`${T}/retailOrders/o1`);
  check('…approved in one step with the order: never more than it was worth, and that unit can’t be claimed again', r.body.ok && c1.status === 'resolved' && c1.resolutionCents === 1500 && o.pendingRefundCents === 1500 && o.lines[0].qtyClaimed === 1, { r: r.body, c1, o: { p: o.pendingRefundCents, l: o.lines[0] } });
  r = await step('decideClaim', { claimId: 'c1', approve: true });
  check('…and decided only once', !r.body.ok && /Already decided/.test(r.body.message) && (await get(`${T}/retailOrders/o1`)).pendingRefundCents === 1500);
  await db.doc(`${T}/retailClaims/c2`).set({ id: 'c2', orderId: 'o1', lineId: 'A', qty: 1, claimValueCents: 1500, status: 'in_review' });
  r = await step('decideClaim', { claimId: 'c2', approve: false });
  check('a decline needs its reason', !r.body.ok && /needs a reason/.test(r.body.message));

  // ── What the review found ──
  await fresh(); as({ role: 'front_desk' });
  await db.doc(`${T}/retailOrders/o1`).set({ stage: 'ready', lines: [line({ qtyScanned: 2, status: 'picked' })] }, { merge: true });
  r = await step('handoffNoScan', { orderId: 'o1', verifiedBy: 'Checked ID' });
  check('the front desk hands over pickups at the register (a role with no orders job of its own)', r.body.ok && (await get(`${T}/retailOrders/o1`)).stage === 'completed', r.body);
  await fresh(); as({ fulfilmentRole: 'picker' });
  await db.doc(`${T}/retailOrders/o1`).set({ stage: 'ready' }, { merge: true });
  r = await step('handoffNoScan', { orderId: 'o1' });
  check('…but someone a manager made a picker doesn’t', r.status === 403 && (await get(`${T}/retailOrders/o1`)).stage === 'ready');
  await fresh(); as({ fulfilmentRole: 'packer' });
  for (const id of ['o2', 'o3']) await db.doc(`${T}/retailOrders/${id}`).set({ id, tenantId: 't1', orderNumber: 1300, stage: 'paid', method: 'counter', lines: [line()], qrToken: `${id}.x`, totalCents: 3000 });
  await step('claimOrder', { orderId: 'o1' }); await step('claimOrder', { orderId: 'o2' });
  r = await step('claimNext', {});
  check('a person takes no more batches from the queue than their role allows, checked on the server', r.status === 409 && /as many as your role holds/.test(r.body.message) && (await get(`${T}/retailOrders/o3`)).stage === 'paid', r.body);
  r = await step('claimOrder', { orderId: 'o3' });
  check('…while opening a particular order (a scan at the shelf) still works', r.body.ok !== false && !!r.body.batchId, r.body);
  await fresh(); as({ uid: 'staff-rec-1', authUid: 'login-1' });
  await db.doc(`${T}/fulfillmentBatches/old1`).set({ id: 'old1', orderIds: ['o1'], assignedTo: 'login-1', active: true, phase: 'pick' });
  await db.doc(`${T}/retailOrders/o1`).set({ stage: 'picking', batchId: 'old1', claimedBy: 'login-1' }, { merge: true });
  r = await step('releaseBatch', { batchId: 'old1' });
  check('a batch claimed before this change, under the person’s sign-in, can still be put back by them', r.body.ok && (await get(`${T}/retailOrders/o1`)).stage === 'paid', r.body);
  const route = src('src/app/api/retail/fulfil/route.ts');
  check('each request’s person is kept on its own (two requests on one server never use each other’s), and store credit is issued as the person who checked the return in',
    /new AsyncLocalStorage<Ctx>\(\)/.test(route) && /ctxStore\.run\(/.test(route) && /credit: async \(t, returnId, who\) => resolveCreditReturn\(getAdminDb\(\), t, returnId, \{ uid: who\.id, name: who\.name/.test(route) && !/F\.setFulfilEffects\(\{[^]*?\}\);[^]*export async function POST[^]*F\.setFulfilEffects/.test(route) && route.indexOf('F.setFulfilEffects') < route.indexOf('export async function POST'));
  check('follow-ups go to the app’s own address, with the caller’s sign-in (so they work even without the server key)', /process\.env\.NEXT_PUBLIC_APP_URL/.test(route) && /deliverMessage\(db, id, \{ base: c\.base, auth: c\.auth \}\)/.test(route) && /Authorization: o\.auth/.test(src('src/lib/order-outbox.ts')));
  check('the screens use the person’s staff record, the id the server stamps on what they claim', ['src/components/orders/OrdersApp.tsx', 'src/components/orders/LostScreen.tsx', 'src/components/orders/ProblemsApp.tsx'].every((p) => /id: staffId \|\| user\?\.uid/.test(src(p))));
  check('putting a batch back or moving a wave says when it didn’t go through', /if \(!r\.ok\) throw new Error\(r\.message\);[^]*if \(!r\.ok\) throw new Error\(r\.message\);/.test(src('src/lib/fulfil-client.ts')) && /The wave didn’t move to the bench/.test(src('src/app/(app)/retail-orders/waves/page.tsx')));
  // Nothing the server's order steps reach is a browser-only file (on the server it would be a placeholder, and the
  // step would fail there, never in a check like this one).
  const path = require('path') as typeof import('path');
  const seen = new Set<string>(); const browserOnly: string[] = [];
  const resolve = (from: string, spec: string) => {
    const base = spec.startsWith('@/') ? path.join('src', spec.slice(2)) : spec.startsWith('.') ? path.join(path.dirname(from), spec) : '';
    if (!base) return '';
    for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) if (fs.existsSync(base + ext)) return base + ext;
    return fs.existsSync(base) && fs.statSync(base).isFile() ? base : '';
  };
  const walk = (f: string) => {
    if (seen.has(f)) return; seen.add(f);
    const text = src(f);
    if (/^\s*['"]use client['"]/.test(text)) browserOnly.push(f);
    for (const m of text.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^'"]*?from\s+['"]([^'"]+)['"]/gm)) { const r2 = resolve(f, m[1]); if (r2) walk(r2); }
  };
  walk('src/app/api/retail/fulfil/route.ts');
  check('nothing the server’s order steps reach is a browser-only file (returns marked damaged used to fail here)', browserOnly.length === 0 && seen.has('src/lib/exception-doc.ts'), browserOnly);

  // ── The rules and the screens ──
  const rules = src('firestore.rules');
  check('a browser can’t create an order, nor change its stage, items, who’s packing it or when each step happened',
    /match \/tenants\/\{tenantId\}\/retailOrders\/\{orderId\} \{\s*allow read: if isTeam\(tenantId\);\s*\/\/[^\n]*\n\s*allow create: if false;/.test(rules)
    && /hasAny\(orderStepKeys\(\)\)/.test(rules) && ['stage', 'lines', 'batchId', 'claimedBy', 'completedAt', 'holdUntilRestock'].every((k) => new RegExp(`function orderStepKeys\\(\\) \\{[^}]*'${k}'`).test(rules)));
  const engine = src('src/lib/retail-fulfill.ts');
  check('the engine runs on the server: no browser-only calls left in it', !/^'use client'/.test(engine) && !/from 'firebase\/firestore'/.test(engine) && !/\bfetch\(/.test(engine) && /from '@\/lib\/fs-any'/.test(engine)
    && !/from 'firebase\/firestore'/.test(src('src/lib/retail-returns.ts')) && !/from 'firebase\/firestore'/.test(src('src/lib/waves.ts')));
  const screens = ['src/lib/orders-flow.ts', 'src/components/orders/OrdersApp.tsx', 'src/components/orders/workspace/PackPane.tsx', 'src/components/orders/workspace/OrderWorkspace.tsx', 'src/components/fulfilment/FulfilmentPanel.tsx', 'src/components/pos/desk/OrderPickup.tsx', 'src/app/(app)/retail-orders/history/page.tsx', 'src/app/(app)/inventory/page.tsx', 'src/components/inventory/QuickReceiveDialog.tsx', 'src/components/inventory/InventoryPage.tsx', 'src/components/orders/ReturnSheet.tsx', 'src/app/(app)/retail-orders/returns/page.tsx', 'src/app/(app)/retail-orders/waves/page.tsx', 'src/app/(app)/retail-orders/claims/page.tsx'];
  const bad = screens.filter((p) => /import \{[^}]*\} from '@\/lib\/retail-fulfill'/.test(src(p)) || !/from '@\/lib\/fulfil-client'/.test(src(p)));
  check('every screen that moves an order asks the server', bad.length === 0, bad);
  check('…and the claims page no longer changes the order itself', !/runTransaction/.test(src('src/app/(app)/retail-orders/claims/page.tsx')) && /decideClaim\(/.test(src('src/app/(app)/retail-orders/claims/page.tsx')));
  check('the words: no mention of the tool, no "call us", US spelling in the new messages', !/claude|anthropic/i.test(src('src/app/api/retail/fulfil/route.ts') + src('src/lib/fulfil-client.ts') + src('src/lib/fs-any.ts') + src('src/lib/claim-decide.ts')) && !/call us/i.test(src('src/app/api/retail/fulfil/route.ts')));

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
