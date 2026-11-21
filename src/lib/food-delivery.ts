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
// - Couldn't be delivered (round 4, design board "When hot food can't be delivered"; lib/food-delivery-settle-server): the
//   guest is texted, and their page asks whether they'll pick it up or want a refund; the counter can send it out again
//   or refund it. Refunded: the food, its tax and the tip, and the delivery fee unless it failed on the guest's side and
//   the second-try rule keeps it. Picked up instead: the tip comes back, and the fee by the same rule.
//   tenants/{t}/counterOrders/{id}.ahead.delivery = { address, note, phone (for the driver), feeCents, miles, driveMin, zone, arriveAt,
//     state: 'waiting' | 'out' | 'delivered' | 'failed' | 'pickup' | 'picked_up' | 'refunded', driverName?, driverId?, outAt?,
//     outsideAt?, deliveredAt?, failedAt?, why?, failText?, settle?, owed?, backCents?, pickupAt?, pickedUpAt?, refundedAt? }
//   and on the order: deliveryFee (dollars), tipCents, tipFor: 'driver'

export const DRIVE_MAX_CHOICES = [10, 15, 20, 30] as const;
export const DEFAULT_DRIVE_MAX = 15;
/** A usual drive when the zone is a ZIP code (no miles to go on). */
export const USUAL_DRIVE_MIN = 15;
export type FoodDeliveryState = 'waiting' | 'out' | 'delivered' | 'failed' | 'pickup' | 'picked_up' | 'refunded';
/** How it's going, for the counter and the guest (the kitchen's part while it's here). */
export type FoodStep = 'making' | 'ready' | 'out' | 'delivered' | 'failed' | 'pickup' | 'picked_up' | 'refunded';
export type FoodAddress = { line1: string; line2: string; city: string; state: string; postalCode: string };

/** The business's food delivery: on (and only with its delivery zones set up), and the longest drive for hot food. */
export function foodDeliveryOf(tenant: any): { on: boolean; maxDriveMin: number; feeTaxed: boolean } {
  const a = tenant?.orderAhead || {};
  const m = Number(a.deliveryMaxMin);
  return { on: a.delivery === true, maxDriveMin: (DRIVE_MAX_CHOICES as readonly number[]).includes(m) ? m : DEFAULT_DRIVE_MAX, feeTaxed: a.deliveryFeeTaxed === true };
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
export function withDeliveryFee<M extends { total: number; tax: number }>(money: M, feeCents: number, tipCents = 0, feeTax = 0): M & { deliveryFee: number; tipCents: number; total: number; deliveryFeeTax: number } {
  const fee = Math.max(0, Math.round(feeCents)) / 100; const tip = Math.max(0, Math.round(tipCents));
  // (Sales tax on the fee, where the business charges it: in the order's tax, and kept apart so a refund that keeps the
  // fee keeps its tax too.)
  const ft = Math.max(0, Math.round(Number(feeTax) * 100)) / 100;
  return { ...money, deliveryFee: fee, tipCents: tip, deliveryFeeTax: ft, tax: Math.round((money.tax + ft) * 100) / 100, total: Math.round((money.total + fee + ft) * 100 + tip) / 100 };
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
export function deliveryStep(d: { state?: string } | null | undefined, kitchen: string): FoodStep {
  const s = String(d?.state || 'waiting');
  if (s === 'delivered' || s === 'failed' || s === 'out' || s === 'pickup' || s === 'picked_up' || s === 'refunded') return s;
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

/** Why it couldn't be delivered (said at the counter and to the guest). `guest`: on the guest's side; `told`: why, in
 *  the guest's text; `when`: the delivery fee isn't refunded "when …", said when the business's rule keeps it. */
export const FOOD_FAIL_REASONS: { code: string; label: string; guest: boolean; told: string; when: string }[] = [
  { code: 'no_answer', label: 'No one answered', guest: true, told: 'no one answered', when: 'no one answers' },
  { code: 'no_access', label: 'Couldn’t get in', guest: true, told: 'they couldn’t get in', when: 'the driver can’t get in' },
  { code: 'bad_address', label: 'Wrong or missing address', guest: true, told: 'the address was wrong or missing', when: 'the address is wrong or missing' },
  { code: 'other', label: 'Something else', guest: false, told: '', when: '' },
];
export const failReasonOf = (why: unknown) => FOOD_FAIL_REASONS.find((r) => r.code === why) || null;

/** The delivery fee is kept when it failed on the guest's side and the business's second-try rule (Orders, Delivery:
 *  lib/delivery-plan secondTry) charges for another try; otherwise it comes back with a refund or a pickup. */
export const keepsFee = (why: unknown, plan: any): boolean => !!failReasonOf(why)?.guest && plan?.secondTry?.customer !== 'free';

/** What goes back to the card when it couldn't be delivered, in cents: refunded (the food, its tax, the driver's tip,
 *  and the fee when `fee`), or picked up instead (the tip, and the fee when `fee`). */
export function moneyBack(o: { subtotal?: unknown; tax?: unknown; deliveryFee?: unknown; deliveryFeeTax?: unknown; tipCents?: unknown }, how: 'refund' | 'pickup', fee: boolean) {
  const c = (v: unknown) => Math.max(0, Math.round((Number(v) || 0) * 100));
  const ft = c(o.deliveryFeeTax);
  const food = how === 'refund' ? c(o.subtotal) : 0; const tax = how === 'refund' ? Math.max(0, c(o.tax) - ft) : 0;
  const tip = Math.max(0, Math.round(Number(o.tipCents) || 0)); const f = fee ? c(o.deliveryFee) + ft : 0;
  return { food, tax, tip, fee: f, total: food + tax + tip + f };
}

/** The lines in the books each part comes back from (lib/counter-server payOrder): the food, its tax, the tip, the fee
 *  (and the fee's own tax, where it's charged). */
export function backLines(orderId: string, how: 'refund' | 'pickup', fee: boolean): string[] {
  return [...(how === 'refund' ? [`counter_${orderId}`, `counter_${orderId}_tax`] : []), `ftip_${orderId}`, ...(fee ? [`counter_${orderId}_delivery`, `counter_${orderId}_delivery_tax`] : [])];
}
/** A line's part of the order, in cents (for what's still to go back). */
export function lineCents(orderId: string, line: string, o: { subtotal?: unknown; tax?: unknown; deliveryFee?: unknown; deliveryFeeTax?: unknown; tipCents?: unknown }): number {
  const c = (v: unknown) => Math.max(0, Math.round((Number(v) || 0) * 100));
  if (line === `counter_${orderId}`) return c(o.subtotal);
  // (The fee's own sales tax, where it's charged, is a line of its own: it goes with the fee.)
  if (line === `counter_${orderId}_tax`) return Math.max(0, c(o.tax) - c(o.deliveryFeeTax));
  if (line === `counter_${orderId}_delivery_tax`) return c(o.deliveryFeeTax);
  if (line === `counter_${orderId}_delivery`) return c(o.deliveryFee);
  if (line === `ftip_${orderId}`) return Math.max(0, Math.round(Number(o.tipCents) || 0));
  return 0;
}

/** The guest's text when it couldn't be delivered: why, and their page to pick it up or get a refund. */
export function failedWords(number: string, why: unknown, link: string | null): string {
  const r = failReasonOf(why); const n = String(number || '').trim();
  return `Our driver couldn’t get ${n ? `order ${n}` : 'your order'} to you${r?.told ? ` (${r.told})` : ''}. Pick it up, or get a refund${link ? `: ${link}` : ' on your order page.'}`;
}
