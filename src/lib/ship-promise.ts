// ─── src/lib/ship-promise.ts ─────────────────────────────────────────────
// THE SHIP-BY DATE. One calculation for the date an order will leave the shop and the days it should arrive, used by
// the product page, checkout, the order, the emails, the team's due times and the late notices, so that every one of
// them says the same date.
//
// Four dates, each with its own job, never mixed up:
//   · Processing starts — the first ship day the order counts from. An order after the daily cutoff, on a day the
//     shop doesn't ship, on a carrier holiday or while the shop is closed starts on the next ship day.
//   · Ships by — processing time (plus busy-period days, or a made-to-order item's longer time) counted in ship days
//     from there, landed on a day the carrier picks up. A pre-ordered item's date wins when it is later. The team
//     works to this date and the customer is promised it.
//   · In transit — the carrier's own time for the service the customer chose, counted in days the carrier delivers.
//   · Arrives — the ship-by date plus transit. Always a range, because no carrier promises one day for ordinary mail.
//
// Pure and dependency-free apart from tenant-time, so the storefront, the routes and the crons all run the same code.
// Calendar days are 'YYYY-MM-DD' strings in the shop's zone throughout; instants appear only at the edges (the moment
// the order came in, the team's deadline, the customer's deadline).

import { dayKey, endOfDay, formatShortDay, wallParts, wallToUtc } from '@/lib/tenant-time';

// ── The schedule a shop saves ────────────────────────────────────────────────

/** A carrier that collects from the shop (or a drop-off the team makes) on set days by a set time. */
export type PickupRule = {
  carrier: string;            // 'USPS', 'UPS', 'FedEx', 'DHL' or the shop's own name for one
  days: number[];             // 0 = Sunday … 6 = Saturday
  time: string;               // 'HH:MM', 24-hour, the shop's clock
  kind?: 'pickup' | 'dropoff';
};

/** Days the shop isn't shipping: a vacation, inventory day, a trade show. Both ends included. */
export type Closure = { from: string; to: string; label?: string };

/** A stretch of extra time while orders run heavy (the engine honours it; it is set up in a later screen). */
export type BusyPeriod = { from: string; to: string; extraDays: number; cutoff?: string; name?: string };

export type ShipSchedule = {
  /** Ship days after processing starts. 0 = the same day for orders before the cutoff. */
  processingDays: number;
  /** Days the shop ships, 0 = Sunday … 6 = Saturday. */
  shipDays: number[];
  /** 'HH:MM': orders after this start on the next ship day. */
  cutoff: string;
  /** A different cutoff for some days of the week, keyed by day number. */
  cutoffByDay: Record<string, string>;
  pickups: PickupRule[];
  /** Skip the days carriers don't pick up or deliver (on unless the shop turns it off). */
  carrierHolidays: boolean;
  closures: Closure[];
  /** Transit for the shop's own flat-rate or standard shipping, where no carrier gives an estimate. */
  standardTransit: { min: number; max: number };
  /** "Order in the next 2 h 13 min" on product pages. Off until a shop turns it on. */
  countdown: boolean;
  busy: BusyPeriod[];
  /** Ship-by and arrival dates shown to customers. Off until the shop turns it on, so nobody is promised a default. */
  showDates: boolean;
  /** When the schedule was last changed. */
  savedAt: string | null;
};

export const DEFAULT_SCHEDULE: ShipSchedule = {
  processingDays: 1,
  shipDays: [1, 2, 3, 4, 5],
  cutoff: '14:00',
  cutoffByDay: {},
  pickups: [],
  carrierHolidays: true,
  closures: [],
  standardTransit: { min: 2, max: 5 },
  countdown: false,
  busy: [],
  showDates: false,
  savedAt: null,
};

export const MAX_PROCESSING_DAYS = 30;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const int = (v: any, lo: number, hi: number, fallback: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const dayList = (v: any): number[] =>
  [...new Set((Array.isArray(v) ? v : []).map((d) => Math.floor(Number(d))).filter((d) => d >= 0 && d <= 6))].sort();
const timeOr = (v: any, fallback: string) => (TIME_RE.test(String(v || '')) ? String(v) : fallback);
/** A real calendar day as 'YYYY-MM-DD' (no February 30th, no month 13). */
export function isCalendarDay(v: any): boolean {
  const s = String(v || '');
  if (!DAY_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, 12));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
const isDay = isCalendarDay;

/**
 * The saved schedule with every gap filled, whatever shape it was written in. A shop that only ever set the old
 * "Ship within (hours)" keeps what it meant: under 24 hours is the same day, 24 is 1 ship day, 48 is 2.
 */
export function normalizeSchedule(raw: any, legacy?: { shipProcessingHours?: any }): ShipSchedule {
  const r = raw && typeof raw === 'object' ? raw : {};
  const legacyHours = Number(legacy?.shipProcessingHours);
  const legacyDays = Number.isFinite(legacyHours) && legacyHours > 0 ? (legacyHours < 24 ? 0 : Math.ceil(legacyHours / 24)) : DEFAULT_SCHEDULE.processingDays;
  const shipDays = dayList(r.shipDays);
  const cutoffByDay: Record<string, string> = {};
  if (r.cutoffByDay && typeof r.cutoffByDay === 'object') {
    for (const [k, v] of Object.entries(r.cutoffByDay)) {
      const d = Math.floor(Number(k));
      if (d >= 0 && d <= 6 && TIME_RE.test(String(v || ''))) cutoffByDay[String(d)] = String(v);
    }
  }
  const pickups: PickupRule[] = (Array.isArray(r.pickups) ? r.pickups : [])
    .filter((p: any) => p && String(p.carrier || '').trim() && TIME_RE.test(String(p.time || '')))
    .slice(0, 8)
    .map((p: any) => ({
      carrier: String(p.carrier).trim().slice(0, 40),
      days: dayList(p.days).length ? dayList(p.days) : [1, 2, 3, 4, 5],
      time: String(p.time),
      kind: p.kind === 'dropoff' ? 'dropoff' : 'pickup',
    }));
  const closures: Closure[] = (Array.isArray(r.closures) ? r.closures : [])
    .filter((c: any) => c && isDay(c.from) && isDay(c.to || c.from))
    .map((c: any) => {
      const from = String(c.from), to = String(c.to || c.from);
      return { from: from <= to ? from : to, to: from <= to ? to : from, ...(c.label ? { label: String(c.label).slice(0, 60) } : {}) };
    })
    .slice(0, 60);
  const busy: BusyPeriod[] = (Array.isArray(r.busy) ? r.busy : [])
    .filter((b: any) => b && isDay(b.from) && isDay(b.to || b.from))
    .map((b: any) => {
      const from = String(b.from), to = String(b.to || b.from);
      return {
        from: from <= to ? from : to, to: from <= to ? to : from,
        extraDays: int(b.extraDays, 0, MAX_PROCESSING_DAYS, 0),
        ...(TIME_RE.test(String(b.cutoff || '')) ? { cutoff: String(b.cutoff) } : {}),
        ...(b.name ? { name: String(b.name).slice(0, 60) } : {}),
      };
    })
    .slice(0, 20);
  const tMin = int(r.standardTransit?.min, 1, 60, DEFAULT_SCHEDULE.standardTransit.min);
  const tMax = int(r.standardTransit?.max, tMin, 90, Math.max(tMin, DEFAULT_SCHEDULE.standardTransit.max));
  return {
    processingDays: r.processingDays === undefined || r.processingDays === null || r.processingDays === ''
      ? Math.min(MAX_PROCESSING_DAYS, legacyDays)
      : int(r.processingDays, 0, MAX_PROCESSING_DAYS, legacyDays),
    shipDays: shipDays.length ? shipDays : [...DEFAULT_SCHEDULE.shipDays],
    cutoff: timeOr(r.cutoff, DEFAULT_SCHEDULE.cutoff),
    cutoffByDay,
    pickups,
    carrierHolidays: r.carrierHolidays !== false,
    closures,
    standardTransit: { min: tMin, max: tMax },
    countdown: r.countdown === true,
    busy,
    showDates: r.showDates === true,
    savedAt: typeof r.savedAt === 'string' && r.savedAt ? r.savedAt : null,
  };
}

/** The shop's schedule from its retail settings, old "Ship within (hours)" included. */
export function scheduleFrom(retailSettings: any): ShipSchedule {
  const rs = retailSettings || {};
  return normalizeSchedule(rs.shipSchedule, { shipProcessingHours: rs.shipProcessingHours });
}

/** Customers are given dates only by a shop that has turned them on, so nobody is promised a default. */
export function showsDates(schedule: ShipSchedule | null | undefined): boolean {
  return schedule?.showDates === true;
}

// ── Carriers ─────────────────────────────────────────────────────────────────

export type CarrierKey = 'usps' | 'ups' | 'fedex' | 'dhl' | '';

/** One name per carrier, however a rate, a label or the shop wrote it. '' when it isn't one of the big four. */
export function carrierKey(name?: string | null): CarrierKey {
  const s = String(name || '').toLowerCase();
  if (!s) return '';
  if (/usps|postal|post office|priority mail|ground advantage|first class/.test(s)) return 'usps';
  if (/fedex|fed ex/.test(s)) return 'fedex';
  if (/\bdhl\b/.test(s)) return 'dhl';
  if (/\bups\b/.test(s)) return 'ups';
  return '';
}

/** Days a carrier delivers. USPS and FedEx deliver Saturdays; the rest are counted Monday to Friday. Sunday never. */
function deliversOn(weekday: number, carrier: CarrierKey): boolean {
  if (weekday === 0) return false;
  if (weekday === 6) return carrier === 'usps' || carrier === 'fedex';
  return true;
}

// ── Holidays ─────────────────────────────────────────────────────────────────
// USPS closes on every federal holiday; UPS, FedEx and DHL on the six big ones. A holiday on a Sunday is kept the
// next day; one on a Saturday stays on the Saturday (the carriers run normally that Friday). When the carrier isn't
// known yet, the USPS list is used: it contains the others, so a date can only come out later, never too early.

const pad = (n: number) => String(n).padStart(2, '0');
const key = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const weekdayOf = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};
const plusDays = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10);
};
function nthWeekday(y: number, m: number, weekday: number, n: number): string {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return key(y, m, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
}
function lastWeekday(y: number, m: number, weekday: number): string {
  const lastDate = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = new Date(Date.UTC(y, m - 1, lastDate)).getUTCDay();
  return key(y, m, lastDate - ((last - weekday + 7) % 7));
}
const kept = (day: string) => (weekdayOf(day) === 0 ? plusDays(day, 1) : day);

export type Holiday = { day: string; name: string; all: boolean };

const holidayCache = new Map<number, Holiday[]>();
/** The carrier holidays of a year. `all` marks the six every carrier keeps; the rest are USPS only. */
export function carrierHolidays(year: number): Holiday[] {
  const hit = holidayCache.get(year);
  if (hit) return hit;
  const list: Holiday[] = [
    { day: kept(key(year, 1, 1)), name: 'New Year’s Day', all: true },
    { day: nthWeekday(year, 1, 1, 3), name: 'Martin Luther King Jr. Day', all: false },
    { day: nthWeekday(year, 2, 1, 3), name: 'Presidents’ Day', all: false },
    { day: lastWeekday(year, 5, 1), name: 'Memorial Day', all: true },
    { day: kept(key(year, 6, 19)), name: 'Juneteenth', all: false },
    { day: kept(key(year, 7, 4)), name: 'Independence Day', all: true },
    { day: nthWeekday(year, 9, 1, 1), name: 'Labor Day', all: true },
    { day: nthWeekday(year, 10, 1, 2), name: 'Columbus Day', all: false },
    { day: kept(key(year, 11, 11)), name: 'Veterans Day', all: false },
    { day: nthWeekday(year, 11, 4, 4), name: 'Thanksgiving', all: true },
    { day: kept(key(year, 12, 25)), name: 'Christmas Day', all: true },
  ];
  holidayCache.set(year, list);
  return list;
}

/** The holiday that day, for this carrier ('' = not known yet, so the full USPS list). */
export function holidayOn(day: string, carrier: CarrierKey = ''): Holiday | null {
  const y = Number(day.slice(0, 4));
  // A New Year's Day kept on Monday January 2 belongs to the year it falls in, which is the one searched.
  for (const h of carrierHolidays(y)) {
    if (h.day === day && (h.all || carrier === 'usps' || carrier === '')) return h;
  }
  return null;
}

// ── Days ─────────────────────────────────────────────────────────────────────

const minutesOf = (hhmm: string) => {
  const m = TIME_RE.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};

/** The busy period that day falls in, if any. */
export function busyOn(day: string, schedule: ShipSchedule): BusyPeriod | null {
  return schedule.busy.find((b) => b.from <= day && day <= b.to) || null;
}

export function closureOn(day: string, schedule: ShipSchedule): Closure | null {
  return schedule.closures.find((c) => c.from <= day && day <= c.to) || null;
}

/** The cutoff that applies on a day: a busy period's, then that weekday's own, then the usual one. */
export function cutoffFor(day: string, schedule: ShipSchedule): string {
  return busyOn(day, schedule)?.cutoff || schedule.cutoffByDay[String(weekdayOf(day))] || schedule.cutoff;
}

/** The pickups that count for a carrier: its own, or every one when the carrier isn't chosen yet. */
function pickupsFor(schedule: ShipSchedule, carrier: CarrierKey, carrierName?: string | null): PickupRule[] {
  if (!schedule.pickups.length) return [];
  if (!carrier && !carrierName) return schedule.pickups;
  const named = String(carrierName || '').trim().toLowerCase();
  return schedule.pickups.filter((p) => {
    const k = carrierKey(p.carrier);
    return carrier ? k === carrier : k === '' && p.carrier.trim().toLowerCase() === named;
  });
}

/** A day the shop works on orders: one of its ship days, not closed, not a carrier holiday. */
export function isShipDay(day: string, schedule: ShipSchedule, carrier: CarrierKey = ''): boolean {
  if (!schedule.shipDays.includes(weekdayOf(day))) return false;
  if (closureOn(day, schedule)) return false;
  if (schedule.carrierHolidays && holidayOn(day, carrier)) return false;
  return true;
}

/**
 * Whether the shop works on orders on a day, and the carrier to read that day by: a ship day for any carrier it uses
 * (one it lists a pickup for, or one an order is going by), so a holiday only USPS keeps doesn't stop a shop that also
 * ships UPS. `carrier` is null when the day counts for every carrier.
 */
export function teamDay(day: string, schedule: ShipSchedule, carriers: (string | null | undefined)[] = []): { ships: boolean; carrier: string | null } {
  if (isShipDay(day, schedule)) return { ships: true, carrier: null };
  const names = [...new Set([...schedule.pickups.map((p) => p.carrier), ...carriers].map((c) => String(c || '').trim()).filter(Boolean))];
  const c = names.find((n) => carrierKey(n) !== '' && isShipDay(day, schedule, carrierKey(n)));
  return c ? { ships: true, carrier: c } : { ships: false, carrier: null };
}

/** A day some carrier works for the shop: one of its ship days, not closed, and not a holiday every carrier keeps
 *  (read for a carrier that keeps only those). */
export function anyCarrierShips(day: string, schedule: ShipSchedule): boolean {
  return isShipDay(day, schedule, 'ups');
}

/** A carrier's name as people write it: 'USPS', 'UPS', 'FedEx', 'DHL', or Shippo's token tidied ('canada_post' →
 *  'Canada Post'). Empty when there's none. */
const CARRIER_TOKENS: Record<string, string> = { dhl_express: 'DHL Express', dhl_ecommerce: 'DHL eCommerce', canada_post: 'Canada Post', ontrac: 'OnTrac', lasership: 'LaserShip' };
export function carrierName(c: unknown): string {
  const s = String(c || '').trim();
  if (!s) return '';
  if (CARRIER_TOKENS[s.toLowerCase()]) return CARRIER_TOKENS[s.toLowerCase()];
  const k = carrierKey(s);
  if (k) return k === 'usps' ? 'USPS' : k === 'ups' ? 'UPS' : k === 'fedex' ? 'FedEx' : 'DHL';
  return /^[a-z0-9_]+$/.test(s) ? s.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : s;
}

/** A ship day the carrier also collects (any ship day, when the shop hasn't listed pickups for it). */
function leavesOn(day: string, schedule: ShipSchedule, carrier: CarrierKey, rules: PickupRule[]): boolean {
  if (!isShipDay(day, schedule, carrier)) return false;
  return rules.length === 0 || rules.some((p) => p.days.includes(weekdayOf(day)));
}

const SCAN_LIMIT = 800;

/** The first ship day on or after a day (the day itself when it is one). */
export function nextShipDay(day: string, schedule: ShipSchedule, carrier: CarrierKey = ''): string {
  let d = day;
  for (let i = 0; i < SCAN_LIMIT && !isShipDay(d, schedule, carrier); i++) d = plusDays(d, 1);
  return d;
}

/** The carrier an order's dates were worked out for: the stored promise's (none means any carrier the shop lists),
 *  else the order's own when it is a real carrier. Never the shop's own "Shop" flat rate, which no pickup is for. */
export function promiseCarrier(order: any): string | null {
  if (order?.promise) return order.promise.carrier ? String(order.promise.carrier) : null;
  return carrierKey(order?.shippingCarrier) ? String(order.shippingCarrier) : null;
}

/** The latest pickup on a day for this carrier, as an instant; null when none is listed that day. */
export function lastPickupAt(
  day: string, timeZone: string, schedule: ShipSchedule, carrier?: string | null,
): string | null {
  const rules = pickupsFor(schedule, carrierKey(carrier), carrier).filter((p) => p.days.includes(weekdayOf(day)));
  if (!rules.length) return null;
  const latest = rules.map((p) => minutesOf(p.time)).sort((a, b) => b - a)[0];
  const at = wallToUtc(day, Math.floor(latest / 60), latest % 60, timeZone);
  return Number.isFinite(at.getTime()) ? at.toISOString() : null;
}

/** A pre-order still waiting on its stock (refunded or cancelled lines don't count): its date moves with the stock.
 *  Once its stock is in and it's released to be packed (releasedAt), it's an order like any other. */
export const waitingPreorder = (o: any) => !o?.releasedAt && (o?.lines || []).some((l: any) => l?.preorder === true && !['refunded', 'cancelled'].includes(String(l?.status)));

/** Running-late notices the app sends by itself for one order (lib/late-notices); after that a person decides. */
export const MAX_AUTO_NOTICES = 2;
/** How long after the last pickup a box still unlabeled counts as late, so one dropped off a little late isn't. */
export const LATE_GRACE_MS = 60 * 60_000;

/** Every pickup (and drop-off) the shop lists on a day, earliest first, as instants on its clock: only on a day the
 *  shop ships and that carrier works. Empty when it lists none. */
export function pickupsOn(day: string, timeZone: string, schedule: ShipSchedule): { carrier: string; kind: 'pickup' | 'dropoff'; time: string; at: string }[] {
  return schedule.pickups
    .filter((p) => p.days.includes(weekdayOf(day)) && isShipDay(day, schedule, carrierKey(p.carrier)))
    .map((p) => {
      const m = minutesOf(p.time);
      const at = wallToUtc(day, Math.floor(m / 60), m % 60, timeZone);
      return { carrier: p.carrier, kind: p.kind === 'dropoff' ? 'dropoff' as const : 'pickup' as const, time: p.time, at: Number.isFinite(at.getTime()) ? at.toISOString() : '' };
    })
    .filter((p) => !!p.at)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

// ── The promise ──────────────────────────────────────────────────────────────

/** What a line contributes: a made-to-order time or a pre-order date. Anything digital ships nothing. */
export type PromiseLine = {
  digital?: boolean;
  preorder?: boolean;
  preorderEtaAt?: string | null;
  leadDays?: { min?: number; max?: number } | null;
};

export type ShipPromise = {
  v: 1;
  source: 'schedule';
  computedAt: string;          // the moment it was worked out from (when the order came in)
  timeZone: string;
  startsOn: string;            // processing starts
  shipBy: string;              // ships by (calendar day, shop's zone)
  shipByAt: string;            // the team's deadline: the last pickup that day, else the end of it
  deadlineAt: string;          // the customer's: the end of the ship-by day, shop's clock
  processingDays: number;
  extraDays: number;           // a busy period's extra days
  leadDays: number;            // a made-to-order item's longest time, when it is longer than processing
  preorderDate: string | null;
  carrier: string | null;
  service: string | null;
  transit: { min: number; max: number } | null;
  arriveFrom: string | null;
  arriveTo: string | null;
  busy: string | null;         // the busy period's name
  why: string[];               // why the dates are what they are, for the explanations people read
};

export type PromiseInput = {
  at: Date | string | number;
  timeZone: string;
  schedule: ShipSchedule;
  lines?: PromiseLine[];
  carrier?: string | null;
  service?: string | null;
  /** The carrier's estimate in days (one number, as rates give it). */
  transitDays?: number | null;
  /** A transit range already decided (the shop's standard shipping). Wins over transitDays. */
  transit?: { min: number; max: number } | null;
};

/**
 * A carrier's single estimate as the range a customer is shown. One day either side, since a route that usually
 * takes three days sometimes takes two or four; next-day services allow a second day.
 */
export function transitWindow(days?: number | null): { min: number; max: number } | null {
  const d = Math.floor(Number(days));
  if (!Number.isFinite(d) || d <= 0) return null;
  if (d === 1) return { min: 1, max: 2 };
  return { min: d - 1, max: d + 1 };
}

const asDay = (v: string | null | undefined, timeZone: string): string | null => {
  const raw = String(v || '').trim();
  if (!raw) return null;
  if (DAY_RE.test(raw)) return raw;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? dayKey(new Date(t), timeZone) : null;
};

/** The made-to-order time an item asks for, cleaned up; null for an item that ships in the usual time. */
export function leadOf(v: any): { min: number; max: number } | null {
  if (!v || typeof v !== 'object') return null;
  const max = int(v.max ?? v.min, 0, 120, 0);
  if (max <= 0) return null;
  const min = int(v.min ?? max, 1, max, max);
  return { min, max };
}

/** Count delivery days after a ship day. */
function deliveredAfter(day: string, days: number, carrier: CarrierKey, holidays: boolean): string {
  let d = day;
  let left = days;
  for (let i = 0; i < SCAN_LIMIT && left > 0; i++) {
    d = plusDays(d, 1);
    if (deliversOn(weekdayOf(d), carrier) && !(holidays && holidayOn(d, carrier))) left--;
  }
  return d;
}

/**
 * The promise for an order coming in at `at`. Same inputs, same dates, wherever it runs.
 */
export function promiseFor(input: PromiseInput): ShipPromise {
  const tz = input.timeZone;
  const schedule = input.schedule;
  const at = new Date(input.at instanceof Date ? input.at.getTime() : input.at);
  const when = Number.isFinite(at.getTime()) ? at : new Date();
  const carrier = carrierKey(input.carrier);
  const rules = pickupsFor(schedule, carrier, input.carrier);
  const why: string[] = [];

  // Processing starts.
  const wall = wallParts(when, tz);
  const today = `${wall.year}-${pad(wall.month)}-${pad(wall.day)}`;
  let startsOn = today;
  if (!isShipDay(today, schedule, carrier)) {
    const closed = closureOn(today, schedule);
    why.push(closed ? 'closure' : schedule.carrierHolidays && holidayOn(today, carrier) ? 'holiday' : 'not_ship_day');
    startsOn = nextShipDay(plusDays(today, 1), schedule, carrier);
  } else if (wall.hour * 60 + wall.minute >= minutesOf(cutoffFor(today, schedule))) {
    why.push('after_cutoff');
    startsOn = nextShipDay(plusDays(today, 1), schedule, carrier);
  }
  if (startsOn !== today && startsOn !== plusDays(today, 1)) {
    // A long weekend or a closure in between: worth saying when the first day back is.
    if (closureOn(plusDays(today, 1), schedule)) why.push('closure');
    else if (schedule.carrierHolidays && holidayOn(plusDays(today, 1), carrier)) why.push('holiday');
  }

  // How many ship days it takes.
  const lines = (input.lines || []).filter((l) => l && l.digital !== true);
  const lead = Math.max(0, ...lines.map((l) => leadOf(l.leadDays)?.max || 0));
  const busy = busyOn(startsOn, schedule);
  const extraDays = busy?.extraDays || 0;
  const base = Math.max(schedule.processingDays, lead);
  if (lead > schedule.processingDays) why.push('made_to_order');
  if (extraDays > 0) why.push('busy');
  let shipBy = startsOn;
  for (let n = base + extraDays, i = 0; n > 0 && i < SCAN_LIMIT; i++) {
    shipBy = plusDays(shipBy, 1);
    if (isShipDay(shipBy, schedule, carrier)) n--;
  }
  // Landed on a day the carrier collects, and not a pickup that has already gone: a same-day order that comes in
  // after its carrier's last pickup (a cutoff later than the pickup, or one carrier collecting earlier than another)
  // goes with the next one.
  const before = shipBy;
  const gone = (d: string) => {
    if (d !== today) return false;
    const last = lastPickupAt(d, tz, schedule, input.carrier);
    return !!last && Date.parse(last) <= when.getTime();
  };
  for (let i = 0; i < SCAN_LIMIT && (!leavesOn(shipBy, schedule, carrier, rules) || gone(shipBy)); i++) shipBy = plusDays(shipBy, 1);
  if (shipBy !== before) why.push('pickup_day');

  // A pre-order ships when its stock is promised, if that is later.
  const preorders = lines
    .filter((l) => l.preorder === true)
    .map((l) => asDay(l.preorderEtaAt, tz))
    .filter((d): d is string => !!d)
    .sort();
  const preorderDate = preorders.length ? preorders[preorders.length - 1] : null;
  if (preorderDate && preorderDate > shipBy) { shipBy = preorderDate; why.push('preorder'); }

  // Arrives.
  const transit = input.transit && input.transit.min > 0
    ? { min: Math.floor(input.transit.min), max: Math.max(Math.floor(input.transit.min), Math.floor(input.transit.max)) }
    : transitWindow(input.transitDays);
  const arriveFrom = transit ? deliveredAfter(shipBy, transit.min, carrier, schedule.carrierHolidays) : null;
  const arriveTo = transit ? deliveredAfter(shipBy, transit.max, carrier, schedule.carrierHolidays) : null;

  const deadline = endOfDay(shipBy, tz).toISOString();
  // The team's deadline: the last pickup that day, or, with none listed, the end of the shop's shipping day (6 PM, or
  // its cutoff when that is later). Never one already gone when the order came in.
  const due = missedAt(shipBy, tz, schedule, input.carrier);
  const shipByAt = Date.parse(due) > when.getTime() ? due : deadline;
  return {
    v: 1,
    source: 'schedule',
    computedAt: when.toISOString(),
    timeZone: tz,
    startsOn,
    shipBy,
    shipByAt,
    deadlineAt: deadline,
    processingDays: schedule.processingDays,
    extraDays,
    leadDays: lead > schedule.processingDays ? lead : 0,
    preorderDate,
    carrier: input.carrier ? String(input.carrier).slice(0, 40) : null,
    service: input.service ? String(input.service).slice(0, 60) : null,
    transit,
    arriveFrom,
    arriveTo,
    busy: busy ? (busy.name || 'Busy period') : null,
    why: [...new Set(why)],
  };
}

/**
 * Where today stands against the cutoff: whether an order now still starts today, the moment that stops, and the
 * day processing starts for an order placed now. What the countdown and the team's day both read.
 */
export function cutoffInfo(now: Date, timeZone: string, schedule: ShipSchedule, carrier?: string | null): {
  shipDay: boolean;
  beforeCutoff: boolean;
  cutoffAt: string | null;
  minutesLeft: number | null;
  startsOn: string;
} {
  const ck = carrierKey(carrier);
  const today = dayKey(now, timeZone);
  const shipDay = isShipDay(today, schedule, ck);
  const cutoff = cutoffFor(today, schedule);
  const at = shipDay ? wallToUtc(today, Math.floor(minutesOf(cutoff) / 60), minutesOf(cutoff) % 60, timeZone) : null;
  const left = at ? (at.getTime() - now.getTime()) / 60_000 : null;
  const beforeCutoff = left !== null && left > 0;
  return {
    shipDay,
    beforeCutoff,
    cutoffAt: at ? at.toISOString() : null,
    minutesLeft: beforeCutoff ? Math.floor(left as number) : null,
    startsOn: beforeCutoff ? today : nextShipDay(plusDays(today, 1), schedule, ck),
  };
}

/**
 * The day a late order now ships by: the next day after the missed one that the shop ships and its carrier collects,
 * and not one whose last pickup has already gone. Late orders go to the front of the queue, so this is the honest
 * next date rather than a fresh order's whole processing time; if it is missed too, the next notice says so.
 */
export function revisedShipBy(missed: string, now: Date, timeZone: string, schedule: ShipSchedule, carrier?: string | null): string {
  const ck = carrierKey(carrier);
  const rules = pickupsFor(schedule, ck, carrier);
  const today = dayKey(now, timeZone);
  let d = plusDays(missed > today ? missed : today, missed >= today ? 1 : 0);
  for (let i = 0; i < SCAN_LIMIT; i++, d = plusDays(d, 1)) {
    if (!leavesOn(d, schedule, ck, rules)) continue;
    // Today still counts until it is missed: its last pickup, or the end of the shop's shipping day.
    if (d === today && now.getTime() >= Date.parse(missedAt(d, timeZone, schedule, carrier))) continue;
    return d;
  }
  return d;
}

/**
 * The moment an order is known to have missed its ship-by day: the last pickup that day, or, when the shop lists none
 * (it drops boxes off itself), the end of its shipping day: 6 PM, or its cutoff when that is later. Before the day
 * ends, so the customer hears about it while the date still stands.
 */
export function missedAt(day: string, timeZone: string, schedule: ShipSchedule, carrier?: string | null): string {
  const pickup = lastPickupAt(day, timeZone, schedule, carrier);
  if (pickup) return pickup;
  const end = Math.max(18 * 60, minutesOf(cutoffFor(day, schedule)));
  return wallToUtc(day, Math.floor(end / 60), end % 60, timeZone).toISOString();
}

// ── Words ────────────────────────────────────────────────────────────────────

/** 'Thu, Oct 22'. */
export function dayLabel(day: string | null | undefined, timeZone: string): string {
  return day ? formatShortDay(day, timeZone) : '';
}

/** 'Thursday, Oct 22'. */
export function longDayLabel(day: string | null | undefined, timeZone: string): string {
  if (!day || !DAY_RE.test(day)) return '';
  const [y, m, d] = day.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  void timeZone; // a calendar day is the same day everywhere once it is named
  return `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${months[m - 1]} ${d}`;
}

/** 'Sat, Oct 24 – Wed, Oct 28', or one day when the range is one day. */
export function arrivalLabel(p: Pick<ShipPromise, 'arriveFrom' | 'arriveTo'> | null | undefined, timeZone: string): string {
  if (!p?.arriveFrom || !p.arriveTo) return '';
  if (p.arriveFrom === p.arriveTo) return dayLabel(p.arriveFrom, timeZone);
  return `${dayLabel(p.arriveFrom, timeZone)} – ${dayLabel(p.arriveTo, timeZone)}`;
}

/** 'Oct 24–28' or 'Oct 30 – Nov 3', for tight spaces. */
export function shortRange(from: string | null | undefined, to: string | null | undefined): string {
  if (!from || !to) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [, fm, fd] = from.split('-').map(Number);
  const [, tm, td] = to.split('-').map(Number);
  if (from === to) return `${months[fm - 1]} ${fd}`;
  if (fm === tm) return `${months[fm - 1]} ${fd}–${td}`;
  return `${months[fm - 1]} ${fd} – ${months[tm - 1]} ${td}`;
}

/** '2:00 PM' from 'HH:MM'. */
export function clockLabel(hhmm: string): string {
  const m = minutesOf(hhmm);
  const h = Math.floor(m / 60), mm = m % 60;
  return `${((h + 11) % 12) + 1}:${pad(mm)} ${h < 12 ? 'AM' : 'PM'}`;
}

/** The shop's rule in one sentence: 'Orders ship within 1 business day.' */
export function processingSentence(schedule: ShipSchedule): string {
  if (schedule.processingDays === 0) return `Orders placed by ${clockLabel(schedule.cutoff)} on a business day ship the same day.`;
  return `Orders ship within ${schedule.processingDays} business day${schedule.processingDays === 1 ? '' : 's'}.`;
}

/** 'Ships in 5–7 business days' for a made-to-order item, '' for one that ships in the usual time. */
export function leadSentence(lead: { min: number; max: number } | null | undefined): string {
  if (!lead) return '';
  const span = lead.min === lead.max ? `${lead.max}` : `${lead.min}–${lead.max}`;
  return `Made to order: ships in ${span} business day${lead.max === 1 ? '' : 's'}.`;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** 'Thursday' for a day within the coming week, 'Thu, Oct 29' further out. */
function whenLabel(day: string, from: string, timeZone: string): string {
  return day > from && day <= plusDays(from, 6) ? WEEKDAYS[weekdayOf(day)] : dayLabel(day, timeZone);
}

/** Why processing starts when it does, in a few words a customer or the team can read. */
export function startsReason(p: ShipPromise, schedule: ShipSchedule): string {
  const came = dayKey(new Date(p.computedAt), p.timeZone);
  const starts = whenLabel(p.startsOn, came, p.timeZone);
  if (p.startsOn === came) return 'Processing starts the same day.';
  if (p.why.includes('after_cutoff')) return `After the ${clockLabel(cutoffFor(came, schedule))} cutoff, so it starts ${starts}.`;
  if (p.why.includes('closure')) return `The shop is closed, so it starts ${starts}.`;
  if (p.why.includes('holiday')) return `Carriers are closed for the holiday, so it starts ${starts}.`;
  return `Not a ship day, so it starts ${starts}.`;
}

/**
 * The countdown for a product page: how long is left to get the earlier date. Null when ordering a minute after the
 * cutoff would give the same ship-by date anyway (a countdown that changes nothing is pressure for no reason), on a
 * day the shop doesn't ship, or with more than 12 hours to go.
 */
export function countdownFor(item: PromiseLine, now: Date, timeZone: string, schedule: ShipSchedule): {
  minutesLeft: number; cutoffAt: string; shipBy: string; laterShipBy: string;
} | null {
  const info = cutoffInfo(now, timeZone, schedule);
  if (!info.beforeCutoff || info.minutesLeft === null || !info.cutoffAt || info.minutesLeft > 12 * 60) return null;
  const nowP = productPromise(item, now, timeZone, schedule);
  const later = productPromise(item, new Date(Date.parse(info.cutoffAt) + 60_000), timeZone, schedule);
  if (later.shipBy === nowP.shipBy) return null;
  return { minutesLeft: info.minutesLeft, cutoffAt: info.cutoffAt, shipBy: nowP.shipBy, laterShipBy: later.shipBy };
}

/** '2 h 13 min', '5 h', '45 min'. */
export function minutesLabel(mins: number): string {
  const m = Math.max(0, Math.floor(mins));
  const h = Math.floor(m / 60);
  return h > 0 ? (m % 60 ? `${h} h ${m % 60} min` : `${h} h`) : `${m} min`;
}

/** The carrier of the shop's own standard shipping: the one carrier it lists pickups for, or null (not known). */
export function standardCarrier(schedule: ShipSchedule): string | null {
  return schedule.pickups.length && new Set(schedule.pickups.map((p) => carrierKey(p.carrier) || p.carrier)).size === 1
    ? schedule.pickups[0].carrier : null;
}

/** The product-page promise for one item bought now, with the shop's standard shipping. */
export function productPromise(item: PromiseLine, now: Date, timeZone: string, schedule: ShipSchedule): ShipPromise {
  return promiseFor({ at: now, timeZone, schedule, lines: [item], carrier: standardCarrier(schedule), transit: schedule.standardTransit });
}

/** What the storefront is given to work dates out with: the schedule, only once the shop shows dates. */
export function publicSchedule(retailSettings: any): ShipSchedule | null {
  const s = scheduleFrom(retailSettings);
  return showsDates(s) ? s : null;
}

/**
 * The promise an order is placed with. The rate the customer picked supplies the carrier and its estimate; the
 * shop's own shipping (flat rate, free shipping, or a rate without an estimate) uses the shop's standard transit.
 * `shown` records whether the customer was shown these dates, which decides whether they are held to them.
 */
export function orderPromise(input: {
  at: Date | string; timeZone: string; schedule: ShipSchedule; lines: PromiseLine[];
  carrier?: string | null; service?: string | null; transitDays?: number | null;
}): ShipPromise & { shown: boolean } {
  const own = !input.carrier || /^shop$/i.test(String(input.carrier)) || !(Number(input.transitDays) > 0);
  const carrier = own ? (input.carrier && !/^shop$/i.test(String(input.carrier)) ? input.carrier : standardCarrier(input.schedule)) : input.carrier;
  const p = promiseFor({
    at: input.at, timeZone: input.timeZone, schedule: input.schedule, lines: input.lines,
    carrier, service: input.service || null,
    ...(own ? { transit: input.schedule.standardTransit } : { transitDays: Number(input.transitDays) }),
  });
  return { ...p, shown: showsDates(input.schedule) };
}

/**
 * The ship-by day an order stands at now. Shown to the customer: the day they were told, or the one a notice (by
 * hand, automatic, or a pre-order run) moved it to, which lives in shipPromiseAt. Not shown: the team's own date,
 * unless a notice has since told the customer one (shipPromiseAt otherwise holds the rule's 30 days, which is not a
 * ship-by day anyone works to). An order from before the schedule: whatever shipPromiseAt says.
 */
export function promisedDay(order: any, timeZone: string): string | null {
  const p = order?.promise;
  const saved = DAY_RE.test(String(p?.shipBy || '')) ? String(p.shipBy) : null;
  const deadline = String(order?.shipPromiseAt || '');
  const t = Date.parse(deadline);
  const stored = Number.isFinite(t) ? dayKey(new Date(t), timeZone) : null;
  if (!p) return stored;
  if (p.shown === true) return stored && deadline !== p.deadlineAt ? stored : saved || stored;
  return order?.notifiedForPromiseAt && stored ? stored : saved;
}

/** The arrival window for a ship day: transit counted in the days the carrier delivers. */
export function arrivalAfter(
  shipBy: string, transit: { min: number; max: number } | null | undefined, carrier?: string | null, holidays = true,
): { arriveFrom: string | null; arriveTo: string | null } {
  if (!transit || !(transit.min > 0) || !DAY_RE.test(shipBy)) return { arriveFrom: null, arriveTo: null };
  const ck = carrierKey(carrier);
  return { arriveFrom: deliveredAfter(shipBy, transit.min, ck, holidays), arriveTo: deliveredAfter(shipBy, Math.max(transit.min, transit.max), ck, holidays) };
}

export type CustomerDates = {
  shipBy: string;
  originalShipBy: string | null;   // the first date, when a notice moved it
  arriveFrom: string | null;
  arriveTo: string | null;
  carrierEta: string | null;       // the carrier's own estimate once it has the box
  service: string | null;
  carrier: string | null;
  timeZone: string;
};

/**
 * What a customer is shown for their order now: the ship-by day (moved by a delay notice, if there was one, with the
 * original kept so it can be struck through), the arrival window from it, and the carrier's own estimate once the box
 * is moving. Null when the customer was never shown dates, so no screen invents one.
 */
export function customerDates(order: any, fallbackZone?: string | null): CustomerDates | null {
  const p = order?.promise;
  if (!p || p.shown !== true || !DAY_RE.test(String(p.shipBy || ''))) return null;
  const tz = String(p.timeZone || fallbackZone || 'UTC');
  const shipBy = promisedDay(order, tz) || String(p.shipBy);
  const moved = shipBy !== p.shipBy;
  const transit = p.transit && Number(p.transit.min) > 0 ? { min: Number(p.transit.min), max: Number(p.transit.max) || Number(p.transit.min) } : null;
  const arrival = moved ? arrivalAfter(shipBy, transit, p.carrier) : { arriveFrom: p.arriveFrom || null, arriveTo: p.arriveTo || null };
  const eta = Date.parse(String(order?.carrierEtaAt || ''));
  return {
    shipBy,
    // Only a later date is "running behind"; one moved sooner (a pre-order that landed early) is simply the date.
    originalShipBy: shipBy > String(p.shipBy) ? String(p.shipBy) : null,
    ...arrival,
    carrierEta: Number.isFinite(eta) ? dayKey(new Date(eta), tz) : null,
    service: p.service || null,
    carrier: p.carrier || null,
    timeZone: tz,
  };
}
