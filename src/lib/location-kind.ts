// src/lib/location-kind.ts
//
// Pure helpers about location documents — no Firebase imports, so both the
// client (LocationContext) and admin API routes can use them.

export const DEFAULT_LOCATION_DOC_ID = 'primary';

/**
 * Is this document a BUSINESS location (a studio address), or something else
 * that happens to live in the same collection?
 *
 * The inventory page stores its STORAGE areas — stockroom, fridge, front
 * shelf — in tenants/{t}/locations too (ids "loc-…", with a locationTypeId).
 * Every business-location list read them as studios, so a studio with five
 * shelves appeared to have six locations. Business locations are created by
 * createLocation and always carry a timezone; storage areas carry a
 * locationTypeId and never a timezone.
 */
export function isBusinessLocation(x: any): boolean {
  if (!x) return false;
  if (x.locationTypeId) return false;
  return x.id === DEFAULT_LOCATION_DOC_ID || typeof x.timezone === 'string' || typeof x.isActive === 'boolean';
}

/** Name pattern the old provisioner used for its auto-created "Main Location". */
export function looksAutoProvisioned(x: any, tenantName?: string | null): boolean {
  const n = String(x?.name || '').trim();
  return n === 'Main Location' || (!!tenantName && n === `${tenantName} — Main Location`) || / — Main Location$/.test(n);
}
