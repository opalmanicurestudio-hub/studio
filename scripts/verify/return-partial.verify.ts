// Checks row 15, the two caveats after part 3: a return that only partly came back is checked in for just what did,
// and an item held to check is followed up in Problems until someone decides.
//   - only part came back (lib/retail-returns trimReturn): the return is cut down to what came, and its money with it;
//     the rest isn't coming (it can be returned again) or is still coming (a return of its own, same reasons, same way
//     of putting it right, the gift's recipient kept); asked again, nothing more changes; the customer is told what
//     didn't arrive (lib/return-view, api/retail/return-notify);
//   - held to check: kept out of stock, counted on the return (holdsOpen), listed in Problems under Returns, and decided
//     once there (decideHold): back on the shelf, or written off at cost with its loss record; the ones held on the old
//     Return desk are counted once by the nightly check.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/return-partial.verify.ts
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
const lamp = { lineId: 'L', productId: 'lamp', sku: 'LAMP', name: 'Mini Gel Lamp', unitPriceCents: 4800, qtyOrdered: 1, qtyShorted: 0, qtyReturned: 0 };
const polish = { lineId: 'P', productId: 'dusk', sku: 'DUSK', name: 'Dusk Polish', unitPriceCents: 1600, qtyOrdered: 3, qtyShorted: 0, qtyReturned: 0 };

(async () => {
  const RO = await import('../../src/lib/retail-orders');
  const order0: any = { lines: [lamp, polish], subtotalCents: 9600, taxCents: 960 };
  console.log('the money for part of a return');
  check('the same share of what it was started at as those items are of all of them, with their tax', RO.trimmedReturnCents(order0, [{ lineId: 'L', qty: 1 }, { lineId: 'P', qty: 3 }] as any, [{ lineId: 'P', qty: 1 }] as any, 10560) === 1760 && RO.trimmedReturnCents(order0, [{ lineId: 'L', qty: 1 }] as any, [] as any, 5280) === 0);

  const { POST } = await import('../../src/app/api/retail/fulfil/route');
  const step = async (action: string, args: any = {}) => { const r: any = await POST(req({ tenantId: 't1', action, ...args })); await settle(); return r; };
  const fresh = async (o: any = {}, ret: any = {}) => {
    db = strictTransactions(makeDb());
    await db.doc(T).set({ name: 'Opal', retailSettings: {} });
    await db.doc(`${T}/inventory/lamp`).set({ id: 'lamp', name: 'Mini Gel Lamp', costPerUnit: 20, totalStock: 4, batches: [{ id: 'b1', stock: 4, costPerUnit: 20 }], unit: 'units' });
    await db.doc(`${T}/inventory/dusk`).set({ id: 'dusk', name: 'Dusk Polish', costPerUnit: 5, totalStock: 10, batches: [{ id: 'b2', stock: 10, costPerUnit: 5 }], unit: 'units' });
    await db.doc(`${T}/retailOrders/o1`).set({ id: 'o1', orderNumber: 1209, stage: 'completed', method: 'ship', customerName: 'Jordan Tate', customerEmail: 'jordan@example.com', qrToken: 'o1.tok', lines: [lamp, polish], subtotalCents: 9600, taxCents: 0, totalCents: 9600, returnSeq: 1, ...o });
    await db.doc(`${T}/retailReturns/r1`).set({ id: 'r1', tenantId: 't1', orderId: 'o1', orderNumber: 1209, status: 'open', resolution: 'refund', photoUrls: [], refundCents: 9600, openedBy: 'Customer — Jordan Tate', openedAt: '2026-10-28T15:00:00Z', labelUrl: 'https://labels.example/r1.pdf', lines: [{ lineId: 'L', sku: 'LAMP', name: 'Mini Gel Lamp', qty: 1, reason: 'changed_mind' }, { lineId: 'P', sku: 'DUSK', name: 'Dusk Polish', qty: 3, reason: 'changed_mind' }], ...ret });
  };

  console.log('only part came back, the rest isn’t coming');
  await fresh();
  let r = await step('trimReturn', { returnId: 'r1', received: [{ lineId: 'L', qty: 1 }, { lineId: 'P', qty: 1 }], rest: 'drop' });
  let ret = await get(`${T}/retailReturns/r1`);
  check('the return is cut down to what came, and what it pays back with it', r.body.ok && r.body.trimmed === true && ret.lines.map((l: any) => `${l.lineId}${l.qty}`).join() === 'L1,P1' && ret.refundCents === 6400 && !(await all(`${T}/retailReturns`)).some((x: any) => x.restOf), { r: r.body, ret });
  check('…what didn’t come is kept on the return, and the order counts the change (a return started at the same moment tries again)', ret.trimmed?.[0]?.rest === 'drop' && ret.trimmed[0].lines[0].name === 'Dusk Polish' && ret.trimmed[0].lines[0].qty === 2 && ret.trimmed[0].by === 'Kai Park' && (await get(`${T}/retailOrders/o1`)).returnSeq === 2);
  const evs = await all(`${T}/retailOrders/o1/events`);
  check('…and the order’s history says so', evs.some((e: any) => e.type === 'note' && e.meta?.kind === 'return_trimmed' && /Not coming: Dusk Polish × 2/.test(e.meta.text)), evs);
  r = await step('trimReturn', { returnId: 'r1', received: [{ lineId: 'L', qty: 1 }, { lineId: 'P', qty: 1 }], rest: 'keep' });
  check('asked again, nothing more changes, and what was decided the first time is said again (never a different choice)', r.body.ok && r.body.trimmed === false && r.body.earlier === true && /was already taken off this return/.test(r.body.message) && (await get(`${T}/retailReturns/r1`)).trimmed.length === 1 && (await get(`${T}/retailOrders/o1`)).returnSeq === 2 && !(await all(`${T}/retailReturns`)).some((x: any) => x.restOf), r.body);
  await step('receiveReturnLine', { returnId: 'r1', lineId: 'L', disposition: 'restock' });
  await step('receiveReturnLine', { returnId: 'r1', lineId: 'P', disposition: 'restock' });
  check('checking an item in counts on the order too (a return started at the same moment tries again)', (await get(`${T}/retailOrders/o1`)).returnSeq === 4);
  r = await step('resolveReturn', { returnId: 'r1' });
  const o1 = await get(`${T}/retailOrders/o1`);
  check('checked in, it refunds only what came back, and only that counts as returned', r.body.ok && r.body.refundQueuedCents === 6400 && o1.pendingRefundCents === 6400 && o1.lines[1].qtyReturned === 1 && (await get(`${T}/inventory/dusk`)).totalStock === 11, { r: r.body, lines: o1.lines });
  const RR = await import('../../src/lib/return-reserve');
  check('…and what didn’t come can be returned again later', RR.returnableUnits(o1.lines[1], [], await all(`${T}/retailReturns`)) === 2);

  console.log('only part came back, the rest is still coming');
  await fresh({}, { giftRecipient: { name: 'Sam Lee', email: 'sam@example.com' }, isGiftReturn: true, resolution: 'store_credit', refundCents: undefined, storeCreditCents: 9600, notes: 'Two boxes' });
  await db.doc(`${T}/private/giftReturns/returns/r1`).set({ name: 'Sam Lee', email: 'sam@example.com', orderId: 'o1', valueCents: 9600, at: '2026-10-28T15:00:00Z' });
  r = await step('trimReturn', { returnId: 'r1', received: [{ lineId: 'L', qty: 1 }, { lineId: 'P', qty: 0 }], rest: 'keep' });
  ret = await get(`${T}/retailReturns/r1`);
  const restRet: any = (await all(`${T}/retailReturns`)).find((x: any) => x.restOf === 'r1');
  check('the rest is a return of its own: what didn’t come, the same reasons, the same way of putting it right, and its share of the money', r.body.ok && !!restRet && restRet.id === r.body.restReturnId && ret.restReturnId === restRet.id && restRet.status === 'open' && restRet.resolution === 'store_credit' && restRet.lines.length === 1 && restRet.lines[0].lineId === 'P' && restRet.lines[0].qty === 3 && restRet.lines[0].reason === 'changed_mind' && restRet.storeCreditCents === 4800 && ret.storeCreditCents === 4800, { r: r.body, ret, restRet });
  check('…opened by the person checking in, with no label of its own yet, and the team’s note kept', restRet.openedBy === 'Kai Park' && !restRet.labelUrl && /The rest of an earlier return/.test(restRet.notes) && /Two boxes/.test(restRet.notes));
  const gRest = await get(`${T}/private/giftReturns/returns/${restRet.id}`);
  check('…a gift’s recipient is kept, as the server recorded them, so its credit reaches the same person', restRet.isGiftReturn === true && restRet.giftRecipient?.email === 'sam@example.com' && gRest?.email === 'sam@example.com' && gRest.valueCents === 4800, gRest);
  check('…and its items stay on their way back (they can’t be started again meanwhile)', RR.returnableUnits(polish, [], await all(`${T}/retailReturns`)) === 0);

  console.log('the shop’s fault stays with both parts');
  await fresh({}, { lines: [{ lineId: 'L', sku: 'LAMP', name: 'Mini Gel Lamp', qty: 1, reason: 'defective' }, { lineId: 'P', sku: 'DUSK', name: 'Dusk Polish', qty: 3, reason: 'changed_mind' }] });
  await db.doc(T).set({ name: 'Opal', retailSettings: { policies: { restockingFees: { as_new: 20, opened: 20, damaged: 20 } } } });
  r = await step('trimReturn', { returnId: 'r1', received: [{ lineId: 'L', qty: 0 }, { lineId: 'P', qty: 3 }], rest: 'keep' });
  const half: any = (await all(`${T}/retailReturns`)).find((x: any) => x.restOf === 'r1');
  check('a return with a faulty item keeps no restocking fee whichever part comes first, and the rest keeps it too', r.body.ok && (await get(`${T}/retailReturns/r1`)).shopFault === true && half?.shopFault === true, half);
  await step('receiveReturnLine', { returnId: 'r1', lineId: 'P', disposition: 'restock' });
  r = await step('resolveReturn', { returnId: 'r1' });
  ret = await get(`${T}/retailReturns/r1`);
  check('…the polish that came first refunds in full (no fee: the lamp still coming was the shop’s fault)', r.body.ok && r.body.refundQueuedCents === 4800 && !ret.restockingFeeCents, { r: r.body, ret });
  await fresh({}, { lines: [{ lineId: 'L', sku: 'LAMP', name: 'Mini Gel Lamp', qty: 1, reason: 'defective' }, { lineId: 'P', sku: 'DUSK', name: 'Dusk Polish', qty: 3, reason: 'changed_mind' }] });
  await db.doc(T).set({ name: 'Opal', retailSettings: { policies: { restockingFees: { as_new: 20, opened: 20, damaged: 20 } } } });
  await step('trimReturn', { returnId: 'r1', received: [{ lineId: 'L', qty: 0 }, { lineId: 'P', qty: 3 }], rest: 'drop' });
  await step('receiveReturnLine', { returnId: 'r1', lineId: 'P', disposition: 'restock' });
  r = await step('resolveReturn', { returnId: 'r1' });
  ret = await get(`${T}/retailReturns/r1`);
  check('…but when the faulty item isn’t coming, what came back is a change of mind like any other (its fee applies)', r.body.ok && !ret.shopFault && ret.restockingFeeCents === 960 && r.body.refundQueuedCents === 3840, { r: r.body, ret });
  check('…the screens and the label agree', /ret\.shopFault === true \|\| returnIsShopFault\(short && rest === 'drop' \? lines : ret\.lines \|\| \[\]\)/.test(src('src/components/orders/ReturnSheet.tsx')) && /ret\.shopFault === true \|\| retLines\.some/.test(src('src/app/api/retail/return-label/route.ts')));

  console.log('what the server refuses');
  await fresh();
  r = await step('trimReturn', { returnId: 'r1', received: [{ lineId: 'L', qty: 0 }, { lineId: 'P', qty: 0 }], rest: 'drop' });
  check('nothing came back: nothing is cut (mark what came, or close it)', r.body.ok === false && /Mark what came back first/.test(r.body.message) && (await get(`${T}/retailReturns/r1`)).lines.length === 2, r.body);
  r = await step('trimReturn', { returnId: 'r1', received: [{ lineId: 'L', qty: 1 }] });
  check('…the rest must be said (still coming, or not)', r.status === 400 && /still coming/.test(r.body.message), r.body);
  r = await step('trimReturn', { returnId: 'r1', received: [{ lineId: 'P', qty: 2 }], rest: 'drop' });
  ret = await get(`${T}/retailReturns/r1`);
  check('…an item the screen didn’t count is left as it is (never dropped unasked)', r.body.ok && ret.lines.find((l: any) => l.lineId === 'L')?.qty === 1 && ret.lines.find((l: any) => l.lineId === 'P')?.qty === 2, ret.lines);
  await fresh({}, { status: 'received', lines: [{ lineId: 'L', sku: 'LAMP', name: 'Mini Gel Lamp', qty: 1, reason: 'changed_mind', disposition: 'restock' }, { lineId: 'P', sku: 'DUSK', name: 'Dusk Polish', qty: 3, reason: 'changed_mind' }] });
  r = await step('trimReturn', { returnId: 'r1', received: [{ lineId: 'L', qty: 0 }, { lineId: 'P', qty: 1 }], rest: 'drop' });
  ret = await get(`${T}/retailReturns/r1`);
  check('…what’s already checked in stays as it is', r.body.ok && ret.lines.find((l: any) => l.lineId === 'L')?.qty === 1 && ret.lines.find((l: any) => l.lineId === 'P')?.qty === 1, ret.lines);
  r = await step('receiveReturnLine', { returnId: 'r1', lineId: 'P' });
  check('an item is never checked in without its condition (never assumed to go back on the shelf)', r.status === 400 && /condition/.test(r.body.message) && !(await get(`${T}/retailReturns/r1`)).lines.find((l: any) => l.lineId === 'P').disposition, r.body);
  await fresh({}, { status: 'resolved' });
  r = await step('trimReturn', { returnId: 'r1', received: [{ lineId: 'L', qty: 1 }, { lineId: 'P', qty: 0 }], rest: 'drop' });
  check('…nor is a settled return cut', r.body.ok === false && /already closed/.test(r.body.message));
  await fresh();
  actor = { ...actor, fulfilmentRole: 'picker' };
  r = await step('trimReturn', { returnId: 'r1', received: [{ lineId: 'L', qty: 1 }, { lineId: 'P', qty: 0 }], rest: 'drop' });
  const r3 = await step('decideHold', { returnId: 'r1', lineId: 'L', outcome: 'restock' });
  check('a picker doesn’t check in returns or decide held items (they move stock)', r.status === 403 && r3.status === 403);
  actor = { uid: 'k1', name: 'Kai Park', role: 'staff', isManager: false, isTenantOwner: false, caps: [] };

  console.log('held to check');
  await fresh();
  r = await step('receiveReturnLine', { returnId: 'r1', lineId: 'L', disposition: 'quarantine' });
  ret = await get(`${T}/retailReturns/r1`);
  check('held to check: kept out of stock, nothing written off, and counted on the return', r.body.ok && /held to check/.test(r.body.message) && (await get(`${T}/inventory/lamp`)).totalStock === 4 && ret.holdsOpen === 1 && !!ret.lines[0].heldAt && !(await all(`${T}/inventoryExceptions`)).length && !(await all(`${T}/transactions`)).length, { r: r.body, ret });
  await step('receiveReturnLine', { returnId: 'r1', lineId: 'P', disposition: 'quarantine' });
  r = await step('resolveReturn', { returnId: 'r1' });
  ret = await get(`${T}/retailReturns/r1`);
  check('…the money is settled at check-in as usual (held items don’t keep the customer waiting)', r.body.ok && ret.status === 'resolved' && ret.holdsOpen === 2, { r: r.body, ret });
  const PV = await import('../../src/lib/problems-view');
  let groups = PV.buildProblems({ orders: [], knownOrders: [await get(`${T}/retailOrders/o1`)], holds: [{ ...ret, id: 'r1' }], now: Date.now() });
  const kinds = groups[0]?.items.map((p) => p.kind).join();
  check('…each waits in Problems under Returns until someone decides', kinds === 'inspect,inspect' && /^Held to check: Mini Gel Lamp$/.test(groups[0].items[0].title) && /Changed their mind · held/.test(groups[0].items[0].detail) && PV.showProblems(groups, 'returns').length === 1 && PV.showProblems(groups, 'claims').length === 0, groups[0]?.items);
  r = await step('decideHold', { returnId: 'r1', lineId: 'L', outcome: 'restock' });
  ret = await get(`${T}/retailReturns/r1`);
  const corr = await all(`${T}/stockCorrections`);
  check('fine, back on the shelf: back in stock, with its correction, decided once', r.body.ok && /back on the shelf/.test(r.body.message) && (await get(`${T}/inventory/lamp`)).totalStock === 5 && corr.some((c: any) => c.productId === 'lamp' && c.change === 1 && /Held return checked/.test(c.reason)) && ret.lines[0].holdDecided?.outcome === 'restock' && ret.lines[0].holdDecided.by === 'Kai Park' && ret.holdsOpen === 1, { r: r.body, ret });
  r = await step('decideHold', { returnId: 'r1', lineId: 'L', outcome: 'restock' });
  check('…and never twice (no second batch on the shelf)', r.body.ok === false && /decided already/.test(r.body.message) && (await get(`${T}/inventory/lamp`)).totalStock === 5);
  r = await step('decideHold', { returnId: 'r1', lineId: 'P', outcome: 'dispose' });
  ret = await get(`${T}/retailReturns/r1`);
  const tx = await all(`${T}/transactions`); const exc = await all(`${T}/inventoryExceptions`);
  check('thrown away: written off at cost, with its loss record, and nothing back in stock', r.body.ok && (await get(`${T}/inventory/dusk`)).totalStock === 10 && tx.some((t: any) => t.category === 'Spoilage' && t.amount === 15 && /after a check/.test(t.description)) && exc.some((e: any) => e.id === 'ret-r1-P' || e.dedupeId === 'ret-r1-P') && ret.holdsOpen === 0, { tx, exc, ret });
  groups = PV.buildProblems({ orders: [], holds: [{ ...ret, id: 'r1' }], now: Date.now() });
  check('…and once decided it leaves Problems', groups.length === 0);
  check('…the order’s history says what was found', (await all(`${T}/retailOrders/o1/events`)).filter((e: any) => e.meta?.kind === 'hold_decided').length === 2);
  r = await step('decideHold', { returnId: 'r1', lineId: 'P', outcome: 'sell_anyway' });
  const r4 = await step('decideHold', { returnId: 'r1', lineId: 'X', outcome: 'restock' });
  check('only what it turned out to be, on an item that’s held', r.status === 400 && r4.body.ok === false && /isn’t held/.test(r4.body.message));
  await fresh();
  await step('receiveReturnLine', { returnId: 'r1', lineId: 'L', disposition: 'quarantine' });
  await db.doc(`${T}/inventory/lamp`).delete();
  r = await step('decideHold', { returnId: 'r1', lineId: 'L', outcome: 'restock' });
  check('a product no longer in stock can’t go back on the shelf (written off instead), and stays held', r.body.ok === false && /Write it off instead/.test(r.body.message) && (await get(`${T}/retailReturns/r1`)).holdsOpen === 1, r.body);

  console.log('held items that turn out differently');
  await fresh({}, { lines: [{ lineId: 'P', sku: 'DUSK', name: 'Dusk Polish', qty: 3, reason: 'changed_mind' }] });
  await step('receiveReturnLine', { returnId: 'r1', lineId: 'P', disposition: 'quarantine' });
  r = await step('decideHold', { returnId: 'r1', lineId: 'P', outcome: 'restock', qty: 2 });
  ret = await get(`${T}/retailReturns/r1`);
  groups = PV.buildProblems({ orders: [], holds: [{ ...ret, id: 'r1' }], now: Date.now() });
  check('two fine: back on the shelf, and the third still waits in Problems', r.body.ok && /1 still held/.test(r.body.message) && (await get(`${T}/inventory/dusk`)).totalStock === 12 && ret.holdsOpen === 1 && !ret.lines[0].holdDecided && groups[0]?.items[0]?.title === 'Held to check: Dusk Polish' && groups[0].items[0].ref.left === 1, { r: r.body, ret, g: groups[0]?.items });
  r = await step('decideHold', { returnId: 'r1', lineId: 'P', outcome: 'damaged', qty: 2 });
  check('…never more than are still held', r.body.ok === false && /Only 1 of Dusk Polish is still held/.test(r.body.message), r.body);
  r = await step('decideHold', { returnId: 'r1', lineId: 'P', outcome: 'damaged' });
  ret = await get(`${T}/retailReturns/r1`);
  check('…the last one damaged: written off on its own, and the item is decided', r.body.ok && ret.holdsOpen === 0 && ret.lines[0].holdDecided?.outcome === 'mixed' && ret.lines[0].holdDecisions.length === 2 && (await all(`${T}/transactions`)).some((t: any) => t.amount === 5 && /1 x Dusk Polish/.test(t.description)) && (await all(`${T}/inventoryExceptions`)).some((e: any) => e.id === 'ret-r1-P-h2' || e.dedupeId === 'ret-r1-P-h2'), { ret, exc: await all(`${T}/inventoryExceptions`) });
  await fresh();
  await db.doc(T).set({ name: 'Opal', retailSettings: { policies: { openedReturns: 'restock' } } });
  await step('receiveReturnLine', { returnId: 'r1', lineId: 'L', disposition: 'quarantine' });
  r = await step('decideHold', { returnId: 'r1', lineId: 'L', outcome: 'open_box' });
  check('opened: by the shop’s policy for opened items (here, back on the shelf)', r.body.ok && /opened, back on the shelf/.test(r.body.message) && (await get(`${T}/inventory/lamp`)).totalStock === 5, r.body);

  console.log('held on the old Return desk');
  const RC = await import('../../src/lib/return-close');
  await fresh({}, { status: 'resolved', lines: [{ lineId: 'L', sku: 'LAMP', name: 'Mini Gel Lamp', qty: 1, reason: 'defective', disposition: 'quarantine' }] });
  await db.doc(`${T}/retailReturns/r2`).set({ id: 'r2', orderId: 'o1', status: 'resolved', lines: [{ lineId: 'P', qty: 1, disposition: 'restock' }] });
  await db.doc(`${T}/retailReturns/r3`).set({ id: 'r3', orderId: 'o1', status: 'received', lines: [{ lineId: 'P', qty: 2, disposition: 'quarantine' }] });
  const n1 = await RC.countEarlierHolds(db, 't1', { page: 1, pages: 2 });
  const mid = await get(`${T}/private/holdsCounted`);
  const n2 = await RC.countEarlierHolds(db, 't1', { page: 1, pages: 2 }); const n3 = await RC.countEarlierHolds(db, 't1', { page: 1, pages: 2 });
  check('counted in pages: a night that doesn’t get through them all carries on the next, then it’s done for good', n1 === 1 && !mid?.doneAt && mid?.after === 'r2' && n2 === 1 && n3 === 0 && !!(await get(`${T}/private/holdsCounted`))?.doneAt && (await get(`${T}/retailReturns/r1`)).holdsOpen === 1 && (await get(`${T}/retailReturns/r3`)).holdsOpen === 1 && (await get(`${T}/retailReturns/r2`)).holdsOpen === undefined && /countEarlierHolds\(db, tenantId\)/.test(src('src/lib/retail-nightly.ts')), { n1, n2, n3, mid });

  console.log('what the customer sees');
  const V = await import('../../src/lib/return-view');
  const cut = { id: 'r1', status: 'resolved', resolution: 'refund', refundNetCents: 6400, lines: [{ name: 'Mini Gel Lamp', qty: 1 }], trimmed: [{ rest: 'drop', lines: [{ name: 'Dusk Polish', qty: 2 }] }] };
  let v = V.customerReturnStatus(V.publicReturn(cut, true), 'ship');
  check('what wasn’t checked in is named, plainly (it may be at the counter or kept), with what to do if they sent it', /Dusk Polish ×2 wasn’t checked in, so it isn’t part of this return\. If you sent it back, write to the shop under Need help with this order\./.test(v.line) && v.label === 'Refunded', v);
  v = V.customerReturnStatus(V.publicReturn({ ...cut, trimmed: [{ rest: 'keep', lines: [{ name: 'Dusk Polish', qty: 2 }] }] }, true), 'ship');
  check('…the rest still coming isn’t called missing (it’s a return of its own)', !/checked in, so/.test(v.line));
  v = V.customerReturnStatus(V.publicReturn({ id: 'r9', status: 'open', resolution: 'refund', restOf: 'r1', openedBy: 'Kai Park', lines: [{ name: 'Dusk Polish', qty: 2 }] }, true), 'ship');
  check('the rest, by post: send it back when they can, and ask for a label if they need one (never “bring it to the shop”)', v.label === 'Send it back' && v.steps[0].label === 'On its way back to us' && /Part of your return reached us\. Send the rest back when you can/.test(v.line), v);
  v = V.customerReturnStatus(V.publicReturn({ id: 'r9', status: 'open', resolution: 'refund', restOf: 'r1', openedBy: 'Kai Park', lines: [{ name: 'Dusk Polish', qty: 2 }] }, true), 'pickup');
  check('…collected from the shop: bring the rest in', v.label === 'Bring it by' && /Bring the rest to the shop/.test(v.line));
  const mail = src('src/app/api/retail/return-notify/route.ts');
  check('the email names what didn’t arrive, and what is still to come', /\$\{namesOf\(dropped\)\} \$\{dropped\.length > 1 \? 'were' : 'was'\} not checked in/.test(mail) && /not arrived yet/.test(mail) && /\$\{cutHtml\}/.test(mail) && /esc\(str\(l\.name, 120\) \|\| 'Item'\)/.test(mail));
  check('Problems says the rest is still to come back', /still to come back/.test(PV.buildProblems({ orders: [], returns: [{ id: 'r9', orderId: 'o1', status: 'open', restOf: 'r1', lines: [{ qty: 2 }], openedAt: '2026-10-30T12:00:00Z' }] })[0].items[0].title));

  console.log('the screens');
  const rsheet = src('src/components/orders/ReturnSheet.tsx');
  check('check-in offers Hold to check, which waits in Problems', /\{ id: 'quarantine', label: 'Hold to check' \}/.test(rsheet) && /Kept out of stock until someone checks it\. It waits in Problems\./.test(rsheet));
  check('…and “Only part of it came back”: count what came, say whether the rest is still coming, check in just that', /Only part of it came back/.test(rsheet) && /What about the rest\?/.test(rsheet) && /\['drop', 'It isn’t coming'\], \['keep', 'It’s still coming'\]/.test(rsheet) && /aria-label=\{`One fewer \$\{l\.name\}`\}/.test(rsheet) && /Didn’t come back/.test(rsheet) && /const ready = part \? here\.length > 0 && allGraded && \(!short \|\| !!rest\) : allIn && allGraded;/.test(rsheet) && /disabled=\{busy \|\| !order \|\| !ready\}/.test(rsheet));
  check('…the return is cut down on the server before anything is checked in, and the money shown is for what came', rsheet.indexOf('await trimReturn(') > 0 && rsheet.indexOf('await trimReturn(') < rsheet.indexOf('await receiveReturnLine(') && /trimmedReturnCents\(order, ret\.lines \|\| \[\], lines, quoted\)/.test(rsheet) && /if \(!cond\[l\.lineId\]\) \{ setErr\(/.test(rsheet));
  const panel = src('src/components/orders/ProblemPanel.tsx');
  check('Problems decides a held item: fine, opened, damaged or thrown away, how many, chosen first, then saved', /if \(p\.kind === 'inspect'\) return <HoldCard/.test(panel) && /\{ id: 'restock', label: 'Fine, as new'/.test(panel) && /\{ id: 'open_box', label: 'Opened'/.test(panel) && /decideHold\(tenantId, r\.id, l\.lineId, pick, n\)/.test(panel) && /disabled=\{!pick \|\| busy\}/.test(panel) && /aria-label=\{`How many \$\{l\.name \|\| 'items'\}`\}/.test(panel));
  check('…and the order opens the return part way through checking in first, then the one started first', /opens\.find\(\(r: any\) => r\.status === 'received'\) \|\| \[\.\.\.opens\]\.sort/.test(src('src/components/orders/workspace/OrderWorkspace.tsx')));
  check('…a retry says what was decided the first time; the closing promise follows the shop’s setting', /if \(t\.trimmed \|\| \(t as any\)\.earlier\) restLine/.test(rsheet) && /closeDays \? `, and closes by itself if it hasn’t come in \$\{closeDays\} day\$\{closeDays === 1 \? '' : 's'\}` : ' until it comes or you close it'/.test(rsheet));
  check('…listening for returns with an item still held, open or settled', /where\('holdsOpen', '>', 0\)/.test(src('src/components/orders/ProblemsApp.tsx')) && /\.\.\.returns, \.\.\.holds, \.\.\.claims/.test(src('src/components/orders/ProblemsApp.tsx')));
  const words = rsheet + panel + src('src/lib/return-view.ts') + src('src/lib/problems-view.ts') + mail;
  check('the words: no mention of the tool, no "call us", US spelling, no JSX comments, no emojis', !new RegExp(['cl', 'aude|anth', 'ropic'].join(''), 'i').test(words) && !/call us/i.test(words) && !/cancelled/.test(words.replace(/'cancelled'/g, '')) && !/\{\/\*/.test(rsheet + panel) && !/[\u{1F300}-\u{1FAFF}]/u.test(words));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
