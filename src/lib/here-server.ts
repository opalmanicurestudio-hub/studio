// src/lib/here-server.ts — WHICH LOCATION A QUICK-SERVICE SCREEN IS AT (server; design board "More than one location").
// A business with one location: none, and everything works as before. With several (Settings, Locations; each one past
// the first on the subscription), each screen is set up for one (kitchenScreens/{h}.locationId: a lane, the kitchen, a
// kiosk, the order board), and a team member signed in on their own device is at the location picked in the app's
// location switcher. Orders, cars and kitchen tickets are stamped with it (lib/counter-server createCar, sendOrder), and
// each screen shows only its own (lib/business-locations atHere).
import { businessLocations } from '@/lib/business-locations';
import { tenantTimeZone } from '@/lib/tenant-time';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
/** `ordering` (lib/ahead-places): whether guests order ahead from it and it delivers (both on unless turned off for it),
 *  whether it's a store on the online shop (lib/shop-stores-server; on unless turned off), and its own opening hours
 *  (null: the business's). */
export type BizLocation = { id: string; name: string; address: string | null; coordinates: { lat: number; lng: number } | null; timezone: string | null;
  /** Its time zone was picked by the owner (lib/here-server zoneOf), not left on the old default. */
  zoneSure?: boolean;
  ordering: { ahead: boolean; delivery: boolean; shop: boolean; hours: Record<string, any> | null } };

/** The business's own locations (not storage areas), read at most once a minute per business. `fresh` reads them now
 *  (placing an order), and the minute's copy is brought up to date with them. */
const cache = new Map<string, { at: number; list: BizLocation[] }>();
export async function bizLocationsOf(db: any, tenantId: string, now = Date.now(), fresh = false): Promise<BizLocation[]> {
  const c = cache.get(tenantId); if (c && !fresh && now - c.at < 60000) return c.list;
  const snap = await db.collection(`tenants/${tenantId}/locations`).get().catch(() => null);
  if (!snap) return c?.list || [];
  const list: BizLocation[] = businessLocations(snap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })))
    .map((l: any) => ({ id: String(l.id), name: String(l.name || 'Location').slice(0, 80), address: l.address ? String(l.address).slice(0, 300) : null,
      coordinates: l.coordinates && Number.isFinite(Number(l.coordinates.lat)) && Number.isFinite(Number(l.coordinates.lng)) ? { lat: Number(l.coordinates.lat), lng: Number(l.coordinates.lng) } : null,
      timezone: l.timezone ? String(l.timezone) : null, zoneSure: l.timezoneSure === true,
      ordering: { ahead: l.ordering?.aheadOff !== true, delivery: l.ordering?.deliveryOff !== true, shop: l.ordering?.shopOff !== true, hours: l.ordering?.hours && typeof l.ordering.hours === 'object' ? l.ordering.hours : null } }))
    .sort((a, b) => a.name.localeCompare(b.name));
  cache.set(tenantId, { at: now, list }); if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  return list;
}
/**
 * A location's own time zone (Settings, Locations), when it's other than the business's: ordering ahead from it, its
 * pickup times, its codes and its screens all run on it. (Locations made before a new one started on the business's
 * time zone kept "America/New_York" as a default, so that one counts only once the owner has said it's right: the
 * location cards ask, `zoneAsk`.)
 */
export function zoneOf(tenant: any, loc: { timezone?: string | null; zoneSure?: boolean } | null | undefined): string {
  const house = tenantTimeZone(tenant);
  if (!loc?.timezone) return house;
  const own = tenantTimeZone(tenant, { timezone: loc.timezone });
  if (own === house) return house;
  if (own === 'America/New_York' && loc.zoneSure !== true) return house;
  return own;
}
/** A time zone kept on a location that isn't used until the owner says it's right (the old default): to ask them. */
export function zoneToAsk(tenant: any, loc: { timezone?: string | null; zoneSure?: boolean } | null | undefined): string | null {
  if (!loc?.timezone) return null;
  const own = tenantTimeZone(tenant, { timezone: loc.timezone });
  return own !== tenantTimeZone(tenant) && zoneOf(tenant, loc) !== own ? own : null;
}
/** The business as one location sees it: the same, on that location's own clock when it keeps one. */
export function zonedFor<T = any>(tenant: T, loc: Parameters<typeof zoneOf>[1]): T {
  const z = zoneOf(tenant, loc);
  return z === tenantTimeZone(tenant) ? tenant : ({ ...(tenant as any), timezone: z } as T);
}
/** The same for a screen's location (lib/here-server hereFor), by its id. */
export async function zonedHere<T = any>(db: any, tenantId: string, tenant: T, here: string | null | undefined): Promise<T> {
  if (!here) return tenant;
  return zonedFor(tenant, (await bizLocationsOf(db, tenantId)).find((l) => l.id === here) || null);
}

/** A location was added, changed or closed: read again. */
export const forgetLocations = (tenantId: string) => { cache.delete(tenantId); };

/** The location asked for, when the business has more than one and it's one of them; otherwise none (everything shows). */
export async function hereOf(db: any, tenantId: string, want: unknown): Promise<string | null> {
  const id = String(want || ''); if (!ID.test(id)) return null;
  const list = await bizLocationsOf(db, tenantId);
  return list.length > 1 && list.some((l) => l.id === id) ? id : null;
}

/** Whether the business has more than one location (screens and pages ask which one). */
export const severalLocations = async (db: any, tenantId: string) => (await bizLocationsOf(db, tenantId)).length > 1;

/** Where a screen or a team member is now: a tablet's own location (only while it's still one of the business's, with
 *  more than one); signed in on a device, the one picked in the app, or else the one location they work at. */
export async function hereFor(db: any, tenantId: string, o: { screen?: { ref?: any; locationId?: string | null } | null; asked?: unknown; memberId?: string | null }): Promise<string | null> {
  if (o.screen?.ref) return o.screen.locationId ? hereOf(db, tenantId, o.screen.locationId) : null;
  const asked = await hereOf(db, tenantId, o.asked); if (asked) return asked;
  if (!o.memberId || !ID.test(o.memberId) || !(await severalLocations(db, tenantId))) return null;
  const me: any = (await db.doc(`tenants/${tenantId}/staff/${o.memberId}`).get().catch(() => null))?.data?.();
  const ids: string[] = Array.isArray(me?.locationIds) ? me.locationIds.filter(Boolean) : [];
  return ids.length === 1 ? hereOf(db, tenantId, ids[0]) : null;
}

/** A location closed: tablets set up for it show every location's again, until a manager picks one. Merged into another
 *  (`to`): they move with it. */
export async function unplaceScreens(db: any, tenantId: string, locationId: string, to: string | null = null): Promise<number> {
  const snap = await db.collection('kitchenScreens').where('tenantId', '==', tenantId).get().catch(() => ({ docs: [] as any[] }));
  const at = snap.docs.filter((d: any) => (d.data() || {}).locationId === locationId);
  for (const d of at) await d.ref.set({ locationId: to && ID.test(to) ? to : null }, { merge: true }).catch(() => null);
  forgetLocations(tenantId);
  return at.length;
}
