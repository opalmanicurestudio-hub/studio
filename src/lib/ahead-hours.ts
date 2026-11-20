// src/lib/ahead-hours.ts — PICKUP TIMES INSIDE OPENING HOURS (pure; design canvas "Ordering ahead inside opening
// hours"). The house hours (Settings → Opening hours: the active schedule's week, as the booking pages read them) decide
// when an order placed ahead can be picked up: from opening (or twenty minutes from now) to closing, and "as soon as it's
// ready" only while open with time left to make it. Hours that run past midnight (5 PM to 2 AM) count to the next
// morning. A business with no hours set has no limit, as before.
import { addDays, todayIn, wallToUtc } from '@/lib/tenant-time';

export type Window = { open: number; close: number };
/** What today's hours say: none set (no limit), or today's window (null: closed today) and the next opening after now. */
export type HoursNow = { set: false } | { set: true; today: Window | null; next: number | null };

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
/** "9:00 AM", "09:00 PM", "17:30" or "9" → minutes after midnight, or null. */
export function clockMinutes(v: unknown): number | null {
  const m = String(v ?? '').trim().toUpperCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/); if (!m) return null;
  let h = Number(m[1]); const min = m[2] ? Number(m[2]) : 0; const ap = m[3] || '';
  if (h > 23 || min > 59 || (ap && (h < 1 || h > 12))) return null;
  if (ap === 'PM' && h < 12) h += 12; if (ap === 'AM' && h === 12) h = 0;
  return h * 60 + min;
}

/** The house week: the active schedule's, as the booking pages read it; null when none is active (no limit). */
export function houseWeek(profiles: any[]): Record<string, any> | null {
  const p = (Array.isArray(profiles) ? profiles : []).find((x) => x && x.isActive === true && typeof x.week === 'object' && x.week);
  return p ? p.week : null;
}

const dayName = (date: string) => DAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
/** That calendar day's opening window in the business's zone (closing at or before opening runs past midnight), or null. */
function windowOn(week: Record<string, any>, date: string, tz: string): Window | null {
  const d = week[dayName(date)]; if (!d || d.enabled !== true) return null;
  const a = clockMinutes(d.start), z = clockMinutes(d.end); if (a === null || z === null || a === z) return null;
  const open = wallToUtc(date, Math.floor(a / 60), a % 60, tz).getTime();
  const close = z > a ? wallToUtc(date, Math.floor(z / 60), z % 60, tz).getTime() : wallToUtc(addDays(date, 1), Math.floor(z / 60), z % 60, tz).getTime();
  return Number.isFinite(open) && Number.isFinite(close) && close > open ? { open, close } : null;
}

/** Where today stands: the window that's open now or still to come today (last night's, while it runs past midnight),
 *  and the next opening after now (within a week). */
export function hoursNow(week: Record<string, any> | null, tz: string, now: number): HoursNow {
  if (!week) return { set: false };
  const today = todayIn(tz, new Date(now));
  const late = windowOn(week, addDays(today, -1), tz);
  const mine = windowOn(week, today, tz);
  const cur = late && now < late.close ? late : mine && now < mine.close ? mine : null;
  let next: number | null = null;
  for (let i = 0; i <= 7 && next === null; i++) { const w = windowOn(week, addDays(today, i), tz); if (w && w.open > now) next = w.open; }
  return { set: true, today: cur, next };
}

/** Whether a pickup time (ms) falls inside the hours: from opening to closing, both included. */
export const insideHours = (h: HoursNow, t: number): boolean => !h.set || (!!h.today && t >= h.today.open && t <= h.today.close);
/** "As soon as it's ready" while open, with at least `leadMin` minutes left before closing. */
export const asapOpen = (h: HoursNow, now: number, leadMin: number): boolean => !h.set || (!!h.today && now >= h.today.open && now + leadMin * 60000 <= h.today.close);
