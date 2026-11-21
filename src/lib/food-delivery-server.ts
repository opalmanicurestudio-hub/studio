// src/lib/food-delivery-server.ts — HOT FOOD DELIVERIES AT THE COUNTER (server; lib/food-delivery is the rules). The
// counter page's Deliveries list and its three steps (api/counter):
//   out       the food goes with a driver (the person signed in, or the counter's own name): the kitchen's tickets are
//             bagged, the order is done for the kitchen, and the guest gets their one text: "on its way" (lib/ready-text)
//   delivered at the door
//   failed    couldn't be delivered, and why (a manager refunds it at the desk, or sends it out again)
import { addressLine, deliveryStep, FOOD_FAIL_REASONS, waitingHot } from '@/lib/food-delivery';
import { todayIn, tenantTimeZone } from '@/lib/tenant-time';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const LIVE_GONE = ['cancelled', 'voided'];
type Fail = { ok: false; error: string; status: number };
const fail = (error: string, status: number): Fail => ({ ok: false, error, status });

export type DeliveryRow = { orderId: string; number: string; name: string | null; to: string; note: string | null; arriveAt: string | null; driveMin: number;
  step: 'making' | 'ready' | 'out' | 'delivered' | 'failed'; readyFor: number | null; leaveAt: string | null; driver: string | null; outAt: string | null; deliveredAt: string | null; why: string | null;
  /** The guest's number, for the driver or the counter to reach them (until it's delivered). */
  phone: string | null };

// (Read once every few seconds for the business, however many counter screens ask; a step taken reads afresh.)
const cache = new Map<string, { at: number; rows: DeliveryRow[] }>();
const forget = (tenantId: string) => { cache.delete(tenantId); };

/** Today's deliveries for the counter (paid ones), the ones still to go first, by when they should leave. */
export async function deliveriesToday(db: any, tenantId: string, tenant: any, now = Date.now()): Promise<DeliveryRow[]> {
  const hit = cache.get(tenantId); if (hit && now - hit.at < 3000) return hit.rows;
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
  const rows: DeliveryRow[] = orders.map((o: any) => {
    const mine = tickets.filter((t) => t.orderId === o.id && !LIVE_GONE.includes(String(t.status)));
    const ready = mine.length > 0 && mine.every((t) => ['ready', 'delivered', 'served', 'done'].includes(String(t.status)));
    const readyAt = ready ? Math.max(...mine.map((t) => Date.parse(String(t.readyAt || t.deliveredAt || t.updatedAt || '')) || 0)) : 0;
    const d = o.ahead.delivery; const step = deliveryStep(d, ready ? 'ready' : 'making');
    const leave = Date.parse(String(o.ahead.slot || o.ahead.at || ''));
    return { orderId: o.id, number: String(o.number || ''), name: o.guestName || null, to: addressLine(d.address), note: d.note || null, arriveAt: d.arriveAt || null,
      driveMin: Math.round(Number(d.driveMin) || 0), step, readyFor: step === 'ready' && readyAt ? waitingHot(readyAt, now) : null,
      leaveAt: Number.isFinite(leave) ? new Date(leave).toISOString() : null, driver: d.driverName || null, outAt: d.outAt || null, deliveredAt: d.deliveredAt || null,
      why: d.state === 'failed' ? FOOD_FAIL_REASONS.find((r) => r.code === d.why)?.label || 'Couldn’t deliver' : null,
      phone: step !== 'delivered' && /^\d{10}$/.test(String(d.phone || '')) ? String(d.phone) : null };
  });
  const rank = { ready: 0, making: 1, out: 2, failed: 3, delivered: 4 } as const;
  return rows.sort((a, b) => rank[a.step] - rank[b.step] || String(a.leaveAt || '').localeCompare(String(b.leaveAt || ''))).slice(0, 60);
}

/** Out with a driver: from waiting, once the kitchen has it all ready (or sent again after it couldn't be delivered).
 *  The kitchen's tickets are bagged and the order is done for the kitchen; then the guest's "on its way" text, if they asked for one. */
export async function deliveryOut(db: any, tenantId: string, orderId: string, by: string, nowIso = new Date().toISOString()): Promise<{ ok: true; already?: boolean } | Fail> {
  if (!ID.test(orderId)) return fail('Which order?', 400);
  const T = `tenants/${tenantId}`; const ref = db.doc(`${T}/counterOrders/${orderId}`);
  const r: any = await db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(ref)).data();
    const tix = (await tx.get(db.collection(`${T}/kdsTickets`).where('orderId', '==', orderId))).docs;
    if (!o || o.ahead?.way !== 'delivery' || !o.ahead?.delivery) return fail('That delivery isn’t here.', 404);
    if (!o.paidAt || o.status === 'voided') return fail('That order isn’t paid.', 409);
    const st = String(o.ahead.delivery.state || 'waiting');
    if (st === 'out' || st === 'delivered') return { ok: true, already: true };
    // Only once the kitchen has it all ready (or it went out once already and is going again).
    const live = tix.map((d: any) => d.data() || {}).filter((t: any) => !LIVE_GONE.includes(String(t.status)));
    if (!live.length || !live.every((t: any) => ['ready', 'delivered', 'served', 'done'].includes(String(t.status)))) return fail('It’s still being made.', 409);
    tx.set(ref, { status: 'done', doneAt: o.doneAt || nowIso, ahead: { delivery: { state: 'out', outAt: nowIso, driverName: String(by).slice(0, 60), failedAt: null, why: null } } }, { merge: true });
    // Handed to the driver: bagged.
    for (const d of tix) { const t: any = d.data() || {}; if (t.status !== 'delivered' && !LIVE_GONE.includes(String(t.status))) tx.set(d.ref, { status: 'delivered', deliveredAt: nowIso, deliveredBy: { name: String(by).slice(0, 60), via: 'delivery' } }, { merge: true }); }
    return { ok: true };
  });
  forget(tenantId);
  if (r.ok && !r.already) {
    const { textIfReady } = await import('@/lib/ready-text');
    await textIfReady(db, tenantId, [orderId], { onWay: true }).catch(() => 0);
  }
  return r;
}

/** Delivered at the door, or couldn't be (and why): only once it's out. */
export async function deliveryEnd(db: any, tenantId: string, orderId: string, how: { done: true } | { done: false; why: unknown }, by: string, nowIso = new Date().toISOString()): Promise<{ ok: true; already?: boolean } | Fail> {
  if (!ID.test(orderId)) return fail('Which order?', 400);
  const why = how.done ? null : FOOD_FAIL_REASONS.find((x) => x.code === how.why)?.code || null;
  if (!how.done && !why) return fail('What happened?', 400);
  const ref = db.doc(`tenants/${tenantId}/counterOrders/${orderId}`);
  const r = await db.runTransaction(async (tx: any) => {
    const o: any = (await tx.get(ref)).data();
    if (!o || o.ahead?.way !== 'delivery' || !o.ahead?.delivery) return fail('That delivery isn’t here.', 404);
    const st = String(o.ahead.delivery.state || 'waiting');
    if ((how.done && st === 'delivered') || (!how.done && st === 'failed')) return { ok: true, already: true };
    if (st !== 'out') return fail('It hasn’t gone out yet.', 409);
    tx.set(ref, { ahead: { delivery: how.done ? { state: 'delivered', deliveredAt: nowIso, deliveredBy: String(by).slice(0, 60) } : { state: 'failed', failedAt: nowIso, why, failedBy: String(by).slice(0, 60) } } }, { merge: true });
    return { ok: true };
  });
  forget(tenantId);
  return r;
}
