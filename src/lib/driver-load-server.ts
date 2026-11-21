// src/lib/driver-load-server.ts — THE DRIVERS NOW (server; lib/driver-load is the rules; design board "Drivers shared,
// and a pause for busy nights"). Read by ordering ahead (lib/counter-ahead: which delivery times a driver can make), shop
// delivery "within the hour" (lib/delivery-server: hot food out keeps a driver too) and the counter's Deliveries list
// (how many drivers are on, how many out, and when the first is back). Read at most every 15 seconds per business.
// - The drivers on the schedule (the ones listed as drivers, Orders → Delivery), from today's and yesterday's shifts.
// - Hot food still to leave (paid, waiting: from its leave time) and out with a driver; shop runs out with a driver,
//   each driver once, until their route has them back (lib/route-server keeps it).
// - At one of several locations (`at`; design board "Each store runs on its own"): the drivers who work there (each
//   person's locations, Staff page; none set: every location), its own hot food to leave, and runs out with those drivers
//   or from there.
import { deliveryFrom } from '@/lib/delivery-plan';
import { shiftsFor } from '@/lib/pickup-slots-server';
import { tenantTimeZone, todayIn, wallParts, wallToUtc } from '@/lib/tenant-time';
import { addDays } from '@/lib/night-close-server';
import { hotTrip, outAt, shopTrip, type Trip } from '@/lib/driver-load';
import { atHere, worksAt } from '@/lib/business-locations';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
export type DriverLoad = {
  /** The drivers on the schedule at t; null when nobody is on it as a driver that day (no limit). */
  onShift: (t: number) => string[] | null;
  trips: Trip[];
  /** On now (null: no schedule), out now, and when the first one out is back. */
  onNow: number | null; outNow: number; backAt: string | null;
  /** Drivers kept out by hot food now (for shop delivery "within the hour", which counts its own). */
  hotOutNow: number;
  /** Each of the drivers now (the counter's list): out (back about when), here and free, or on later today (when).
   *  One off for the day isn't listed. */
  drivers: { id: string; state: 'out' | 'free' | 'later'; backAt: string | null; onAt: string | null }[];
};

const cache = new Map<string, { at: number; v: DriverLoad }>();
export const forgetDriverLoad = (tenantId: string) => { for (const k of [...cache.keys()]) if (k === tenantId || k.startsWith(`${tenantId}|`)) cache.delete(k); };

/** Of the listed drivers, the ones who work at a location (lib/business-locations worksAt: none set, every location). */
export async function driversAt(db: any, tenantId: string, drivers: string[], at: string | null | undefined): Promise<string[]> {
  if (!at || !drivers.length) return drivers;
  const ids = drivers.filter((id) => ID.test(id)).slice(0, 60);
  const docs = ids.length ? await db.getAll(...ids.map((id) => db.doc(`tenants/${tenantId}/staff/${id}`))).catch(() => null) : [];
  if (!docs) return drivers;
  const byId = new Map(ids.map((id, i) => [id, docs[i]?.exists === false ? null : docs[i]?.data?.() || null]));
  // (An entry that isn't a team member's id can't be placed: kept, as working everywhere.)
  return drivers.filter((id) => !byId.has(id) || worksAt(byId.get(id), at));
}

/** `skipCheckout`: read afresh, leaving out one guest's own unpaid tries (their checkout key), for placing their order. */
export async function driverLoad(db: any, tenantId: string, tenant: any, now = Date.now(), opts: { skipCheckout?: string; at?: string | null } = {}): Promise<DriverLoad> {
  const at = opts.at || null;
  if (opts.skipCheckout) return readLoad(db, tenantId, tenant, now, opts.skipCheckout, at);
  const key = at ? `${tenantId}|${at}` : tenantId;
  const hit = cache.get(key); if (hit && now >= hit.at && now - hit.at < 15_000) return hit.v;
  const v = await readLoad(db, tenantId, tenant, now, '', at);
  cache.set(key, { at: now, v }); if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  return v;
}

/** An order being paid for holds a driver as long as its payment link lasts (31 minutes); one called off stops at once. */
const PAYING_MS = 32 * 60000;

async function readLoad(db: any, tenantId: string, tenant: any, now: number, skipCheckout = '', at: string | null = null): Promise<DriverLoad> {
  const T = `tenants/${tenantId}`; const tz = tenantTimeZone(tenant);
  const today = todayIn(tz, new Date(now)); const days = [addDays(today, -1), today];
  const listed = deliveryFrom(tenant?.retailSettings).drivers;
  const drivers = await driversAt(db, tenantId, listed, at);
  // (The business has drivers and none of them works at this location: none on, ever, rather than no limit.)
  const noneHere = !!at && listed.length > 0 && drivers.length === 0;
  const set = new Set(drivers);
  const [spans, waiting, hotOut, shopOut] = await Promise.all([
    drivers.length ? shiftsFor(db, tenantId, days).then((x) => x.filter((s) => set.has(s.staffId))).catch(() => []) : Promise.resolve([]),
    db.collection(`${T}/counterOrders`).where('ahead.way', '==', 'delivery').where('ahead.delivery.state', '==', 'waiting').where('day', 'in', days).limit(200).get(),
    db.collection(`${T}/counterOrders`).where('ahead.way', '==', 'delivery').where('ahead.delivery.state', '==', 'out').where('day', 'in', days).limit(200).get(),
    db.collection(`${T}/retailOrders`).where('delivery.status', '==', 'out').limit(200).get().catch(() => ({ docs: [] as any[] })),
  ]);
  const onShift = (t: number): string[] | null => {
    if (noneHere) return [];
    const day = todayIn(tz, new Date(t)); if (!spans.some((s: any) => s.date === day)) return null;
    const w = wallParts(new Date(t), tz); const at = w.hour * 60 + w.minute;
    return Array.from(new Set(spans.filter((x: any) => x.date === day && x.start <= at && x.end > at).map((x: any) => String(x.staffId))));
  };
  const trips: Trip[] = [];
  // Hot food still to go: from when it should leave (one already late leaves now). Paid, or being paid for in the last
  // few minutes (so two guests can't both take the last driver's time while they pay).
  for (const d of waiting.docs) {
    const o: any = d.data() || {}; if (o.status === 'voided') continue;
    // (At one location: its own hot food to leave.)
    if (!atHere(o, at)) continue;
    const paying = !o.paidAt && o.ahead?.state === 'awaiting_pay' && now - (Date.parse(String(o.createdAt || '')) || 0) < PAYING_MS && (!skipCheckout || o.ahead?.checkout !== skipCheckout);
    if (!o.paidAt && !paying) continue;
    const leave = Date.parse(String(o.ahead?.slot || o.ahead?.at || '')); if (!Number.isFinite(leave)) continue;
    trips.push({ ...hotTrip(leave < now ? now : leave, Number(o.ahead.delivery.driveMin) || 0), hot: true });
  }
  // Out with a driver: each driver once, from when the first went out until they're back (their route's time, or the
  // drive back from the last stop's guess). A name the counter typed counts as a driver of its own.
  // (`named`: someone the counter typed by name, not one of the drivers: out, but taking no driver's place.)
  const byDriver = new Map<string, { from: number; to: number; stops: number; id: string | null; hot: boolean; shop: boolean; named: boolean }>();
  const join = (key: string, id: string | null, from: number, to: number, hot: boolean, named: boolean) => { const g = byDriver.get(key); if (g) { g.from = Math.min(g.from, from); g.to = Math.max(g.to, to); g.stops++; g.hot = g.hot || hot; g.shop = g.shop || !hot; } else byDriver.set(key, { from, to, stops: 1, id, hot, shop: !hot, named }); };
  for (const d of hotOut.docs) {
    const o: any = d.data() || {}; const del = o.ahead?.delivery || {};
    const out = Date.parse(String(del.outAt || '')) || now; const id = ID.test(String(del.driverId || '')) ? String(del.driverId) : null;
    // (At one location: out with one of its drivers, wherever from, or out from there.)
    if (at && !(id && set.has(id)) && !atHere(o, at)) continue;
    join(id ? `id:${id}` : `name:${String(del.driverName || d.id).toLowerCase()}`, id, out, hotTrip(out, Number(del.driveMin) || 0).to, true, !id && !!del.driverName);
  }
  for (const d of shopOut.docs) {
    const o: any = d.data() || {}; const del = o.delivery || {};
    const out = Date.parse(String(del.outAt || del.startedAt || '')) || now; const id = ID.test(String(del.driverId || '')) ? String(del.driverId) : null;
    if (at && !(id && set.has(id)) && !atHere(o, at)) continue;
    const t = shopTrip(out, 1, null, now); join(id ? `id:${id}` : `shop:${d.id}`, id, t.from, t.to, false, false);
  }
  // Their route's own time back, when it was planned (lib/route-server keeps it, for drivers on the team).
  const ids = Array.from(byDriver.values()).map((g) => g.id).filter((x): x is string => !!x).slice(0, 40);
  const kept = ids.length ? await db.getAll(...ids.map((id) => db.doc(`${T}/private/route_${id}`))).catch(() => []) : [];
  const backOf = new Map<string, number>();
  kept.forEach((s: any, i: number) => { const b = Date.parse(String(s?.data?.()?.view?.backAt || '')); if (Number.isFinite(b)) backOf.set(ids[i], b); });
  for (const g of byDriver.values()) {
    const back = g.id && backOf.has(g.id) ? backOf.get(g.id)! : null;
    trips.push({ from: g.from, to: Math.max(now + 60000, back ?? g.to, g.stops > 1 && back === null ? g.from + g.stops * 15 * 60000 : 0), hot: g.hot, shop: g.shop, driverId: g.id, ...(g.named || (g.id && !set.has(g.id)) ? { counts: false } : {}) });
  }
  const outs = trips.filter((x) => x.from <= now && now < x.to);
  const on = onShift(now);
  // (For shop delivery "within the hour", which counts its own runs: drivers out with hot food and no shop stop, who are
  // its drivers.)
  // Each driver: out (until their trip has them back), here (on the schedule now), or on later today.
  const today0 = todayIn(tz, new Date(now)); const w0 = wallParts(new Date(now), tz); const at0 = w0.hour * 60 + w0.minute;
  const each = drivers.map((id) => {
    const mine = trips.filter((x) => x.driverId === id && x.from <= now && now < x.to);
    if (mine.length) return { id, state: 'out' as const, backAt: new Date(Math.max(...mine.map((x) => x.to))).toISOString(), onAt: null };
    if (on?.includes(id)) return { id, state: 'free' as const, backAt: null, onAt: null };
    const later = spans.filter((x: any) => x.staffId === id && x.date === today0 && x.start > at0).sort((a: any, b: any) => a.start - b.start)[0];
    return later ? { id, state: 'later' as const, backAt: null, onAt: wallToUtc(today0, Math.floor(later.start / 60), later.start % 60, tz).toISOString() } : null;
  }).filter((x): x is NonNullable<typeof x> => !!x);
  return { onShift, trips, drivers: each, onNow: on === null ? null : on.length, outNow: outAt(trips, now), hotOutNow: outs.filter((x) => x.hot && !x.shop && x.counts !== false).length, backAt: outs.length ? new Date(Math.min(...outs.map((x) => x.to))).toISOString() : null };
}
