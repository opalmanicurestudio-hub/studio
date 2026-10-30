// src/lib/pickup-slots-server.ts — THE SHOP'S PICKUP WINDOWS, LIVE (server; the rules are in lib/pickup-slots).
// Counts the orders already in each window and, when the shop sizes windows by who's working, the people on shift in
// each. Checkout reads the windows to offer them; placing an order checks the chosen window against the same answer
// and counts it again in the transaction that writes the order, so two customers can't both take the last place.
// A shop whose time zone was never set gets no times (its hours would land hours off), and checkout stays as before.
import { createHash } from 'crypto';
import { hasTimeZone, tenantTimeZone, todayIn } from '@/lib/tenant-time';
import { hasHours, isPaused, peopleThrough, pickupWindows, planFrom, readyBy, noPickupReason, shiftLookup, shiftSpans, type PickupPlan, type PickupWindow, type ShiftSpan } from '@/lib/pickup-slots';
export { peopleThrough };

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

/** Work shifts over the days offered, as spans of minutes on the shop's clock. */
export async function shiftsFor(db: any, tenantId: string, days: string[]): Promise<ShiftSpan[]> {
  if (!days.length) return [];
  const snap = await db.collection(`tenants/${tenantId}/shifts`).where('date', '>=', days[0]).where('date', '<=', days[days.length - 1]).orderBy('date').limit(3000).get();
  return shiftSpans(snap.docs.map((d: any) => { const s = d.data() || {}; return { ...s, staffId: s.staffId || d.id }; }));
}

export async function shiftCounter(db: any, tenantId: string, tz: string, days: string[]): Promise<(startMs: number, endMs: number) => number | null> {
  return shiftLookup(await shiftsFor(db, tenantId, days), tz);
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
  const plan = planFrom(tenant?.retailSettings || {});
  // A pause stops online pickup whatever else is set: before hours (or a time zone) are set, checkout would otherwise
  // fall back to its old "ready in about" and take the order anyway.
  if (isPaused(plan, now)) return { plan, booked: {}, view: { scheduled: true, windows: [], readyBy: null, reason: noPickupReason(plan, now, tenantTimeZone(tenant)) } };
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
