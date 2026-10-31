// Checks row 15, part 3a: a return is started on the order itself (components/orders/StartReturnSheet) and checked in
// in one go (ReturnSheet), and the old Return desk page is gone.
//   - what can still come back: ordered, less shorted, returned, refunded on their own, covered by a report, or already
//     on its way back (lib/return-reserve returnableUnits), the same count for the shop, the customer and the server;
//   - the server opens it (api/retail/fulfil openReturn) with those counts and the final-sale rule;
//   - the screens: Start a return on a finished order, here-with-it carries straight into checking in, or a prepaid
//     label is emailed; checking in needs every item scanned or ticked; the customer's order code opens a finished order.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/start-return.verify.ts
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
const lamp = { lineId: 'L', productId: 'lamp', sku: 'LAMP', barcode: '012345678912', name: 'Mini Gel Lamp', unitPriceCents: 4800, qtyOrdered: 1, qtyShorted: 0, qtyReturned: 0 };
const polish = { lineId: 'P', productId: 'dusk', sku: 'DUSK', name: 'Dusk Polish', unitPriceCents: 1600, qtyOrdered: 3, qtyShorted: 0, qtyReturned: 0 };

(async () => {
  const R = await import('../../src/lib/return-reserve');
  console.log('what can still come back');
  check('ordered, less shorted, returned and refunded on their own', R.returnableUnits({ ...polish, qtyShorted: 1, qtyRefunded: 1 }, [], []) === 1);
  check('…less what a report covers (waiting, or put right) and what’s already on its way back', R.returnableUnits(polish, [{ status: 'in_review', lineId: 'P', qty: 1 }], [{ status: 'open', lines: [{ lineId: 'P', qty: 1 }] }]) === 1 && R.returnableUnits({ ...polish, qtyClaimed: 2 }, [], []) === 1);
  check('the order offers Start a return only once it’s gone out, with something left to come back', R.hasReturnable({ stage: 'completed', lines: [lamp] }, []) && !R.hasReturnable({ stage: 'paid', lines: [lamp] }, []) && !R.hasReturnable({ stage: 'completed', lines: [{ ...lamp, qtyReturned: 1 }] }, []) && !R.hasReturnable({ stage: 'completed', lines: [{ ...lamp, digital: true }] }, []) && !R.hasReturnable({ stage: 'completed', lines: [lamp] }, [{ status: 'open', lines: [{ lineId: 'L', qty: 1 }] }]));

  const PV = await import('../../src/lib/problems-view');
  const g = PV.buildProblems({ orders: [], knownOrders: [{ id: 'k1', orderNumber: 1209, customerName: 'Jordan Tate', stage: 'completed', pendingRefundCents: 4800 }], returns: [{ id: 'r1', orderId: 'k1', status: 'open', resolution: 'refund', lines: [{ qty: 1 }], openedAt: '2026-10-28T12:00:00Z' }], now: Date.parse('2026-10-31T12:00:00Z') });
  check('a finished order read once names its return, and never adds a refund row of its own', g.length === 1 && g[0].customerName === 'Jordan Tate' && g[0].num === '#1209' && g[0].items.map((p) => p.kind).join() === 'return', g.map((x) => [x.customerName, x.items.map((p) => p.kind)]));

  console.log('on the server');
  const { POST } = await import('../../src/app/api/retail/fulfil/route');
  const step = async (action: string, args: any = {}) => { const r: any = await POST(req({ tenantId: 't1', action, ...args })); await settle(); return r; };
  const fresh = async (o: any = {}) => {
    db = strictTransactions(makeDb());
    await db.doc(T).set({ name: 'Opal', retailSettings: {} });
    await db.doc(`${T}/retailOrders/o1`).set({ id: 'o1', orderNumber: 1209, stage: 'completed', method: 'pickup', customerName: 'Jordan Tate', customerEmail: 'jordan@example.com', qrToken: 'o1.tok', lines: [lamp, polish], subtotalCents: 9600, taxCents: 0, totalCents: 9600, completedAt: '2026-10-21T16:00:00Z', ...o });
  };
  await fresh();
  let r = await step('openReturn', { orderId: 'o1', selections: [{ lineId: 'L', qty: 1, reason: 'defective' }], resolution: 'refund' });
  const ret = (await all(`${T}/retailReturns`))[0] || {};
  check('a return started on the order is opened by the server, as the person signed in, worth what they paid', r.body.ok && ret.status === 'open' && ret.openedBy === 'Kai Park' && ret.refundCents === 4800 && ret.lines?.[0]?.reason === 'defective' && (await get(`${T}/retailOrders/o1`)).returnSeq === 1, { r: r.body, ret });
  r = await step('openReturn', { orderId: 'o1', selections: [{ lineId: 'L', qty: 1, reason: 'defective' }], resolution: 'refund' });
  check('…and the same item can’t be started twice', r.body.ok === false && /Only 0 of Mini Gel Lamp/.test(r.body.message), r.body);
  await fresh({ lines: [lamp, { ...polish, qtyRefunded: 3 }] });
  r = await step('openReturn', { orderId: 'o1', selections: [{ lineId: 'P', qty: 1, reason: 'defective' }], resolution: 'refund' });
  check('units refunded on their own can’t be returned for a refund again', r.body.ok === false && /Only 0 of Dusk Polish/.test(r.body.message), r.body);
  await fresh({ lines: [lamp, { ...polish, finalSale: true, finalSaleReason: 'Opened polish can’t be returned.' }] });
  r = await step('openReturn', { orderId: 'o1', selections: [{ lineId: 'P', qty: 1, reason: 'changed_mind' }], resolution: 'refund' });
  const r2 = await step('openReturn', { orderId: 'o1', selections: [{ lineId: 'P', qty: 1, reason: 'damaged_in_transit' }], resolution: 'refund' });
  check('a final-sale item comes back only for a fault', r.body.ok === false && r2.body.ok === true, { a: r.body, b: r2.body });
  await fresh({ lines: [{ ...lamp, digital: true }, polish] });
  r = await step('openReturn', { orderId: 'o1', selections: [{ lineId: 'L', qty: 1, reason: 'defective' }], resolution: 'refund' });
  check('a download isn’t returned (nothing to send back)', r.body.ok === false && /download/.test(r.body.message));
  await fresh();
  actor = { ...actor, fulfilmentRole: 'picker' };
  r = await step('openReturn', { orderId: 'o1', selections: [{ lineId: 'L', qty: 1, reason: 'defective' }], resolution: 'refund' });
  check('a picker doesn’t start or check in returns (they move stock)', r.status === 403 && /aren’t part of your role/.test(r.body.message), r.body);
  actor = { uid: 'k1', name: 'Kai Park', role: 'staff', isManager: false, isTenantOwner: false, caps: [] };
  await fresh({ stage: 'paid' });
  r = await step('openReturn', { orderId: 'o1', selections: [{ lineId: 'L', qty: 1, reason: 'defective' }], resolution: 'refund' });
  check('nothing comes back from an order that hasn’t gone out', r.status === 409);

  console.log('the screens');
  const sheet = src('src/components/orders/StartReturnSheet.tsx');
  check('Start a return asks what’s coming back and why, how they get their money back, and how it gets back', /What’s coming back/.test(sheet) && /How they get their money back/.test(sheet) && /Getting it back/.test(sheet) && /They’re here with it/.test(sheet) && /Email them a prepaid label/.test(sheet) && /returnableUnits\(l, claims \|\| \[\], returns \|\| \[\]\)/.test(sheet));
  check('…a final-sale item can’t be picked for a change of mind, and every item needs its reason', /const no = final && !\['defective', 'damaged_in_transit', 'wrong_item'\]\.includes\(r\.id\);/.test(sheet) && /const missingWhy = picks\.some\(\(p: any\) => !p\.reason\);/.test(sheet) && /const ready = picks\.length > 0 && !missingWhy && !blocked && claims !== null;/.test(sheet));
  check('…here with it carries straight into checking it in; otherwise the label is emailed through the server', /const r = await openReturn\(fs, tenantId, order, picks as any, res, note\.trim\(\)\.slice\(0, 500\), actor\);/.test(sheet) && /if \(checkIn\) return <ReturnSheet /.test(sheet) && /fetch\('\/api\/retail\/return-label'/.test(sheet) && /qrToken: order\.qrToken \|\| ''/.test(sheet));
  const rsheet = src('src/components/orders/ReturnSheet.tsx');
  check('checking in needs every item scanned or marked, and its condition chosen (never assumed), with a handheld scanner heard first', /const allIn = \(ret\.lines \|\| \[\]\)\.every/.test(rsheet) && /const allGraded = \(ret\.lines \|\| \[\]\)\.every\(\(l: any\) => !!l\.disposition \|\| !!cond\[l\.lineId\]\);/.test(rsheet) && /disabled=\{busy \|\| !order \|\| !allIn \|\| !allGraded\}/.test(rsheet) && /useWedgeScanner\(\(v\) => scan\(v\), !!order, \{ layer: 'front' \}\)/.test(rsheet) && /React\.useState<Record<string, Cond \| undefined>>\(\{\}\)/.test(rsheet));
  check('…as new, opened, damaged, or thrown away (for anything that can’t be sold again); the money shows once each is chosen', /\{ id: 'damaged', label: 'Damaged' \}, \{ id: 'dispose', label: 'Throw away' \}/.test(rsheet) && !/quarantine/.test(rsheet) && /\{ret\.resolution !== 'replacement' && allGraded && \(/.test(rsheet));
  check('…the team’s note on the return shows where it’s checked in', /ret\.notes \?/.test(rsheet) && /r\.notes \?/.test(src('src/components/orders/ProblemPanel.tsx')));
  check('…a label is offered in Problems only for a return by post with an email to send it to', /const labelFix = r\.status === 'open' && !r\.labelUrl && group\.order\?\.method === 'ship'/.test(src('src/components/orders/ProblemPanel.tsx')));
  check('…a report’s decide sheet keeps its order live (never the copy read once to name it)', /return onSnapshot\(doc\(fs, `tenants\/\$\{tenantId\}\/retailOrders\/\$\{claim\.orderId\}`\)/.test(src('src/components/orders/ClaimCard.tsx')));
  check('…and a try after one that stopped part way picks up from the return as it’s saved', /const now0 = await getDoc\(doc\(fs, `tenants\/\$\{tenantId\}\/retailReturns`, ret\.id\)\)/.test(rsheet) && /for \(const l of saved\.lines \|\| \[\]\) \{\s+if \(l\.disposition\) continue;/.test(rsheet));
  check('a scan while choosing what comes back is heard by the sheet (never starts packing behind it); a label only with an email to send it to', /useWedgeScanner\(\(\) => \{ feel\(false\); setHeard\(/.test(sheet) && /&& !!String\(order\.customerEmail \|\| ''\)\.trim\(\);/.test(sheet) && /label: 'Arrived damaged'/.test(sheet) && /\{ id: 'other', label: 'Other' \}/.test(sheet) && /Note for the team \(optional\)/.test(sheet));
  const ws = src('src/components/orders/workspace/OrderWorkspace.tsx');
  check('a return on its way back is checked in from the order', /openRet \? \{ label: 'Check in the return', run: \(\) => setCheckRet\(openRet\) \}/.test(src('src/components/orders/workspace/OrderWorkspace.tsx')) && /const doesReturns = perms\.canPack \|\| perms\.canManage \|\| canRefund \|\| isManager;/.test(src('src/components/orders/workspace/OrderWorkspace.tsx')));
  check('a finished order offers Start a return as its next step, and in More', /returnable \? \{ label: 'Start a return', run: \(\) => setStartReturn\(true\) \}/.test(ws) && /\{returnable && <Btn kind="soft" className="w-full" onClick=\{\(\) => \{ setMore\(false\); setStartReturn\(true\); \}\}>Start a return<\/Btn>\}/.test(ws));
  check('the customer’s order code opens a finished order at the counter (the order they paid on, and a failed look-up says so)', /where\('qrToken', '==', code\), limit\(10\)/.test(src('src/components/orders/OrdersApp.tsx')) && /const hit = rows\.find\(\(o: any\) => !o\.parentOrderId\) \|\| rows\[0\] \|\| null;/.test(src('src/components/orders/OrdersApp.tsx')) && /couldn’t be looked up just now/.test(src('src/components/orders/OrdersApp.tsx')));
  check('Problems names the finished order a return is on, with what a label needs', /knownOrders/.test(src('src/components/orders/ProblemsApp.tsx')) && /\.\.\.\(src\.knownOrders \|\| \[\]\), \.\.\.\(src\.refundOrders \|\| \[\]\)/.test(src('src/lib/problems-view.ts')));
  check('the same count everywhere: a gift exchange, a report, and the customer’s page', /const left = returnableUnits\(l, claims, open\);/.test(src('src/app/api/retail/gift/route.ts')) && /const claimableOf = \(l: any\) => returnableUnits\(l, otherClaims, openReturns\);/.test(src('src/app/api/retail/claims/route.ts')) && /qtyRefunded: Math\.max\(0, Number\(l\.qtyRefunded\) \|\| 0\),/.test(src('src/app/api/retail/order-status/route.ts')));
  check('a backorder or replacement line starts with fresh counts', /qtyReturned: 0, qtyRefunded: 0, qtyClaimed: 0, status: 'pending', shortReason: ''/.test(src('src/lib/retail-fulfill.ts')) && /qtyReturned: 0, qtyRefunded: 0, qtyClaimed: 0, status: 'pending', shortReason: '', preorder: false/.test(src('src/lib/retail-returns.ts')));
  const old = src('src/app/(app)/retail-orders/returns/page.tsx');
  check('the old Return desk sends people to Problems, and nothing links to it', /redirect\('\/retail-orders\/problems\?show=returns'\)/.test(old) && !/'use client'/.test(old) && !/retail-orders\/returns/.test(src('src/components/orders/SetupScreen.tsx')));
  const words = sheet + rsheet;
  check('the words: no mention of the tool, no "call us", no JSX comments, no emojis', !new RegExp(['cl', 'aude|anth', 'ropic'].join(''), 'i').test(words) && !/call us/i.test(words) && !/\{\/\*/.test(words) && !/[\u{1F300}-\u{1FAFF}]/u.test(words));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
