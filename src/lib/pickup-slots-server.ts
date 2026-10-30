// src/lib/pickup-slots-server.ts — THE SHOP'S PICKUP WINDOWS, LIVE (server; the rules are in lib/pickup-slots).
// Counts the orders already in each window and, when the shop sizes windows by who's working, the people on shift in
// each. Checkout reads the windows to offer them; placing an order checks the chosen window against the same answer
// and counts it again in the transaction that writes the order, so two customers can't both take the last place.
// A shop whose time zone was never set gets no times (its hours would land hours off), and checkout stays as before.
import { createHash } from 'crypto';
import { dayKey, hasTimeZone, tenantTimeZone, todayIn, wallParts } from '@/lib/tenant-time';
import { cleanPlan, hasHours, pickupWindows, readyBy, noPickupReason, type PickupPlan, type PickupWindow } from '@/lib/pickup-slots';

/**
 * An order still holding its place: anything not cancelled. A checkout still being paid for holds it for an hour (its
 * payment link lasts 31 minutes; the hour covers a payment whose notice is late), unless it was the same customer's
 * earlier try at this same checkout (`sameCheckout`), which a new try replaces.
 */
export const checkoutSlotHash = (tenantId: string, ckey: string) => (ckey ? createHash('sha256').update(`slot:${tenantId}:${ckey}`).digest('hex').slice(0, 24) : '');

export function holdsPlace(o: any, now: number, sameCheckout = ''): boolean {
  const st = String(o?.stage || '');
  if (st === 'cancelled') return false;
  if (st === 'placed') {
    if (sameCheckout && String(o?.checkoutKeyHash || '') === sameCheckout) return false;
    return now - (Date.parse(String(o?.placedAt || '')) || 0) < 60 * 60e3;
  }
  return true;
}

const minsOf = (hm: string) => { const m = /^(\d{2}):(\d{2})$/.exec(String(hm || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };

/**
 * People on shift through a window: the fewest working at any moment of it, so staggered cover (one until 1, another
 * from 1) still counts as one person. A day with no shifts published at all isn't sized by people (null): the
 * shop's own limit applies, rather than every window looking full.
 */
export function peopleThrough(shifts: { staffId: string; start: number; end: number }[], ws: number, we: number): number | null {
  if (!shifts.length) return null;
  const points = [ws, ...shifts.flatMap((s) => [s.start, s.end]).filter((x) => x > ws && x < we)];
  let least = Infinity;
  for (const pt of points) least = Math.min(least, new Set(shifts.filter((s) => s.start <= pt && s.end > pt).map((s) => s.staffId)).size);
  return least === Infinity ? 0 : least;
}

export async function shiftCounter(db: any, tenantId: string, tz: string, days: string[]): Promise<(startMs: number, endMs: number) => number | null> {
  if (!days.length) return () => null;
  const snap = await db.collection(`tenants/${tenantId}/shifts`).where('date', '>=', days[0]).where('date', '<=', days[days.length - 1]).orderBy('date').limit(3000).get();
  const byDay = new Map<string, { staffId: string; start: number; end: number }[]>();
  for (const d of snap.docs) {
    const s: any = d.data() || {};
    if (['cancelled', 'draft'].includes(String(s.status || '')) || (s.kind && s.kind !== 'work')) continue;
    const start = minsOf(s.startTime), end = minsOf(s.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const list = byDay.get(String(s.date)) || []; list.push({ staffId: String(s.staffId || d.id), start, end }); byDay.set(String(s.date), list);
  }
  return (startMs: number, endMs: number) => {
    const a = wallParts(new Date(startMs), tz), b = wallParts(new Date(endMs), tz);
    const ws = a.hour * 60 + a.minute, we = b.hour * 60 + b.minute || 24 * 60;
    return peopleThrough(byDay.get(dayKey(new Date(startMs), tz)) || [], ws, we);
  };
}

/** Orders already in each window over the days offered, by window key (not counting `sameCheckout`'s own earlier try). */
export async function bookedFrom(db: any, tenantId: string, firstDay: string, lastDay: string, now: number, sameCheckout = ''): Promise<Record<string, number>> {
  const snap = await db.collection(`tenants/${tenantId}/retailOrders`).where('pickupWindowKey', '>=', firstDay).where('pickupWindowKey', '<=', `${lastDay}~`).limit(5000).get();
  const out: Record<string, number> = {};
  for (const d of snap.docs) { const o: any = d.data() || {}; if (holdsPlace(o, now, sameCheckout)) out[String(o.pickupWindowKey)] = (out[String(o.pickupWindowKey)] || 0) + 1; }
  return out;
}

export type ShopPickup = { scheduled: boolean; windows: PickupWindow[]; readyBy: string | null; reason: string | null };

/** What checkout shows for collecting an order: the windows, when it can be ready, or why there are none. */
export async function shopPickup(db: any, tenantId: string, tenant: any, now = Date.now(), sameCheckout = ''): Promise<{ plan: PickupPlan; view: ShopPickup; booked: Record<string, number> }> {
  const rs = tenant?.retailSettings || {};
  const plan = cleanPlan({ ...(rs.pickupPlan || {}), prepMinutes: rs.pickupPlan?.prepMinutes ?? rs.prepMinutes ?? 60 });
  if (!hasHours(plan) || !hasTimeZone(tenant)) {
    if (hasHours(plan)) console.warn('[pickup-slots] hours set but no time zone', tenantId);
    return { plan, booked: {}, view: { scheduled: false, windows: [], readyBy: null, reason: null } };
  }
  const tz = tenantTimeZone(tenant);
  const today = todayIn(tz, new Date(now));
  const days = Array.from({ length: plan.daysAhead }, (_, i) => new Date(Date.parse(`${today}T12:00:00Z`) + i * 864e5).toISOString().slice(0, 10));
  const [booked, onShift] = await Promise.all([bookedFrom(db, tenantId, days[0], days[days.length - 1], now, sameCheckout), plan.perPerson !== null ? shiftCounter(db, tenantId, tz, days) : Promise.resolve(undefined)]);
  const windows = pickupWindows(plan, now, tz, booked, onShift);
  const rb = readyBy(plan, now, tz, windows);
  const open = windows.some((w) => !w.full);
  return { plan, booked, view: { scheduled: true, windows, readyBy: rb?.label || null, reason: open ? null : noPickupReason(plan, now, tz) } };
}

/**
 * Placing an order: the chosen window, from the answer the caller already worked out. Returns the window and its
 * whole size (what's left plus what's booked), which the transaction counts against.
 */
export function chosenWindow(view: ShopPickup, booked: Record<string, number>, key: string): { ok: true; window: PickupWindow; cap: number | null } | { ok: false; error: string } {
  const w = view.windows.find((x) => x.key === key);
  if (!w) return { ok: false, error: view.reason || 'That pickup time isn’t available anymore. Choose another.' };
  if (w.full) return { ok: false, error: `${w.label} just filled up. Choose another time.` };
  return { ok: true, window: w, cap: w.left === null ? null : w.left + (booked[w.key] || 0) };
}
