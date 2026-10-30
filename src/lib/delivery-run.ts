// src/lib/delivery-run.ts — A DRIVER'S DELIVERIES, FROM THE SHOP'S OWN TEAM (pure). Read by the staff app's Deliveries
// tab (mockups 4A to 4C), the server's delivery steps (lib/retail-fulfill) and the order pages.
//   · The run: delivery orders waiting to go (packed or on the ready shelf, and any brought back) that a driver puts in
//     the van, then their own stops in order (the earliest promise first; one skipped for later goes to the end).
//   · Proof at the door, as the shop sets it (lib/delivery-plan proof): a photo on every delivery or only when it's left
//     rather than handed over, and the customer's delivery code on orders at or over an amount.
//   · Couldn't deliver: what happened, and whose side it was on. The customer's side (no one answered, couldn't get in,
//     the address) or the shop's (not safe to leave, something else), so a second try can be charged or free by the
//     shop's rule.
export type FailCode = 'no_answer' | 'no_access' | 'bad_address' | 'unsafe' | 'other';
export type FailCause = 'customer' | 'shop';

export const FAIL_REASONS: { code: FailCode; label: string; cause: FailCause }[] = [
  { code: 'no_answer', label: 'No one answered', cause: 'customer' },
  { code: 'no_access', label: 'Can’t get in to the building', cause: 'customer' },
  { code: 'bad_address', label: 'The address is wrong or can’t be found', cause: 'customer' },
  { code: 'unsafe', label: 'Not safe to leave it here', cause: 'shop' },
  { code: 'other', label: 'Something else', cause: 'shop' },
];
export const failReason = (code: unknown) => FAIL_REASONS.find((r) => r.code === code) || null;

/** The proof the shop asks for at the door, from the plan's saved setting. */
export function proofOf(plan: any): { photo: 'always' | 'left' | 'off'; pinOverCents: number | null } {
  const p = plan?.proof || {};
  const photo = ['always', 'left', 'off'].includes(p.photo) ? p.photo : 'left';
  const pin = Math.round(Number(p.pinOverCents));
  return { photo, pinOverCents: Number.isFinite(pin) && pin > 0 ? pin : null };
}

/**
 * What this delivery needs before it's marked delivered: a photo (handed over or `left`), the delivery code. The code
 * is asked of the person taking it; a big order left where they asked has no one to give it, so its photo is asked for
 * instead, whatever the photo setting.
 */
export function proofNeeded(order: any, plan: any, left: boolean): { photo: boolean; pin: boolean } {
  const p = proofOf(plan);
  const total = Math.round(Number(order?.totalCents) || 0);
  const big = p.pinOverCents !== null && total >= p.pinOverCents;
  return { photo: p.photo === 'always' || (left && (p.photo === 'left' || big)), pin: big && !left };
}

/** One line under a stop: what the customer asked, else what the shop asks for at that door. */
export function stopHint(order: any, plan: any): string {
  const note = String(order?.delivery?.note || '').trim();
  if (note) return `“${note.length > 80 ? `${note.slice(0, 79)}…` : note}”`;
  const p = proofOf(plan);
  if (proofNeeded(order, plan, false).pin) return `Over ${dollars(p.pinOverCents as number)}: ask for their code`;
  if (p.photo === 'always') return 'Photo on every delivery';
  if (p.photo === 'left') return 'Photo when it’s left';
  return '';
}
const dollars = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;

/** The order of a run: the earliest promise first (a window's start, or "within N minutes"), then the order number. */
export function promiseOf(order: any): number {
  const d = order?.delivery || {};
  const t = Date.parse(String(d.window?.start || d.asap?.by || d.readyBy || order?.placedAt || ''));
  return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
}

/**
 * The run for one driver: what's waiting to go (packed or ready, not out; brought back ones too), and their own stops
 * out with them, in order. A stop they skipped to come back to goes to the end, in the order they skipped them.
 */
export function runFor(orders: any[], driverId: string): { toTake: any[]; route: any[] } {
  const live = (orders || []).filter((o) => o && o.method === 'delivery' && ['packed', 'ready'].includes(String(o.stage)));
  const byPromise = (a: any, b: any) => promiseOf(a) - promiseOf(b) || (Number(a.orderNumber) || 0) - (Number(b.orderNumber) || 0);
  const toTake = live.filter((o) => String(o.delivery?.status || 'waiting') !== 'out').sort(byPromise);
  const mine = live.filter((o) => o.delivery?.status === 'out' && String(o.delivery?.driverId || '') === driverId);
  const skipped = (o: any) => Date.parse(String(o.delivery?.skippedAt || '')) || 0;
  const route = [...mine.filter((o) => !skipped(o)).sort(byPromise), ...mine.filter((o) => skipped(o)).sort((a, b) => skipped(a) - skipped(b))];
  return { toTake, route };
}

/** The street lines of a delivery address (no name): what a driver reads and the customer is told the driver is at. */
export function streetLines(a: any): string[] {
  if (!a) return [];
  return [a.line1, a.line2, [a.city, [a.state, a.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ')].map((x: any) => String(x || '').trim()).filter(Boolean);
}

/** What the customer is told the driver at their door ran into, by reason. */
export function doorWords(code: unknown): string {
  return code === 'no_access' ? 'can’t get in to the building' : code === 'bad_address' ? 'can’t find the address' : code === 'unsafe' ? 'can’t find a safe place to leave it' : code === 'other' ? 'needs a word with you' : 'couldn’t reach you';
}

/** Navigation in the driver's own maps app: Apple Maps on an iPhone or iPad, Google Maps elsewhere. */
export function mapsLink(addressLine: string, apple: boolean): string {
  const q = encodeURIComponent(String(addressLine || '').trim());
  return apple ? `https://maps.apple.com/?daddr=${q}` : `https://www.google.com/maps/dir/?api=1&destination=${q}`;
}

/** Each try at the door is its own: messages and the wait are keyed by it, so a second try starts fresh. */
export const tryKey = (order: any) => `t${Math.max(1, Math.floor(Number(order?.delivery?.tries) || 1))}`;

/** The window's key for the order, as checkout stored it (for grouping a run by window). */
export const windowKeyOf = (order: any) => String(order?.delivery?.window?.key || '');

/** How long the driver waits at the door for the customer's answer before choosing what to do. */
export const DOOR_WAIT_MS = 5 * 60_000;
