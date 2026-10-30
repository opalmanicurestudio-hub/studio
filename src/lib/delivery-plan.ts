// src/lib/delivery-plan.ts — LOCAL DELIVERY, AS THE SHOP SETS IT (pure). Phase D, round 1: where the shop delivers,
// what it costs and when. From the shop's delivery plan (retailSettings.deliveryPlan):
//   · zones, drawn by distance from the shop (rings: up to 3 mi, 3 to 6 mi …) or by postal code, each with its own
//     fee, order minimum, free-delivery amount and the charge for "within 90 minutes" (or none, when it isn't offered);
//   · delivery windows (10 am–12 pm, 2–4 pm …) on the days deliveries run, each taking a set number of orders, or a
//     number for each driver on shift through it, whichever is smaller;
//   · a same-day cutoff, and how many days ahead to offer;
//   · "within N minutes", offered only while a driver on shift isn't already out on one.
// Prep time and closed days are the shop's own (lib/pickup-slots): a window is offered only if the order can be ready
// before it starts, and nothing is offered on a day the shop is closed. Checkout and the settings screen read the same
// answers, and the server checks them again when the order is placed.
import { dayKey, wallParts, wallToUtc } from '@/lib/tenant-time';
import { closureOn, hasHours, peopleThrough, readyAt, windowLabel, type PickupPlan, type PickupWindow, type ShiftSpan } from '@/lib/pickup-slots';

export type DeliveryZone = {
  id: string;
  name: string;
  /** Distance zones: the outer edge in miles. The zone runs from the edge of the one inside it. */
  upToMiles: number | null;
  /** Postal-code zones: five-digit ZIP codes. */
  postalCodes: string[];
  feeCents: number;
  minimumCents: number;
  /** Items worth this much or more deliver free; null = never free. */
  freeOverCents: number | null;
  /** The extra charge for "within N minutes"; null = not offered in this zone. */
  expressCents: number | null;
  on: boolean;
};

export type DeliverySlot = { start: string; end: string };
export type DeliveryOrigin = { lat: number; lng: number; label: string; source: 'address' | 'location' };

export type DeliveryPlan = {
  /** Local delivery offered at checkout. */
  on: boolean;
  by: 'distance' | 'postal';
  zones: DeliveryZone[];
  /** Where distance is measured from. */
  origin: DeliveryOrigin | null;
  /** Days of the week deliveries run (0 Sunday … 6 Saturday). */
  days: number[];
  /** The windows on each delivery day, in order. */
  slots: DeliverySlot[];
  /** Orders a window can take; null = no limit. */
  perWindow: number | null;
  /** Orders each driver on shift through a window can take; null = windows aren't sized by drivers. */
  perDriver: number | null;
  /** Team members who drive (staff ids). */
  drivers: string[];
  /** 'HH:MM' on the shop's clock: orders after it go to the next delivery day. null = no cutoff. */
  sameDayCutoff: string | null;
  daysAhead: number;
  /** "Within N minutes". */
  asap: { on: boolean; minutes: number };
  /** Customers may say where it can be left (gate code, leave at the door, hand it to me). */
  dropoffNotes: boolean;
};

export const MAX_ZONES = 12;
export const MAX_SLOTS = 8;
export const MAX_CODES = 200;
export const ASAP_MINUTES = [45, 60, 90, 120];

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const END = /^(([01]\d|2[0-3]):([0-5]\d)|24:00)$/;
const mins = (hm: string) => { if (hm === '24:00') return 1440; const m = HM.exec(hm); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
const int = (v: any, lo: number, hi: number, dflt: number) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };
const cents = (v: any, hi: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(0, n)) : 0; };
const optCents = (v: any, hi: number) => (v === null || v === undefined || v === '' ? null : cents(v, hi));
const words = (v: any, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** A five-digit ZIP code from what was typed ('97204', '97204-1234', ' 97204 '), or '' when it isn't one. */
export function zip5(v: any): string { const m = /^\s*(\d{5})(?:-?\d{4})?\s*$/.exec(String(v ?? '')); return m ? m[1] : ''; }

function cleanZone(z: any, i: number): DeliveryZone {
  const id = /^[A-Za-z0-9_-]{1,24}$/.test(String(z?.id || '')) ? String(z.id) : `z${i + 1}`;
  const miles = Number(z?.upToMiles);
  const codes = [...new Set((Array.isArray(z?.postalCodes) ? z.postalCodes : []).map(zip5).filter(Boolean))].slice(0, MAX_CODES) as string[];
  return {
    id, name: words(z?.name, 40) || `Zone ${i + 1}`,
    upToMiles: Number.isFinite(miles) && miles > 0 ? Math.min(100, Math.round(miles * 10) / 10) : null,
    postalCodes: codes,
    feeCents: cents(z?.feeCents, 50_000), minimumCents: cents(z?.minimumCents, 100_000),
    // Free over $0 would make every order free: read as no free-over amount.
    freeOverCents: optCents(z?.freeOverCents, 1_000_000) || null, expressCents: optCents(z?.expressCents, 50_000),
    on: z?.on !== false,
  };
}

/** A saved plan, cleaned: anything malformed is dropped rather than trusted. */
export function cleanDelivery(raw: any): DeliveryPlan {
  const zones = (Array.isArray(raw?.zones) ? raw.zones : []).slice(0, MAX_ZONES).map(cleanZone);
  // Ids stay unique, so editing one zone can never change another.
  const seen = new Set<string>();
  zones.forEach((z: DeliveryZone, i: number) => { if (seen.has(z.id)) { let n = 2; while (seen.has(`${z.id.slice(0, 18)}-${n}`) && n < 100) n++; z.id = n < 100 ? `${z.id.slice(0, 18)}-${n}` : `z${i + 1}-${Date.now().toString(36)}`.slice(0, 24); } seen.add(z.id); });
  const slots = (Array.isArray(raw?.slots) ? raw.slots : [])
    .map((s: any) => ({ start: String(s?.start || ''), end: String(s?.end || '') }))
    .filter((s: DeliverySlot) => HM.test(s.start) && END.test(s.end) && mins(s.end) > mins(s.start))
    .sort((a: DeliverySlot, b: DeliverySlot) => mins(a.start) - mins(b.start))
    .slice(0, MAX_SLOTS);
  const o = raw?.origin;
  const lat = Number(o?.lat), lng = Number(o?.lng);
  const origin: DeliveryOrigin | null = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0)
    ? { lat, lng, label: words(o?.label, 160), source: o?.source === 'location' ? 'location' : 'address' } : null;
  const per = (v: any) => (v === null || v === undefined || v === '' ? null : int(v, 1, 500, 1));
  const cut = String(raw?.sameDayCutoff || '');
  const days = [...new Set((Array.isArray(raw?.days) ? raw.days : [1, 2, 3, 4, 5, 6]).map((d: any) => Math.floor(Number(d))).filter((d: number) => d >= 0 && d <= 6))].sort() as number[];
  const am = Math.floor(Number(raw?.asap?.minutes));
  return {
    on: raw?.on === true,
    by: raw?.by === 'postal' ? 'postal' : 'distance',
    zones, origin, days, slots,
    perWindow: raw && Object.prototype.hasOwnProperty.call(raw, 'perWindow') ? per(raw.perWindow) : 6,
    perDriver: per(raw?.perDriver),
    drivers: [...new Set((Array.isArray(raw?.drivers) ? raw.drivers : []).map((s: any) => String(s || '')).filter((s: string) => /^[A-Za-z0-9_-]{1,128}$/.test(s)))].slice(0, 50) as string[],
    sameDayCutoff: HM.test(cut) ? cut : null,
    daysAhead: int(raw?.daysAhead, 1, 30, 7),
    asap: { on: raw?.asap?.on === true, minutes: ASAP_MINUTES.includes(am) ? am : 90 },
    dropoffNotes: raw?.dropoffNotes !== false,
  };
}

export const deliveryFrom = (rs: any): DeliveryPlan => cleanDelivery(rs?.deliveryPlan);

/** Straight-line miles between two points. */
export function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Distance zones from the inside out (the ones the plan can use: with an edge). */
export const rings = (p: DeliveryPlan) => p.zones.filter((z) => z.upToMiles !== null).sort((a, b) => (a.upToMiles as number) - (b.upToMiles as number));

const mi = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} mi`;

/** "Up to 3 mi", "3 to 6 mi", "97204, 97205 and 3 more". */
export function areaWords(p: DeliveryPlan, z: DeliveryZone): string {
  if (p.by === 'postal') {
    const c = z.postalCodes;
    if (!c.length) return 'No postal codes yet';
    return c.length <= 3 ? c.join(', ') : `${c.slice(0, 2).join(', ')} and ${c.length - 2} more`;
  }
  if (z.upToMiles === null) return 'No distance yet';
  const list = rings(p); const i = list.findIndex((x) => x.id === z.id);
  const inner = i > 0 ? list[i - 1].upToMiles : null;
  return inner ? `${Number.isInteger(inner) ? inner : inner.toFixed(1)} to ${mi(z.upToMiles)}` : `Up to ${mi(z.upToMiles)}`;
}

export type ZoneAnswer = { ok: true; zone: DeliveryZone; miles: number | null } | { ok: false; why: 'outside' | 'not_set' };

/**
 * The zone an address is in. By distance: the innermost ring that reaches it (a ring that's off means no delivery
 * there, never the next ring out). By postal code: the zone that lists it.
 */
export function zoneFor(p: DeliveryPlan, at: { miles?: number | null; postal?: string }): ZoneAnswer {
  if (p.by === 'postal') {
    const code = zip5(at.postal);
    if (!code) return { ok: false, why: 'outside' };
    const z = p.zones.find((x) => x.postalCodes.includes(code));
    return z && z.on ? { ok: true, zone: z, miles: null } : { ok: false, why: 'outside' };
  }
  if (!p.origin) return { ok: false, why: 'not_set' };
  const m = Number(at.miles);
  if (!Number.isFinite(m) || m < 0) return { ok: false, why: 'outside' };
  const z = rings(p).find((x) => m <= (x.upToMiles as number));
  return z && z.on ? { ok: true, zone: z, miles: Math.round(m * 10) / 10 } : { ok: false, why: 'outside' };
}

export type FeeAnswer = { ok: true; feeCents: number; expressCents: number; free: boolean } | { ok: false; minimumCents: number };

/** What delivery costs for items worth `itemsCents`: the zone's fee (free over its amount), plus the express charge. */
export function deliveryFee(z: DeliveryZone, itemsCents: number, express = false): FeeAnswer {
  if (itemsCents < z.minimumCents) return { ok: false, minimumCents: z.minimumCents };
  const free = z.freeOverCents !== null && itemsCents >= z.freeOverCents;
  return { ok: true, feeCents: free ? 0 : z.feeCents, expressCents: express && z.expressCents !== null ? z.expressCents : 0, free };
}

export const money = (c: number) => `$${(c / 100).toFixed(2)}`;

const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
const addDay = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const pastCutoff = (p: DeliveryPlan, now: number, tz: string) => { const n = wallParts(new Date(now), tz); return p.sameDayCutoff !== null && n.hour * 60 + n.minute >= mins(p.sameDayCutoff); };
const hm = (n: number) => (n >= 1440 ? '24:00' : `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`);

/**
 * When an order placed now can be ready to go out: the shop's prep time, counted only while the shop is open when it
 * has set its hours (Pickup times), otherwise straight from now. The shop's pickup pause and pickup cutoff don't apply
 * to delivery.
 */
export function readyToGo(shop: PickupPlan, now: number, tz: string): number {
  if (!hasHours(shop)) return now + shop.prepMinutes * 60e3;
  const r = readyAt({ ...shop, pausedUntil: null, sameDayCutoff: null, daysAhead: 30 }, now, tz);
  return r ?? Infinity;
}

/** The delivery window's key: 'D' and its start on the shop's clock. Orders in it are counted by it. */
export const deliveryKey = (day: string, start: string) => `${day}D${start}`;

/**
 * The delivery windows to offer, in order. `booked` is how many orders each window already has (by key);
 * `drivers` says how many drivers are on shift through a window (only asked when windows are sized by drivers). A full
 * window is listed, marked full; a day deliveries don't run, a day the shop is closed, a window that starts before the
 * order could be ready, or today after the cutoff is never offered.
 */
export function deliveryWindows(p: DeliveryPlan, shop: PickupPlan, now: number, tz: string, booked: Record<string, number> = {}, drivers?: (startMs: number, endMs: number) => number | null): PickupWindow[] {
  if (!p.slots.length || !p.days.length) return [];
  const ready = readyToGo(shop, now, tz);
  if (!Number.isFinite(ready)) return [];
  const today = dayKey(new Date(now), tz);
  const skipToday = pastCutoff(p, now, tz);
  const out: PickupWindow[] = [];
  for (let i = 0; i < p.daysAhead; i++) {
    const day = addDay(today, i);
    if ((i === 0 && skipToday) || closureOn(shop, day) || !p.days.includes(weekday(day))) continue;
    for (const s of p.slots) {
      const a = mins(s.start), b = mins(s.end);
      const start = wallToUtc(day, Math.floor(a / 60), a % 60, tz).getTime();
      const end = wallToUtc(day, Math.floor(b / 60), b % 60, tz).getTime();
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start < ready) continue;
      // A clock change can skip a wall time: a window whose start doesn't land where it says isn't offered that day.
      const sp = wallParts(new Date(start), tz);
      if (dayKey(new Date(start), tz) !== day || sp.hour * 60 + sp.minute !== a) continue;
      const key = deliveryKey(day, s.start);
      let cap: number | null = p.perWindow;
      if (p.perDriver !== null && drivers) {
        const n = drivers(start, end);
        if (n !== null) cap = Math.min(cap ?? Infinity, n * p.perDriver);
      }
      const left = cap === null ? null : Math.max(0, cap - (booked[key] || 0));
      out.push({ key, start: new Date(start).toISOString(), end: new Date(end).toISOString(), day, label: windowLabel(start, end, tz, today), left, full: left === 0 });
    }
  }
  return out;
}

export type AsapAnswer = { ok: true; byIso: string; free: number } | { ok: false; why: string };

/**
 * "Within N minutes", right now. Offered on a delivery day the shop isn't closed, before the cutoff, inside the day's
 * delivery windows (from the first one's start until N minutes before the last one ends), when the order can be ready
 * in time, in a zone that offers it, and while a driver on shift isn't already out on one (`driversNow` is how many
 * drivers are on shift now, null when the shop hasn't said who drives; `out` is how many of these orders are still on
 * their way).
 */
export function asapOffer(p: DeliveryPlan, shop: PickupPlan, z: DeliveryZone | null, now: number, tz: string, driversNow: number | null, out: number): AsapAnswer {
  const no = (why: string): AsapAnswer => ({ ok: false, why });
  if (!p.asap.on) return no('off');
  if (z && z.expressCents === null) return no('zone');
  const today = dayKey(new Date(now), tz);
  if (!p.days.includes(weekday(today)) || closureOn(shop, today) || !p.slots.length) return no('closed');
  if (pastCutoff(p, now, tz)) return no('cutoff');
  const n = wallParts(new Date(now), tz); const at = n.hour * 60 + n.minute;
  const first = mins(p.slots[0].start), last = Math.max(...p.slots.map((s) => mins(s.end)));
  if (at < first || at + p.asap.minutes > last) return no('hours');
  const by = now + p.asap.minutes * 60e3;
  if (readyToGo(shop, now, tz) > by) return no('prep');
  if (driversNow === null) return no('drivers');
  const free = Math.max(0, driversNow - out);
  if (!free) return no('busy');
  return { ok: true, byIso: new Date(by).toISOString(), free };
}

/**
 * Drivers on shift through a window on a day (minutes on the shop's clock), from everyone's shifts: the fewest drivers
 * on at any moment of it. A day with shifts on the schedule but no driver among them is 0 (nothing can go out); a day
 * with no shifts on the schedule at all is null (not sized by drivers: the window limit applies).
 */
export function driversOnDay(spans: ShiftSpan[], drivers: string[], day: string, ws: number, we: number): number | null {
  const today = spans.filter((s) => s.date === day);
  if (!today.length) return null;
  const set = new Set(drivers);
  return peopleThrough(today.filter((s) => set.has(s.staffId)), ws, we) ?? 0;
}

/** The same, for a window given as instants (what deliveryWindows asks). */
export function driverLookup(spans: ShiftSpan[], drivers: string[], tz: string): (startMs: number, endMs: number) => number | null {
  return (startMs: number, endMs: number) => {
    const a = wallParts(new Date(startMs), tz), b = wallParts(new Date(endMs), tz);
    return driversOnDay(spans, drivers, dayKey(new Date(startMs), tz), a.hour * 60 + a.minute, b.hour * 60 + b.minute || 24 * 60);
  };
}

/** What can't be saved at all: zones or windows that contradict each other. In the shop's words. */
export function planErrors(p: DeliveryPlan): string[] {
  const out: string[] = [];
  if (p.by === 'distance') {
    if (p.zones.some((z) => z.upToMiles === null)) out.push('Each zone needs a distance.');
    const edges = rings(p).map((z) => z.upToMiles);
    if (new Set(edges).size !== edges.length) out.push('Two zones end at the same distance. Give each its own.');
  } else {
    if (p.zones.some((z) => !z.postalCodes.length)) out.push('Each zone needs at least one postal code.');
    const all = p.zones.flatMap((z) => z.postalCodes);
    const twice = [...new Set(all.filter((c, i) => all.indexOf(c) !== i))];
    if (twice.length) out.push(`${twice.slice(0, 3).join(', ')}${twice.length > 3 ? ' and others are' : twice.length > 1 ? ' are' : ' is'} in two zones. Keep each code in one.`);
  }
  for (let i = 1; i < p.slots.length; i++) if (mins(p.slots[i].start) < mins(p.slots[i - 1].end)) { out.push('Two delivery windows overlap. Change one so they don’t.'); break; }
  return out;
}

/** What's missing before checkout can offer delivery. */
export function notReady(p: DeliveryPlan, opts: { mapsReady: boolean }): string[] {
  const out: string[] = [];
  if (!p.zones.some((z) => z.on)) out.push('Add a zone.');
  if (p.by === 'distance' && !opts.mapsReady) out.push('Distance zones aren’t available yet. Use postal codes for now.');
  else if (p.by === 'distance' && !p.origin) out.push('Set where deliveries start from, so distance can be measured.');
  if (!p.slots.length) out.push('Add at least one delivery window.');
  if (!p.days.length) out.push('Choose the days you deliver.');
  return out;
}

/** Everything that stops a plan being saved as it is: its errors, and while delivery is on, what's missing. */
export const deliveryProblems = (p: DeliveryPlan, opts: { mapsReady: boolean }): string[] => [...planErrors(p), ...(p.on ? notReady(p, opts) : [])];

const m12 = (n: number) => { const h = Math.floor(n / 60) % 24, m = n % 60, h12 = h % 12 || 12; return { t: m ? `${h12}:${String(m).padStart(2, '0')}` : String(h12), ap: n >= 1440 || h < 12 ? 'am' : 'pm' }; };
/** "10 am–12 pm", "5–7 pm": a window's times, as the shop set them. */
export function slotWords(s: DeliverySlot): string {
  const a = m12(mins(s.start)), b = m12(mins(s.end));
  return `${a.t}${a.ap === b.ap ? '' : ` ${a.ap}`}–${b.t} ${b.ap}`;
}

/** How many drivers are on shift at `now` (spans already narrowed to drivers). */
export function driversOnNow(spans: { date: string; staffId: string; start: number; end: number }[], now: number, tz: string): number {
  const day = dayKey(new Date(now), tz); const w = wallParts(new Date(now), tz); const at = w.hour * 60 + w.minute;
  return new Set(spans.filter((x) => x.date === day && x.start <= at && x.end > at).map((x) => x.staffId)).size;
}

/** A new window after the last one: the same length, starting where it ends, never past midnight. */
export function nextSlot(slots: DeliverySlot[]): DeliverySlot {
  if (!slots.length) return { start: '10:00', end: '12:00' };
  const last = slots[slots.length - 1];
  const len = Math.max(30, mins(last.end) - mins(last.start));
  const a = Math.min(1440 - 30, mins(last.end)); const b = Math.min(1440, a + len);
  return { start: hm(a), end: hm(b) };
}

/**
 * A follow-up order made from a delivery (an item sent later when it's back in stock, a replacement): it goes to the
 * same door, at no new fee, with the customer's note; its time is arranged when it's ready (the first window has gone).
 */
export function followUpDelivery(d: any): Record<string, any> | null {
  if (!d || typeof d !== 'object') return null;
  return { zoneId: String(d.zoneId || ''), zoneName: String(d.zoneName || ''), feeCents: 0, expressCents: 0, free: true, window: null, asap: null, readyBy: null, note: String(d.note || ''), status: 'waiting', followUp: true };
}
