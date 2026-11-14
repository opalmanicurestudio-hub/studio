// src/lib/table-booking.ts — TABLES BOOKED ONLINE (design canvas BookTable, BookHold, TableBookSettings). Pure: the
// business's settings, the times a guest can pick, and whether a party fits.
// - Off until the business turns it on (Hosting settings). The days and times it takes bookings, how many seats online
//   bookings can fill at once (a few kept back for walk-ins), the largest party online, how far ahead and how late.
// - A party fits a time when, all through its stay (how long a table that size usually stays here, lib/table-stage),
//   the guests booked in at the same time plus this party come to no more than those seats.
// - A card to hold big tables: from a party size the business picks. Nothing is charged when they book; a no-show or a
//   late cancel can be charged the fee they agreed to, by a manager, from the host stand.
import { turnFor, type FloorSettings } from '@/lib/table-stage';

export type TableBookingSettings = {
  on: boolean;
  /** Days of the week bookings are taken, 0 Sunday to 6 Saturday. */
  days: number[];
  /** First and last time a guest can pick ('HH:MM'), and how far apart the times are. */
  first: string;
  last: string;
  every: 15 | 30;
  /** Seats online bookings can fill at once. 0: the floor plan's seats. */
  seats: number;
  maxSize: number;
  aheadDays: number;
  /** The latest a table can be booked, in minutes before. */
  cutoffMin: number;
  /** A card to hold the table, from parties of `cardFrom`. */
  card: boolean;
  cardFrom: number;
  /** Dollars a guest, for a no-show or a cancel after `cancelHours` before. */
  feePerGuest: number;
  cancelHours: number;
};

export const DEFAULT_TABLE_BOOKING: TableBookingSettings = {
  on: false, days: [0, 1, 2, 3, 4, 5, 6], first: '17:00', last: '21:00', every: 30, seats: 0, maxSize: 8, aheadDays: 30, cutoffMin: 60,
  card: false, cardFrom: 6, feePerGuest: 20, cancelHours: 24,
};

/** What a guest can tell us when they book (shown on the host stand; never limits which table they get). */
export const BOOKING_ASKS = ['Birthday', 'Anniversary', 'High chair', 'Step-free access', 'Allergy', 'Quiet table'] as const;
export const MAX_NOTE = 200;
/** How long a big table is kept for a guest while they put in their card. */
export const CARD_HOLD_MIN = 15;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const int = (v: unknown, d: number, lo: number, hi: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
export const toMin = (hhmm: string) => { const m = HHMM.exec(String(hhmm || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
export const fromMin = (n: number) => `${String(Math.floor(n / 60) % 24).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function cleanTableBooking(raw: any): TableBookingSettings {
  const d = DEFAULT_TABLE_BOOKING; const x = raw && typeof raw === 'object' ? raw : {};
  const days = Array.isArray(x.days) ? Array.from(new Set(x.days.map((n: any) => Math.round(Number(n))).filter((n: number) => n >= 0 && n <= 6))).sort() as number[] : d.days;
  let first = HHMM.test(String(x.first || '')) ? String(x.first) : d.first; let last = HHMM.test(String(x.last || '')) ? String(x.last) : d.last;
  if (toMin(last) < toMin(first)) [first, last] = [last, first];
  return {
    on: x.on === true, days, first, last, every: Number(x.every) === 15 ? 15 : 30,
    seats: int(x.seats, d.seats, 0, 2000), maxSize: int(x.maxSize, d.maxSize, 1, 40), aheadDays: int(x.aheadDays, d.aheadDays, 1, 365), cutoffMin: int(x.cutoffMin, d.cutoffMin, 0, 2880),
    card: x.card === true, cardFrom: int(x.cardFrom, d.cardFrom, 1, 40), feePerGuest: x.feePerGuest === undefined || x.feePerGuest === null || x.feePerGuest === '' || !Number.isFinite(Number(x.feePerGuest)) ? d.feePerGuest : r2(Math.min(500, Math.max(0, Number(x.feePerGuest)))),
    cancelHours: int(x.cancelHours, d.cancelHours, 0, 168),
  };
}
export const tableBookingOf = (tenant: any): TableBookingSettings => cleanTableBooking(tenant?.hostingSettings?.booking);

/** The times guests can pick, in order. */
export function timesFor(s: TableBookingSettings): string[] {
  const a = toMin(s.first), b = toMin(s.last); const out: string[] = [];
  for (let t = a; Number.isFinite(t) && t <= b && out.length < 96; t += s.every) out.push(fromMin(t));
  return out;
}

/** The day of the week of a 'YYYY-MM-DD' (the calendar day itself, wherever the server is). */
export const weekdayOf = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
export const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A booking as it counts against the seats: its time, its size, and (a big table waiting for a card) until when. */
export type Held = { at: string; size: number; until?: string | null };
export const heldNow = (h: Held, now: number) => !h.until || Date.parse(h.until) > now;

/** The most guests in at once between `from` and `to` (minutes in the day), from these bookings. */
export function guestsIn(held: Held[], from: number, to: number, fs: FloorSettings): number {
  const spans = held.map((h) => { const a = toMin(h.at); return { a, b: a + turnFor(h.size, fs), n: Math.max(1, Math.round(Number(h.size) || 1)) }; }).filter((x) => Number.isFinite(x.a));
  const points = [from, ...spans.map((x) => x.a).filter((a) => a > from && a < to)];
  let most = 0;
  for (const p of points) { const n = spans.filter((x) => x.a <= p && p < x.b).reduce((s, x) => s + x.n, 0); if (n > most) most = n; }
  return most;
}

/** Whether a party this size fits at this time, with these seats. */
export function fits(held: Held[], time: string, size: number, seats: number, fs: FloorSettings): boolean {
  const a = toMin(time); if (!Number.isFinite(a) || size < 1) return false;
  return guestsIn(held, a, a + turnFor(size, fs), fs) + size <= seats;
}

export type Slot = { time: string; ok: boolean };
/** The times a guest can pick on a day: those still bookable (not past the latest), each open or full. `startOf` turns a
 *  day and time into the instant it is at the business. */
export function slotsFor(o: { day: string; size: number; s: TableBookingSettings; fs: FloorSettings; seats: number; held: Held[]; now: number; startOf: (day: string, time: string) => number }): Slot[] {
  const { day, size, s, fs, seats, held, now } = o;
  if (!s.on || !DAY.test(day) || !s.days.includes(weekdayOf(day)) || size < 1 || size > s.maxSize) return [];
  return timesFor(s).filter((t) => o.startOf(day, t) - s.cutoffMin * 60000 >= now).map((t) => ({ time: t, ok: fits(held, t, size, seats, fs) }));
}

export const cardNeeded = (size: number, s: TableBookingSettings) => s.card && s.feePerGuest > 0 && size >= s.cardFrom;
export const feeFor = (size: number, s: TableBookingSettings) => r2(Math.max(1, Math.round(size)) * s.feePerGuest);
/** Until when they can cancel without the fee. */
export const freeUntil = (arrivesAt: string, s: TableBookingSettings) => new Date(Date.parse(arrivesAt) - s.cancelHours * 3600000).toISOString();

export const cleanAsks = (v: unknown): string[] => (Array.isArray(v) ? Array.from(new Set(v.map(String).filter((x) => (BOOKING_ASKS as readonly string[]).includes(x)))) : []);
export const cleanNote = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE);

/** "Sat, Nov 16 at 7:00 pm for 8". */
export function bookingWords(arrivesAt: string, size: number, tz: string): string {
  const d = new Date(arrivesAt);
  const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).toLowerCase();
  return `${day} at ${time} for ${size}`;
}
export const money = (n: number) => `$${(Number(n) || 0).toFixed(Number.isInteger(Number(n)) ? 0 : 2)}`;
