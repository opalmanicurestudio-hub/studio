// src/lib/driver-load.ts — DRIVERS, SHARED BY HOT FOOD AND SHOP DELIVERY (pure; design board "Drivers shared, and a pause
// for busy nights"). The business's drivers (the ones listed as drivers under Orders, Delivery) are one set of people:
// - Each hot food delivery keeps a driver out from when it should leave, for the drive there, a few minutes at the door,
//   and the drive back. A shop run out with a driver keeps them out until the route has them back.
// - A time is offered for hot food only when a driver on the schedule is free for the whole trip. With nobody on the
//   schedule as a driver (no shifts with a driver on them that day), there's no limit, as before.
// - The counter can slow new deliveries down: more minutes on their times, or a pause for a while or the rest of the day.
//   It ends by itself. Orders already placed keep their times; shop orders in a delivery window aren't changed.
//   tenants/{t}.deliveryNow = { pausedUntil, extraMin, extraUntil, by, at }

export const DOOR_MIN = 5;
/** A shop stop when the route has no time for it: about this long each. */
export const SHOP_STOP_MIN = 15;
export const EXTRA_CHOICES = [15, 30] as const;
export const PAUSE_CHOICES = [30, 60] as const;

/** A driver out (or about to be), from and to; `hot`: with hot food on it. `driverId`: which of the drivers (none: not
 *  given to one yet, so it keeps any one of them); `counts` false: someone who isn't one of the drivers took it; `shop`:
 *  with shop stops on it too. */
export type Trip = { from: number; to: number; hot?: boolean; shop?: boolean; driverId?: string | null; counts?: boolean };

/** A hot delivery's trip: from when it should leave, there and back, with a few minutes at the door. */
export function hotTrip(leaveMs: number, driveMin: number): Trip {
  const d = Math.max(1, Math.round(Number(driveMin) || 0));
  return { from: leaveMs, to: leaveMs + (2 * d + DOOR_MIN) * 60000 };
}

/** A shop run out with a driver: from when it went out until the route has them back (or about 15 minutes a stop). */
export function shopTrip(outMs: number, stops: number, backMs: number | null, now: number): Trip {
  const guess = outMs + Math.max(1, stops) * SHOP_STOP_MIN * 60000;
  return { from: Math.min(outMs, now), to: Math.max(now + 60000, backMs && Number.isFinite(backMs) ? backMs : guess) };
}

/** How many drivers are out at an instant. */
export const outAt = (trips: Trip[], t: number) => trips.filter((x) => x.from <= t && t < x.to).length;

/** Drivers free at an instant: on the schedule then and not out (one out who isn't on the schedule doesn't take anyone's
 *  place; one not given to anyone yet takes one). `on`: a count, or which drivers. */
export function freeAt(on: number | string[], trips: Trip[], t: number): number {
  const live = trips.filter((x) => x.from <= t && t < x.to && x.counts !== false);
  if (typeof on === 'number') return on - live.length;
  const ids = new Set(on);
  const busy = new Set(live.filter((x) => x.driverId && ids.has(x.driverId)).map((x) => x.driverId as string));
  const loose = live.filter((x) => !x.driverId).length;
  return ids.size - busy.size - loose;
}

/** Drivers free for a whole trip (the fewest free at any moment of it); null when the schedule has no drivers then (no
 *  limit). `onShift(t)`: the drivers on the schedule at t (a count, or which), null when nobody is on it as a driver. */
export function freeThrough(onShift: (t: number) => number | string[] | null, trips: Trip[], from: number, to: number): number | null {
  const pts = new Set<number>([from]);
  for (let t = from; t < to; t += 5 * 60000) pts.add(t);
  for (const x of trips) { if (x.from > from && x.from < to) pts.add(x.from); if (x.to > from && x.to < to) pts.add(x.to); }
  let least: number | null = null;
  for (const t of pts) {
    const on = onShift(t); if (on === null) continue;
    const free = freeAt(on, trips, t);
    least = least === null ? free : Math.min(least, free);
  }
  return least;
}

/** Of the times hot food could leave, the ones a driver can make (kept), and the ones that are full. */
export function drivableTimes(leaveIsos: string[], driveMin: number, onShift: (t: number) => number | string[] | null, trips: Trip[]): { ok: string[]; full: string[] } {
  const ok: string[] = [], full: string[] = [];
  for (const iso of leaveIsos) {
    const t = Date.parse(iso); if (!Number.isFinite(t)) continue;
    const tr = hotTrip(t, driveMin); const free = freeThrough(onShift, trips, tr.from, tr.to);
    (free === null || free > 0 ? ok : full).push(iso);
  }
  return { ok, full };
}

/** New deliveries slowed down from the counter: paused (until when), and minutes added to their times. Over by itself. */
export function deliveryNowOf(tenant: any, now = Date.now()): { paused: boolean; until: string | null; extraMin: number; extraUntil: string | null; by: string | null } {
  const d = tenant?.deliveryNow || {};
  const pu = Date.parse(String(d.pausedUntil || '')); const eu = Date.parse(String(d.extraUntil || ''));
  const paused = Number.isFinite(pu) && pu > now;
  const extra = Number.isFinite(eu) && eu > now && (EXTRA_CHOICES as readonly number[]).includes(Number(d.extraMin)) ? Number(d.extraMin) : 0;
  return { paused, until: paused ? new Date(pu).toISOString() : null, extraMin: extra, extraUntil: extra ? new Date(eu).toISOString() : null, by: typeof d.by === 'string' ? d.by.slice(0, 60) : null };
}
