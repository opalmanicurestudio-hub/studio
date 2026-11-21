// src/lib/shop-stores-server.ts — THE ONLINE SHOP AT MORE THAN ONE STORE (design board "The online shop at more than one
// store"; lib/shop-stores). With two or more locations, each one on the shop (Shop settings, Your stores) is a store: on
// the Find a store page, a pickup choice at checkout (nearest first), and where a delivery comes from (the nearest that
// delivers there, measured from its own address). One location: no stores, and checkout works as before.
import { bizLocationsOf, type BizLocation } from '@/lib/here-server';
import { aheadWeek } from '@/lib/ahead-hours-server';
import { nearestFirst, openWords, pointOf, weekOf } from '@/lib/ahead-places';
import { geocode } from '@/lib/geocode-server';
import { tenantTimeZone } from '@/lib/tenant-time';
import { directionsTo, type StoreRow } from '@/lib/shop-stores';
import type { DeliveryAddress, DeliveryView } from '@/lib/delivery-server';

/** Whether the business has several locations, and the ones on the shop (several and none: no store to pick, so no
 *  pickup). `fresh` reads them again rather than from the minute's copy (placing an order). */
export async function shopStoresOf(db: any, tenantId: string, fresh = false): Promise<{ several: boolean; stores: BizLocation[] }> {
  const all = await bizLocationsOf(db, tenantId, Date.now(), fresh);
  return { several: all.length > 1, stores: all.length > 1 ? all.filter((l) => l.ordering.shop) : [] };
}

/** A store's opening hours: its own, or the business's (null: none set). Pickup times stay inside them, and the Find a
 *  store page says open or closed by them. */
export async function storeWeekOf(db: any, tenantId: string, store: BizLocation): Promise<Record<string, any> | null> {
  return weekOf(store, await aheadWeek(db, tenantId));
}

/** The store asked for, if it's one; with only one on the shop, that one (nothing to pick). */
export const pickedStore = (stores: BizLocation[], want: unknown) => stores.find((s) => s.id === String(want || '')) || (stores.length === 1 ? stores[0] : null);

/** What a customer sees of each store: where it is, open now and until when (or when it opens), and directions. */
export async function storeRows(db: any, tenantId: string, tenant: any, stores: BizLocation[], now = Date.now()): Promise<StoreRow[]> {
  const house = await aheadWeek(db, tenantId, now); const tz = tenantTimeZone(tenant);
  return stores.map((s) => ({ id: s.id, name: s.name, address: s.address, lat: s.coordinates?.lat ?? null, lng: s.coordinates?.lng ?? null, delivers: s.ordering.delivery && !!s.coordinates,
    directions: s.address ? directionsTo(s.address) : null, ...openWords(weekOf(s, house), tz, now) }));
}

const NO_STORE: DeliveryView = { ok: false, reason: 'off', message: 'None of our stores deliver right now. Choose another way to get your order.' };

/**
 * A delivery from more than one store: from the nearest that delivers there (the address looked up once; when it can't
 * be, by name), trying the next when one doesn't reach it. Placing the order passes `hint`, the store the customer's
 * check said: only that one is asked (its signed distance kept), and if it no longer delivers there, `changed` (they
 * check the address again; it's never swapped for another without them seeing the new fee).
 */
export async function storeDelivery(db: any, tenantId: string, tenant: any, address: DeliveryAddress, opts: { itemsCents: number; token?: unknown; now?: number; sameCheckout?: string; hint?: unknown }, stores: BizLocation[]):
  Promise<{ v: DeliveryView; from: BizLocation | null; changed?: boolean }> {
  const { deliveryFor } = await import('@/lib/delivery-server');
  const ask = (s: BizLocation) => deliveryFor(db, tenantId, tenant, address, { itemsCents: opts.itemsCents, now: opts.now, sameCheckout: opts.sameCheckout, token: opts.token, origin: s.coordinates });
  const deliverers = stores.filter((s) => s.ordering.delivery);
  if (!deliverers.length) return { v: NO_STORE, from: null, ...(opts.hint ? { changed: true } : {}) };
  const can = deliverers.filter((s) => s.coordinates);
  if (!can.length) {
    // None located on the map yet (Settings, Locations): from the shop's own starting point, as with one store.
    const only = deliverers.length === 1 ? deliverers[0] : null;
    if (opts.hint && String(opts.hint) !== only?.id) return { v: NO_STORE, from: null, changed: true };
    return { v: await deliveryFor(db, tenantId, tenant, address, { itemsCents: opts.itemsCents, now: opts.now, sameCheckout: opts.sameCheckout, token: opts.token }), from: only };
  }
  if (opts.hint) {
    const h = can.find((s) => s.id === String(opts.hint));
    if (!h) return { v: NO_STORE, from: null, changed: true };
    const v = await ask(h);
    return !v.ok && (v.reason === 'outside' || v.reason === 'off') ? { v, from: null, changed: true } : { v, from: h };
  }
  const g = await geocode([address.line1, address.city, `${address.state} ${address.postalCode}`].join(', ')).catch(() => null);
  const pt = g && g !== 'down' ? pointOf((g as any).lat, (g as any).lng) : null;
  let last: { v: DeliveryView; from: BizLocation | null } | null = null;
  for (const s of nearestFirst(can, pt).slice(0, 5)) {
    const v = await ask(s);
    if (v.ok) return { v, from: s };
    if (!last || (last.v.ok === false && last.v.reason === 'outside' && v.reason !== 'outside')) last = { v, from: null };
    // (Not found on the map, the map down, or the address not complete: no other store would do better.)
    if (v.reason === 'unavailable' || v.reason === 'not_found' || v.reason === 'incomplete' || v.reason === 'off') break;
  }
  return last || { v: NO_STORE, from: null };
}
