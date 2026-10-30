// src/lib/delivery-live-server.ts — A DELIVERY ON ITS WAY, LIVE (server; the rules are lib/delivery-live).
//   · The driver's app sends where they are while they have stops out (api/retail/driver-location). Each update keeps,
//     for that driver only, their route in order, an arrival estimate for each stop and (when they share it) their
//     last location (tenants/{t}/driverLocations/{staffId}, read and written only here). Once their last stop is done,
//     it's gone.
//   · Each stop's place on the map is looked up once, when it's first on a route, as a result that may be kept (Mapbox's
//     permanent lookup), and kept on the delivery.
//   · The order page's map is drawn by the server (api/retail/delivery-map), from a key it signs for that order, so the
//     map key and the driver's exact location never reach a browser.
import { createHmac, timingSafeEqual } from 'crypto';
import { runFor } from '@/lib/delivery-run';
import { geocode, hasMapsKey, preciseEnough } from '@/lib/geocode-server';
import { FIX_MAX_AGE_MS, FRESH_MS, NEAR_ACCURACY_M, NEAR_AFTER_OUT_MS, isNear, okPoint, roughly, routeEtas, stopsBefore, type LatLng, type StopEta } from '@/lib/delivery-live';
import { tryKey } from '@/lib/delivery-run';

const secret = () => String(process.env.RETAIL_QUOTE_SECRET || process.env.FIREBASE_ADMIN_PRIVATE_KEY || 'clarityflow-map');
const sign = (tenantId: string, orderId: string, exp: number) => createHmac('sha256', secret()).update(`dmap|${tenantId}|${orderId}|${exp}`).digest('base64url');
const LOOKUPS_PER_UPDATE = 3;
const NEAR_TRIES = 3; const NEAR_TRY_GAP_MS = 2 * 60e3;
/** A place that couldn't be looked up (the map service down, or refusing) is tried again after this long. */
const LOOKUP_AGAIN_MS = 30 * 60e3;
/** What's kept of a driver who stopped sending (the app closed mid-route) goes after this long (the five-minute check). */
export const KEEP_SILENT_MS = 30 * 60e3;
/** The address a place was looked up for: a changed address is looked up again. */
const placeKey = (a: any) => [a?.line1, a?.line2, a?.city, a?.state, a?.postalCode].map((x) => String(x || '').trim().toLowerCase()).join('|');
export const driverRef = (db: any, tenantId: string, staffId: string) => db.doc(`tenants/${tenantId}/driverLocations/${staffId}`);

/** A short-lived key for one order's map. The same for a couple of minutes, so the page's address for the map (and the
 *  browser's copy of it) only changes when the driver has moved. */
export function mapKey(tenantId: string, orderId: string, now = Date.now()): { exp: number; key: string } {
  const step = 2 * 60e3; const exp = Math.ceil(now / step) * step + 5 * 60e3; return { exp, key: sign(tenantId, orderId, exp) };
}
export function mapKeyOk(tenantId: string, orderId: string, exp: any, key: any, now = Date.now()): boolean {
  const e = Number(exp); if (!Number.isFinite(e) || e < now || e > now + 10 * 60e3) return false;
  const want = Buffer.from(sign(tenantId, orderId, e)); const got = Buffer.from(String(key || ''));
  return want.length === got.length && timingSafeEqual(want, got);
}

/** The order's place on the map, as kept on its delivery. */
export const destOf = (order: any): LatLng | null => (okPoint(order?.delivery?.dest) ? { lat: Number(order.delivery.dest.lat), lng: Number(order.delivery.dest.lng) } : null);

/** What the order page shows of the live delivery, from the driver's kept route (null when there's nothing live). */
export function liveFor(orderId: string, doc: any, now = Date.now()): { stopsBefore: number | null; eta: StopEta | null; at: string | null; point: LatLng | null } | null {
  if (!doc) return null;
  const at = Date.parse(String(doc.at || ''));
  if (!Number.isFinite(at) || now - at > FRESH_MS * 3) return null;
  const n = stopsBefore(Array.isArray(doc.stops) ? doc.stops : [], orderId);
  if (n === null) return null;
  const located = doc.sharing === true && okPoint(doc.point) && Number.isFinite(Date.parse(String(doc.pointAt || ''))) && now - Date.parse(String(doc.pointAt)) <= FRESH_MS;
  // Arrival times come from where the driver is, so they're shown only while that's fresh too.
  return { stopsBefore: n, eta: located ? doc.eta?.[orderId] || null : null, at: located ? String(doc.pointAt) : null, point: located ? roughly(doc.point) : null };
}

export type DriverUpdate = { point: LatLng | null; accuracy?: number | null; sharing: boolean; fixAgeMs?: number | null };

/** Looks each stop's place up once for its address (a few at a time; a changed address is looked up again). Each
 *  lookup is claimed first, so two updates at once never both pay for it. */
async function lookUpPlaces(db: any, tenantId: string, route: any[], now: number): Promise<void> {
  if (!hasMapsKey()) return;
  const due = route.filter((o: any) => { const d = o.delivery || {}; return !(d.destFor === placeKey(o.shippingAddress) && (d.destAt || now - (Date.parse(String(d.destTriedAt || '')) || 0) < LOOKUP_AGAIN_MS)); })
    .slice(0, LOOKUPS_PER_UPDATE);
  await Promise.all(due.map(async (o: any) => {
    const key = placeKey(o.shippingAddress);
    const oRef = db.doc(`tenants/${tenantId}/retailOrders/${o.id}`);
    const mine = await db.runTransaction(async (tx: any) => {
      const cur: any = ((await tx.get(oRef)).data() as any)?.delivery || {};
      if (cur.destFor === key && (cur.destAt || now - (Date.parse(String(cur.destTriedAt || '')) || 0) < LOOKUP_AGAIN_MS)) return false;
      tx.update(oRef, { 'delivery.destFor': key, 'delivery.destTriedAt': new Date(now).toISOString(), 'delivery.destAt': null, 'delivery.dest': null });
      return true;
    }).catch(() => false);
    if (!mine) return;
    const a = o.shippingAddress || {};
    const g = await geocode([a.line1, a.city, `${a.state || ''} ${a.postalCode || ''}`].join(', '), { keep: true }).catch(() => 'down' as const);
    // Down or refusing: tried again later (its claim says when it was tried).
    if (g === 'down') return;
    const dest = g && preciseEnough(g) ? { lat: g.lat, lng: g.lng } : null;
    await oRef.update({ 'delivery.dest': dest, 'delivery.destAt': new Date(now).toISOString() }).catch(() => {});
  }));
}

/**
 * One update from the driver's app: their route now, each stop's arrival estimate and (when shared) where they are.
 * A fix the phone took more than a minute ago (its age, as the phone measured it, so a phone's clock being off doesn't
 * matter) isn't where they are now; while they're still sharing, the last good one stands until it's a few minutes old
 * (a phone standing still at a door may not send a new one). Answers which stop they're now a few minutes from (their
 * next one only), for its text.
 */
export async function updateDriver(db: any, tenantId: string, staffId: string, name: string, u: DriverUpdate, now = Date.now()):
  Promise<{ stops: number; near: { orderId: string; tries: string }[] }> {
  // Only the stops out with them now (a driver's past deliveries never crowd them out).
  const q = db.collection(`tenants/${tenantId}/retailOrders`).where('delivery.driverId', '==', staffId).where('delivery.status', '==', 'out').limit(60);
  const pre = runFor((await q.get()).docs.map((d: any) => ({ ...(d.data() || {}), id: d.id })), staffId).route;
  if (pre.length) await lookUpPlaces(db, tenantId, pre, now);
  const age = Number(u.fixAgeMs);
  const fixAt = u.fixAgeMs != null && Number.isFinite(age) && age >= 0 ? now - age : now;
  const fresh = u.sharing && okPoint(u.point) && now - fixAt <= FIX_MAX_AGE_MS ? { lat: Number(u.point!.lat), lng: Number(u.point!.lng) } : null;
  const accuracy = fresh && Number.isFinite(Number(u.accuracy)) ? Math.round(Number(u.accuracy)) : null;
  const ref = driverRef(db, tenantId, staffId);
  // The route and its times are written as they are when written: two updates at once (several stops starting
  // together) never leave the older route standing.
  const out = await db.runTransaction(async (tx: any) => {
    const [snap, prevSnap] = await Promise.all([tx.get(q), tx.get(ref)]);
    const route = runFor(snap.docs.map((d: any) => ({ ...(d.data() || {}), id: d.id })), staffId).route;
    if (!route.length) { if (prevSnap.exists) tx.delete(ref); return { route, point: null as LatLng | null, at: now, accuracy: null as number | null }; }
    const prev: any = prevSnap.exists ? prevSnap.data() : null;
    const keep = !fresh && u.sharing && prev?.sharing === true && okPoint(prev.point) && now - (Date.parse(String(prev.pointAt || '')) || 0) <= FRESH_MS;
    const point = fresh || (keep ? prev.point : null);
    const at = fresh ? fixAt : keep ? Date.parse(String(prev.pointAt)) : now;
    const acc = fresh ? accuracy : keep ? (prev.accuracy ?? null) : null;
    tx.set(ref, {
      staffId, name: String(name || prev?.name || '').trim().split(/\s+/)[0].slice(0, 40), at: new Date(now).toISOString(), sharing: !!point,
      stops: route.map((o: any) => o.id), eta: routeEtas(at, point, route.map((o: any) => ({ id: o.id, dest: destOf(o) }))),
      ...(point ? { point, pointAt: new Date(at).toISOString(), accuracy: acc } : { point: null, pointAt: null, accuracy: null }),
    });
    return { route, point, at, accuracy: acc };
  });
  if (!out.route.length) return { stops: 0, near: [] };
  // The next stop only: a few minutes away, once per try, from a new fix sure enough, and not right out of the shop.
  // A text that didn't go is tried again by a later update while it's still true: at most three times a try, two
  // minutes apart (each try is written on the order first).
  const next = out.route[0];
  const outFor = now - (Date.parse(String(next.delivery?.outAt || '')) || 0);
  const near: { orderId: string; tries: string }[] = [];
  const tried = next.delivery?.nearTry?.try === tryKey(next) ? next.delivery.nearTry : null;
  if (fresh && (accuracy === null || accuracy <= NEAR_ACCURACY_M) && outFor >= NEAR_AFTER_OUT_MS && isNear(fresh, destOf(next))
    && !next.delivery?.sent?.[`near_${tryKey(next)}`] && !(tried && tried.n >= NEAR_TRIES)) {
    const oRef = db.doc(`tenants/${tenantId}/retailOrders/${next.id}`);
    const tk = tryKey(next);
    const go = await db.runTransaction(async (tx: any) => {
      const d: any = ((await tx.get(oRef)).data() as any)?.delivery || {};
      if (d.status !== 'out' || d.sent?.[`near_${tk}`]) return false;
      const t = d.nearTry?.try === tk ? d.nearTry : { try: tk, n: 0, at: null };
      if (t.n >= NEAR_TRIES || now - (Date.parse(String(t.at || '')) || 0) < NEAR_TRY_GAP_MS) return false;
      tx.update(oRef, { 'delivery.nearTry': { try: tk, n: t.n + 1, at: new Date(now).toISOString() } });
      return true;
    }).catch(() => false);
    if (go) near.push({ orderId: next.id, tries: tk });
  }
  return { stops: out.route.length, near };
}

/**
 * After a stop is done (delivered, brought back, skipped) the order pages see the new route at once, from the driver's
 * last location while it's still fresh, and nothing once their last stop is done.
 */
export async function refreshDriver(db: any, tenantId: string, staffId: string, now = Date.now()): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(staffId || ''))) return;
  const doc: any = (await driverRef(db, tenantId, staffId).get().catch(() => null))?.data?.() || null;
  await updateDriver(db, tenantId, staffId, String(doc?.name || ''), { point: null, sharing: doc?.sharing === true }, now).catch(() => null);
}

/** EVERY FIVE MINUTES (cron/retail-payments): a driver who stopped sending mid-route (the app closed) isn't kept. */
export async function sweepDriverLocations(db: any, tenantId: string, now = Date.now()): Promise<number> {
  const before = new Date(now - KEEP_SILENT_MS).toISOString();
  const snap = await db.collection(`tenants/${tenantId}/driverLocations`).where('at', '<', before).limit(50).get().catch(() => ({ docs: [] as any[] }));
  for (const d of snap.docs) await d.ref.delete().catch(() => {});
  return snap.docs.length;
}
