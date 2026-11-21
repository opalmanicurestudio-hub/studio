// src/lib/food-delivery-server.ts — HOT FOOD DELIVERIES (server; lib/food-delivery is the rules). The counter page's
// Deliveries list and the driver's Deliveries tab in the staff app (api/counter, api/counter/food-run), and their steps:
//   out       the food goes with a driver (one of the business's drivers, or a name the counter typed): the kitchen's
//             tickets are bagged, the order is done for the kitchen, and the guest gets their one text: "on its way"
//             (lib/ready-text)
//   outside   the driver texts the guest they're outside, from the business's number (never anyone's own)
//   delivered at the door: the guest's tip (booked when it was paid, with no one on it) is put under the driver's name
//   failed    couldn't be delivered, and why (a manager refunds it at the desk, or sends it out again)
import { addressLine, deliveryStep, FOOD_FAIL_REASONS, OUTSIDE_EVERY_MS, waitingHot } from '@/lib/food-delivery';
import { deliveryFrom } from '@/lib/delivery-plan';
import { todayIn, tenantTimeZone } from '@/lib/tenant-time';
import { goesWith, TOGETHER_MAX_ADD_MIN } from '@/lib/route-plan';
import { routeSpot, newestPlan } from '@/lib/delivery-run';
import { hotDestOf, lookUpHot, shopPlace } from '@/lib/route-server';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const LIVE_GONE = ['cancelled', 'voided'];
type Fail = { ok: false; error: string; status: number };
const fail = (error: string, status: number): Fail => ({ ok: false, error, status });
/** Who's driving: their name, and their team record when they're on the team (for their tip). */
export type Driver = { name: string; id: string | null };
const driverOf = (d: string | Driver): Driver => (typeof d === 'string' ? { name: d, id: null } : { name: d.name, id: d.id && ID.test(d.id) ? d.id : null });

export type DeliveryRow = { orderId: string; number: string; name: string | null; to: string; note: string | null; arriveAt: string | null; driveMin: number;
  step: 'making' | 'ready' | 'out' | 'delivered' | 'failed'; readyFor: number | null; leaveAt: string | null; driver: string | null; outAt: string | null; deliveredAt: string | null; why: string | null;
  /** The guest's number, for the counter to reach them (until it's delivered). */
  phone: string | null;
  /** For the team only: the whole address for a maps app, who has it (their team record), and the guest's tip. */
  mapTo: string; driverId: string | null; tip: number;
  /** Out with a driver: its place in their planned route (lib/route-server) and when it should get there. */
  route: { id: string; seq: number; eta: string | null; late: boolean } | null;
  /** Ready: another ready one that goes the same way (adds a few minutes to the trip, and both stay on time). */
  with: { orderId: string; number: string; addMin: number } | null };

// (Read once every few seconds for the business, however many counter screens and drivers ask; a step taken reads afresh.)
const cache = new Map<string, { at: number; rows: DeliveryRow[] }>();
const forget = (tenantId: string) => { cache.delete(tenantId); };

/** Today's deliveries for the counter (paid ones), the ones still to go first, by when they should leave. */
export async function deliveriesToday(db: any, tenantId: string, tenant: any, now = Date.now()): Promise<DeliveryRow[]> {
  const hit = cache.get(tenantId); if (hit && now >= hit.at && now - hit.at < 3000) return hit.rows;
  const rows = await readToday(db, tenantId, tenant, now);
  cache.set(tenantId, { at: now, rows }); if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  return rows;
}

async function readToday(db: any, tenantId: string, tenant: any, now: number): Promise<DeliveryRow[]> {
  const T = `tenants/${tenantId}`;
  const day = todayIn(tenantTimeZone(tenant), new Date(now));
  const orders = (await db.collection(`${T}/counterOrders`).where('ahead.way', '==', 'delivery').where('day', '==', day).limit(200).get()).docs
    .map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((o: any) => o.paidAt && o.status !== 'voided' && o.ahead?.delivery);
  if (!orders.length) return [];
  const tickets: any[] = [];
  for (let i = 0; i < orders.length; i += 30) {
    const ids = orders.slice(i, i + 30).map((o: any) => o.id);
    tickets.push(...(await db.collection(`${T}/kdsTickets`).where('orderId', 'in', ids).get()).docs.map((d: any) => d.data() || {}));
  }
  // Places on the map for the ones still to go (looked up once each, one a read: the next read has it), to see which
  // go together.
  const toGo = orders.filter((o: any) => !['out', 'delivered', 'failed'].includes(String(o.ahead.delivery.state || 'waiting')));
  if (toGo.length > 1 && toGo.some((o: any) => !hotDestOf(o.ahead.delivery))) await lookUpHot(db, tenantId, toGo.map((o: any) => ({ id: o.id, d: o.ahead.delivery })), now, 1).catch(() => null);
  const dests = new Map<string, any>(toGo.map((o: any) => [o.id, hotDestOf(o.ahead.delivery)]));
  const rows: DeliveryRow[] = orders.map((o: any) => {
    const mine = tickets.filter((t) => t.orderId === o.id && !LIVE_GONE.includes(String(t.status)));
    const ready = mine.length > 0 && mine.every((t) => ['ready', 'delivered', 'served', 'done'].includes(String(t.status)));
    const readyAt = ready ? Math.max(...mine.map((t) => Date.parse(String(t.readyAt || t.deliveredAt || t.updatedAt || '')) || 0)) : 0;
    const d = o.ahead.delivery; const step = deliveryStep(d, ready ? 'ready' : 'making');
    const leave = Date.parse(String(o.ahead.slot || o.ahead.at || ''));
    const a = d.address || {};
    return { orderId: o.id, number: String(o.number || ''), name: o.guestName || null, to: addressLine(a), note: d.note || null, arriveAt: d.arriveAt || null,
      driveMin: Math.round(Number(d.driveMin) || 0), step, readyFor: step === 'ready' && readyAt ? waitingHot(readyAt, now) : null,
      leaveAt: Number.isFinite(leave) ? new Date(leave).toISOString() : null, driver: d.driverName || null, outAt: d.outAt || null, deliveredAt: d.deliveredAt || null,
      why: d.state === 'failed' ? FOOD_FAIL_REASONS.find((r) => r.code === d.why)?.label || 'Couldn’t deliver' : null,
      phone: step !== 'delivered' && /^\d{10}$/.test(String(d.phone || '')) ? String(d.phone) : null,
      mapTo: [a.line1, a.line2, a.city, [a.state, a.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', '),
      driverId: d.driverId && ID.test(String(d.driverId)) ? String(d.driverId) : null, tip: Math.max(0, Math.round(Number(o.tipCents) || 0)) / 100,
      route: d.state === 'out' && routeSpot(d) ? { ...routeSpot(d)!, eta: d.routeEta || null, late: d.routeLate === true } : null, with: null };
  });
  // Ready ones that go together: the one that adds least to the other's trip, when both stay on time.
  const ready = rows.filter((r) => r.step === 'ready' && dests.get(r.orderId));
  if (ready.length > 1) {
    const shop = await shopPlaceSoon(db, tenantId, tenant, now);
    if (shop) for (const r of ready) {
      let best: DeliveryRow['with'] = null;
      for (const x of ready) {
        if (x === r) continue;
        const g = goesWith(shop, { at: dests.get(r.orderId), due: Date.parse(String(r.arriveAt || '')) || null }, { at: dests.get(x.orderId), due: Date.parse(String(x.arriveAt || '')) || null }, now);
        if (g && g.onTime && g.addMin <= TOGETHER_MAX_ADD_MIN && (!best || g.addMin < best.addMin)) best = { orderId: x.orderId, number: x.number, addMin: g.addMin };
      }
      r.with = best;
    }
  }
  const rank = { ready: 0, making: 1, out: 2, failed: 3, delivered: 4 } as const;
  return rows.sort((a, b) => rank[a.step] - rank[b.step] || String(a.leaveAt || '').localeCompare(String(b.leaveAt || ''))).slice(0, 60);
}

/** Where the shop is (kept a few minutes). */
const shopCache = new Map<string, { at: number; v: any }>();
async function shopPlaceSoon(db: any, tenantId: string, tenant: any, now: number) {
  const hit = shopCache.get(tenantId); if (hit && now >= hit.at && now - hit.at < 5 * 60e3) return hit.v?.at || null;
  const v = await shopPlace(db, tenantId, tenant).catch(() => null);
  shopCache.set(tenantId, { at: now, v }); if (shopCache.size > 500) shopCache.delete(shopCache.keys().next().value as string);
  return v?.at || null;
}

/** The driver's Deliveries tab: their own hot food out with them first, then what's ready to take, then what's being
 *  made. (Never another driver's, and nothing delivered or brought back.) */
export async function foodRun(db: any, tenantId: string, tenant: any, me: string, now = Date.now()): Promise<DeliveryRow[]> {
  const rows = await deliveriesToday(db, tenantId, tenant, now);
  const rank = (r: DeliveryRow) => (r.step === 'out' ? 0 : r.step === 'ready' ? 1 : 2);
  // Their own in the order their route was planned (lib/route-server), any added since by when they're due.
  const plan = newestPlan(rows.filter((r) => r.step === 'out' && r.driverId === me).map((r) => r.route));
  const seq = (r: DeliveryRow) => (r.route && r.route.id === plan ? r.route.seq : 1e6);
  return rows.filter((r) => (r.step === 'out' && r.driverId === me) || r.step === 'ready' || r.step === 'making')
    .sort((a, b) => rank(a) - rank(b) || seq(a) - seq(b) || String(a.arriveAt || '').localeCompare(String(b.arriveAt || '')))
    // (The guest's number stays with the counter: the driver texts through the business.)
    .map((r) => ({ ...r, phone: null, tip: r.driverId === me || r.step !== 'out' ? r.tip : 0 }));
}

/** The business's drivers (from its delivery settings), by name, for the counter to pick who's taking it. */
const driverCache = new Map<string, { at: number; list: Driver[] }>();
export async function foodDrivers(db: any, tenantId: string, tenant: any, now = Date.now()): Promise<Driver[]> {
  // (Kept a minute, and read again at once when the list of drivers changes.)
  const ids = deliveryFrom(tenant?.retailSettings).drivers.slice(0, 40); const key = `${tenantId}|${ids.join(',')}`;
  const hit = driverCache.get(key); if (hit && now >= hit.at && now - hit.at < 60_000) return hit.list;
  const docs = ids.length ? await db.getAll(...ids.map((id) => db.doc(`tenants/${tenantId}/staff/${id}`))) : [];
  const list = docs.map((d: any, i: number) => ({ id: ids[i], s: d.exists ? d.data() || {} : null }))
    .filter((x: any) => x.s && x.s.isActive !== false && x.s.role !== 'renter' && x.s.isRenter !== true)
    .map((x: any) => ({ id: x.id, name: String(x.s.name || 'A driver').slice(0, 60) }));
  driverCache.set(key, { at: now, list }); if (driverCache.size > 500) driverCache.delete(driverCache.keys().next().value as string);
  return list;
}

/** Out with a driver: from waiting, once the kitchen has it all ready (or sent again after it couldn't be delivered).
 *  The kitchen's tickets are bagged and the order is done for the kitchen; then the guest's "on its way" text, if they asked for one. */
export async function deliveryOut(db: any, tenantId: string, orderId: string, driver: string | Driver, nowIso = new Date().toISOString(), opts: { fromWaiting?: boolean } = {}): Promise<{ ok: true; already?: boolean } | Fail> {
  if (!ID.test(orderId)) return fail('Which order?', 400);
  const who = driverOf(driver); const name = String(who.name).slice(0, 60);
  const T = `tenants/${tenantId}`; const ref = db.doc(`${T}/counterOrders/${orderId}`);
  const r: any = await db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(ref)).data();
    const tix = (await tx.get(db.collection(`${T}/kdsTickets`).where('orderId', '==', orderId))).docs;
    if (!o || o.ahead?.way !== 'delivery' || !o.ahead?.delivery) return fail('That delivery isn’t here.', 404);
    if (!o.paidAt || o.status === 'voided') return fail('That order isn’t paid.', 409);
    const st = String(o.ahead.delivery.state || 'waiting');
    if (st === 'out' && who.id && String(o.ahead.delivery.driverId || '') !== who.id) return fail(`${o.number} is already out with ${o.ahead.delivery.driverName || 'another driver'}.`, 409);
    if (st === 'out' || st === 'delivered') return { ok: true, already: true };
    // (One brought back goes out again from the counter, by a manager's say: never picked up again from a driver's phone.)
    if (st === 'failed' && opts.fromWaiting) return fail('This one was brought back. A manager sends it out again from the counter.', 409);
    // Only once the kitchen has it all ready (or it went out once already and is going again).
    const live = tix.map((d: any) => d.data() || {}).filter((t: any) => !LIVE_GONE.includes(String(t.status)));
    if (!live.length || !live.every((t: any) => ['ready', 'delivered', 'served', 'done'].includes(String(t.status)))) return fail('It’s still being made.', 409);
    tx.set(ref, { status: 'done', doneAt: o.doneAt || nowIso, ahead: { delivery: { state: 'out', outAt: nowIso, driverName: name, driverId: who.id, outsideAt: null, failedAt: null, why: null } } }, { merge: true });
    // Handed to the driver: bagged.
    for (const d of tix) { const t: any = d.data() || {}; if (t.status !== 'delivered' && !LIVE_GONE.includes(String(t.status))) tx.set(d.ref, { status: 'delivered', deliveredAt: nowIso, deliveredBy: { name, via: 'delivery' } }, { merge: true }); }
    return { ok: true };
  });
  forget(tenantId);
  if (r.ok && !r.already) {
    const { textIfReady } = await import('@/lib/ready-text');
    await textIfReady(db, tenantId, [orderId], { onWay: true }).catch(() => 0);
  }
  return r;
}

/** Delivered at the door, or couldn't be (and why): only once it's out. `only`: from a driver's phone, only the driver
 *  who has it (a manager may do it for them). Delivered: the guest's tip is the driver's, booked under their name. */
export async function deliveryEnd(db: any, tenantId: string, orderId: string, how: { done: true } | { done: false; why: unknown }, by: string,
  only: { id: string; manager?: boolean } | null = null, nowIso = new Date().toISOString()): Promise<{ ok: true; already?: boolean } | Fail> {
  if (!ID.test(orderId)) return fail('Which order?', 400);
  const why = how.done ? null : FOOD_FAIL_REASONS.find((x) => x.code === how.why)?.code || null;
  if (!how.done && !why) return fail('What happened?', 400);
  const T = `tenants/${tenantId}`; const ref = db.doc(`${T}/counterOrders/${orderId}`);
  const tRef = db.doc(`${T}/transactions/ftip_${orderId}`);
  const r = await db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(ref)).data();
    const line: any = how.done ? (await tx.get(tRef)).data() : null;
    if (!o || o.ahead?.way !== 'delivery' || !o.ahead?.delivery) return fail('That delivery isn’t here.', 404);
    const d = o.ahead.delivery; const st = String(d.state || 'waiting');
    if (only && !only.manager && st === 'out' && String(d.driverId || '') !== only.id) return fail('That delivery is out with someone else.', 403);
    if ((how.done && st === 'delivered') || (!how.done && st === 'failed')) return { ok: true, already: true };
    if (st !== 'out') return fail('It hasn’t gone out yet.', 409);
    tx.set(ref, { ahead: { delivery: how.done ? { state: 'delivered', deliveredAt: nowIso, deliveredBy: String(by).slice(0, 60) } : { state: 'failed', failedAt: nowIso, why, failedBy: String(by).slice(0, 60) } } }, { merge: true });
    // The tip is the driver's: its line (booked when it was paid, with no one on it) goes under their name, shared by the
    // business's tip policy and paid with their pay like any tip. A driver the counter typed who isn't on the team: it
    // stays with no one on it, for the owner to give out by hand.
    const tip = Math.max(0, Math.round(Number(o.tipCents) || 0));
    if (how.done && tip > 0) {
      const driverId = d.driverId && ID.test(String(d.driverId)) ? String(d.driverId) : null;
      const description = driverId ? `Driver tip, order ${o.number}` : `Driver tip, order ${o.number} (${String(d.driverName || 'the driver')} isn’t on the team: give it out by hand)`;
      tx.set(tRef, line ? { staffId: driverId, description, deliveredAt: nowIso } : { id: tRef.id, date: nowIso, type: 'income', context: 'Business', category: 'Tips', taxBucket: 'gratuity', hasReceipt: false,
        amount: tip / 100, staffId: driverId, clientOrVendor: o.guestName || 'Guest', orderId, channel: 'ahead', paymentMethod: 'card', tenantId, description, deliveredAt: nowIso }, { merge: true });
    }
    return { ok: true };
  });
  forget(tenantId);
  return r;
}

/** The driver's "I'm outside": one text to the guest from the business's number (every couple of minutes at most), and
 *  their order page says so. Only the driver who has it. */
export async function deliveryOutside(db: any, tenantId: string, orderId: string, me: { id: string; manager?: boolean }, now = Date.now()): Promise<{ ok: true; sent: boolean; why?: 'soon' | 'no_phone' | 'failed' } | Fail> {
  if (!ID.test(orderId)) return fail('Which order?', 400);
  const ref = db.doc(`tenants/${tenantId}/counterOrders/${orderId}`);
  const r: any = await db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(ref)).data();
    if (!o || o.ahead?.way !== 'delivery' || !o.ahead?.delivery) return fail('That delivery isn’t here.', 404);
    const d = o.ahead.delivery;
    if (d.state !== 'out') return fail('It isn’t out for delivery.', 409);
    if (!me.manager && String(d.driverId || '') !== me.id) return fail('That delivery is out with someone else.', 403);
    if (now - (Date.parse(String(d.outsideAt || '')) || 0) < OUTSIDE_EVERY_MS) return { ok: true, sent: false, why: 'soon' };
    const to = /^\d{10}$/.test(String(d.phone || '')) ? String(d.phone) : null;
    if (!to) return { ok: true, sent: false, why: 'no_phone' };
    const at = new Date(now).toISOString();
    tx.set(ref, { ahead: { delivery: { outsideAt: at } } }, { merge: true });
    return { ok: true, sent: false, to, at, number: String(o.number || '') };
  });
  if (!r.ok || r.why) return r;
  const { sendTenantSms } = await import('@/lib/sms');
  const words = `Your driver is outside with order ${r.number}.`;
  const s: any = await sendTenantSms(db, tenantId, r.to, words, undefined, { kind: 'delivery_outside', recipientType: 'other', skipMessageLog: true, forget: true, logBody: words } as any).catch(() => ({ ok: false }));
  if (s?.ok) return { ok: true, sent: true };
  // Not sent: tried again at once, and their page doesn't say the driver's outside.
  await db.runTransaction(async (tx: any) => { const o: any = (await tx.get(ref)).data(); if (o?.ahead?.delivery?.outsideAt === r.at) tx.set(ref, { ahead: { delivery: { outsideAt: null } } }, { merge: true }); }).catch(() => null);
  return { ok: true, sent: false, why: 'failed' };
}
