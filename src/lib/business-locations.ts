// src/lib/business-locations.ts — which location a person, visit or walk-in belongs to.
// Business locations share the `locations` collection with inventory storage areas; theirs have no locationTypeId.
// A team member with no locations set works at all of them. A visit's location is the one saved on it, otherwise its
// provider's (when they work at exactly one), otherwise the business's only location. Anything we can't place is
// shown at every location rather than hidden.

export function businessLocations(locs: any[] | null | undefined): any[] {
  return (locs || []).filter((l: any) => l && l.isActive !== false && !l.locationTypeId);
}

export function worksAt(person: any, locationId: string | null | undefined): boolean {
  if (!locationId) return true;
  const ids: string[] = Array.isArray(person?.locationIds) ? person.locationIds.filter(Boolean) : [];
  return ids.length === 0 || ids.includes(locationId);
}

export function locationOf(rec: any, staff: any[], locs: any[]): string | null {
  if (rec?.locationId) return String(rec.locationId);
  const sid = rec?.staffId || rec?.assignedStaffId || null;
  const person = sid ? (staff || []).find((s: any) => s?.id === sid) : null;
  const ids: string[] = Array.isArray(person?.locationIds) ? person.locationIds.filter(Boolean) : [];
  if (ids.length === 1) return ids[0];
  const biz = businessLocations(locs);
  return biz.length === 1 ? String(biz[0].id) : null;
}

/** Shown when filtering to `locationId`: placed there, or not placed anywhere yet. */
export function atLocation(rec: any, staff: any[], locs: any[], locationId: string | null | undefined): boolean {
  if (!locationId) return true;
  const at = locationOf(rec, staff, locs);
  return at === null || at === locationId;
}

/** The one location a person works at, if just one — used to stamp new visits and walk-ins. */
export function homeLocation(person: any): string | null {
  const ids: string[] = Array.isArray(person?.locationIds) ? person.locationIds.filter(Boolean) : [];
  return ids.length === 1 ? ids[0] : null;
}

/** For the quick-service screens (the counter, a lane, the kitchen, the ready board): whether something belongs at the
 *  location a screen is set up for. No location (one location only, or a screen not set up for one) shows everything;
 *  something not stamped with a location (made before there were several) shows at every one. */
export function atHere(rec: any, here: string | null | undefined): boolean {
  return !here || !rec?.locationId || String(rec.locationId) === here;
}

/** The key a day's order numbers and pickup codes are kept under: each location counts its own ("C1" at each). */
export const dayKey = (day: string, here: string | null | undefined) => (here ? `${day}_${here}` : day);
