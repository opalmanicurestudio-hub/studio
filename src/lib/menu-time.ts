// src/lib/menu-time.ts — MENUS BY TIME OF DAY, AND HAPPY HOUR (design canvas "The counter and the menus"). Set on the
// Menu page:
//   - the menus by time of day ("dayparts"): Breakfast 7 to 11 AM, Lunch 11 AM to 3 PM… An item put in one or more is
//     sold only while one of them is on (an item in none is sold all day). Outside them, screens say when it's back
//     ("Breakfast, from 7 AM"), and nothing can be ordered from them.
//   - happy hour: the days and hours, and each item's happy-hour price. The price when it's ordered is the price at
//     checkout: a table's line ordered at 5:55 keeps its happy-hour price when the check is paid at 8.
// Every time is the business's own (its time zone). A window can run past midnight (10 PM to 2 AM). Pure.
import { tenantTimeZone } from '@/lib/tenant-time';

export type Daypart = { id: string; name: string; from: string; to: string };
export type HappyHour = { on: boolean; days: number[]; from: string; to: string };
export const MAX_DAYPARTS = 6;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const mins = (hhmm: string) => { const m = HHMM.exec(hhmm); return m ? Number(m[1]) * 60 + Number(m[2]) : -1; };

export function cleanDayparts(raw: unknown): Daypart[] {
  const out: Daypart[] = []; const seen = new Set<string>();
  for (const d of Array.isArray(raw) ? raw.slice(0, MAX_DAYPARTS) : []) {
    const id = String((d as any)?.id || ''); const name = clip((d as any)?.name, 30); const from = String((d as any)?.from || ''); const to = String((d as any)?.to || '');
    if (!ID.test(id) || seen.has(id) || !name || !HHMM.test(from) || !HHMM.test(to) || from === to) continue;
    seen.add(id); out.push({ id, name, from, to });
  }
  return out;
}
export function cleanHappyHour(raw: any): HappyHour {
  const days = Array.from(new Set((Array.isArray(raw?.days) ? raw.days : []).map((x: any) => Math.floor(Number(x))).filter((x: number) => x >= 0 && x <= 6))).sort() as number[];
  const from = HHMM.test(String(raw?.from || '')) ? String(raw.from) : '16:00'; const to = HHMM.test(String(raw?.to || '')) ? String(raw.to) : '18:00';
  return { on: raw?.on === true && days.length > 0 && from !== to, days, from, to };
}
export const daypartsOf = (tenant: any): Daypart[] => cleanDayparts(tenant?.menuSettings?.dayparts);
export const happyHourOf = (tenant: any): HappyHour => cleanHappyHour(tenant?.menuSettings?.happyHour);

/** The day of the week (0 Sunday) and minute of the day at the business. */
export function localNow(tenant: any, at: Date = new Date()): { day: number; min: number } {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tenantTimeZone(tenant), weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
    const get = (t: string) => p.find((x) => x.type === t)?.value || '';
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
    return { day: day < 0 ? at.getDay() : day, min: Number(get('hour')) * 60 + Number(get('minute')) };
  } catch { return { day: at.getDay(), min: at.getHours() * 60 + at.getMinutes() }; }
}
/** Whether a window is on at a minute of the day (one running past midnight too). */
export function inWindow(from: string, to: string, min: number): boolean {
  const a = mins(from), b = mins(to); if (a < 0 || b < 0 || a === b) return false;
  return a < b ? min >= a && min < b : min >= a || min < b;
}
/** "7 AM", "11:30 AM". */
export function timeWords(hhmm: string): string {
  const m = mins(hhmm); if (m < 0) return hhmm;
  const h = Math.floor(m / 60), mm = m % 60; const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}
export const windowWords = (from: string, to: string) => `${timeWords(from)} to ${timeWords(to)}`;

/** An item's menus by time of day (the business's own that it's in). None: sold all day. */
export function partsOfItem(item: any, tenant: any): Daypart[] {
  const ids = Array.isArray(item?.dayparts) ? item.dayparts.map(String) : [];
  return ids.length ? daypartsOf(tenant).filter((d) => ids.includes(d.id)) : [];
}
/** Whether an item can be ordered now, and if not, when it's next on ("Breakfast, from 7 AM"). */
export function servedNow(item: any, tenant: any, at: Date = new Date()): { ok: true } | { ok: false; when: string } {
  const parts = partsOfItem(item, tenant); if (!parts.length) return { ok: true };
  const { min } = localNow(tenant, at);
  if (parts.some((d) => inWindow(d.from, d.to, min))) return { ok: true };
  // The next one to start (today, or else the first tomorrow).
  const next = parts.slice().sort((a, b) => ((mins(a.from) - min + 1440) % 1440) - ((mins(b.from) - min + 1440) % 1440))[0];
  return { ok: false, when: `${next.name}, from ${timeWords(next.from)}` };
}
/** The menu by time of day that's on now (for the screens' "Lunch until 3 PM"), if any. */
export function daypartNow(tenant: any, at: Date = new Date()): (Daypart & { until: string }) | null {
  const { min } = localNow(tenant, at); const d = daypartsOf(tenant).find((x) => inWindow(x.from, x.to, min));
  return d ? { ...d, until: timeWords(d.to) } : null;
}

/** Whether it's happy hour at the business. */
export function inHappyHour(tenant: any, at: Date = new Date()): boolean {
  const h = happyHourOf(tenant); if (!h.on) return false;
  const { day, min } = localNow(tenant, at);
  // (A window past midnight belongs to the day it started.)
  const startDay = mins(h.from) > mins(h.to) && min < mins(h.to) ? (day + 6) % 7 : day;
  return h.days.includes(startDay) && inWindow(h.from, h.to, min);
}
/** An item's happy-hour price, when it has one below its price. */
export function happyPriceOf(item: any): number | null {
  const p = Number(item?.happyPrice); const full = Number(item?.price);
  if (item?.happyPrice === null || item?.happyPrice === undefined || item?.happyPrice === '' || !Number.isFinite(p) || p < 0) return null;
  return Number.isFinite(full) && p < full ? Math.round(p * 100) / 100 : null;
}
/** The item's price at a moment: its happy-hour price during happy hour, otherwise its price. */
export function priceNow(item: any, tenant: any, at: Date = new Date()): { price: number; happy: boolean } {
  const full = Math.max(0, Math.round((Number(item?.price) || 0) * 100) / 100);
  const hp = happyPriceOf(item);
  return hp !== null && inHappyHour(tenant, at) ? { price: hp, happy: true } : { price: full, happy: false };
}
