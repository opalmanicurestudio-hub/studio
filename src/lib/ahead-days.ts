// src/lib/ahead-days.ts — ORDERS FOR ANOTHER DAY (pure; design board "Orders for another day"). Catering and big orders,
// picked up or delivered: the guest picks a day and a time, from the notice the business needs on, up to how far ahead it
// takes them, only when it's open (Settings, Opening hours; none set, 9 AM to 9 PM). It's paid when it's placed and waits
// (status 'scheduled', no tickets) until its day: a couple of hours before its time it goes to the kitchen screen, under
// Later until it's time to start (its slowest item, and more for a big order), and to the drivers when it's a delivery.
// The guest can cancel for a full refund until the notice runs out; a manager can until it goes to the kitchen.
//   tenants/{t}.orderAhead.anotherDay = { on, daysAhead: 3|7|14|30, noticeHours: 12|24|48|72, minCents: number|null }
//   counterOrders/{id}: day = its own day (its code and number are that day's), status 'scheduled' until it's sent,
//     ahead.forDay, ahead.later = { people, phone, cancelBy, releaseAt, noticeHours, wipe, cancel?, release?, sentAt? }
// Server: lib/ahead-days-server (sent on its day, cancel, the counter's Coming up); placing and paying: lib/counter-ahead.
import { addDays, todayIn, wallToUtc } from '@/lib/tenant-time';
import { windowOn } from '@/lib/ahead-hours';

export const DAYS_AHEAD = [3, 7, 14, 30] as const;
export const NOTICE_HOURS = [12, 24, 48, 72] as const;
/** Times for another day: every half hour. */
export const LATER_STEP_MIN = 30;
/** The smallest order a business can ask for (dollars), and the most people. */
export const MIN_ORDER_MAX = 5000;
export const PEOPLE_MAX = 500;
/** The most of one thing on a line for another day (20 otherwise). */
export const LATER_MAX_QTY = 100;
/** To the kitchen screen this long before its time at least (under Later until it's time to start). */
export const RELEASE_MS = 2 * 3600000;
/** A page a few minutes old: a time it offered still counts this long after it falls inside the notice. */
const GRACE_MS = 15 * 60000;

export type AnotherDay = { on: boolean; daysAhead: number; noticeHours: number; minCents: number | null };
export type DayChoice = { date: string; times: string[] };

/** The business's settings for orders for another day (off until it's turned on; a week ahead, a day's notice). */
export function anotherDayOf(tenant: any): AnotherDay {
  const a = tenant?.orderAhead?.anotherDay || {};
  const days = Number(a.daysAhead), hrs = Number(a.noticeHours), min = Number(a.minCents);
  return { on: a.on === true, daysAhead: (DAYS_AHEAD as readonly number[]).includes(days) ? days : 7, noticeHours: (NOTICE_HOURS as readonly number[]).includes(hrs) ? hrs : 24,
    minCents: a.minCents != null && Number.isFinite(min) && min > 0 && min <= MIN_ORDER_MAX * 100 ? Math.round(min) : null };
}

/** The smallest order as typed (dollars): cents, null for any size, undefined when it isn't one. */
export function cleanMinOrder(v: unknown): number | null | undefined {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > MIN_ORDER_MAX) return undefined;
  return n === 0 ? null : Math.round(n * 100);
}

/** How many people (optional): 1 to 500, null when not said, undefined when it isn't a number of people. */
export function cleanPeople(v: unknown): number | null | undefined {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > PEOPLE_MAX) return undefined;
  return n;
}

/** That day's opening window (no hours set: 9 AM to 9 PM in the business's zone), or null when it's closed that day. */
function openOn(week: Record<string, any> | null, date: string, tz: string): { open: number; close: number } | null {
  if (week) return windowOn(week, date, tz);
  const open = wallToUtc(date, 9, 0, tz).getTime(), close = wallToUtc(date, 21, 0, tz).getTime();
  return Number.isFinite(open) && Number.isFinite(close) ? { open, close } : null;
}

/** A day's times: every half hour from half an hour after opening to half an hour before closing, none sooner than the
 *  notice from now. */
export function dayTimes(a: AnotherDay, week: Record<string, any> | null, tz: string, date: string, now: number): string[] {
  const w = openOn(week, date, tz); if (!w) return [];
  const step = LATER_STEP_MIN * 60000; const earliest = now + a.noticeHours * 3600000;
  const out: string[] = [];
  for (let t = Math.ceil((w.open + step) / step) * step; t <= w.close - step; t += step) if (t >= earliest) out.push(new Date(t).toISOString());
  return out;
}

/** The days a guest can pick (tomorrow on, up to how far ahead), each with its times; a day with none isn't offered. */
export function dayChoices(a: AnotherDay, week: Record<string, any> | null, tz: string, now: number): DayChoice[] {
  const today = todayIn(tz, new Date(now)); const out: DayChoice[] = [];
  for (let i = 1; i <= a.daysAhead; i++) { const date = addDays(today, i); const times = dayTimes(a, week, tz, date, now); if (times.length) out.push({ date, times }); }
  return out;
}

/** Whether a day and time can be ordered for now (a time the page offered a few minutes ago still counts). */
export function laterOk(a: AnotherDay, week: Record<string, any> | null, tz: string, date: string, at: string, now: number): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const today = todayIn(tz, new Date(now));
  if (date <= today || date > addDays(today, a.daysAhead)) return false;
  const t = Date.parse(at); if (!Number.isFinite(t)) return false;
  return dayTimes(a, week, tz, date, now - GRACE_MS).some((x) => Date.parse(x) === t);
}

type LineLike = { quantity?: unknown; makeSeconds?: unknown };
const itemsIn = (lines: LineLike[]) => (lines || []).reduce((n, l) => n + Math.max(1, Math.round(Number(l?.quantity) || 1)), 0);
/** How long before its time the kitchen starts: its slowest item and two minutes, and for a big order three minutes an
 *  item past six, up to an hour more. */
export function leadMs(lines: LineLike[]): number {
  const slowest = Math.max(60, ...(lines || []).map((l) => Number(l?.makeSeconds) || 0));
  return (slowest + 120) * 1000 + Math.min(60, Math.max(0, itemsIn(lines) - 6) * 3) * 60000;
}
/** When the kitchen starts on it (its tickets wait under Later until then). */
export const startsAt = (at: number, lines: LineLike[]) => at - leadMs(lines);
/** When it goes to the kitchen screen: two hours before its time, or sooner by its own lead. */
export const releaseAt = (at: number, lines: LineLike[]) => at - Math.max(RELEASE_MS, leadMs(lines));
/** Until when the guest can cancel for a full refund: the notice before its time. */
export const cancelBy = (at: number, noticeHours: number) => at - noticeHours * 3600000;

/** An order for another day (placed for a later day, paid, waiting or since sent). */
export const isLater = (o: any) => !!o?.ahead?.forDay;
/** The time an order belongs to for the night it's counted in: for another day, its own time; otherwise when it was paid
 *  (or started). */
export const ownTime = (o: any): string => String((o?.ahead?.forDay && o.ahead.at) || o?.paidAt || o?.createdAt || '');

/** "Saturday, Nov 29" (long) or "Sat 29" (short), for a day in the business's calendar. */
export function dayWords(date: string, short = false): string {
  const d = new Date(`${date}T12:00:00Z`); if (!Number.isFinite(d.getTime())) return date;
  if (short) return `${d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })} ${d.getUTCDate()}`;
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
