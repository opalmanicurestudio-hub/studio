// src/lib/callout-timing.ts — when a client of a provider who called out must choose by (pure; no database).
// Used by lib/callout-choices on the server and by the practice game in the browser.
import { wallParts, wallToUtc, addDays } from '@/lib/tenant-time';
export const CALL_WITHIN_H = 3;
const H = 3600e3;
const ymd = (n: number, tz: string) => { const p = wallParts(new Date(n), tz); return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`; };
/** When this client must choose by. 0 = too soon to wait: the desk calls now. */
export function chooseByFor(startMs: number, now: number, tz: string, rule: any): number {
  const latest = startMs - CALL_WITHIN_H * H;
  let at: number;
  const hrs = Number(rule);
  if (Number.isFinite(hrs) && hrs > 0) at = startMs - hrs * H;
  else at = wallToUtc(addDays(ymd(startMs, tz), -1), 18, 0, tz).getTime();   // 6:00 PM the evening before
  at = Math.min(at, latest);
  return at < now + H ? 0 : at;
}

