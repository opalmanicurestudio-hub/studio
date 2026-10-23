// Checks the second scan is counted per unit and saved on the order (lib/retail-orders applyBoxScan, lib/retail-fulfill
// recordBoxScan, markPacked, undoLineCount, takeOverOrder). A scan on the packing screen is at the box: the unit counts
// as picked and in the box at once. Items picked at the shelf are scanned again as they go in; one scan at the box
// never excuses the rest. Finishing checks it in the engine, whichever screen finishes. An undo takes back exactly what
// was counted. Taking over someone's order keeps every count.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/box-scan.verify.ts
import Module from 'module';
import * as mock from './web-firestore-mock';
import { check, failures } from './fake-db';

const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'firebase/firestore') return mock;
  if (request === 'firebase/auth') return { getAuth: () => ({ currentUser: null }) };
  return load.call(this, request, ...rest);
};

const T = 'tenants/t1';
const ana = { id: 'u1', name: 'Ana Ruiz' };
const kai = { id: 'u2', name: 'Kai Park' };
const line = (id: string, productId: string, name: string, q: number, scanned: number, x: any = {}) => ({ lineId: id, productId, name, qtyOrdered: q, qtyScanned: scanned, qtyShorted: 0, qtyPacked: 0, unitPriceCents: 1000, status: scanned >= q ? 'picked' : 'pending', barcode: `85000111000${productId.slice(1)}`, ...x });
const order = (lines: any[], x: any = {}) => ({ tenantId: 't1', orderNumber: 1210, stage: 'picking', method: 'ship', claimedBy: 'u2', claimedByName: 'Kai Park', batchId: 'b8', customerName: 'Noor Haddad', lines, ...x });
const o = () => mock.read(`${T}/retailOrders/o8`)!;
const L = (id: string) => o().lines.find((l: any) => l.lineId === id);

(async () => {
  const { applyBoxScan, isPackComplete } = await import('../../src/lib/retail-orders');
  const fx = await import('../../src/lib/retail-fulfill');

  // ── The rule ──
  const shelf = [line('a', 'p3', 'Gel polish', 4, 4), line('b', 'p2', 'Cuticle oil', 1, 0)];
  let r = applyBoxScan(shelf as any, '850001110002', null, true);
  check('a unit scanned at the box counts as picked and as in the box at once', r.result.ok && (r.result as any).kind === 'picked' && r.lines[1].qtyScanned === 1 && (r.lines[1] as any).qtyPacked === 1);
  check('…but four picked at the shelf still need their scan into the box: the order isn’t packed yet', !isPackComplete(r.lines as any));
  r = applyBoxScan(r.lines as any, '850001110003', null, true);
  check('an item picked at the shelf, scanned at the box, is checked in (second scan on)', r.result.ok && (r.result as any).kind === 'checked' && (r.lines[0] as any).qtyPacked === 1 && r.lines[0].qtyScanned === 4);
  r = applyBoxScan([line('a', 'p3', 'Gel polish', 2, 2)] as any, '850001110003', null, false);
  check('without the second scan, a fully counted item says so (nothing is counted)', !r.result.ok && (r.result as any).code === 'over_scan');
  r = applyBoxScan([line('a', 'p3', 'Gel polish', 5, 4)] as any, '850001110003', null, true);
  check('the 5th of 5, four picked at the shelf: picked and in the box, and four still to check in', r.result.ok && (r.result as any).kind === 'picked' && r.lines[0].qtyScanned === 5 && (r.lines[0] as any).qtyPacked === 1 && !isPackComplete(r.lines as any));
  r = applyBoxScan([line('a', 'p3', 'Gel polish', 1, 1, { qtyPacked: 1 })] as any, '850001110003', null, true);
  check('…a unit already checked in can’t be counted twice', !r.result.ok && (r.result as any).code === 'over_scan');

  // ── Saved on the order, checked when it's packed ──
  mock.reset();
  mock.seed(`${T}/retailOrders/o8`, order([line('a', 'p3', 'Gel polish', 4, 4), line('b', 'p2', 'Cuticle oil', 1, 0)], { claimedBy: 'u1', claimedByName: 'Ana Ruiz', batchId: 'b1' }));
  mock.seed(`${T}/fulfillmentBatches/b1`, { active: true, orderIds: ['o8'], assignedTo: 'u1' });
  let a = await fx.recordBoxScan({} as any, 't1', 'o8', '850001110002', ana, { secondScan: true });
  check('the scan at the box is saved on the order', a.ok && a.kind === 'picked' && L('b').qtyScanned === 1 && L('b').qtyPacked === 1, a);
  let p = await fx.markPacked({} as any, 't1', 'o8', ana, { requirePackScan: true });
  check('with the second scan on, the order can’t be marked packed while shelf-picked units aren’t in the box', !p.ok && /scan every item again/i.test(p.message) && o().stage === 'picking', p);
  for (let i = 0; i < 4; i++) a = await fx.recordBoxScan({} as any, 't1', 'o8', '850001110003', ana, { secondScan: true });
  check('each shelf-picked unit is checked in by its own scan', a.ok && a.kind === 'checked' && a.packComplete === true && L('a').qtyPacked === 4, a);
  p = await fx.markPacked({} as any, 't1', 'o8', ana, { requirePackScan: true });
  check('…then it’s packed', p.ok && o().stage === 'packed', p);

  // A wave order's one scan is at the box: no second scan asked.
  mock.reset();
  mock.seed(`${T}/retailOrders/o8`, order([line('a', 'p3', 'Gel polish', 2, 2)], { waveId: 'w1' }));
  p = await fx.markPacked({} as any, 't1', 'o8', ana, { requirePackScan: true });
  check('a wave order isn’t held for a second scan', p.ok);

  // A line partly missing (refunded): the units picked before still go in the box, and are checked in.
  const part = [line('a', 'p3', 'Gel polish', 3, 2, { qtyShorted: 1, status: 'refunded' })];
  check('a line with one of three refunded still needs its two picked units in the box', !isPackComplete(part as any) && isPackComplete([{ ...part[0], qtyPacked: 2 }] as any));
  r = applyBoxScan(part as any, '850001110003', null, true);
  check('…and a scan at the box checks one in', r.result.ok && (r.result as any).kind === 'checked' && (r.lines[0] as any).qtyPacked === 1);
  check('…a line refunded in full needs nothing in the box', isPackComplete([line('a', 'p3', 'Gel polish', 2, 0, { qtyShorted: 2, status: 'refunded' })] as any));
  mock.reset();
  mock.seed(`${T}/retailOrders/o8`, order(part, { claimedBy: 'u1' }));
  p = await fx.markPacked({} as any, 't1', 'o8', ana, { requirePackScan: true });
  check('…so the order can’t be marked packed before they’re in', !p.ok);

  // A code added to the product after the order was placed, two lines of it: the one still to check in.
  mock.reset();
  mock.seed(`${T}/inventory/p3`, { name: 'Gel polish', barcode: 'NEWCODE123' });
  mock.seed(`${T}/retailOrders/o8`, order([line('a', 'p3', 'Gel polish', 1, 1, { qtyPacked: 1 }), line('b', 'p3', 'Gel polish', 1, 1, { optionsLabel: 'Matte' })], { claimedBy: 'u1' }));
  a = await fx.recordBoxScan({} as any, 't1', 'o8', 'NEWCODE123', ana, { secondScan: true });
  check('a code the product got after the order was placed finds the line still to check in (not the one already in)', a.ok && a.kind === 'checked' && L('b').qtyPacked === 1 && L('a').qtyPacked === 1, a);

  // ── Undo takes back exactly what was counted ──
  mock.reset();
  mock.seed(`${T}/retailOrders/o8`, order([line('a', 'p3', 'Gel polish', 2, 1), line('b', 'p2', 'Cuticle oil', 1, 1)], { claimedBy: 'u1' }));
  a = await fx.recordBoxScan({} as any, 't1', 'o8', '850001110003', ana, { secondScan: true });
  let u = await fx.undoLineCount({} as any, 't1', 'o8', 'a', ana, 'box');
  check('undoing a scan at the box takes the unit back out: not picked, not in the box', a.ok && u.ok && L('a').qtyScanned === 1 && L('a').qtyPacked === 0, { a, u, line: L('a') });
  a = await fx.recordBoxScan({} as any, 't1', 'o8', '850001110002', ana, { secondScan: true });
  u = await fx.undoLineCount({} as any, 't1', 'o8', 'b', ana, 'check');
  check('undoing a second scan takes back only its check: still picked', a.ok && a.kind === 'checked' && u.ok && L('b').qtyScanned === 1 && L('b').qtyPacked === 0, { a, u, line: L('b') });

  // ── Taking over ──
  mock.reset();
  mock.seed(`${T}/retailOrders/o8`, order([line('a', 'p3', 'Gel polish', 2, 2), line('b', 'p2', 'Cuticle oil', 1, 1)]));
  mock.seed(`${T}/retailOrders/o9`, order([line('c', 'p1', 'Hand cream', 1, 0)], { orderNumber: 1211 }));
  mock.seed(`${T}/fulfillmentBatches/b8`, { active: true, orderIds: ['o8', 'o9'], assignedTo: 'u2' });
  const t = await fx.takeOverOrder({} as any, 't1', 'o8', ana);
  const mine = o();
  const old = mock.read(`${T}/fulfillmentBatches/b8`)!;
  const fresh = mock.read(`${T}/fulfillmentBatches/${mine.batchId}`)!;
  check('taking over an order Kai picked: it’s Ana’s now, in a batch of her own, with every count kept', t.ok && mine.claimedBy === 'u1' && mine.batchId !== 'b8' && fresh?.active === true && fresh.orderIds.join() === 'o8'
    && L('a').qtyScanned === 2 && L('b').qtyScanned === 1, { t, mine, fresh });
  check('…Kai keeps his other order', old.active === true && old.orderIds.join() === 'o9');
  check('…and the record says who took it from whom', mock.list(`${T}/retailOrders/o8/events`).some((e: any) => e.meta?.kind === 'taken_over' && /from Kai Park/.test(e.meta?.text)));
  mock.seed(`${T}/retailOrders/o9`, order([line('c', 'p1', 'Hand cream', 1, 0)], { orderNumber: 1211, stage: 'packed' }));
  const late = await fx.takeOverOrder({} as any, 't1', 'o9', ana);
  check('an order that’s already packed can’t be taken over', !late.ok);
  mock.reset();
  mock.seed(`${T}/retailOrders/w1`, order([line('a', 'p3', 'Gel polish', 1, 0)], { waveId: 'wave1', waveTote: 4, batchId: null, claimedBy: 'u2' }));
  const wt = await fx.takeOverOrder({} as any, 't1', 'w1', ana);
  const wo = mock.read(`${T}/retailOrders/w1`)!;
  check('taking over a wave order changes who packs it, without a batch of its own (so it never times out of its wave)', wt.ok && wo.claimedBy === 'u1' && !wo.batchId && mock.list(`${T}/fulfillmentBatches`).length === 0, wo);

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
