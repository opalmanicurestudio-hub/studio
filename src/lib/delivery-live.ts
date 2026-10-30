// src/lib/delivery-live.ts — A DELIVERY ON ITS WAY, LIVE (pure). Mockup 1C: the customer's order page shows roughly where
// the driver is (only while their order is out, and only while the driver shares it), when it should arrive, how many
// stops are before theirs, and who is bringing it. Read by the driver's location updates (api/retail/driver-location),
// the order page (api/retail/order-status) and its map (api/retail/delivery-map).
//   · The driver's route, as their app has it (lib/delivery-run runFor), is kept with their last location, with an
//     arrival estimate for each stop: the drive from where they are, stop to stop, plus a few minutes at each door.
//   · Shown to the customer rounded (about a city block), and never once it's delivered or older than a few minutes.
//   · A driver within about half a mile of the next stop: the customer is texted that they're a few minutes away.
import { milesBetween } from '@/lib/delivery-plan';
import { wallParts } from '@/lib/tenant-time';

export type LatLng = { lat: number; lng: number };
export type StopEta = { from: string; to: string };

/** Minutes at each door before the next drive. */
export const DOOR_MINUTES = 4;
/** A stop on the way whose place isn't on the map: this long for it, and the next drive is from where it was before. */
export const UNKNOWN_STOP_MINUTES = 12;
/** Town driving: straight-line miles are about this much longer by road, at about this speed. */
const ROAD_FACTOR = 1.35; const MPH = 22;
/** The arrival estimate is a range this wide. */
export const RANGE_MINUTES = 20;
/** Close enough to the next stop to tell the customer the driver is a few minutes away. */
export const NEAR_MILES = 0.6;
/** A location older than this isn't shown, and doesn't move anything. */
export const FRESH_MS = 3 * 60e3;
/** A fix from the phone older than this when it reaches the server isn't where the driver is now. */
export const FIX_MAX_AGE_MS = 60e3;
/** A fix less sure than this (in meters) doesn't count as near a stop. */
export const NEAR_ACCURACY_M = 300;
/** Just out of the shop: not yet "a few minutes away", even from a stop close by (the "on its way" text was just sent). */
export const NEAR_AFTER_OUT_MS = 3 * 60e3;
/** How often the driver's app sends where they are. */
export const SEND_EVERY_MS = 30e3;

export const okPoint = (p: any): p is LatLng => !!p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) && Math.abs(Number(p.lat)) <= 90 && Math.abs(Number(p.lng)) <= 180 && !(Number(p.lat) === 0 && Number(p.lng) === 0);

/** About a city block: what the customer sees of where the driver is. */
export const roughly = (p: LatLng): LatLng => ({ lat: Math.round(p.lat * 1000) / 1000, lng: Math.round(p.lng * 1000) / 1000 });

const round5 = (ms: number, up: boolean) => { const step = 5 * 60e3; return (up ? Math.ceil(ms / step) : Math.floor(ms / step)) * step; };

/** Minutes to drive between two places (straight line, made road-like). */
export const driveMinutes = (a: LatLng, b: LatLng): number => (milesBetween(a, b) * ROAD_FACTOR / MPH) * 60;

/**
 * When each stop on the route should be reached, in order: from where the driver is now, each drive plus the doors
 * before it. Only from a real location: a guess without one would slide later on every look, so then there's none
 * (the order page shows the delivery window instead). A stop without a place on the map gets none either, and counts
 * a set time on the way to the ones after it.
 */
export function routeEtas(now: number, from: LatLng | null, stops: { id: string; dest: LatLng | null }[]): Record<string, StopEta> {
  const out: Record<string, StopEta> = {};
  if (!from) return out;
  let at = now; let here: LatLng = from;
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    const door = (i > 0 ? DOOR_MINUTES : 0) * 60e3;
    if (!s.dest) { at += door + UNKNOWN_STOP_MINUTES * 60e3; continue; }
    at += door + Math.max(2, driveMinutes(here, s.dest)) * 60e3;
    const lo = Math.max(round5(at, false), round5(now, true));
    out[s.id] = { from: new Date(lo).toISOString(), to: new Date(lo + RANGE_MINUTES * 60e3).toISOString() };
    here = s.dest;
  }
  return out;
}

/** The driver is a few minutes from the stop. */
export const isNear = (at: LatLng | null, dest: LatLng | null): boolean => !!at && !!dest && milesBetween(at, dest) <= NEAR_MILES;

/** How many stops come before this order on the driver's route (null when it isn't on it). */
export function stopsBefore(stops: string[], orderId: string): number | null {
  const i = (stops || []).indexOf(orderId);
  return i < 0 ? null : i;
}

/** "2 stops before yours", "You’re next". */
export function stopsWords(n: number | null): string {
  if (n === null) return '';
  return n === 0 ? 'You’re next' : `${n} stop${n === 1 ? '' : 's'} before yours`;
}

/** "Updated just now", "Updated 3 min ago". */
export function updatedWords(at: string | null | undefined, now = Date.now()): string {
  const t = Date.parse(String(at || '')); if (!Number.isFinite(t)) return '';
  const m = Math.max(0, Math.round((now - t) / 60e3));
  return m < 1 ? 'Updated just now' : `Updated ${m} min ago`;
}

const hm = (ms: number, tz: string) => { const p = wallParts(new Date(ms), tz); const h = p.hour % 12 === 0 ? 12 : p.hour % 12; return { t: `${h}:${String(p.minute).padStart(2, '0')}`, ap: p.hour < 12 ? 'am' : 'pm' }; };

/** "5:20 to 5:40 pm", "11:50 am to 12:10 pm", on the shop's clock. */
export function rangeWords(eta: StopEta | null | undefined, tz: string): string {
  const a = Date.parse(String(eta?.from || '')), b = Date.parse(String(eta?.to || ''));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return '';
  const x = hm(a, tz), y = hm(b, tz);
  return x.ap === y.ap ? `${x.t} to ${y.t} ${y.ap}` : `${x.t} ${x.ap} to ${y.t} ${y.ap}`;
}
