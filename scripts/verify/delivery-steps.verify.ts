// scripts/verify/delivery-steps.verify.ts — Phase D, round 1, run for real against the stand-in database: a delivery
// order's steps through /api/retail/fulfil (out with the driver, can't be canceled or handed over at the counter while
// out, brought back, out again, delivered as the sale), and checkout's delivery answer (lib/delivery-server
// deliveryFor) with postal-code zones: the zone and fee, the minimum, a full window, and a day with the schedule out but
// no driver on it.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/delivery-steps.verify.ts
import Module from 'module';
import { makeDb, check, failures, FV, strictTransactions } from './fake-db';

process.env.CRON_SECRET = 'test-secret';
let db: any = strictTransactions(makeDb());
const M: any = Module as any;
const load = M._load;
const fake = (request: string, mock: any) => { const c = M._cache?.[request]; if (c) { c.exports = mock; c.loaded = true; } return mock; };
const afterJobs: Promise<any>[] = [];
let actor: any = { uid: 'riley', name: 'Riley Chen', role: 'staff', isManager: false, isTenantOwner: false, caps: [] };
M._load = function (request: string, ...rest: any[]) {
  if (request === 'next/server') return { NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, body }) }, after: (fn: any) => { afterJobs.push(Promise.resolve().then(fn).catch(() => null)); } };
  if (request === '@/lib/firebase-admin') return { getAdminDb: () => db };
  if (request === 'firebase-admin/firestore' || /firebase-admin\/lib\/firestore\/index\.js$/.test(request)) return fake(request, { getFirestore: () => db, FieldValue: FV });
  if (request === '@/lib/staff-auth' || /\/src\/lib\/staff-auth(\.ts)?$/.test(request)) return fake(request, { verifyStaffActor: async () => ({ ok: true, actor, tenant: {} }) });
  if (request === '@/lib/message-policy' || /\/src\/lib\/message-policy(\.ts)?$/.test(request)) return fake(request, { gateMessage: async () => ({ send: true }) });
  return load.call(this, request, ...rest);
};
(globalThis as any).fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });

const T = 'tenants/t1';
const get = async (p: string) => (await db.doc(p).get()).data() || null;
const all = async (p: string) => (await db.collection(p).get()).docs.map((d: any) => ({ id: d.id, ...d.data() }));
const settle = async () => { while (afterJobs.length) await afterJobs.shift(); };
const req = (body: any) => ({ json: async () => body, headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? 'Bearer t' : null) }, nextUrl: { origin: 'https://app.example', searchParams: new URLSearchParams() } }) as any;

(async () => {
  const plan = {
    on: true, by: 'postal', days: [0, 1, 2, 3, 4, 5, 6], slots: [{ start: '10:00', end: '12:00' }, { start: '14:00', end: '16:00' }], perWindow: 2, perDriver: null, drivers: [],
    sameDayCutoff: null, daysAhead: 3, asap: { on: false, minutes: 90 }, dropoffNotes: true,
    zones: [{ id: 'a', name: 'Close', postalCodes: ['97204'], feeCents: 500, minimumCents: 2000, freeOverCents: 6000, expressCents: null, on: true }],
  };
  await db.doc(T).set({ name: 'Opal', timezone: 'America/Los_Angeles', retailSettings: { deliveryPlan: plan, prepMinutes: 30 } });
  await db.doc(`${T}/staff/riley`).set({ name: 'Riley Chen', authUid: 'riley' });

  // ── The steps
  const { POST: FULFIL } = await import('../../src/app/api/retail/fulfil/route');
  const order = { id: 'd1', tenantId: 't1', orderNumber: 7, method: 'delivery', stage: 'ready', readyAt: new Date().toISOString(), qrToken: 'd1.tok', customerName: 'Dana Lee', totalCents: 4500, refundedCents: 0,
    lines: [{ lineId: 'A', productId: 'gel', name: 'Gel', qtyOrdered: 1, qtyScanned: 1, qtyShorted: 0, unitPriceCents: 4000 }],
    shippingAddress: { line1: '88 Pine St', city: 'Portland', state: 'OR', postalCode: '97204' }, delivery: { status: 'waiting', zoneId: 'a', feeCents: 500 } };
  await db.doc(`${T}/retailOrders/d1`).set(order);
  let r: any = await FULFIL(req({ tenantId: 't1', action: 'handoffNoScan', orderId: 'd1', verifiedBy: 'Checked' }));
  check('a delivery waiting for its driver can’t be handed over at the counter', r.body.ok === false && /is a delivery/.test(r.body.message), r.body);
  r = await FULFIL(req({ tenantId: 't1', action: 'deliveryOut', orderId: 'd1' })); await settle();
  let o: any = await get(`${T}/retailOrders/d1`);
  check('out for delivery: with the person who tapped it, still on the shop’s books', r.body.ok && o.delivery.status === 'out' && o.delivery.driverId === 'riley' && o.stage === 'ready', { r: r.body, d: o.delivery });
  r = await FULFIL(req({ tenantId: 't1', action: 'handoffNoScan', orderId: 'd1', verifiedBy: 'Checked' }));
  check('…and while it’s out, no counter hand-over either', r.body.ok === false && (await get(`${T}/retailOrders/d1`)).stage === 'ready', r.body);
  r = await FULFIL(req({ tenantId: 't1', action: 'handoffScan', orderId: 'd1', value: 'd1.tok' }));
  check('…nor by scanning the code', r.body.ok === false && /is a delivery/.test(r.body.message || ''), r.body);
  r = await FULFIL(req({ tenantId: 't1', action: 'handoffPin', orderId: 'd1', pin: '1234' }));
  check('…nor by the four-digit code', r.body.ok === false && /is a delivery/.test(r.body.message || ''), r.body);
  r = await FULFIL(req({ tenantId: 't1', action: 'bringingOut', orderId: 'd1' }));
  check('…and it isn’t “brought out to the car”', r.body.ok === false && !(await get(`${T}/retailOrders/d1`)).curbside?.bringingOutAt, r.body);
  actor = { ...actor, uid: 'mgr', name: 'Morgan', isManager: true };
  r = await FULFIL(req({ tenantId: 't1', action: 'cancel', orderId: 'd1', reason: 'test' }));
  check('an order out for delivery can’t be canceled', r.body.ok === false && /out for delivery/.test(r.body.message) && (await get(`${T}/retailOrders/d1`)).stage === 'ready', r.body);
  actor = { ...actor, uid: 'riley', name: 'Riley Chen', isManager: false };
  r = await FULFIL(req({ tenantId: 't1', action: 'deliveryFailed', orderId: 'd1', reason: 'No one was there to take it' }));
  o = await get(`${T}/retailOrders/d1`);
  check('brought back: why, and back on the shelf', r.body.ok && o.delivery.status === 'failed' && o.delivery.failReason === 'No one was there to take it' && o.stage === 'ready', o.delivery);
  r = await FULFIL(req({ tenantId: 't1', action: 'deliveryDone', orderId: 'd1' }));
  check('one that’s back can’t be marked delivered without going out again', r.body.ok === false, r.body);
  r = await FULFIL(req({ tenantId: 't1', action: 'deliveryOut', orderId: 'd1' }));
  o = await get(`${T}/retailOrders/d1`);
  check('out again counts the try', r.body.ok && o.delivery.status === 'out' && o.delivery.tries === 2, o.delivery);
  r = await FULFIL(req({ tenantId: 't1', action: 'deliveryDone', orderId: 'd1' })); await settle();
  o = await get(`${T}/retailOrders/d1`);
  const evs = (await all(`${T}/retailOrders/d1/events`)).map((e: any) => e.type);
  check('delivered completes it, with the delivered time and who', r.body.ok && o.stage === 'completed' && o.delivery.status === 'delivered' && !!o.deliveredAt && o.delivery.deliveredById === 'riley', { r: r.body, o: { stage: o.stage, d: o.delivery, at: o.deliveredAt } });
  check('the history says out, brought back, out again, delivered', ['out_for_delivery', 'delivery_failed', 'delivered', 'completed'].every((t) => evs.includes(t)) && evs.filter((t: string) => t === 'out_for_delivery').length === 2, evs);
  r = await FULFIL(req({ tenantId: 't1', action: 'deliveryDone', orderId: 'd1' }));
  check('a second tap on delivered changes nothing', r.body.ok && (await all(`${T}/retailOrders/d1/events`)).filter((e: any) => e.type === 'delivered').length === 1, r.body);
  r = await FULFIL(req({ tenantId: 't1', action: 'deliveryFailed', orderId: 'd1', reason: 'x' }));
  check('a delivered order can’t be marked brought back', r.body.ok === false && (await get(`${T}/retailOrders/d1`)).delivery.status === 'delivered', r.body);
  const { cancelWithFollowUps } = await import('../../src/lib/order-family');
  const fam = cancelWithFollowUps({ id: 'root', stage: 'paid', lines: [] }, [{ id: 'c1', stage: 'ready', method: 'delivery', delivery: { status: 'out' }, lines: [], parentOrderId: 'root' }, { id: 'c2', stage: 'paid', method: 'delivery', delivery: { status: 'waiting' }, lines: [], parentOrderId: 'root' }]);
  check('canceling an order leaves its follow-up that’s out for delivery alone', !fam.cancel.some((f: any) => f.id === 'c1') && fam.cancel.some((f: any) => f.id === 'c2'), fam.cancel.map((f: any) => f.id));
  await db.doc(`${T}/retailOrders/p1`).set({ ...order, id: 'p1', method: 'counter', delivery: undefined });
  r = await FULFIL(req({ tenantId: 't1', action: 'deliveryOut', orderId: 'p1' }));
  check('a pickup order doesn’t go out for delivery', r.body.ok === false, r.body);

  // ── Checkout's answer
  const { deliveryFor } = await import('../../src/lib/delivery-server');
  const tenant = await get(T);
  const now = Date.parse('2026-10-30T15:00:00Z');   // 8 am in Los Angeles
  const addr = { line1: '88 Pine St', city: 'Portland', state: 'OR', postalCode: '97204-1111' };
  let v: any = await deliveryFor(db, 't1', tenant, addr, { itemsCents: 3000, now });
  check('a ZIP in a zone: delivered there, its fee, its windows', v.ok && v.fee.feeCents === 500 && v.windows[0].key === '2026-10-30D10:00' && v.windows[0].left === 2, v.ok ? { fee: v.fee, w: v.windows[0] } : v);
  check('no address looked up on a map for postal zones, and no distance kept', v.ok && v.miles === null && v.token === null);
  v = await deliveryFor(db, 't1', tenant, addr, { itemsCents: 1500, now });
  check('under the minimum: said, with the amount', !v.ok && v.reason === 'minimum' && /\$20\.00/.test(v.message), v);
  v = await deliveryFor(db, 't1', tenant, { ...addr, postalCode: '99999' }, { itemsCents: 3000, now });
  check('a ZIP outside every zone: not delivered there', !v.ok && v.reason === 'outside', v);
  v = await deliveryFor(db, 't1', tenant, { ...addr, city: '' }, { itemsCents: 3000, now });
  check('an address missing its town isn’t checked', !v.ok && v.reason === 'incomplete', v);
  v = await deliveryFor(db, 't1', tenant, addr, { itemsCents: 6000, now });
  check('free over the zone’s amount', v.ok && v.fee.feeCents === 0 && v.fee.free);
  const placedAt = new Date(now - 5 * 60e3).toISOString();
  await db.doc(`${T}/retailOrders/b1`).set({ stage: 'paid', deliveryWindowKey: '2026-10-30D10:00', placedAt });
  await db.doc(`${T}/retailOrders/b2`).set({ stage: 'placed', deliveryWindowKey: '2026-10-30D10:00', placedAt, checkoutKeyHash: 'mine' });
  v = await deliveryFor(db, 't1', tenant, addr, { itemsCents: 3000, now });
  check('a window with its orders taken is full', v.ok && v.windows[0].full, v.ok && v.windows[0]);
  v = await deliveryFor(db, 't1', tenant, addr, { itemsCents: 3000, now, sameCheckout: 'mine' });
  check('…but this checkout’s own earlier try doesn’t count against it', v.ok && !v.windows[0].full && v.windows[0].left === 1, v.ok && v.windows[0]);
  await db.doc(`${T}/retailOrders/b3`).set({ stage: 'cancelled', deliveryWindowKey: '2026-10-30D14:00', placedAt });
  v = await deliveryFor(db, 't1', tenant, addr, { itemsCents: 3000, now });
  check('a canceled order frees its place', v.ok && v.windows.find((w: any) => w.key === '2026-10-30D14:00')?.left === 2);

  // Sized by drivers: Friday has the schedule out (Jo at the counter) but no driver on it; Saturday has nothing out.
  await db.doc(T).update({ 'retailSettings.deliveryPlan.perDriver': 3, 'retailSettings.deliveryPlan.drivers': ['riley'] });
  await db.doc(`${T}/shifts/s1`).set({ staffId: 'jo', date: '2026-10-30', startTime: '09:00', endTime: '17:00', status: 'published' });
  await db.doc(`${T}/shifts/s2`).set({ staffId: 'riley', date: '2026-11-01', startTime: '13:00', endTime: '17:00', status: 'published' });
  v = await deliveryFor(db, 't1', await get(T), addr, { itemsCents: 3000, now });
  const w = (k: string) => v.ok && v.windows.find((x: any) => x.key === k);
  check('a day with the schedule out and no driver on it offers nothing', v.ok && w('2026-10-30D14:00')?.full === true, v.ok && w('2026-10-30D14:00'));
  check('a day with nothing on the schedule keeps the window limit', v.ok && w('2026-10-31D10:00')?.left === 2, v.ok && w('2026-10-31D10:00'));
  check('a day with a driver on: three each, never over the limit; none in a window they aren’t on for', v.ok && w('2026-11-01D14:00')?.left === 2 && w('2026-11-01D10:00')?.full === true, v.ok && [w('2026-11-01D10:00'), w('2026-11-01D14:00')]);

  // A delivery turned off, or a shop with no time zone, offers nothing.
  v = await deliveryFor(db, 't1', { ...tenant, retailSettings: { deliveryPlan: { ...plan, on: false } } }, addr, { itemsCents: 3000, now });
  check('delivery off: not offered', !v.ok && v.reason === 'off');
  v = await deliveryFor(db, 't1', { ...tenant, timezone: undefined }, addr, { itemsCents: 3000, now });
  check('no time zone set: not offered (times would land hours off)', !v.ok && v.reason === 'off');

  // A plan whose zone ids collide is tidied, never stuck.
  const { cleanDelivery } = await import('../../src/lib/delivery-plan');
  const x24 = 'x'.repeat(24);
  const t0 = Date.now(); const ids = cleanDelivery({ zones: [{ id: x24 }, { id: x24 }, { id: x24 }] }).zones.map((z) => z.id);
  check('zone ids that collide are made unique at once', new Set(ids).size === 3 && Date.now() - t0 < 200, ids);
  check('free over $0 reads as no free-over amount', cleanDelivery({ zones: [{ freeOverCents: 0 }] }).zones[0].freeOverCents === null);

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
