// src/lib/locate-server.ts — A LOCATION FINDS ITS OWN PLACE ON THE MAP (design board "Each store runs on its own").
// A business location with an address but no pin (Settings, Locations) is looked up from its address once, the first
// time its settings are opened (Menu page, Order ahead; Shop settings, Your stores) or when it's made, so nearest first,
// delivery from it, and the arrival check work without a trip to Settings. Each address is looked up once (kept as
// `geoTriedFor`): one that isn't found says so, and asks for the address to be checked. A pin found this way follows
// its address: the address changed, it's looked up again (the old pin kept until a new one is found; not found, it's
// taken off, never left at the old place). A pin set by hand is never changed. Nothing happens without the maps service.
import { businessLocations } from '@/lib/business-locations';
import { geocode, hasMapsKey, preciseEnough } from '@/lib/geocode-server';
import { forgetLocations } from '@/lib/here-server';

const pinned = (c: any) => !!c && Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lng)) && !(Number(c.lat) === 0 && Number(c.lng) === 0);
const addressOf = (l: any) => String(l?.address || '').replace(/\s+/g, ' ').trim().slice(0, 300);

/** Where each location stands on the map: on it, not found from its address, no address yet, or not looked up yet. */
export type MapState = 'on' | 'missed' | 'no_address' | 'not_yet';
export function mapStateOf(l: any): MapState {
  const a = addressOf(l);
  // (Found from an address that's since changed: looked up again.)
  if (pinned(l?.coordinates)) return l?.coordinatesSource === 'address' && a && l?.geoTriedFor !== a ? 'not_yet' : 'on';
  if (!a) return 'no_address';
  return l?.geoTriedFor === a ? 'missed' : 'not_yet';
}

/** Looks up the business locations with an address and no pin (a few at a time), and keeps what's found. Each address
 *  is claimed first, so two pages opened at once never both pay for it. Returns each location's state after. */
export async function locateMissing(db: any, tenantId: string, limit = 3): Promise<Record<string, MapState>> {
  const snap = await db.collection(`tenants/${tenantId}/locations`).get().catch(() => null);
  if (!snap) return {};
  const locs = businessLocations(snap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })));
  const out: Record<string, MapState> = Object.fromEntries(locs.map((l: any) => [String(l.id), mapStateOf(l)]));
  if (!hasMapsKey()) return out;
  const due = locs.filter((l: any) => out[String(l.id)] === 'not_yet').slice(0, limit);
  let changed = false;
  await Promise.all(due.map(async (l: any) => {
    const ref = db.doc(`tenants/${tenantId}/locations/${l.id}`); const a = addressOf(l);
    const mine = await db.runTransaction(async (tx: any) => {
      const cur: any = (await tx.get(ref)).data() || {};
      if ((pinned(cur.coordinates) && cur.coordinatesSource !== 'address') || cur.geoTriedFor === a) return false;
      tx.update(ref, { geoTriedFor: a });
      return true;
    }).catch(() => false);
    if (!mine) return;
    const g = await geocode(a).catch(() => 'down' as const);
    // (The map service down: tried again next time.)
    if (g === 'down') { await ref.update({ geoTriedFor: null }).catch(() => {}); return; }
    if (preciseEnough(g)) {
      await ref.update({ coordinates: { lat: g.lat, lng: g.lng }, coordinatesSource: 'address', updatedAt: new Date().toISOString() }).catch(() => {});
      out[String(l.id)] = 'on'; changed = true;
    } else {
      // (A pin found from the old address isn't left at the old place.)
      if (l.coordinatesSource === 'address') { await ref.update({ coordinates: null, coordinatesSource: null, updatedAt: new Date().toISOString() }).catch(() => {}); changed = true; }
      out[String(l.id)] = 'missed';
    }
  }));
  if (changed) forgetLocations(tenantId);
  return out;
}
