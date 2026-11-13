// src/lib/pickups-view.ts — THE PICKUPS SCREEN'S OWN RULES (components/orders/PickupsScreen): which orders are picked up,
// who's here, who's on the way and how far, which list an order is in, and the one-tap message. No database here.
import { firstName, packQueue } from './orders-view';

export type PickupTab = 'here' | 'bag' | 'bagged';
const NOT_PICKUP = ['ship', 'delivery', 'digital'];
/** Bagged and on the shelf (ready), or bagged with them here (arrived). */
export const BAGGED = ['ready', 'arrived'];

/** "Dana R.": what fits on a card. */
export function shortName(name: any): string {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return 'Customer';
  return w.length === 1 ? w[0] : `${w[0]} ${w[w.length - 1].charAt(0).toUpperCase()}.`;
}
/** Collected by the customer (at the window, curbside, inside), not shipped or delivered. */
export const isPickup = (o: any) => !NOT_PICKUP.includes(String(o?.method || ''));
/** They've said they're here: checked in (stage arrived), or arrived before it was bagged. */
export const isHere = (o: any) => o?.stage === 'arrived' || !!o?.curbside?.arrivedAt;
/** On their way, and not here yet. */
export const onTheWay = (o: any) => !isHere(o) && !!o?.curbside?.onWayAt;
/** About how many minutes away, from when they left and what they said; null when they didn't say. */
export function minutesAway(o: any, now: number): number | null {
  const left = Date.parse(String(o?.curbside?.onWayAt || '')); const eta = Number(o?.curbside?.etaMinutes);
  if (!Number.isFinite(left) || !Number.isFinite(eta) || eta <= 0) return null;
  return Math.max(0, Math.round(eta - (now - left) / 60000));
}
/** Which list an active pickup order is in. */
export function pickupTab(o: any): PickupTab { return isHere(o) ? 'here' : BAGGED.includes(String(o?.stage)) ? 'bagged' : 'bag'; }
/** Any line sold to licensed pros only (lib/pro-license). */
export const hasProsOnly = (o: any) => (o?.lines || []).some((l: any) => l?.prosOnly === true);
/** The license an order was sold on has run out by `today` (YYYY-MM-DD): worth a look at a current one before it goes. */
export const licenseLapsed = (o: any, today: string) => !!o?.proLicense?.expiresOn && String(o.proLicense.expiresOn) < today;
/** Today on this device's calendar (YYYY-MM-DD). */
export const localDay = (d: Date = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** The one-tap message: how long until it's brought out. */
export const soonText = (o: any, mins: number) => `Hi ${firstName(o?.customerName)}, we’ll have it out to you in about ${mins} minute${mins === 1 ? '' : 's'}.`;

/** A one-tap message counts as sent for this long: the card says so instead of offering it again. */
export const SOON_SENT_MS = 20 * 60_000;
export const soonSent = (o: any, now: number) => { const t = Date.parse(String(o?.curbside?.soonSentAt || '')); return Number.isFinite(t) && now - t < SOON_SENT_MS; };

const ms = (v: any) => { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? t : 0; };
/** When they're expected: when they left plus what they said (an hour out when they didn't say). */
const dueAt = (o: any) => ms(o?.curbside?.onWayAt) + (Number(o?.curbside?.etaMinutes) > 0 ? Number(o.curbside.etaMinutes) : 60) * 60_000;
const byThen = (a: number, b: number, x: any, y: any) => a - b || String(x?.id || '').localeCompare(String(y?.id || ''));

export type PickupLists = { here: any[]; coming: any[]; toBag: any[]; bagged: any[]; held: number };
/** The screen's lists from the business's active orders (shipped and delivered ones are left out here). Each keeps
 *  its order between updates, so a row doesn't move under a finger as the clock ticks:
 *    here    — longest wait first (when they said they were here; one checked in without a time goes last)
 *    coming  — soonest expected first (when they left plus what they said)
 *    toBag   — the packing order (rushed, late, soonest due), whoever's on the way first; held ones are counted, not
 *              listed (they're decided on the Orders screen)
 *    bagged  — on the shelf longest first */
export function pickupLists(active: any[], rs: any, now: number, zone?: string | null): PickupLists {
  const pickups = (active || []).filter(isPickup);
  // (One checked in without a time goes after those with one: how long it's waited isn't known.)
  const here = pickups.filter(isHere).map((o) => ({ o, t: ms(o.curbside?.arrivedAt) || Number.MAX_SAFE_INTEGER })).sort((a, b) => byThen(a.t, b.t, a.o, b.o)).map((x) => x.o);
  const coming = pickups.filter(onTheWay).sort((a, b) => byThen(dueAt(a), dueAt(b), a, b));
  const bag = pickups.filter((o) => pickupTab(o) === 'bag');
  const queue = packQueue(bag, rs, now, zone);
  const toBag = [...queue.filter(onTheWay), ...queue.filter((o) => !onTheWay(o))];
  const bagged = pickups.filter((o) => pickupTab(o) === 'bagged').sort((a, b) => byThen(ms(a.readyAt), ms(b.readyAt), a, b));
  return { here, coming, toBag, bagged, held: bag.length - queue.length };
}
