// src/lib/pickup-geo.ts — WHERE PICKUPS HAPPEN, as a point on the map: the curbside spot the shop pinned
// (retailSettings.curbsideLat/Lng), else the business's one location with coordinates, else its studio location. Null when
// there's no single answer (two pinned locations would be a guess, and a guess sends someone to the wrong building).
// Used by the shop's order page (api/retail/order-status) and by café orders placed ahead for curbside (lib/counter-ahead)
// to say how far away someone is, and to check them in once they pull in (CURBSIDE_GEOFENCE_M, while their page is open).
const usable = (lat: any, lng: any) => {
  const a = Number(lat); const b = Number(lng);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180 && (a !== 0 || b !== 0) ? { lat: a, lng: b } : null;
};

// A guest's page asks every few seconds while they're on their way: the locations are read at most once a minute per
// business (locations rarely move; a new one is picked up within the minute).
const pins = new Map<string, { at: number; pinned: { lat: number; lng: number }[] }>();
export const forgetPickupGeo = (tenantId?: string) => { if (tenantId) pins.delete(tenantId); else pins.clear(); };

export async function pickupGeoOf(db: any, tenantId: string, tenant: any): Promise<{ lat: number; lng: number } | null> {
  const explicit = usable(tenant?.retailSettings?.curbsideLat, tenant?.retailSettings?.curbsideLng);
  if (explicit) return explicit;
  try {
    let hit = pins.get(tenantId);
    if (!hit || Date.now() - hit.at > 60000) {
      const locSnap = await db.collection(`tenants/${tenantId}/locations`).get();
      hit = { at: Date.now(), pinned: locSnap.docs.map((d: any) => d.data() as any).filter((l: any) => l?.isActive !== false).map((l: any) => usable(l?.coordinates?.lat, l?.coordinates?.lng)).filter(Boolean) };
      pins.set(tenantId, hit); if (pins.size > 500) pins.delete(pins.keys().next().value as string);
    }
    if (hit.pinned.length === 1) return hit.pinned[0];
  } catch { /* a locations read failing must never break the page */ }
  return usable(tenant?.studioLocation?.lat, tenant?.studioLocation?.lng);
}
