// src/lib/route-server.ts — A DRIVER'S ROUTE, PLANNED (server; lib/route-plan is the rules; design board "Routes in
// the best order"). Asked for by the driver's app (api/retail/delivery-route) when they set out, and again whenever
// a stop is added, taken or brought back.
// - Their stops: shop orders out with them (lib/delivery-run) and hot food out with them (lib/food-delivery-server).
//   Each stop's place on the map is looked up once for its address and kept on the delivery (Mapbox's permanent lookup).
// - Drive times by road from the map (Mapbox's travel times, with live traffic for up to 9 stops); when the map service
//   isn't there, from the distance, and the plan says so.
// - From where the driver is (when they share it and it's fresh), otherwise from the shop; back to the shop at the end.
// - The plan is kept on each stop (its place in the order and when it should get there), so the driver's list, the
//   customer's "stops before yours" and the live arrival times all follow it, and once for the driver
//   (tenants/{t}/private/route_{staffId}, server only) with its totals. Asked again with the same stops: the same plan.
import { planRoute, routeLink, estimateLegs, type Legs, type RouteStop } from '@/lib/route-plan';
import { okPoint, FRESH_MS, type LatLng } from '@/lib/delivery-live';
import { deliveryFrom } from '@/lib/delivery-plan';
import { pinnedLocations } from '@/lib/delivery-server';
import { geocode, hasMapsKey, preciseEnough } from '@/lib/geocode-server';
import { runFor } from '@/lib/delivery-run';
import { driverRef, lookUpPlaces, destOf } from '@/lib/delivery-live-server';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
/** A plan this old is made again even for the same stops (traffic changes). */
const KEEP_PLAN_MS = 20 * 60e3;
/** Places looked up at most this many at a time, per plan. */
const LOOKUPS = 12;

/* ─── Drive times by road ─────────────────────────────────────────────────────── */

const legCache = new Map<string, { at: number; legs: Legs }>();
/** Drive minutes and miles by road between points, from the map: with live traffic for up to 10 points, without it up
 *  to 25. Null when the map service can't answer (no key, too many points, down, or slow). */
export async function roadLegs(points: LatLng[], opts: { fetcher?: typeof fetch; now?: number } = {}): Promise<Legs | null> {
  const token = String(process.env.MAPBOX_TOKEN || '').trim();
  if (!token || points.length < 2 || points.length > 25) return null;
  const coords = points.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
  const now = opts.now ?? Date.now();
  const hit = legCache.get(coords); if (hit && now - hit.at < 5 * 60e3) return hit.legs;
  const profile = points.length <= 10 ? 'driving-traffic' : 'driving';
  const url = `https://api.mapbox.com/directions-matrix/v1/mapbox/${profile}/${coords}?annotations=duration,distance&access_token=${encodeURIComponent(token)}`;
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await (opts.fetcher || fetch)(url, { signal: ctl.signal, cache: 'no-store' } as any);
    if (!r.ok) return null;
    const j: any = await r.json();
    if (j?.code !== 'Ok' || !Array.isArray(j.durations) || j.durations.length !== points.length) return null;
    const est = estimateLegs(points);
    // A pair the map couldn't route (an island, a closed road): the estimate for that one.
    const min = points.map((_, i) => points.map((__, k) => { const v = Number(j.durations?.[i]?.[k]); return i === k ? 0 : Number.isFinite(v) && j.durations[i][k] !== null ? v / 60 : est.min[i][k]; }));
    const miles = points.map((_, i) => points.map((__, k) => { const v = Number(j.distances?.[i]?.[k]); return i === k ? 0 : Number.isFinite(v) && j.distances?.[i]?.[k] != null ? v / 1609.344 : est.miles[i][k]; }));
    const legs = { min, miles, road: true };
    legCache.set(coords, { at: now, legs }); if (legCache.size > 300) legCache.delete(legCache.keys().next().value as string);
    return legs;
  } catch { return null; } finally { clearTimeout(timer); }
}

/** Legs for [start, ...stops, home], some of which may not be on the map: by road between those that are, from the
 *  distance otherwise. */
async function legsFor(points: (LatLng | null)[], now: number): Promise<Legs> {
  const est = estimateLegs(points);
  const at = points.map((p, i) => ({ p, i })).filter((x) => x.p) as { p: LatLng; i: number }[];
  const road = at.length >= 2 ? await roadLegs(at.map((x) => x.p), { now }) : null;
  if (!road) return est;
  at.forEach((a, ai) => at.forEach((b, bi) => { est.min[a.i][b.i] = road.min[ai][bi]; est.miles[a.i][b.i] = road.miles[ai][bi]; }));
  return { ...est, road: true };
}

/* ─── Where the shop is ───────────────────────────────────────────────────────── */

/** Where deliveries start from and come back to: the delivery settings' starting point, or the shop's first location
 *  with a pin on the map. Null when there's neither. */
export async function shopPlace(db: any, tenantId: string, tenant: any): Promise<{ at: LatLng; address: string | null } | null> {
  const o: any = deliveryFrom(tenant?.retailSettings).origin; const label = o?.label ? String(o.label) : null;
  if (o && okPoint(o)) return { at: { lat: Number(o.lat), lng: Number(o.lng) }, address: label };
  const pins = await pinnedLocations(db, tenantId).catch(() => []);
  return pins[0] ? { at: { lat: pins[0].lat, lng: pins[0].lng }, address: pins[0].address || null } : null;
}

/* ─── Hot food's places ───────────────────────────────────────────────────────── */

const placeKey = (a: any) => [a?.line1, a?.line2, a?.city, a?.state, a?.postalCode].map((x) => String(x || '').trim().toLowerCase()).join('|');
const LOOKUP_AGAIN_MS = 30 * 60e3;
export const hotDestOf = (d: any): LatLng | null => (okPoint(d?.dest) && d?.destFor === placeKey(d?.address) ? { lat: Number(d.dest.lat), lng: Number(d.dest.lng) } : null);
/** Looks a hot food delivery's place up once for its address (claimed first, so two at once never both pay for it). */
export async function lookUpHot(db: any, tenantId: string, orders: { id: string; d: any }[], now: number, limit = 2): Promise<void> {
  if (!hasMapsKey()) return;
  const due = orders.filter(({ d }) => !(d?.destFor === placeKey(d?.address) && (d.destAt || now - (Date.parse(String(d.destTriedAt || '')) || 0) < LOOKUP_AGAIN_MS))).slice(0, limit);
  await Promise.all(due.map(async ({ id, d }) => {
    const ref = db.doc(`tenants/${tenantId}/counterOrders/${id}`); const key = placeKey(d.address);
    const mine = await db.runTransaction(async (tx: any) => {
      const cur: any = ((await tx.get(ref)).data() as any)?.ahead?.delivery || {};
      if (cur.destFor === key && (cur.destAt || now - (Date.parse(String(cur.destTriedAt || '')) || 0) < LOOKUP_AGAIN_MS)) return false;
      tx.set(ref, { ahead: { delivery: { destFor: key, destTriedAt: new Date(now).toISOString(), destAt: null, dest: null } } }, { merge: true });
      return true;
    }).catch(() => false);
    if (!mine) return;
    const a = d.address || {};
    const g = await geocode([a.line1, a.city, `${a.state || ''} ${a.postalCode || ''}`].join(', '), { keep: true }).catch(() => 'down' as const);
    if (g === 'down') return;
    await ref.set({ ahead: { delivery: { dest: g && preciseEnough(g) ? { lat: g.lat, lng: g.lng } : null, destAt: new Date(now).toISOString() } } }, { merge: true }).catch(() => {});
  }));
}

/* ─── The plan ────────────────────────────────────────────────────────────────── */

export type RouteView = { ok: true; id: string;
  /** In order. `eta` null: the stop isn't on the map, so it isn't in the best order and its time isn't known. */
  stops: { kind: 'shop' | 'hot'; id: string; eta: string | null; late: boolean; placed: boolean }[]; driveMin: number; miles: number; backAt: string | null;
  savedMin: number; road: boolean; from: 'here' | 'shop' | 'first'; link: string | null;
  /** How many stops the link has (the maps app takes ten), of how many to go. */
  linkStops: number; linkOf: number; at: string };

// (For the maps app's link: its stops are joined with a bar, so a bar in what someone typed is taken out.)
const streetOf = (a: any) => [a?.line1, a?.city, [a?.state, a?.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ').replace(/[|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();

/** The driver's stops now (shop orders, then hot food), as the planner takes them. */
async function stopsOf(db: any, tenantId: string, staffId: string, now: number) {
  const T = `tenants/${tenantId}`;
  const shopDocs = (await db.collection(`${T}/retailOrders`).where('delivery.driverId', '==', staffId).where('delivery.status', '==', 'out').limit(60).get()).docs
    .map((d: any) => ({ ...(d.data() || {}), id: d.id }));
  let shop = runFor(shopDocs, staffId).route;
  if (shop.some((o: any) => !destOf(o))) {
    await lookUpPlaces(db, tenantId, shop, now, LOOKUPS);
    shop = runFor((await db.collection(`${T}/retailOrders`).where('delivery.driverId', '==', staffId).where('delivery.status', '==', 'out').limit(60).get()).docs.map((d: any) => ({ ...(d.data() || {}), id: d.id })), staffId).route;
  }
  const hotQ = () => db.collection(`${T}/counterOrders`).where('ahead.delivery.driverId', '==', staffId).where('ahead.delivery.state', '==', 'out').limit(30).get();
  let hot = (await hotQ()).docs.map((d: any) => ({ id: d.id, d: (d.data() || {}).ahead?.delivery || {} }));
  if (hot.some((h: any) => !hotDestOf(h.d))) { await lookUpHot(db, tenantId, hot, now, LOOKUPS); hot = (await hotQ()).docs.map((d: any) => ({ id: d.id, d: (d.data() || {}).ahead?.delivery || {} })); }
  const stops: (RouteStop & { kind: 'shop' | 'hot'; id: string; street: string })[] = [
    ...hot.map((h: any) => ({ key: `h:${h.id}`, kind: 'hot' as const, id: h.id, at: hotDestOf(h.d), open: null, due: Date.parse(String(h.d.arriveAt || '')) || null, hot: true, skippedAt: null, street: streetOf(h.d.address) })),
    ...shop.map((o: any) => {
      const d = o.delivery || {}; const start = Date.parse(String(d.window?.start || '')); const end = Date.parse(String(d.window?.end || d.asap?.by || ''));
      return { key: `s:${o.id}`, kind: 'shop' as const, id: o.id, at: destOf(o), open: Number.isFinite(start) ? start : null, due: Number.isFinite(end) ? end : null,
        hot: false, skippedAt: Date.parse(String(d.skippedAt || '')) || null, street: streetOf(o.shippingAddress) };
    }),
  ];
  return stops;
}

// (The same stops, skipped or not, on the map or not, due when they were: the same plan.)
const sigOf = (stops: { key: string; skippedAt?: number | null; at: LatLng | null; due: number | null }[]) => stops.map((s) => `${s.key}${s.skippedAt ? '~' : ''}${s.at ? '@' : ''}${s.due || ''}`).sort().join(',');

/**
 * The driver's route: the kept plan when their stops are the same and it's recent, otherwise planned now and kept on
 * each stop. `again`: planned now whatever (the driver asked). Null when they have no stops out.
 */
export async function routeFor(db: any, tenantId: string, tenant: any, staffId: string, opts: { again?: boolean; now?: number } = {}): Promise<RouteView | null> {
  if (!ID.test(staffId)) return null;
  const now = opts.now ?? Date.now();
  const stops = await stopsOf(db, tenantId, staffId, now);
  const keptRef = db.doc(`tenants/${tenantId}/private/route_${staffId}`);
  if (!stops.length) { await keptRef.delete().catch(() => {}); return null; }
  const sig = sigOf(stops);
  const kept: any = (await keptRef.get()).data();
  const keptAge = now - (Date.parse(String(kept?.at || '')) || 0);
  // (Asked again within a few seconds, or for the same stops not long ago: the kept plan.)
  if (kept?.sig === sig && (opts.again ? keptAge < 15_000 : keptAge < KEEP_PLAN_MS)) return kept.view as RouteView;
  // From where they are when they share it and it's fresh; from the shop otherwise.
  const live: any = (await driverRef(db, tenantId, staffId).get()).data();
  // (Rounded to about a block: close enough to plan from, and the same drive times serve a driver standing still.)
  const here = live?.sharing === true && okPoint(live.point) && now - (Date.parse(String(live.pointAt || '')) || 0) <= FRESH_MS ? { lat: Math.round(Number(live.point.lat) * 1000) / 1000, lng: Math.round(Number(live.point.lng) * 1000) / 1000 } : null;
  const shop = await shopPlace(db, tenantId, tenant);
  const start = here || shop?.at || null;
  const legs = await legsFor([start, ...stops.map((s) => s.at), shop?.at || null], now);
  const plan = planRoute({ start, home: shop?.at || null, stops, now, legs });
  const id = `r${now}`;
  const byKey = new Map(stops.map((s) => [s.key, s]));
  const ordered = plan.order.map((k) => byKey.get(k)!);
  const view: RouteView = {
    ok: true, id, at: new Date(now).toISOString(), driveMin: plan.driveMin, miles: plan.miles, backAt: plan.backAt ? new Date(plan.backAt).toISOString() : null,
    savedMin: plan.savedMin, road: plan.road, from: here ? 'here' : shop ? 'shop' : 'first',
    stops: ordered.map((s) => { const e = plan.eta[s.key]; return { kind: s.kind, id: s.id, eta: e.placed ? new Date(e.at).toISOString() : null, late: e.placed && e.late, placed: e.placed }; }),
    link: null, linkStops: 0, linkOf: 0,
  };
  const linked = ordered.filter((s) => !s.skippedAt).map((s) => s.street).filter(Boolean);
  view.link = routeLink(here ? null : shop?.address || null, linked); view.linkStops = Math.min(10, linked.length); view.linkOf = linked.length;
  // Kept on each stop and once for the driver, all at once (two plans made together never leave a mix of both). A
  // stop that's gone since (deleted) fails it: then each is kept on its own, passing that one over.
  const writes = ordered.map((s, n) => {
    const e = view.stops[n]; const f = { routeId: id, routeSeq: n, routeEta: e.eta, routeLate: e.late };
    return s.kind === 'shop'
      ? { ref: db.doc(`tenants/${tenantId}/retailOrders/${s.id}`), v: { 'delivery.routeId': f.routeId, 'delivery.routeSeq': f.routeSeq, 'delivery.routeEta': f.routeEta, 'delivery.routeLate': f.routeLate } }
      : { ref: db.doc(`tenants/${tenantId}/counterOrders/${s.id}`), v: { 'ahead.delivery.routeId': f.routeId, 'ahead.delivery.routeSeq': f.routeSeq, 'ahead.delivery.routeEta': f.routeEta, 'ahead.delivery.routeLate': f.routeLate } };
  });
  const batch = db.batch(); for (const w of writes) batch.update(w.ref, w.v); batch.set(keptRef, { sig, at: view.at, view });
  try { await batch.commit(); }
  catch { await Promise.all(writes.map((w) => w.ref.update(w.v).catch(() => null))); await keptRef.set({ sig, at: view.at, view }); }
  return view;
}
