// src/lib/ahead-places.ts — ORDERING AHEAD FROM MORE THAN ONE LOCATION (pure; design board "More than one location").
// With more than one location, guests pick where from (nearest first, once they share where they are), each location
// takes orders ahead and delivers unless that's turned off for it (Menu page, Order ahead, Your locations), with its own
// opening hours or the business's. A delivery goes from the nearest location that delivers there. One location: none of
// this, and the page works as before.
import { windowOn } from '@/lib/ahead-hours';
import { addDays, todayIn } from '@/lib/tenant-time';

export type Place = { id: string; name: string; address: string | null; coordinates: { lat: number; lng: number } | null; ordering: { ahead: boolean; delivery: boolean; hours: Record<string, any> | null } };

/** Straight-line miles between two points (for "nearest first"; the drive is worked out from the delivery zones). */
export function milesApart(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = (d: number) => (d * Math.PI) / 180; const R = 3958.8;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A point a guest's phone gave, if it's one. */
export function pointOf(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const a = Number(lat), b = Number(lng);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180 && (a !== 0 || b !== 0) ? { lat: a, lng: b } : null;
}

/** Nearest first from a point (those without a pin last, by name); without a point, by name. */
export function nearestFirst<T extends { name: string; coordinates: { lat: number; lng: number } | null }>(list: T[], from: { lat: number; lng: number } | null): (T & { miles: number | null })[] {
  return list.map((p) => ({ ...p, miles: from && p.coordinates ? Math.round(milesApart(from, p.coordinates) * 10) / 10 : null }))
    .sort((a, b) => (a.miles === null ? 1 : 0) - (b.miles === null ? 1 : 0) || (a.miles ?? 0) - (b.miles ?? 0) || a.name.localeCompare(b.name));
}

/** A location's week: its own hours, or the business's. */
export const weekOf = (p: Pick<Place, 'ordering'> | null | undefined, house: Record<string, any> | null) => p?.ordering?.hours || house;

/** What a guest sees of a location on the picker: open now and until when, or when it opens next (within a week). */
export function openWords(week: Record<string, any> | null, tz: string, now: number): { open: boolean; until: string | null; opens: string | null } {
  if (!week) return { open: true, until: null, opens: null };
  const today = todayIn(tz, new Date(now));
  for (const d of [addDays(today, -1), today]) { const w = windowOn(week, d, tz); if (w && now >= w.open && now < w.close) return { open: true, until: new Date(w.close).toISOString(), opens: null }; }
  for (let i = 0; i <= 7; i++) { const w = windowOn(week, addDays(today, i), tz); if (w && w.open > now) return { open: false, until: null, opens: new Date(w.open).toISOString() }; }
  return { open: false, until: null, opens: null };
}

/** A week as typed on the Menu page: each day open (with its opening and closing, "9:00 AM") or closed; null if it isn't one. */
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const CLOCK = /^(1[0-2]|[1-9]):[0-5]\d (AM|PM)$/;
export function cleanWeek(v: unknown): Record<string, { enabled: boolean; start: string; end: string }> | null {
  if (!v || typeof v !== 'object') return null;
  const out: Record<string, { enabled: boolean; start: string; end: string }> = {};
  for (const d of DAYS) {
    const x: any = (v as any)[d] || {};
    const start = String(x.start || '9:00 AM'), end = String(x.end || '5:00 PM');
    if (!CLOCK.test(start) || !CLOCK.test(end)) return null;
    out[d] = { enabled: x.enabled === true, start, end };
  }
  return out;
}
