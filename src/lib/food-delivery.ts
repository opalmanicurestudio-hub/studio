// src/lib/food-delivery.ts — HOT FOOD, DELIVERED BY THE BUSINESS'S OWN DRIVERS (pure; design board "Hot food delivery").
// Guests pick Delivery when they order ahead (lib/counter-ahead). It uses the shop's own delivery zones and fees
// (lib/delivery-plan, set under Orders, Delivery), with a limit on how far hot food goes:
// - How far: the drive, worked out from the miles (a few minutes to get going, then about 2.5 a mile); an address
//   farther than the longest drive the business sets is turned away, with pickup offered instead. Zones by ZIP code
//   have no miles: a usual drive is taken.
// - When: the guest picks an arrival time (a pickup time plus the drive), or as soon as it's ready. The kitchen makes
//   it to be ready when the driver should leave: the order's pickup time is the arrival less the drive.
// - The fee: its own line on the order, the receipt and the books ('Shipping Charged'), never in the food's sales and
//   with no sales tax on it.
// - Handed over at the counter (api/counter: deliveryOut, deliveryDone, deliveryFailed): out with a driver, delivered,
//   or couldn't be delivered and why. The guest's page follows it, and their one text is "on its way", not "ready".
// - The driver (round 2, design board "Hot food on the driver's phone"): a driver takes it from the staff app's
//   Deliveries tab (api/counter/food-run), or the counter sends it out with one of the business's drivers. They can text
//   the guest they're outside, from the business's number.
// - A tip for the driver, chosen when ordering (a percent of the food, or an amount): all of it is theirs, booked under
//   their name as a tip when it's delivered (never food sales, no tax on it).
//   tenants/{t}/counterOrders/{id}.ahead.delivery = { address, note, phone (for the driver), feeCents, miles, driveMin, zone, arriveAt,
//     state: 'waiting' | 'out' | 'delivered' | 'failed', driverName?, driverId?, outAt?, outsideAt?, deliveredAt?, failedAt?, why? }
//   and on the order: deliveryFee (dollars), tipCents, tipFor: 'driver'

export const DRIVE_MAX_CHOICES = [10, 15, 20, 30] as const;
export const DEFAULT_DRIVE_MAX = 15;
/** A usual drive when the zone is a ZIP code (no miles to go on). */
export const USUAL_DRIVE_MIN = 15;
export type FoodDeliveryState = 'waiting' | 'out' | 'delivered' | 'failed';
export type FoodAddress = { line1: string; line2: string; city: string; state: string; postalCode: string };

/** The business's food delivery: on (and only with its delivery zones set up), and the longest drive for hot food. */
export function foodDeliveryOf(tenant: any): { on: boolean; maxDriveMin: number } {
  const a = tenant?.orderAhead || {};
  const m = Number(a.deliveryMaxMin);
  return { on: a.delivery === true, maxDriveMin: (DRIVE_MAX_CHOICES as readonly number[]).includes(m) ? m : DEFAULT_DRIVE_MAX };
}

/** About how long the drive is, in minutes, from the miles (a few to get going, then about 2.5 a mile). */
export function driveMinutes(miles: number | null | undefined): number {
  const m = Number(miles);
  if (miles === null || miles === undefined || !Number.isFinite(m) || m < 0) return USUAL_DRIVE_MIN;
  return Math.max(5, Math.ceil(4 + m * 2.5));
}

/** An address as a guest typed it, tidied (control characters out, spaces tidied, lengths kept sane); null when a part
 *  that's needed is missing. */
export function cleanAddress(raw: any): FoodAddress | null {
  const t = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
  const a = { line1: t(raw?.line1, 120), line2: t(raw?.line2, 60), city: t(raw?.city, 60), state: t(raw?.state, 20).toUpperCase(), postalCode: t(raw?.postalCode, 10) };
  return a.line1 && a.city && a.state && /^\d{5}(-?\d{4})?$/.test(a.postalCode) ? a : null;
}
/** The driver's note ("side door, gate code 1234"), tidied; empty when none. */
export const cleanNote = (v: unknown) => String(v ?? '').replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
/** One line for the counter and the driver: "412 Elm St, Apt 3, Riverton". */
export const addressLine = (a: Partial<FoodAddress> | null | undefined) => [a?.line1, a?.line2, a?.city].filter(Boolean).join(', ');

/** The arrival times on offer: each pickup time (the time it's ready to leave) plus the drive, to the next 5 minutes. */
export function arrivalTimes(pickupIsos: string[], driveMin: number): { at: string; arrive: string }[] {
  return pickupIsos.map((at) => { const t = Date.parse(at) + driveMin * 60000; return { at, arrive: new Date(Math.ceil(t / 300000) * 300000).toISOString() }; });
}

/** The order's money with its delivery fee (and the driver's tip): the food's subtotal and tax as they were, the fee and
 *  the tip on their own lines, and the total with them (the one the guest pays). */
export function withDeliveryFee<M extends { total: number }>(money: M, feeCents: number, tipCents = 0): M & { deliveryFee: number; tipCents: number; total: number } {
  const fee = Math.max(0, Math.round(feeCents)) / 100; const tip = Math.max(0, Math.round(tipCents));
  return { ...money, deliveryFee: fee, tipCents: tip, total: Math.round((money.total + fee) * 100 + tip) / 100 };
}

/** The tips offered for the driver: a percent of the food (before tax), or an amount up to this. */
export const TIP_PCTS = [15, 18, 20] as const;
export const MAX_TIP_CENTS = 10000;
/** The driver's tip from what the guest picked: { pct } (one of the offered percents) or { cents }; nothing is no tip.
 *  -1: not one that's offered. */
export function tipCentsOf(raw: any, foodCents: number): number {
  if (raw === null || raw === undefined || raw === false) return 0;
  if (typeof raw !== 'object') return -1;
  if (raw.pct !== undefined && raw.pct !== null) { const p = Number(raw.pct); return (TIP_PCTS as readonly number[]).includes(p) ? Math.round((Math.max(0, foodCents) * p) / 100) : -1; }
  if (raw.cents !== undefined && raw.cents !== null) { const c = Number(raw.cents); return Number.isInteger(c) && c >= 0 && c <= MAX_TIP_CENTS ? c : -1; }
  return 0;
}

/** "I'm outside" goes once every couple of minutes at most. */
export const OUTSIDE_EVERY_MS = 2 * 60_000;

/** How the delivery is going, for the counter and the guest: waiting (being made, or ready to go), out with a driver,
 *  delivered, or not. `kitchen`: 'making' | 'ready' | 'handed' from the tickets. */
export function deliveryStep(d: { state?: string } | null | undefined, kitchen: string): 'making' | 'ready' | 'out' | 'delivered' | 'failed' {
  const s = String(d?.state || 'waiting');
  if (s === 'delivered' || s === 'failed' || s === 'out') return s;
  return kitchen === 'ready' || kitchen === 'handed' ? 'ready' : 'making';
}

/** Minutes past the time the guest was given before it's running late (said to them and the counter). */
export const LATE_AFTER_MIN = 5;
/** Out with a driver: about when it gets there now, and whether that's running late. The driver's planned route has the
 *  time when there is one (lib/route-server, kept on the delivery as routeEta); otherwise when it left plus the drive. Late: LATE_AFTER_MIN past the arrival time the guest was given (or, with no newer time,
 *  that far past it now). */
export function etaOf(d: { routeEta?: unknown; outAt?: unknown; driveMin?: unknown; arriveAt?: unknown } | null | undefined, now: number): { eta: string | null; late: boolean } {
  const due = Date.parse(String(d?.arriveAt || ''));
  const route = Date.parse(String(d?.routeEta || ''));
  const left = Date.parse(String(d?.outAt || ''));
  const byRoute = Number.isFinite(route) ? route : null;
  const byDrive = Number.isFinite(left) ? left + Math.max(0, Number(d?.driveMin) || 0) * 60000 : null;
  // (A time already past is no estimate: it's now, and still on its way.)
  let t = byRoute ?? byDrive; if (t !== null && t < now) t = now;
  const late = Number.isFinite(due) && (t ?? now) - due >= LATE_AFTER_MIN * 60000;
  return { eta: t === null ? null : new Date(Math.ceil(t / 60000) * 60000).toISOString(), late };
}

/** Ready and still here this long (minutes): hot food waiting on a driver. Over five: leave now. */
export const waitingHot = (readyAtMs: number, now: number) => Math.max(0, Math.floor((now - readyAtMs) / 60000));

/** Why it couldn't be delivered (said at the counter; a manager refunds or sends it again). */
export const FOOD_FAIL_REASONS: { code: string; label: string }[] = [
  { code: 'no_answer', label: 'No one answered' },
  { code: 'no_access', label: 'Couldn’t get in' },
  { code: 'bad_address', label: 'Wrong or missing address' },
  { code: 'other', label: 'Something else' },
];
