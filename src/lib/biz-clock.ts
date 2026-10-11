// src/lib/biz-clock.ts — THE BUSINESS'S CLOCK ON A TEAM MEMBER'S PHONE (staff app). A phone keeps its own time zone
// (someone travelling, or a phone set wrong), so "today", "now" and an appointment's time have to come from the
// business's zone or the day view, walk-in queue and greetings show the wrong day near midnight.
//
// The staff app sets the zone once the business loads (setBizZone). Then:
//   biz(instant)  → a Date whose ordinary fields (getHours, date-fns format…) read as the business's wall clock.
//                   Only for SHOWING times and placing them on a day — never save one, and never subtract it from a
//                   real instant (elapsed timers keep using real instants).
//   bizNow()      → the business's "now" in that same form; its calendar day is the business's today.
//   bizKey(d?)    → 'YYYY-MM-DD' of an instant in the business's zone (defaults to now).
//   bizDayStart(key) → the real instant the business's day begins.
// With no zone set (or an invalid one) everything falls back to the phone's own clock, as before.
import { isValidTimeZone, wallParts, dayKey, startOfDay as zoneDayStart } from '@/lib/tenant-time';

let zone = '';
export function setBizZone(tz?: string | null) { const t = String(tz || '').trim(); zone = isValidTimeZone(t) ? t : ''; }
export const bizZone = () => zone;

export function biz(d: Date): Date {
  if (!zone || !(d instanceof Date) || isNaN(+d)) return d;
  const p = wallParts(d, zone); return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, d.getMilliseconds());
}
export const bizNow = () => biz(new Date());
const localKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const bizKey = (d: Date = new Date()) => (zone ? dayKey(d, zone) : localKey(d));
export function bizDayStart(key: string): Date {
  if (zone) return zoneDayStart(key, zone);
  const [y, m, dd] = key.split('-').map(Number); return new Date(y, m - 1, dd);
}
