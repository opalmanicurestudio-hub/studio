// Checks BAG TAGS (lib/bag-tag, lib/order-qr, lib/retail-fulfill, api/retail/fulfil):
//   - each bag of a pickup order gets its own signed code, never the customer's pickup code; a code can't be made up,
//     moved to another order or another business;
//   - the bags an order went into are kept as it's packed; every one is scanned before the handover, checked on the
//     server whatever screen sends it, before the customer's code, so a missing bag never costs them a try;
//   - a bag's tag alone hands nothing over; a shop that turned bag scans off, an order packed before bags were counted,
//     a shipped order and a delivery (handled on its own tab) are handed over as before;
//   - a tag that won't scan (or a wrong count) is handed over on a manager's PIN, checked with the handover and kept;
//   - the bag count can't be changed from a browser (firestore.rules); pop-up line orders aren't bag-scanned;
//   - the tag sheet prints a page per bag with that bag's code; the screens scan bags first.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/bag-tag.verify.ts
import Module from 'module';
import fs from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
let actor: any = { uid: 'k1', name: 'Kai Park', role: 'staff', isManager: false, isTenantOwner: false, caps: [] };
const afterJobs: Promise<any>[] = [];
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (fn: any) => { afterJobs.push(Promise.resolve().then(fn)); } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) });
  return load.call(this, request, ...rest);
};
(globalThis as any).fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? 'Bearer t' : null) }, nextUrl: { origin: 'https://app.example' } }) as any;
const src = (p: string) => fs.readFileSync(p, 'utf8');
const settle = async () => { while (afterJobs.length) await afterJobs.shift(); };
const line = (x: any = {}) => ({ lineId: 'A', productId: 'gel', sku: 'GEL-121', barcode: '012345678905', name: 'Gel color, Rosewood 121', unitPriceCents: 1500, qtyOrdered: 2, qtyScanned: 0, qtyShorted: 0, qtyReturned: 0, status: 'pending', ...x });
const fresh = async (rs: any = {}, x: any = {}) => {
  db = strictTransactions(makeDb());
  await db.doc(T).set({ name: 'Opal', retailSettings: rs });
  await db.doc(`${T}/inventory/gel`).set({ id: 'gel', name: 'Gel color, Rosewood 121', type: 'retail', status: 'active', totalStock: 10, stockReserved: 2, batches: [{ id: 'b1', stock: 10, costPerUnit: 4, receivedDate: '2026-01-01' }], barcode: '012345678905' });
  const { pinHash } = await import('../../src/lib/approvals');
  await db.doc(`${T}/staff/m1`).set({ name: 'Andre Cole', role: 'manager', hasPin: true }); await db.doc(`${T}/staffSecrets/m1`).set({ pinHash: pinHash('t1', '4321') });
  await db.doc(`${T}/staff/k1`).set({ name: 'Kai Park', role: 'staff', hasPin: true }); await db.doc(`${T}/staffSecrets/k1`).set({ pinHash: pinHash('t1', '1111') });
  await db.doc(`${T}/retailOrders/o1`).set({ id: 'o1', tenantId: 't1', orderNumber: 142, stage: 'paid', method: 'counter', lines: [line()], customerName: 'Dana R', customerEmail: 'dana@example.com', qrToken: 'o1.abcdef', totalCents: 3000, placedAt: '2026-11-13T10:00:00Z', paidAt: '2026-11-13T10:00:00Z', ...x });
};

(async () => {
  const B = await import('../../src/lib/bag-tag');
  const Q = await import('../../src/lib/order-qr');
  const { POST } = await import('../../src/app/api/retail/fulfil/route');
  const step = async (action: string, args: any = {}) => { actor = { uid: 'k1', name: 'Kai Park', role: 'staff', isManager: false, isTenantOwner: false, caps: [] }; const r: any = await POST(req({ tenantId: 't1', action, ...args })); await settle(); return r; };
  const O = async () => get(`${T}/retailOrders/o1`);
  const packed = async (bags?: number) => {
    await step('claimOrder', { orderId: 'o1' });
    await step('scanBox', { orderId: 'o1', value: '012345678905' }); await step('scanBox', { orderId: 'o1', value: '012345678905' });
    const r = await step('markPacked', { orderId: 'o1', ...(bags != null ? { bags } : {}) });
    await step('markReady', { orderId: 'o1' });
    return r;
  };

  // ── The codes ──
  const c1 = Q.makeBagCode('t1', 'o1', 1); const c2 = Q.makeBagCode('t1', 'o1', 2);
  check('each bag has its own code, never the customer’s pickup code', c1.startsWith('clarityflow://bag/o1.1.') && c1 !== c2 && !c1.includes('abcdef'), c1);
  check('the server knows its own codes, bag by bag', Q.checkBagCode('t1', 'o1', c1) === 1 && Q.checkBagCode('t1', 'o1', c2) === 2);
  check('…and a code can’t be made up, moved to another order or business, or have its number changed',
    Q.checkBagCode('t1', 'o1', 'clarityflow://bag/o1.1.0000000000000000') === null && Q.checkBagCode('t1', 'o2', c1) === null
    && Q.checkBagCode('t2', 'o1', c1) === null && Q.checkBagCode('t1', 'o1', c1.replace('o1.1.', 'o1.2.')) === null && Q.checkBagCode('t1', 'o1', 'clarityflow://order/o1.abcdef') === null);
  check('a tag numbered 0 isn’t a bag', B.parseBagCode('clarityflow://bag/o1.0.0123456789abcdef') === null);
  check('an order from the line at a pop-up isn’t bag-scanned (its table has no printer)', B.bagsToScan({ method: 'counter', lines: [line()], bagCount: 1, popupId: 'p1' }, {}) === 0);
  check('the bag count is one of the order’s steps: a browser can’t change it (firestore.rules)', /function orderStepKeys\(\) \{[\s\S]{0,400}'bagCount'\]/.test(src('firestore.rules')));
  const rules = src('firestore.rules');
  const locked = (k: string) => new RegExp(`function (orderLockedKeys|orderStepKeys)\\(\\) \\{[^}]*'${k}'`).test(rules);
  check('…nor anything else the bag check reads (how it goes out, a pop-up, its items)', ['bagCount', 'method', 'popupId', 'lines'].every(locked), ['bagCount', 'method', 'popupId', 'lines'].filter((k) => !locked(k)));
  check('screens read which order and bag a tag names', JSON.stringify(B.parseBagCode(c2)) === JSON.stringify({ orderId: 'o1', n: 2 }) && B.parseBagCode('clarityflow://order/o1.abcdef') === null && B.parseBagCode('012345678905') === null);
  check('bag counts stay between 1 and 20', B.clampBags(0) === 1 && B.clampBags(3) === 3 && B.clampBags(99) === 20 && B.clampBags('x') === 1);
  check('pickup and delivery orders go in bags; shipped orders and downloads don’t', B.goesInBags({ method: 'counter', lines: [line()] }) && B.goesInBags({ method: 'delivery', lines: [line()] }) && !B.goesInBags({ method: 'ship', lines: [line()] }) && !B.goesInBags({ method: 'counter', lines: [line({ digital: true })] }));
  check('bags to scan at handover: on unless turned off, never for an order packed before bags were counted or a delivery',
    B.bagsToScan({ method: 'counter', lines: [line()], bagCount: 2 }, {}) === 2 && B.bagsToScan({ method: 'counter', lines: [line()], bagCount: 2 }, { scanBagAtHandover: false }) === 0
    && B.bagsToScan({ method: 'counter', lines: [line()] }, {}) === 0 && B.bagsToScan({ method: 'delivery', lines: [line()], bagCount: 1 }, {}) === 0);

  // ── Packed in two bags, handed over only with both scanned ──
  await fresh({});
  let r = await packed(2);
  check('the bags an order went into are kept as it’s packed', r.body.ok && (await O()).bagCount === 2, { r: r.body, n: (await O()).bagCount });
  r = await step('handoffScan', { value: 'clarityflow://order/o1.abcdef', orderId: 'o1' });
  check('their code alone doesn’t hand it over: both bags first', !r.body.ok && r.body.needBags === true && /Scan all 2 bags first/.test(r.body.message) && (await O()).stage === 'ready', r.body);
  r = await step('handoffScan', { value: 'clarityflow://order/o1.abcdef', orderId: 'o1', bags: [c1] });
  check('…one of two says which is still to scan', !r.body.ok && /bag 2 of 2 still to scan/.test(r.body.message), r.body);
  r = await step('handoffScan', { value: 'clarityflow://order/o1.abcdef', orderId: 'o1', bags: [c1, 'clarityflow://bag/o1.2.0000000000000000'] });
  check('…a made-up code for the second bag doesn’t count', !r.body.ok && /bag 2 of 2/.test(r.body.message), r.body);
  r = await step('handoffScan', { value: 'clarityflow://order/o1.abcdef', orderId: 'o1', bags: [c1, Q.makeBagCode('t1', 'o9', 2)] });
  check('…nor another order’s bag', !r.body.ok && (await O()).stage === 'ready', r.body);
  r = await step('handoffScan', { value: c1, orderId: 'o1', bags: [c1, c2] });
  check('a bag’s tag scanned as their code hands nothing over', !r.body.ok && /bag tag/.test(r.body.message) && (await O()).stage === 'ready', r.body);
  r = await step('handoffPin', { orderId: 'o1', pin: '0000', bags: [c1] });
  check('a missing bag never costs the customer a try at their code', !r.body.ok && r.body.needBags === true && !(await O()).pinTries, { r: r.body, tries: (await O()).pinTries });
  r = await step('handoffScan', { value: 'clarityflow://order/o1.abcdef', orderId: 'o1', bags: [c2, c1] });
  const o = await O();
  check('both bags and their code: handed over, with the bags on the record', r.body.ok && o.stage === 'completed' && o.handoff?.bagsScanned === 2, { r: r.body, h: o.handoff });
  const ev = (await all(`${T}/retailOrders/o1/events`)).find((e: any) => e.type === 'handoff_scanned');
  check('…and in its history', ev?.meta?.bagsScanned === 2, ev);

  // The name check, too.
  await fresh({}); await packed();
  r = await step('handoffNoScan', { orderId: 'o1', verifiedBy: 'Photo ID' });
  check('checking their name doesn’t skip the bag either', !r.body.ok && /Scan the bag first/.test(r.body.message), r.body);
  r = await step('handoffNoScan', { orderId: 'o1', verifiedBy: 'Photo ID', bags: [c1] });
  check('…with the bag scanned, it’s handed over', r.body.ok && (await O()).stage === 'completed' && (await O()).bagCount === 1, r.body);

  // ── A tag that won't scan: a manager's PIN, checked with the handover ──
  await fresh({}); await packed(2);
  r = await step('handoffScan', { value: 'clarityflow://order/o1.abcdef', orderId: 'o1', bags: [c1], bagPin: '1111' });
  check('a packer’s own PIN doesn’t skip the bags (and says it was the PIN, so the bags scanned are kept)', r.status === 403 && r.body.badBagPin === true && !r.body.needBags && (await O()).stage === 'ready', r.body);
  r = await step('handoffScan', { value: 'clarityflow://order/o1.abcdef', orderId: 'o1', bags: [c1], bagPin: '4321' });
  const done2 = await O(); const evs2 = await all(`${T}/retailOrders/o1/events`);
  const ov = evs2.find((e: any) => e.type === 'override' && e.meta?.rule === 'bags_approved');
  check('a manager’s PIN hands it over without every tag scanned, kept on the order with their name', r.body.ok && done2.stage === 'completed' && ov?.meta?.approvedBy === 'Andre Cole' && !done2.handoff?.bagsScanned, { r: r.body, ov });
  const { eventWords } = await import('../../src/lib/order-events');
  check('…in words', eventWords(ov).text === 'Handed over without scanning every bag’s tag, approved by Andre Cole · Kai Park', eventWords(ov).text);

  // ── As before, where bags aren't scanned ──
  await fresh({ scanBagAtHandover: false }); await packed(3);
  r = await step('handoffScan', { value: 'clarityflow://order/o1.abcdef', orderId: 'o1' });
  check('a shop that turned bag scans off hands over by their code, as before (bags still counted)', r.body.ok && (await O()).stage === 'completed' && (await O()).bagCount === 3, r.body);
  await fresh({}, { stage: 'ready', readyAt: '2026-11-13T10:30:00Z', lines: [line({ qtyScanned: 2, qtyPacked: 2, status: 'picked' })] });
  r = await step('handoffScan', { value: 'clarityflow://order/o1.abcdef', orderId: 'o1' });
  check('an order packed before bags were counted is handed over as before', r.body.ok && (await O()).stage === 'completed', r.body);
  await fresh({}, { method: 'ship' });
  await step('claimOrder', { orderId: 'o1' });
  await step('scanBox', { orderId: 'o1', value: '012345678905' }); await step('scanBox', { orderId: 'o1', value: '012345678905' });
  r = await step('markPacked', { orderId: 'o1', bags: 4 });
  check('a shipped order goes out in boxes, not bags', r.body.ok && (await O()).bagCount === undefined, r.body);

  // ── The tag sheet and the screens ──
  const label = src('src/app/print/label/[tenantId]/[orderId]/page.tsx');
  check('the tag sheet prints a page per bag, each with that bag’s own code', /makeBagCode\(tenantId, orderId, i \+ 1\)/.test(label) && /bagWords\(i \+ 1, bags\)/.test(label) && /className=\{`band\$\{i < bags - 1 \? ' next' : ''\}`\}/.test(label));
  const sheet = src('src/components/orders/HandoverSheet.tsx');
  check('the handover sheet scans the bags first, says whose a wrong bag is, and sends the bags with the handover',
    /const bagStep = need > 0 && bags\.size < need && !bagPin;/.test(sheet) && /Wrong bag\. This one is #/.test(sheet) && (sheet.match(/bags: codes, bagPin: bagPin \|\| undefined/g) || []).length === 3 && /Tag torn or missing\?/.test(sheet) && /Skip the bag scan/.test(sheet));
  check('the staff portal prints the bag’s tag as it’s finished', /tagTab\.location\.href = `\/print\/label\//.test(src('src/components/fulfilment/FulfilmentPanel.tsx')));
  check('every screen that opens it can name another order’s bag', ['src/components/orders/OrdersApp.tsx', 'src/components/orders/PickupsScreen.tsx', 'src/components/orders/PopupScreen.tsx', 'src/components/fulfilment/FulfilmentPanel.tsx', 'src/components/orders/workspace/OrderWorkspace.tsx'].every((f) => /<HandoverSheet [\s\S]{0,300}?lookup=\{\(id\) =>/.test(src(f))));
  const desk = src('src/components/pos/desk/OrderPickup.tsx');
  check('the desk scans the bags too, every way it hands over, and a bag’s tag opens its order', /disabled=\{busy \|\| \(!withQr && !usePin && !check\) \|\| !bagsDone\}/.test(desk) && (desk.match(/codes, bagPin \|\| undefined\)/g) || []).length === 3 && /if \(!sel\) \{ setSel\(o\); setDone\(null\); \}/.test(desk));
  check('…a bag scanned after their code keeps the match, and each scan is taken once', /const withQr = !!sel && !!matched && sel\.qrToken === matched;/.test(desk) && /usedScan\.current === scanned\) return; usedScan\.current = scanned;/.test(desk));
  check('…and a tag that won’t scan can be reprinted or skipped with a manager’s PIN there too', /Reprint the tags/.test(desk) && /id="desk-bag-pin"/.test(desk));
  const pack = src('src/components/orders/workspace/PackPane.tsx');
  check('the packing screen asks how many bags, and the tags print as it’s finished', /aria-label="One more bag"/.test(pack) && /finishPacking\(fs, tenantId, order, all, actor, rs, inBags \? bags : undefined\)/.test(pack) && /tagTab\.location\.href = `\/print\/label\//.test(pack));
  const setup = src('src/components/orders/SetupScreen.tsx');
  check('Setup: one switch for scanning bags at handover', /'retailSettings\.scanBagAtHandover': !bagsOn/.test(setup));
  for (const [name, text] of [['handover sheet', sheet], ['bag rules', src('src/lib/bag-tag.ts')]] as [string, string][]) {
    check(`the ${name} has no all-caps, no heavy weight and the real apostrophe`, !/\buppercase\b|font-black/.test(text) && !/[a-z]'[a-z]/i.test(text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/'[^'\n]*'/g, '')));
  }

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
