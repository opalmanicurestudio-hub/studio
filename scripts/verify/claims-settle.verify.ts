// Checks row 15, part 2b: a problem report put right by sending another, or with store credit (lib/claim-settle,
// through api/retail/fulfil decideClaim).
//   - Send another: a $0 order with the item at the price paid, going the way the first did, its stock held; for a
//     parcel that never came, everything still theirs, as a lost parcel's replacement, and only once; never a download;
//     within the person's refund limit;
//   - store credit: worth what's left to refund, never more than is left of what was paid; kept with their email,
//     counted as given back for the order, in the books with its tax; one per report; none without an email;
//   - both settle the units, record the loss, and tell the customer in words that say what happened.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/claims-settle.verify.ts
import Module from 'module';
import fs from 'fs';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

let db: any = strictTransactions(makeDb());
const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
let actor: any = {};
const afterJobs: Promise<any>[] = [];
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (fn: any) => { afterJobs.push(Promise.resolve().then(fn)); } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) });
  return load.call(this, request, ...rest);
};
(globalThis as any).fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, sent: true }) });

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const req = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? 'Bearer t' : null) }, nextUrl: { origin: 'https://app.example' } }) as any;
const src = (p: string) => fs.readFileSync(p, 'utf8');
const settle = async () => { while (afterJobs.length) await afterJobs.shift(); };
const as = (x: any = {}) => { actor = { uid: 'k1', name: 'Kai Park', role: 'staff', isManager: false, isTenantOwner: false, caps: ['checkout.refund'], ...x }; };
const oil = { lineId: 'A', productId: 'oil', name: 'Rose Cuticle Oil', unitPriceCents: 1800, qtyOrdered: 2, qtyShorted: 0, qtyReturned: 0 };
const file = { lineId: 'B', productId: 'file', name: 'Glass File', unitPriceCents: 1200, qtyOrdered: 1, qtyShorted: 0, qtyReturned: 0 };
const fresh = async (o: any = {}, rs: any = {}) => {
  db = strictTransactions(makeDb()); afterJobs.length = 0;
  await db.doc(T).set({ name: 'Opal', userId: 'owner1', retailSettings: rs });
  await db.doc(`${T}/inventory/oil`).set({ id: 'oil', costPerUnit: 4.5, totalStock: 10, stockReserved: 1, unit: 'units' });
  await db.doc(`${T}/inventory/file`).set({ id: 'file', costPerUnit: 2, totalStock: 5, stockReserved: 0, unit: 'units' });
  await db.doc(`${T}/retailOrders/o1`).set({ id: 'o1', orderNumber: 1214, stage: 'completed', method: 'ship', carrier: 'usps', trackingNumber: '9400', customerName: 'Maya Rivera', customerEmail: 'Maya@Example.com', qrToken: 'o1.x',
    shippingAddress: { line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701' }, lines: [oil, file], subtotalCents: 4800, taxCents: 400, totalCents: 5200, chargedCents: 5200, refundedCents: 0, ...o });
  await db.doc(`${T}/retailClaims/c1`).set({ id: 'c1', orderId: 'o1', orderNumber: 1214, lineId: 'A', lineName: 'Rose Cuticle Oil', qty: 1, claimValueCents: 1800, status: 'in_review', type: 'missing', customerName: 'Maya Rivera', customerEmail: 'Maya@Example.com', openedAt: '2026-10-28T12:00:00Z' });
};

(async () => {
  const { POST } = await import('../../src/app/api/retail/fulfil/route');
  const step = async (action: string, args: any = {}) => { const r: any = await POST(req({ tenantId: 't1', action, ...args })); await settle(); return r; };
  const V = await import('../../src/lib/claim-view');

  console.log('send another');
  await fresh(); as();
  let r = await step('decideClaim', { claimId: 'c1', approve: true, how: 'replacement' });
  let c1 = await get(`${T}/retailClaims/c1`);
  let o1 = await get(`${T}/retailOrders/o1`);
  const kids = (await all(`${T}/retailOrders`)).filter((x: any) => x.parentOrderId === 'o1');
  const kid: any = kids[0] || {};
  check('approved by sending another: a $0 order with the item at the price paid, going the way the first did', r.body.ok && kids.length === 1 && kid.stage === 'paid' && kid.method === 'ship' && kid.totalCents === 0 && kid.isReplacement === true && kid.claimId === 'c1'
    && kid.lines.length === 1 && kid.lines[0].productId === 'oil' && kid.lines[0].qtyOrdered === 1 && kid.lines[0].unitPaidCents === 1800 && kid.shippingAddress?.line1 === '1 Main St' && !kid.replacementFor, { r: r.body, kid });
  check('…the report says how it was put right, by whom, and that unit can’t be claimed or returned again', c1.status === 'resolved' && c1.resolution === 'replacement' && c1.resolutionCents === 0 && c1.replacementOrderId === kid.id && c1.decidedBy === 'Kai Park' && o1.lines[0].qtyClaimed === 1 && !o1.pendingRefundCents, { c1, l: o1.lines[0] });
  const inv = await get(`${T}/inventory/oil`);
  const holds = (await all(`${T}/stockCorrections`)).filter((x: any) => x.productId === 'oil');
  check('…its stock is held now, with a line in the stock history', inv.stockReserved === 2 && holds.length === 1 && holds[0].change === 1 && holds[0].refId === kid.id, { inv, holds });
  check('…the loss is recorded, and the customer is told from the queue', !!(await get(`${T}/inventoryExceptions/claim-c1`)) && c1.lossPending === false && (await all('messageOutbox')).some((m: any) => m.kind === 'claim_decided'));
  r = await step('decideClaim', { claimId: 'c1', approve: true, how: 'replacement' });
  check('…and decided only once', r.status === 409 && /Already decided/.test(r.body.message) && (await all(`${T}/retailOrders`)).filter((x: any) => x.parentOrderId === 'o1').length === 1);

  await fresh(); as();
  await db.doc(`${T}/retailClaims/c2`).set({ id: 'c2', orderId: 'o1', orderNumber: 1214, qty: 1, claimValueCents: 5200, status: 'in_review', type: 'not_received', customerName: 'Maya Rivera', customerEmail: 'Maya@Example.com' });
  r = await step('decideClaim', { claimId: 'c2', approve: true, how: 'replacement' });
  o1 = await get(`${T}/retailOrders/o1`);
  const box: any = (await all(`${T}/retailOrders`)).find((x: any) => x.parentOrderId === 'o1') || {};
  check('a parcel that never came: everything still theirs goes again, as a lost parcel’s replacement', r.body.ok && box.lines?.length === 2 && box.lines.map((l: any) => l.qtyOrdered).join() === '2,1' && box.replacementFor === 'lost_in_transit' && box.lostParcelOrderId === 'o1' && o1.replacementOrderId === box.id && o1.lines.every((l: any) => l.qtyClaimed === l.qtyOrdered), { box, o1: o1.lines });
  await db.doc(`${T}/retailClaims/c3`).set({ id: 'c3', orderId: 'o1', qty: 1, claimValueCents: 5200, status: 'in_review', type: 'not_received' });
  r = await step('decideClaim', { claimId: 'c3', approve: true, how: 'replacement' });
  check('…and only once for the order', r.status === 409 && /already has a replacement|already been put right/.test(r.body.message), r.body);

  await fresh({ lines: [{ ...oil, digital: true }] }); as();
  r = await step('decideClaim', { claimId: 'c1', approve: true, how: 'replacement' });
  check('a download isn’t sent again', r.status === 409 && /download/.test(r.body.message) && (await get(`${T}/retailClaims/c1`)).status === 'in_review');

  await fresh({}, { policies: { refundLimits: { front_desk: 1000 } } }); as({ role: 'front_desk' });
  r = await step('decideClaim', { claimId: 'c1', approve: true, how: 'replacement' });
  check('within the person’s refund limit: an $18.00 item is more than a $10.00 limit', r.status === 403 && /\$10\.00/.test(r.body.message) && (await get(`${T}/retailClaims/c1`)).status === 'in_review', r.body);

  console.log('store credit');
  await fresh(); as();
  r = await step('decideClaim', { claimId: 'c1', approve: true, how: 'store_credit' });
  c1 = await get(`${T}/retailClaims/c1`);
  const cred = await get(`${T}/depositCredits/claim_c1`);
  const book = await get(`${T}/transactions/claimcredit_c1`);
  const tally = await get(`${T}/private/returnCredits/orders/o1`);
  o1 = await get(`${T}/retailOrders/o1`);
  check('approved with store credit: worth the item, kept with their email, ready at checkout', r.body.ok && cred && cred.amountCents === 1800 && cred.clientEmail === 'maya@example.com' && cred.status === 'available' && cred.kind === 'store_credit' && cred.sourceRetailClaimId === 'c1' && !!cred.grantEmailAt, { r: r.body, cred });
  check('…in the books as a refund paid as store credit, with its tax, and the tax counted on the order', book && book.category === 'Refunds' && book.paymentMethod === 'Store credit' && book.amount === 18 && book.taxRefunded > 0 && o1.refundedTaxCents === Math.round(book.taxRefunded * 100), { book, tax: o1.refundedTaxCents });
  check('…counted as given back on the order, and the report says what it was', tally?.cents === 1800 && tally?.claims?.c1 === 1800 && c1.resolution === 'store_credit' && c1.creditCents === 1800 && c1.creditId === 'claim_c1' && o1.lines[0].qtyClaimed === 1 && !o1.pendingRefundCents);
  const { returnCreditGiven } = await import('../../src/lib/return-credit');
  check('…so a later refund on the order counts it as already given back', (await returnCreditGiven((x: any) => x.get(), db, 't1', 'o1', [])) === 1800);
  check('…and its loss is recorded', !!(await get(`${T}/inventoryExceptions/claim-c1`)));

  await fresh({ pendingRefundCents: 4000 }); as();
  r = await step('decideClaim', { claimId: 'c1', approve: true, how: 'store_credit' });
  check('never more than is left of what was paid: $52.00 paid, $40.00 already waiting to go back, so $12.00', r.body.ok && (await get(`${T}/depositCredits/claim_c1`))?.amountCents === 1200 && (await get(`${T}/retailClaims/c1`)).partialOfCents === 1800, r.body);
  await fresh({ refundedCents: 5200 }); as();
  r = await step('decideClaim', { claimId: 'c1', approve: true, how: 'store_credit' });
  check('…nothing at all when everything paid has gone back already, and the report stays open', r.status === 409 && /nothing left to give as credit/.test(r.body.message) && (await get(`${T}/retailClaims/c1`)).status === 'in_review' && !(await get(`${T}/depositCredits/claim_c1`)));
  await fresh(); as();
  r = await step('decideClaim', { claimId: 'c1', approve: true, how: 'store_credit', cents: 900 });
  check('a smaller amount chosen is what’s given', r.body.ok && (await get(`${T}/depositCredits/claim_c1`))?.amountCents === 900);
  await fresh({ customerEmail: '' }); as();
  await db.doc(`${T}/retailClaims/c1`).update({ customerEmail: '' });
  r = await step('decideClaim', { claimId: 'c1', approve: true, how: 'store_credit' });
  check('no email on the order: no store credit (it’s kept by email)', r.status === 422 && /kept by email/.test(r.body.message));
  await fresh({}, { policies: { refundLimits: { front_desk: 1000 } } }); as({ role: 'front_desk' });
  r = await step('decideClaim', { claimId: 'c1', approve: true, how: 'store_credit' });
  check('…and within the person’s refund limit', r.status === 403);
  await fresh(); as({ caps: [] });
  r = await step('decideClaim', { claimId: 'c1', approve: true, how: 'store_credit' });
  check('only those who can decide on a report put it right any way', r.status === 403 && !(await get(`${T}/depositCredits/claim_c1`)));

  console.log('what the review found');
  const LP = (await import('../../src/app/api/retail/lost-parcel/route')).POST;
  const lost = async () => { const r: any = await LP(req({ tenantId: 't1', orderId: 'o1' })); await settle(); return r; };
  const NR = { id: 'c2', orderId: 'o1', orderNumber: 1214, qty: 1, claimValueCents: 5200, status: 'in_review', type: 'not_received', customerName: 'Maya Rivera', customerEmail: 'Maya@Example.com', openAtFiling: { A: 2, B: 1 } };
  await fresh({ stage: 'shipped', carrierIssue: { open: true, status: 'STALLED' } }); as();
  await db.doc(`${T}/retailClaims/c2`).set(NR);
  r = await step('decideClaim', { claimId: 'c2', approve: true, how: 'store_credit' });
  o1 = await get(`${T}/retailOrders/o1`);
  let lp = await lost();
  check('store credit for a parcel that never came: Needs you can’t also send a replacement, and its carrier problem is closed', r.body.ok && o1.carrierIssue?.open === false && o1.carrierIssue?.outcome === 'report_settled' && lp.status === 409 && (await all(`${T}/retailOrders`)).filter((x: any) => x.parentOrderId === 'o1').length === 0, { r: r.body, lp: lp.body, ci: o1.carrierIssue });
  await fresh({ stage: 'shipped' }); as();
  r = await step('decideClaim', { claimId: 'c1', approve: true, how: 'replacement' });
  lp = await lost();
  const second: any = (await all(`${T}/retailOrders`)).find((x: any) => x.parentOrderId === 'o1' && x.replacementFor === 'lost_in_transit') || {};
  check('an item already sent again for a report: a replacement for the whole parcel sends only the rest', r.body.ok && lp.body.ok && second.lines?.map((l: any) => `${l.productId}x${l.qtyOrdered}`).join() === 'oilx1,filex1', { lp: lp.body, lines: second.lines?.map((l: any) => [l.productId, l.qtyOrdered]) });
  await fresh({ stage: 'shipped' }); as();
  r = await step('decideClaim', { claimId: 'c1', approve: true, how: 'replacement' });
  await db.doc(`${T}/retailClaims/c2`).set(NR);
  r = await step('decideClaim', { claimId: 'c2', approve: true, how: 'store_credit' });
  check('a whole-order report after an item was sent again: credit only for what’s still theirs ($52.00 × $30.00 of $66.00 still open)', r.body.ok && (await get(`${T}/depositCredits/claim_c2`))?.amountCents === Math.round((5200 * 3000) / 4800), { r: r.body, cred: (await get(`${T}/depositCredits/claim_c2`))?.amountCents });
  for (const o of [{ refundedCents: 5200 }, { pendingRefundCents: 5200 }]) {
    await fresh(o); as();
    r = await step('decideClaim', { claimId: 'c1', approve: true, how: 'replacement' });
    check(`no replacement for an order already ${o.refundedCents ? 'refunded' : 'being refunded'} in full`, r.status === 409 && /refunded in full/.test(r.body.message));
  }
  await fresh({ lines: [{ ...oil, qtyRefunded: 1 }, file] }); as();
  await db.doc(`${T}/retailClaims/c2`).set({ ...NR, openAtFiling: undefined });
  r = await step('decideClaim', { claimId: 'c2', approve: true, how: 'replacement' });
  const partBox: any = (await all(`${T}/retailOrders`)).find((x: any) => x.parentOrderId === 'o1') || {};
  check('a unit refunded on its own isn’t sent again', r.body.ok && partBox.lines?.find((l: any) => l.productId === 'oil')?.qtyOrdered === 1);
  await fresh({ lines: [{ ...oil, qtyOrdered: 3, qtyReturned: 2 }, file] }); as();
  await db.doc(`${T}/retailClaims/c1`).update({ qty: 3, claimValueCents: 5400 });
  r = await step('decideClaim', { claimId: 'c1', approve: true, how: 'replacement' });
  c1 = await get(`${T}/retailClaims/c1`);
  check('only the units still theirs go again, and the report and its loss say so', r.body.ok && c1.qtySettled === 1 && (await get(`${T}/inventoryExceptions/claim-c1`))?.qty === 1 && (await get(`${T}/inventoryExceptions/claim-c1`))?.replacementOrderId === c1.replacementOrderId);
  await fresh({ shippedWithOrderIds: ['o9'] }); as();
  await db.doc(`${T}/retailClaims/c2`).set(NR);
  r = await step('decideClaim', { claimId: 'c2', approve: true, how: 'replacement' });
  check('a whole order that shared a box isn’t sent again from here (the other order’s goods were in it too)', r.status === 409 && /one box with another order/.test(r.body.message));
  const { unitsLeft } = await import('../../src/lib/part-refund');
  check('units put right through a report can’t be refunded again on their own', unitsLeft({ qtyOrdered: 2, qtyClaimed: 1 }) === 1);
  await fresh({ method: 'pickup' }); as();
  r = await step('decideClaim', { claimId: 'c1', approve: true, how: 'replacement' });
  check('a pickup order’s replacement is told as one to collect, not one on its way', V.customerClaimStatus(await get(`${T}/retailClaims/c1`)).line === 'We’re getting another ready for you, at no charge. You’ll hear when it’s ready to collect.');
  check('a whole-order report keeps what was still theirs when it came in', /openAtFiling: Object\.fromEntries\(lines\.filter\(\(l: any\) => l && l\.lineId && unitsOpen\(l\) > 0\)/.test(src('src/app/api/retail/claims/route.ts')));
  check('a parcel that turned up after all closes the claim to file for a report on it too', /String\(x\.id\)\.startsWith\('claim-'\) && x\.data\(\)\?\.reason === 'carrier_lost'/.test(src('src/app/api/retail/shippo-webhook/route.ts')));

  console.log('the second look');
  await fresh({ refundedCents: 5200 }); as();
  await db.doc(`${T}/retailOrders/b1`).set({ id: 'b1', orderNumber: 1214, parentOrderId: 'o1', stage: 'completed', method: 'ship', customerName: 'Maya Rivera', customerEmail: 'Maya@Example.com', totalCents: 0, lines: [{ ...oil, lineId: 'BA', qtyOrdered: 1, unitPaidCents: 1800 }] });
  await db.doc(`${T}/retailClaims/cb`).set({ id: 'cb', orderId: 'b1', lineId: 'BA', lineName: 'Rose Cuticle Oil', qty: 1, claimValueCents: 1800, status: 'in_review', type: 'damaged', customerEmail: 'Maya@Example.com' });
  r = await step('decideClaim', { claimId: 'cb', approve: true, how: 'replacement' });
  check('a backorder whose original order was refunded in full isn’t sent again either', r.status === 409 && /refunded in full/.test(r.body.message), r.body);
  await fresh({ lines: [{ ...oil, qtyOrdered: 1, unitPriceCents: 3000, promoCents: 1500 }, { ...file, unitPriceCents: 3000 }], subtotalCents: 4500, totalCents: 4500, chargedCents: 4500 }); as();
  await db.doc(`${T}/retailClaims/c2`).set({ ...NR, claimValueCents: 4500, openAtFiling: { A: 1, B: 1 } });
  await db.doc(`${T}/retailOrders/o1`).update({ lines: [{ ...oil, qtyOrdered: 1, unitPriceCents: 3000, promoCents: 1500, qtyClaimed: 1 }, { ...file, unitPriceCents: 3000 }] });
  r = await step('decideClaim', { claimId: 'c2', approve: true, how: 'store_credit' });
  check('a whole order is valued at what each item was really paid (a promo counts): the file’s $30.00 of $45.00', r.body.ok && (await get(`${T}/depositCredits/claim_c2`))?.amountCents === 3000, (await get(`${T}/depositCredits/claim_c2`))?.amountCents);
  await fresh({ stage: 'shipped' }); as();
  r = await step('decideClaim', { claimId: 'c1', approve: true, how: 'replacement' });
  await db.doc(`${T}/retailClaims/c2`).set({ ...NR, openAtFiling: undefined });
  r = await step('decideClaim', { claimId: 'c2', approve: true });
  check('a whole-order report filed before what was open was kept: an item already sent again isn’t paid for as well', r.body.ok && (await get(`${T}/retailClaims/c2`)).resolutionCents === Math.round((5200 * 3000) / 4800), (await get(`${T}/retailClaims/c2`)).resolutionCents);
  o1 = await get(`${T}/retailOrders/o1`);
  lp = await lost();
  check('a never-arrived report put right leaves a note on the order that the quiet-parcel check, a parcel turning up and Needs you all read', o1.lostReportSettled?.claimId === 'c2' && o1.lostReportSettled?.how === 'refund' && lp.status === 409 && /if \(o\?\.lostReportSettled\) return `The customer’s report that \$\{num\(o\)\} never arrived was already put right\.`;/.test(src('src/app/api/retail/lost-parcel/route.ts'))
    && /order\.replacementOrderId \|\| order\.lostReportSettled\) continue;/.test(src('src/lib/retail-sweeps.ts')) && /\(order\.replacementOrderId \|\| order\.lostReportSettled\) && \['DELIVERED', 'RETURNED'\]/.test(src('src/app/api/retail/shippo-webhook/route.ts')), { mark: o1.lostReportSettled, lp: lp.body });
  check('the customer’s order page gets how a replacement goes and the credit given', /replacementMethod: d\.replacementMethod \|\| null,\s+creditCents: d\.creditCents \?\? null,/.test(src('src/app/api/retail/claims/route.ts')));
  check('…and offers to return only units still theirs (not ones refunded on their own or put right)', /order\.lines\.filter\(\(l\) => l\.lineId && \(l as any\)\.digital !== true && unitsOpen\(l\) > 0\)/.test(src('src/app/shop/[tenantId]/order/[orderId]/page.tsx')));

  await fresh({ totalCents: 0, chargedCents: 0, subtotalCents: 0, taxCents: 0 }); as();
  r = await step('decideClaim', { claimId: 'c1', approve: true, how: 'replacement' });
  check('an order nothing was paid for (a free one) can still be sent again', r.body.ok === true, r.body);
  await fresh({ lines: [{ ...oil, qtyReturned: 2 }, { ...file, qtyRefunded: 1 }] }); as();
  await db.doc(`${T}/retailClaims/c2`).set({ ...NR, openAtFiling: undefined });
  r = await step('decideClaim', { claimId: 'c2', approve: true });
  check('an older whole-order report on an order already returned and refunded in full isn’t approved for the full amount', r.body.ok === false && /already been put right/.test(r.body.message), r.body);

  console.log('what the customer hears');
  check('their order page says what happened', V.customerClaimStatus({ status: 'resolved', resolution: 'replacement', replacementMethod: 'ship' }).line === 'Another is on its way to you, at no charge.' && V.customerClaimStatus({ status: 'resolved', resolution: 'store_credit', creditCents: 1800, resolutionCents: 1800 }).line === '$18.00 store credit, ready to use at checkout.');
  const cn = src('src/app/api/retail/claim-notify/route.ts');
  check('…and the decision email and text say it too', /decision\.replacementMethod === 'ship' \? `, and we are sending you another at no charge\./.test(cn) && /we are getting another ready for you at no charge\. We will let you know when it is ready to collect\./.test(cn) && /in store credit has been added for you\. It is kept with \$\{String\(decision\.creditEmail/.test(cn) && /we’re sending another at no charge\. Details on your order page:/.test(cn));

  console.log('the screen');
  const card = src('src/components/orders/ClaimCard.tsx');
  check('the decide sheet offers a refund, Send another and Store credit, and sends the choice to the server', /\{ id: 'refund', label: 'A refund' \}/.test(card) && /label: 'Send another'/.test(card) && /label: 'Store credit'/.test(card) && /decideClaim\(tenantId, claim\.id, true, \{ how, cents: how === 'replacement' \|\| max === 0 \? null : cents \}\)/.test(card) && /role="radiogroup"/.test(card) && /aria-checked=\{how === h\.id\}/.test(card));
  check('…Send another isn’t offered for a download or an order already replaced, store credit not without an email', /const canSend = !!order && !paidBack && \(claim\.lineId\s+\? !!line && line\.digital !== true && left\.units > 0\s+: !order\.replacementOrderId && !shared/.test(card) && /const canCredit = max > 0 && !!String\(claim\.customerEmail \|\| order\?\.customerEmail \|\| ''\)\.trim\(\);/.test(card));
  check('the words: no mention of the tool, no "call us", no JSX comments', !new RegExp(['cl', 'aude|anth', 'ropic'].join(''), 'i').test(src('src/lib/claim-settle.ts') + card) && !/call us/i.test(src('src/lib/claim-settle.ts') + card + cn) && !/\{\/\*/.test(card));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
