// src/lib/capacity.ts — WHAT THE TEAM CAN SHIP IN A DAY, AND WHAT TO DO WHEN MORE IS DUE. Pure: the capacity screen,
// Needs you and the alerts check all read it the same way.
//   · Capacity: a number the shop sets, or worked out from the team's own busier days: over the last 30 days, the
//     shipped orders each person packing got through on a ship day; the upper quarter of those days (what the team has
//     shown it can do, not a quiet day's count) times the usual number of people packing. A busy period can set its
//     own, for the extra hands scheduled.
//   · Load: orders still to pack on each coming ship day, by the day they're due (late ones count on the first).
//   · Over capacity: a coming ship day with more to pack than that. The suggestions change nothing until someone
//     picks one: give new orders one more day (dates already promised stay), move the cutoff earlier on the day whose
//     orders land on it, or add a packer that day.
import { addDays, dayKey, startOfDay, wallToUtc } from './tenant-time';
import {
  clockLabel, cutoffFor, isCalendarDay, lastPickupAt, productPromise, promiseCarrier, teamDay,
  type BusyPeriod, type ShipSchedule,
} from './ship-promise';
import { dueAt, fulfilmentPolicy } from './retail-orders';
import { hasLabel, waitsOnStock, whenWord } from './ship-day';

export const CAPACITY_DAYS = 30;
const MIN_DAYS = 5;

export type TeamCapacity = { perPacker: number; packers: number; perDay: number; days: number };

const quantile = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))] : 0; };

/**
 * The team's own capacity, from shipped orders packed over the last 30 days (packedAt and who packed it): for each day,
 * orders per person packing; the upper quarter of those days times the usual number of people packing. Null with
 * fewer than five such days.
 */
export function teamCapacity(packed: any[], now: number, tz: string): TeamCapacity | null {
  const today = dayKey(new Date(now), tz);
  const since = addDays(today, -CAPACITY_DAYS);
  const byDay = new Map<string, { n: number; people: Set<string> }>();
  for (const o of packed) {
    if (o?.method !== 'ship' || o.digitalOnly === true || o.labelFromOrderId || o.shippedWithOrderId) continue;
    const t = Date.parse(String(o?.packedAt || ''));
    if (!Number.isFinite(t)) continue;
    const d = dayKey(new Date(t), tz);
    if (d >= today || d < since) continue;
    const e = byDay.get(d) || { n: 0, people: new Set<string>() };
    e.n++; if (o.claimedBy) e.people.add(String(o.claimedBy));
    byDay.set(d, e);
  }
  const days = [...byDay.values()];
  if (days.length < MIN_DAYS) return null;
  const perPacker = Math.max(1, Math.round(quantile(days.map((e) => e.n / Math.max(1, e.people.size)), 0.75)));
  const packers = Math.max(1, Math.round(quantile(days.map((e) => Math.max(1, e.people.size)), 0.5)));
  return { perPacker, packers, perDay: perPacker * packers, days: days.length };
}

/** What the team can ship on a day: a busy period's own number, else the shop's fixed one, else the team's. */
export function capacityOn(day: string, schedule: ShipSchedule, team: TeamCapacity | null): number | null {
  const period = schedule.busy.find((b) => b.from <= day && day <= b.to && (b.capacity || 0) > 0);
  if (period) return period.capacity!;
  if (schedule.capacity.mode === 'fixed') return schedule.capacity.perDay > 0 ? schedule.capacity.perDay : null;
  return team ? team.perDay : null;
}

const OPEN = ['paid', 'picking'];
/** Still to pack: shipped by the shop itself, not waiting on stock, not riding in another order's box. */
const toPack = (o: any) => o?.method === 'ship' && o.digitalOnly !== true && !o.labelFromOrderId && !o.shippedWithOrderId && OPEN.includes(String(o?.stage)) && !waitsOnStock(o) && !hasLabel(o);

/** The first day on or after `day` the shop ships with any carrier it uses (lib/ship-promise teamDay), so a holiday
 *  only USPS keeps isn't skipped for a shop that also ships UPS. */
export function nextTeamDay(day: string, schedule: ShipSchedule, carriers: (string | null | undefined)[] = []): string {
  let d = day;
  for (let i = 0; i < 60 && !teamDay(d, schedule, carriers).ships; i++) d = addDays(d, 1);
  return d;
}

/** Shipped orders packed today (riding ones aside): work today's capacity has already done. */
export function packedOn(packed: any[], day: string, tz: string): number {
  return packed.filter((o) => o?.method === 'ship' && o.digitalOnly !== true && !o.labelFromOrderId && !o.shippedWithOrderId
    && (() => { const t = Date.parse(String(o?.packedAt || '')); return Number.isFinite(t) && dayKey(new Date(t), tz) === day; })()).length;
}

/**
 * The coming ship days (today while its last pickup is ahead, else from the next one) and how many orders are still
 * to pack for each, by the day they're due; late ones count on the first. Today also counts what's already been packed
 * today (`packedToday`), since that came out of today's capacity. `cap` is that day's capacity.
 */
export function dayLoads(orders: any[], rs: any, tz: string, schedule: ShipSchedule, now: number, team: TeamCapacity | null, count = 5, packedToday = 0): { day: string; due: number; cap: number | null }[] {
  const today = dayKey(new Date(now), tz);
  const carriers = orders.filter(toPack).map(promiseCarrier);
  const td = teamDay(today, schedule, carriers);
  const last = lastPickupAt(today, tz, schedule, td.carrier);
  const todayOpen = td.ships && (!last || Date.parse(last) > now);
  const days: string[] = [];
  let d = todayOpen ? today : nextTeamDay(addDays(today, 1), schedule, carriers);
  for (let i = 0; i < count && i < 60; i++) { days.push(d); d = nextTeamDay(addDays(d, 1), schedule, carriers); }
  const counts = new Map(days.map((x) => [x, 0]));
  if (days[0] === today && packedToday > 0) counts.set(today, packedToday);
  const pol = fulfilmentPolicy(rs || {}, tz);
  for (const o of orders) {
    if (!toPack(o)) continue;
    const t = dueAt(o, pol);
    if (!Number.isFinite(t)) continue;
    const due = dayKey(new Date(t), tz);
    const on = due < days[0] ? days[0] : days.find((x) => x === due) || (due < days[days.length - 1] ? days.find((x) => x > due) : null);
    if (on) counts.set(on, (counts.get(on) || 0) + 1);
  }
  return days.map((x) => ({ day: x, due: counts.get(x) || 0, cap: capacityOn(x, schedule, team) }));
}

export type Over = { day: string; due: number; cap: number; by: number };
/** The coming ship days with more to pack than the team can ship. */
export function overDays(loads: { day: string; due: number; cap: number | null }[]): Over[] {
  return loads.filter((l) => l.cap !== null && l.due > l.cap).map((l) => ({ day: l.day, due: l.due, cap: l.cap!, by: l.due - l.cap! }));
}

export type Suggestion =
  | { kind: 'more_time'; title: string; detail: string; period: BusyPeriod }
  | { kind: 'early_cutoff'; title: string; detail: string; period: BusyPeriod }
  | { kind: 'packer'; title: string; detail: string; day: string };

/** A new busy period's own name, for changes to it (api/retail/ship-schedule). */
export const newBusyId = () => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/**
 * What would bring an over-capacity day back down, worked out from the schedule (nothing changes until someone picks
 * one):
 *   · One more day for new orders: a short busy period over just the days an order can start and land on the over day,
 *     adding a day, so those orders go the next ship day instead (orders that start earlier aren't moved onto it); dates
 *     already promised stay as they are. Only while new orders would still land on it.
 *   · An earlier cutoff on the last of those start days: orders after it start the next ship day. Only while that
 *     cutoff is still ahead, with at least half an hour to spare.
 *   · Another packer that day, with roughly what one more person covers.
 */
export function suggestionsFor(over: Over, schedule: ShipSchedule, now: number, tz: string, team: TeamCapacity | null): Suggestion[] {
  const today = dayKey(new Date(now), tz);
  const out: Suggestion[] = [];
  // The days an order can start (one placed now, or a minute past midnight later on) and be due on the over day.
  const starts: string[] = [];
  for (let d = today, i = 0; d <= over.day && i < 60; d = addDays(d, 1), i++) {
    const at = d === today ? new Date(now) : new Date(startOfDay(d, tz).getTime() + 60_000);
    const p = productPromise({}, at, tz, schedule);
    if (p.startsOn === d && p.shipBy === over.day) starts.push(d);
  }
  if (starts.length) {
    const first = starts[0], last = starts[starts.length - 1];
    const period: BusyPeriod = { id: newBusyId(), from: first, to: last, extraDays: 1, name: 'Catching up', auto: 'more_time' };
    const at = first === today ? new Date(now) : new Date(startOfDay(first, tz).getTime() + 60_000);
    const later = productPromise({}, at, tz, { ...schedule, busy: [...schedule.busy, period] }).shipBy;
    const on = (d: string) => { const w = whenWord(d, today, tz); return w === 'today' || w === 'tomorrow' ? w : `on ${w}`; };
    const placed = first === last ? on(first) : `${on(first)} through ${whenWord(last, today, tz)}`;
    out.push({ kind: 'more_time', title: 'Give new orders one more day', period,
      detail: first === today
        ? `From now on, new orders show “ships by ${whenWord(later, today, tz)}”. Orders already placed keep their dates.`
        : `Orders placed ${placed} show “ships by ${whenWord(later, today, tz)}” instead of ${whenWord(over.day, today, tz)}. Orders already placed keep their dates.` });
    // Two hours earlier (not before 9 AM), and only while that's still at least half an hour away.
    const [h, m] = cutoffFor(last, schedule).split(':').map(Number);
    const usual = (h || 0) * 60 + (m || 0);
    const earlier = Math.max(9 * 60, usual - 120);
    const time = `${String(Math.floor(earlier / 60)).padStart(2, '0')}:${String(earlier % 60).padStart(2, '0')}`;
    const cutAt = wallToUtc(last, Math.floor(earlier / 60), earlier % 60, tz).getTime();
    if (earlier < usual && cutAt - now >= 30 * 60_000) {
      const cut: BusyPeriod = { id: newBusyId(), from: last, to: last, extraDays: 0, cutoff: time, name: 'Earlier cutoff', auto: 'early_cutoff' };
      // When an order placed just after the new cutoff starts.
      const next = productPromise({}, new Date(cutAt + 60_000), tz, { ...schedule, busy: [...schedule.busy, cut] }).startsOn;
      out.push({ kind: 'early_cutoff', title: `Move ${possessive(whenWord(last, today, tz))} cutoff to ${clockLabel(time)}`, period: cut,
        detail: `Orders after ${clockLabel(time).replace(':00', '')} start ${whenWord(next, today, tz)}.` });
    }
  }
  out.push({ kind: 'packer', title: `Add a packer ${whenWord(over.day, today, tz)}`, day: over.day,
    detail: team ? `One more person packing covers about ${team.perPacker} orders.` : 'Each extra person packing takes some of the pile.' });
  return out;
}

const possessive = (w: string) => (w === 'today' ? 'today’s' : w === 'tomorrow' ? 'tomorrow’s' : `${w}’s`);

/** The over-capacity headline: 'Thursday is over by 12'. */
export function overTitle(over: Over, today: string, tz: string): string {
  const w = whenWord(over.day, today, tz);
  return `${w === 'today' ? 'Today' : w === 'tomorrow' ? 'Tomorrow' : w} is over by ${over.by}`;
}

/** Of the orders shipped in the last 30 days that had a ship-by day, the share that went out by the first one given.
 *  Null with fewer than five. */
export function onTimeRate(shipped: any[], now: number, tz: string): number | null {
  const since = addDays(dayKey(new Date(now), tz), -CAPACITY_DAYS);
  let n = 0, ok = 0;
  for (const o of shipped) {
    if (o?.method !== 'ship' || o.labelFromOrderId || o.shippedWithOrderId || !isCalendarDay(o?.promise?.shipBy)) continue;
    const t = Date.parse(String(o.completedAt || ''));
    if (!Number.isFinite(t)) continue;
    const day = dayKey(new Date(t), tz);
    if (day < since) continue;
    n++;
    if (day <= String(o.promise.shipBy)) ok++;
  }
  return n >= 5 ? Math.round((ok / n) * 100) : null;
}
