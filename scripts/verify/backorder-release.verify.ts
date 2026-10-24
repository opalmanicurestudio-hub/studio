// Checks backorders waiting for stock (lib/retail-fulfill releaseBackorder, releaseCoverableBackorders). One goes into
// the packing queue by itself when everything it needs is free on the shelf now (on hand, less what paid orders hold),
// however many deliveries that took, never when only part of it is there, oldest first; a return checked back onto
// the shelf counts too. The team can release one by hand, told first what's short. Each product takes its units once,
// however many lines it's on. Packing a waiting order says why it can't start.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/backorder-release.verify.ts
import Module from 'module';
import { makeDb, check, failures } from './fake-db';

let db = makeDb();
const webFs: any = { __fs: true };
let auto = 0;
const colRef = (path: string) => ({ __col: true, path, id: path.split('/').pop() });
const docRef = (path: string) => ({ __doc: true, path, id: path.split('/').pop() });
const webSnap = (s: any, r: any) => ({ exists: () => s.exists, data: () => s.data(), id: s.id, ref: r });
const web: any = {
  collection: (base: any, ...segs: string[]) => colRef([base?.__doc ? base.path : '', ...segs].filter(Boolean).join('/')),
  doc: (base: any, ...segs: string[]) => (base?.__col
    ? docRef(`${base.path}/${segs[0] || `auto${++auto}`}`)
    : docRef([base?.__doc ? base.path : '', ...segs].filter(Boolean).join('/'))),
  runTransaction: (_fs: any, fn: any) => db.runTransaction(() => fn({
    get: async (r: any) => webSnap(await db.doc(r.path).get(), r),
    update: (r: any, v: any) => db.doc(r.path).update(v),
    set: (r: any, v: any, o?: any) => db.doc(r.path).set(v, o),
  })),
  getDoc: async (r: any) => webSnap(await db.doc(r.path).get(), r),
  updateDoc: (r: any, v: any) => db.doc(r.path).update(v),
  query: (c: any, ...cons: any[]) => ({ __q: true, path: c.path, cons }),
  where: (k: string, op: string, v: any) => ({ t: 'where', k, op, v }),
  limit: (n: number) => ({ t: 'limit', n }), orderBy: () => ({ t: 'orderBy' }),
  getDocs: async (q: any) => {
    let c: any = db.collection(q.path);
    for (const x of q.cons || []) { if (x?.t === 'where') c = c.where(x.k, x.op, x.v); if (x?.t === 'limit') c = c.limit(x.n); }
    const s = await c.get();
    return { docs: s.docs.map((d: any) => ({ id: d.id, data: () => d.data(), exists: () => true })), empty: s.empty, size: s.size };
  },
};
const M: any = Module as any;
const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === 'firebase/firestore') return web;
  if (request.endsWith('staff-fetch')) return { staffAuthHeader: async () => ({}) };
  if (request.endsWith('renter-credit-client')) return { syncRenterCredits: () => undefined };
  return load.call(this, request, ...rest);
};
(globalThis as any).fetch = async () => ({ ok: true, json: async () => ({}) });

const T = 'tenants/t1';
const get = async (path: string) => (await db.doc(path).get()).data() || null;
const actor = { id: 'u1', name: 'Rae Moss' };
const gel = (qty: number, x: any = {}) => ({ lineId: `G${qty}${x.k || ''}`, productId: 'gel', name: 'Gel polish', unitPriceCents: 1400, qtyOrdered: qty, qtyScanned: 0, qtyShorted: 0, qtyReturned: 0, status: 'pending', ...x });
const file = (qty: number) => ({ lineId: `F${qty}`, productId: 'file', name: 'Nail file', unitPriceCents: 1000, qtyOrdered: qty, qtyScanned: 0, qtyShorted: 0, qtyReturned: 0, status: 'pending' });
const bo = (id: string, lines: any[], placedAt: string) => ({ id, tenantId: 't1', orderNumber: 1070, stage: 'paid', method: 'ship', lines, parentOrderId: 'p1', holdUntilRestock: true, totalCents: 0, placedAt, qrToken: 'qr1', customerName: 'Dana Whitfield' });

(async () => {
  const RF = await import('../../src/lib/retail-fulfill');
  const OF = await import('../../src/lib/orders-flow');
  const RR = await import('../../src/lib/retail-returns');
  const fresh = async (stock: Record<string, [number, number]>, orders: any[]) => {
    db = makeDb();
    for (const [pid, [total, reserved]] of Object.entries(stock)) await db.doc(`${T}/inventory/${pid}`).set({ name: pid, totalStock: total, stockReserved: reserved });
    for (const o of orders) await db.doc(`${T}/retailOrders/${o.id}`).set(o);
  };

  // ── Releasing one by hand ──
  await fresh({ gel: [1, 0], file: [5, 0] }, [bo('b1', [gel(2), file(1)], '2026-10-01T10:00:00Z')]);
  let r = await RF.releaseBackorder(webFs, 't1', 'b1', actor, { onlyIfCovered: true });
  check('one polish on the shelf for a backorder of two: it isn’t released, and the team is told what’s short',
    !r.ok && r.short?.length === 1 && r.short[0].have === 1 && r.short[0].need === 2 && /1 of 2 Gel polish/.test(r.message) && (await get(`${T}/retailOrders/b1`)).holdUntilRestock === true, r);
  r = await RF.releaseBackorder(webFs, 't1', 'b1', actor, { onlyIfCovered: false });
  let b1 = await get(`${T}/retailOrders/b1`);
  check('…released anyway when they say so: in the queue, its units held, and the history says it may come up short',
    r.ok && b1.holdUntilRestock === false && !!b1.releasedAt && (await get(`${T}/inventory/gel`)).stockReserved === 2 && (await get(`${T}/inventory/file`)).stockReserved === 1 && /may come up short/.test(r.message), { r, b1 });
  r = await RF.releaseBackorder(webFs, 't1', 'b1', actor, { onlyIfCovered: true });
  check('…and releasing it again says it isn’t waiting any more', !r.ok && /isn’t waiting on stock/.test(r.message));

  await fresh({ gel: [5, 0] }, [bo('b2', [gel(1), gel(2, { k: 'b' })], '2026-10-01T10:00:00Z')]);
  r = await RF.releaseBackorder(webFs, 't1', 'b2', actor, { onlyIfCovered: true });
  check('two lines of the same polish take all three units (each line used to overwrite the other)', r.ok && (await get(`${T}/inventory/gel`)).stockReserved === 3, { r, inv: await get(`${T}/inventory/gel`) });

  check('packing an order that’s waiting on stock says why it can’t start',
    !(await OF.startPacking(webFs, 't1', { id: 'x', stage: 'paid', holdUntilRestock: true }, actor)).ok && /waiting on stock/.test((await OF.startPacking(webFs, 't1', { id: 'x', stage: 'paid', holdUntilRestock: true }, actor)).message));

  // ── Released by itself when stock comes in ──
  await fresh({ gel: [1, 0] }, [bo('b3', [gel(2)], '2026-10-01T10:00:00Z')]);
  let rel = await RF.releaseCoverableBackorders(webFs, 't1', [{ productId: 'gel', qty: 1 }], actor);
  check('one of two polishes arrives: nothing is released', rel.released.length === 0 && (await get(`${T}/retailOrders/b3`)).holdUntilRestock === true);
  await db.doc(`${T}/inventory/gel`).set({ totalStock: 2 }, { merge: true });
  rel = await RF.releaseCoverableBackorders(webFs, 't1', [{ productId: 'gel', qty: 1 }], actor);
  check('the second arrives in another delivery: the two on the shelf cover it, so it’s released (one delivery used to have to cover it all)',
    rel.released.length === 1 && rel.released[0].orderId === 'b3' && rel.released[0].units === 2 && (await get(`${T}/retailOrders/b3`)).holdUntilRestock === false && (await get(`${T}/inventory/gel`)).stockReserved === 2, rel);

  await fresh({ gel: [2, 0], file: [0, 0] }, [bo('b4', [gel(2), file(1)], '2026-10-01T10:00:00Z')]);
  rel = await RF.releaseCoverableBackorders(webFs, 't1', [{ productId: 'gel', qty: 2 }], actor);
  check('its polishes are in but its file isn’t: it waits (only the first item used to be checked)', rel.released.length === 0 && (await get(`${T}/retailOrders/b4`)).holdUntilRestock === true, rel);

  await fresh({ gel: [3, 2] }, [bo('b5', [gel(2)], '2026-10-01T10:00:00Z')]);
  rel = await RF.releaseCoverableBackorders(webFs, 't1', [{ productId: 'gel', qty: 3 }], actor);
  check('three on hand but two held for paid orders: one is free, so a backorder of two waits', rel.released.length === 0, rel);

  await fresh({ gel: [2, 0] }, [bo('new', [gel(2)], '2026-10-05T10:00:00Z'), bo('old', [gel(2)], '2026-10-01T10:00:00Z')]);
  rel = await RF.releaseCoverableBackorders(webFs, 't1', [{ productId: 'gel', qty: 2 }], actor);
  check('two backorders and stock for one: the older goes first', rel.released.length === 1 && rel.released[0].orderId === 'old' && (await get(`${T}/retailOrders/new`)).holdUntilRestock === true, rel);

  // ── A return put back on the shelf ──
  await fresh({ gel: [0, 0] }, [bo('b6', [gel(2)], '2026-10-01T10:00:00Z'),
    { id: 'o9', tenantId: 't1', orderNumber: 1090, stage: 'completed', method: 'ship', lines: [{ ...gel(2), lineId: 'R1', qtyScanned: 2, status: 'picked' }], qrToken: 'qr9', customerName: 'Sam Lee' }]);
  await db.doc(`${T}/retailReturns/ret1`).set({ id: 'ret1', orderId: 'o9', orderNumber: 1090, status: 'in_transit', resolution: 'refund', lines: [{ lineId: 'R1', name: 'Gel polish', qty: 2, reason: 'changed_mind' }] });
  const rr = await RR.receiveReturnLine(webFs, 't1', { id: 'ret1' } as any, 'R1', 'restock', actor);
  check('two polishes come back as new and go on the shelf: the backorder waiting for them is released',
    rr.ok && (await get(`${T}/inventory/gel`)).totalStock === 2 && (await get(`${T}/retailOrders/b6`)).holdUntilRestock === false && /was waiting for it/.test(rr.message), { rr, inv: await get(`${T}/inventory/gel`) });

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
