// src/lib/delivery-server.ts — LOCAL DELIVERY, LIVE (server; the rules are lib/delivery-plan). What the delivery
// settings screen and checkout read beside the plan: the orders already in each delivery window, the shifts of the
// people who drive, the team to choose drivers from, and the shop's own pinned locations to measure from.
import { holdsPlace, shiftsFor } from '@/lib/pickup-slots-server';
import type { ShiftSpan } from '@/lib/pickup-slots';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  asapOffer, deliveryFee, deliveryFrom, deliveryWindows, driverLookup, driversOnNow, milesBetween, money, notReady, zip5, zoneFor,
  type AsapAnswer, type DeliveryPlan, type DeliveryZone, type FeeAnswer,
} from '@/lib/delivery-plan';
import { planFrom, type PickupPlan, type PickupWindow } from '@/lib/pickup-slots';
import { geocode, hasMapsKey, preciseEnough } from '@/lib/geocode-server';
import { hasTimeZone, tenantTimeZone, todayIn } from '@/lib/tenant-time';

/** Orders already in each delivery window over the days offered, by window key (not counting `sameCheckout`'s own earlier try). */
export async function bookedDelivery(db: any, tenantId: string, firstDay: string, lastDay: string, now: number, sameCheckout = ''): Promise<Record<string, number>> {
  const snap = await db.collection(`tenants/${tenantId}/retailOrders`).where('deliveryWindowKey', '>=', firstDay).where('deliveryWindowKey', '<=', `${lastDay}~`).limit(5000).get();
  const out: Record<string, number> = {};
  for (const d of snap.docs) { const o: any = d.data() || {}; if (holdsPlace(o, now, sameCheckout)) out[String(o.deliveryWindowKey)] = (out[String(o.deliveryWindowKey)] || 0) + 1; }
  return out;
}

/** The drivers' shifts over the days offered (nobody else's). */
export async function driverShifts(db: any, tenantId: string, days: string[], drivers: string[]): Promise<ShiftSpan[]> {
  if (!drivers.length || !days.length) return [];
  const set = new Set(drivers);
  return (await shiftsFor(db, tenantId, days)).filter((s) => set.has(s.staffId));
}

export type TeamMember = { id: string; name: string };

/** The team who could drive: current members, not renters. */
export async function deliveryTeam(db: any, tenantId: string): Promise<TeamMember[]> {
  const snap = await db.collection(`tenants/${tenantId}/staff`).limit(300).get();
  return snap.docs
    .map((d: any) => ({ id: d.id, m: d.data() || {} }))
    .filter(({ m }: any) => m.archived !== true && m.role !== 'renter' && m.isRenter !== true && m.active !== false)
    .map(({ id, m }: any) => ({ id, name: String(m.name || m.displayName || 'Team member').slice(0, 60) }))
    .sort((a: TeamMember, b: TeamMember) => a.name.localeCompare(b.name));
}

export type PinnedPlace = { id: string; name: string; address: string; lat: number; lng: number };

/** The shop's locations with a pin (Settings, Locations), to measure deliveries from. */
export async function pinnedLocations(db: any, tenantId: string): Promise<PinnedPlace[]> {
  const snap = await db.collection(`tenants/${tenantId}/locations`).limit(20).get();
  return snap.docs.flatMap((d: any) => {
    const l: any = d.data() || {};
    const lat = Number(l?.coordinates?.lat), lng = Number(l?.coordinates?.lng);
    if (l.isActive === false || !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return [];
    return [{ id: d.id, name: String(l.name || 'Location').slice(0, 80), address: String(l.address || '').slice(0, 200), lat, lng }];
  });
}

/* ════════════════════════════════════════════════════════════════════════════
 * CHECKOUT: is this address delivered to, what does it cost, and when can it come
 * ════════════════════════════════════════════════════════════════════════════ */

export type DeliveryAddress = { line1?: string; line2?: string; city?: string; state?: string; postalCode?: string };

/** The address as one key: the same street, town and code, however it was spaced or capitalized. */
export const addressKey = (a: DeliveryAddress) => [a.line1, a.line2, a.city, a.state, zip5(a.postalCode)].map((x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()).join('|');

const secret = () => String(process.env.RETAIL_QUOTE_SECRET || process.env.FIREBASE_ADMIN_PRIVATE_KEY || 'clarityflow-quote');
const TOKEN_MS = 60 * 60e3;
type At = { lat: number; lng: number } | null;
const at5 = (o: At) => (o ? `${o.lat.toFixed(5)},${o.lng.toFixed(5)}` : '');
// Signed with where it was measured from too: a shop that moves its starting point gets every address measured again.
const sign = (tenantId: string, key: string, miles: number, exp: number, from: At) => createHmac('sha256', secret()).update(`deliv|${tenantId}|${key}|${miles}|${exp}|${at5(from)}`).digest('base64url');

/** A signed note that this address was found this far from the shop, so placing the order doesn't look it up again. */
export function milesToken(tenantId: string, a: DeliveryAddress, miles: number, from: At, now = Date.now()): string {
  const exp = now + TOKEN_MS; const m = Math.round(miles * 100) / 100;
  return `${m}.${exp}.${sign(tenantId, addressKey(a), m, exp, from)}`;
}
export function milesFromToken(tenantId: string, a: DeliveryAddress, token: any, from: At, now = Date.now()): number | null {
  const m = /^(\d+(?:\.\d+)?)\.(\d{1,16})\.([A-Za-z0-9_-]{20,80})$/.exec(String(token || ''));
  if (!m) return null;
  const miles = Number(m[1]), exp = Number(m[2]);
  if (!Number.isFinite(miles) || !Number.isFinite(exp) || exp < now) return null;
  const want = Buffer.from(sign(tenantId, addressKey(a), miles, exp, from)); const got = Buffer.from(m[3]);
  return want.length === got.length && timingSafeEqual(want, got) ? miles : null;
}

/** Delivery orders still on their way that were promised within minutes (they each keep a driver busy). */
export async function asapOut(db: any, tenantId: string, plan: DeliveryPlan, now: number, sameCheckout = ''): Promise<number> {
  const since = new Date(now - Math.max(plan.asap.minutes, 60) * 2 * 60e3).toISOString();
  const snap = await db.collection(`tenants/${tenantId}/retailOrders`).where('deliveryAsapAt', '>=', since).limit(500).get();
  return snap.docs.filter((d: any) => asapBusy(d.data() || {}, now, sameCheckout)).length;
}
/** An order promised within minutes that still keeps a driver busy: held or paid, and not yet delivered or brought back. */
export function asapBusy(o: any, now: number, sameCheckout = ''): boolean {
  if (!holdsPlace(o, now, sameCheckout)) return false;
  const st = String(o?.delivery?.status || '');
  return !['delivered', 'failed'].includes(st) && String(o?.stage || '') !== 'completed';
}

export type DeliveryView =
  | { ok: false; reason: 'off' | 'incomplete' | 'unavailable' | 'not_found' | 'outside' | 'minimum'; message: string; minimumCents?: number }
  | { ok: true; plan: DeliveryPlan; shop: PickupPlan; tz: string; zone: DeliveryZone; miles: number | null; fee: Extract<FeeAnswer, { ok: true }>; windows: PickupWindow[]; booked: Record<string, number>; asap: AsapAnswer; token: string | null };

/**
 * What checkout shows for delivering to an address, and what placing the order checks again: whether the shop
 * delivers there, the fee for items worth `itemsCents`, the windows with room, and whether "within N minutes" is on
 * offer right now. `token` is the signed distance from an earlier check of the same address.
 */
export async function deliveryFor(db: any, tenantId: string, tenant: any, address: DeliveryAddress, opts: { itemsCents: number; now?: number; sameCheckout?: string; token?: any }): Promise<DeliveryView> {
  const now = opts.now ?? Date.now();
  const rs = tenant?.retailSettings || {};
  const plan = deliveryFrom(rs);
  if (!plan.on || !hasTimeZone(tenant) || notReady(plan, { mapsReady: hasMapsKey() }).length) return { ok: false, reason: 'off', message: 'This shop isn’t delivering right now. Choose another way to get your order.' };
  if (!address?.line1 || !address?.city || !address?.state || !zip5(address?.postalCode)) return { ok: false, reason: 'incomplete', message: 'Add the street address, town, state and ZIP code to see if we deliver there.' };
  let miles: number | null = null;
  if (plan.by === 'distance') {
    miles = milesFromToken(tenantId, address, opts.token, plan.origin, now);
    if (miles === null) {
      const g = await geocode([address.line1, address.city, `${address.state} ${zip5(address.postalCode)}`].join(', '));
      if (g === 'down') return { ok: false, reason: 'unavailable', message: 'Delivery addresses can’t be checked just now. Try again in a minute, or choose another way to get your order.' };
      if (!preciseEnough(g)) return { ok: false, reason: 'not_found', message: 'We couldn’t find that address on the map. Check the street and number.' };
      miles = Math.round(milesBetween(plan.origin!, g) * 100) / 100;
    }
  }
  const z = zoneFor(plan, { miles, postal: address.postalCode });
  if (!z.ok) return { ok: false, reason: 'outside', message: 'We don’t deliver to that address yet. Choose another way to get your order.' };
  const fee = deliveryFee(z.zone, Math.max(0, Math.round(opts.itemsCents)));
  if (!fee.ok) return { ok: false, reason: 'minimum', minimumCents: fee.minimumCents, message: `Delivery to your address needs an order of ${money(fee.minimumCents)} or more.` };
  const shop = planFrom(rs);
  const tz = tenantTimeZone(tenant);
  const today = todayIn(tz, new Date(now));
  const days = Array.from({ length: plan.daysAhead }, (_, i) => new Date(Date.parse(`${today}T12:00:00Z`) + i * 864e5).toISOString().slice(0, 10));
  const [booked, spans, out] = await Promise.all([
    bookedDelivery(db, tenantId, days[0], days[days.length - 1], now, opts.sameCheckout || ''),
    plan.drivers.length ? shiftsFor(db, tenantId, days) : Promise.resolve([] as ShiftSpan[]),
    plan.asap.on && z.zone.expressCents !== null ? asapOut(db, tenantId, plan, now, opts.sameCheckout || '') : Promise.resolve(0),
  ]);
  // Everyone's shifts, so a day with the schedule out but no driver on it offers nothing, rather than no limit.
  const lookup = plan.perDriver !== null && plan.drivers.length ? driverLookup(spans, plan.drivers, tz) : undefined;
  const windows = deliveryWindows(plan, shop, now, tz, booked, lookup);
  const driverSet = new Set(plan.drivers);
  const asap = asapOffer(plan, shop, z.zone, now, tz, plan.drivers.length ? driversOnNow(spans.filter((s) => driverSet.has(s.staffId)), now, tz) : null, out);
  return { ok: true, plan, shop, tz, zone: z.zone, miles: z.miles, fee, windows, booked, asap, token: miles === null ? null : milesToken(tenantId, address, miles, plan.origin, now) };
}
