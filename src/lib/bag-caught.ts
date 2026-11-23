// src/lib/bag-caught.ts — CAUGHT BEFORE IT WENT (pure; design board "The extras in the bag, and what got caught";
// lib/bag-caught-server; Drive-thru live, its third tab). What the check before an order to go caught, by shift:
//   - orders to go handed over;
//   - a wrong item caught: a bag label or item sticker from another order scanned for this one, each once (kept as it's
//     scanned, on the order being handed over, a car's own order when it carries one placed ahead too: order.checks.wrongs,
//     lib/food-bags-server noteWrong);
//   - held, something missing: a handover refused while an item's sticker or an extra was still to go in, or a bag
//     still to scan (order.checks.held), and what it was (order.checks.missing: items and extras by name);
//   - let go with a manager's PIN, and why (order.bags.skipped); who okayed it for managers only;
//   - went without a code: a bag label or item sticker printed in words only, so it couldn't be scanned.
// Shifts are the menu's own times of day (lib/menu-time), or morning, afternoon and evening when it has none. Nothing is
// kept for the report itself: it's read from the orders.
//   tenants/{t}/counterOrders/{id}.checks = { wrongs: [which bag or sticker], held: true, missing: [names] }
import { bagsOf } from '@/lib/food-bags';
import { goesOut, stickersOf } from '@/lib/item-stickers';
import type { Daypart } from '@/lib/menu-time';

export type CaughtShift = { id: string; name: string; orders: number; wrong: number; held: number; skipped: number; noCode: number };
export type CaughtReport = {
  shifts: CaughtShift[]; total: CaughtShift;
  /** Most often missing when someone tried to hand it over: each order counts a name once. */
  missing: { name: string; n: number }[];
  /** Let go with a PIN: why, and who (managers only), with how many. */
  skips: { reason: string; by: string | null; n: number }[];
  /** Went without a code: orders whose bag labels were words only, and item stickers that were. */
  noCode: { labels: number; stickers: number };
};

const words = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
/** An item or extra as it's counted missing: "Iced matcha" (not its choices), "Ranch" (not how many). */
export const missName = (v: unknown, extra = false) => words(extra ? String(v ?? '').replace(/^\s*\d+\s+/, '') : String(v ?? '').split(',')[0], 60);
/** Each name once, whatever its case, as it was first written. */
const firstOfEach = (list: string[]) => { const seen = new Map<string, string>(); for (const x of list) if (!seen.has(x.toLowerCase())) seen.set(x.toLowerCase(), x); return Array.from(seen.values()); };
/** What the check kept on an order. */
export function checksOf(order: any): { wrong: number; held: boolean; missing: string[] } {
  const c = order?.checks || {};
  return { wrong: Math.min(99, new Set((Array.isArray(c.wrongs) ? c.wrongs : []).map(String)).size), held: c.held === true,
    missing: firstOfEach((Array.isArray(c.missing) ? c.missing : []).map((x: unknown) => words(x, 60)).filter(Boolean)).slice(0, 20) };
}

/** The minute of the day an ISO time falls on in a time zone. */
export function minuteIn(iso: string, tz: string): number {
  const d = new Date(iso); if (!Number.isFinite(d.getTime())) return 0;
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
    return (Number(p.find((x) => x.type === 'hour')?.value) % 24) * 60 + Number(p.find((x) => x.type === 'minute')?.value || 0);
  } catch { return d.getUTCHours() * 60 + d.getUTCMinutes(); }
}
const mins = (hhmm: string) => { const m = /^(\d{2}):(\d{2})$/.exec(hhmm); return m ? Number(m[1]) * 60 + Number(m[2]) : -1; };
const FIXED = [{ id: 'morning', name: 'Morning', to: 720 }, { id: 'afternoon', name: 'Afternoon', to: 1020 }, { id: 'evening', name: 'Evening', to: 1440 }];
/** The shifts, in order: the menu's times of day (and "Other times" for the rest), or morning, afternoon and evening. */
export const shiftsFor = (dayparts: Daypart[]) => (dayparts.length ? [...dayparts.map((d) => ({ id: d.id, name: d.name })), { id: 'other', name: 'Other times' }] : FIXED.map(({ id, name }) => ({ id, name })));
/** Which shift a minute of the day falls in. */
export function shiftOf(minute: number, dayparts: Daypart[]): { id: string; name: string } {
  if (!dayparts.length) { const f = FIXED.find((x) => minute < x.to) || FIXED[2]; return { id: f.id, name: f.name }; }
  for (const d of dayparts) {
    const a = mins(d.from), b = mins(d.to); if (a < 0 || b < 0) continue;
    if (a < b ? minute >= a && minute < b : minute >= a || minute < b) return { id: d.id, name: d.name };
  }
  return { id: 'other', name: 'Other times' };
}

const zero = (id: string, name: string): CaughtShift => ({ id, name, orders: 0, wrong: 0, held: 0, skipped: 0, noCode: 0 });
/** The report from the orders handed over in the stretch (any order; only those to go count). `who`: say who okayed
 *  each PIN (for a manager). */
export function caughtReport(orders: any[], dayparts: Daypart[], tz: string, o: { who: boolean }): CaughtReport {
  const order = shiftsFor(dayparts); const by = new Map<string, CaughtShift>(order.map((s) => [s.id, zero(s.id, s.name)]));
  const total = zero('all', 'All day'); const missing = new Map<string, { name: string; n: number }>(); const skips = new Map<string, { reason: string; by: string | null; n: number }>();
  const noCode = { labels: 0, stickers: 0 };
  for (const x of orders) {
    if (!x || x.status !== 'done' || !goesOut(x) || !x.doneAt) continue;
    const s = shiftOf(minuteIn(String(x.doneAt), tz), dayparts); const row = by.get(s.id) || by.set(s.id, zero(s.id, s.name)).get(s.id)!;
    const c = checksOf(x); const b = bagsOf(x); const st = stickersOf(x);
    const skip = x.bags?.skipped && typeof x.bags.skipped === 'object' && x.bags.skipped.by ? x.bags.skipped : null;
    const uncoded = st ? st.list.filter((y) => !y.c).length : 0; const labelWords = !!b && !b.coded;
    for (const r of [row, total]) { r.orders++; r.wrong += c.wrong; r.held += c.held ? 1 : 0; r.skipped += skip ? 1 : 0; r.noCode += labelWords || uncoded ? 1 : 0; }
    for (const m of c.missing) { const k = m.toLowerCase(); const was = missing.get(k); missing.set(k, { name: was?.name || m, n: (was?.n || 0) + 1 }); }
    if (skip) { const reason = words(skip.reason, 60) || 'Not said'; const who = o.who ? words(skip.by, 60) || null : null; const k = `${reason}|${who || ''}`; const was = skips.get(k); skips.set(k, { reason, by: who, n: (was?.n || 0) + 1 }); }
    if (labelWords) noCode.labels++; noCode.stickers += uncoded;
  }
  return {
    shifts: Array.from(by.values()).filter((r) => r.orders > 0),
    total,
    missing: Array.from(missing.values()).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).slice(0, 6),
    skips: Array.from(skips.values()).sort((a, b) => b.n - a.n || a.reason.localeCompare(b.reason)).slice(0, 8),
    noCode,
  };
}
