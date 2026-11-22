// src/lib/speed.ts — SPEED OF SERVICE (pure; design board "Speed of service, and what slows it"; lib/speed-server; the
// Drive-thru live page's second tab). For the drive-thru, the counter, curbside and pickups ordered ahead: how fast
// (average against the target, how many were under it, how many, the longest), where the drive-thru's time goes
// (waiting to be greeted, ordering, getting to the window, at the window), when it's busiest and slowest (each weekday
// by hour), and every guest who waited too long.
// - Each guest served is one record: how long they waited (from pulling up, or saying they're here, until it was
//   handed over), the hour they got there, and, at the drive-thru, where the time went. A day's records are kept small
//   (lib/speed-server), so a month is read in a moment.
// - The long wait alert: a car waiting longer than the business's choice (4 or 5 minutes, or off) buzzes the shift
//   lead's phone once, with where it's stuck.
import { clock, timesOf } from '@/lib/drive-live';

export type SpeedCh = 'drive' | 'counter' | 'curb' | 'ahead';
export const SPEED_CHS: { id: SpeedCh; label: string; from: string }[] = [
  { id: 'drive', label: 'Drive-thru', from: 'from pulling up to handed over' },
  { id: 'counter', label: 'Counter', from: 'from ordering to handed over' },
  { id: 'curb', label: 'Curbside', from: 'from saying they’re here to handed over' },
  { id: 'ahead', label: 'Pickups ahead', from: 'from saying they’re here to handed over' },
];
/** Curbside: a guest outside this long is waiting long (the curbside screen says so at five minutes too). Pickups ordered
 *  ahead: it should be ready when they get here, so two minutes. */
export const CURB_TARGET = 300, AHEAD_TARGET = 120;
export type SpeedRange = 'today' | '7' | '30';
export const SPEED_RANGES: { id: SpeedRange; label: string; days: number }[] = [{ id: 'today', label: 'Today', days: 1 }, { id: '7', label: '7 days', days: 7 }, { id: '30', label: '30 days', days: 30 }];

export type Part = 'greet' | 'ordering' | 'toWindow' | 'atWindow';
export const PARTS: { id: Part; label: string; words: string }[] = [
  { id: 'greet', label: 'waiting to be greeted', words: 'waiting to be greeted' },
  { id: 'ordering', label: 'ordering', words: 'ordering' },
  { id: 'toWindow', label: 'to the window', words: 'from the order to the window' },
  { id: 'atWindow', label: 'at the window', words: 'at the window' },
];

/** One guest served. `hour`: the hour (0 to 23, in the business's time) they got there, -1 when that was the day
 *  before the one they were served; `parts`: the drive-thru's, -1
 *  for a part it didn't have. */
export type SpeedRec = { ch: SpeedCh; sec: number; hour: number; endHour?: number; startMs: number; parts: Record<Part, number>; number: string; orderId: string | null; name?: string | null };
/** A guest who waited a long time, as the list shows them. */
export type LongWait = { ch: SpeedCh; number: string; name: string | null; at: string; sec: number; parts: Record<Part, number>; orderId?: string | null };
/** A day, kept small: per kind, each guest as seven numbers (STRIDE), and the longest waits. */
export type SpeedDay = { v: number; day: string; wd: number; ch: Record<SpeedCh, { r: number[]; long: LongWait[] }> };
export const SPEED_DAY_VERSION = 2;
/** Seven numbers a guest: seconds, the hour they got here, the hour they were handed over, then the four parts. */
export const STRIDE = 7;
const noParts = (): Record<Part, number> => ({ greet: -1, ordering: -1, toWindow: -1, atWindow: -1 });
const ok = (n: number) => Number.isFinite(n) && n >= 0;

/** A drive-thru or counter guest from their place in line (driveThruCars), once handed over: null when they left,
 *  were taken off, or the times don't add up. A car taken in line ordered before the speaker: no parts, as on the lane
 *  screen. */
export function carRec(c: any, hourOf: (ms: number) => number): SpeedRec | null {
  if (!c || c.left === true || c.voided === true || c.stage !== 'gone') return null;
  const start = Date.parse(String(c.arrivedAt || '')), end = Date.parse(String(c.goneAt || ''));
  const sec = Math.round((end - start) / 1000); if (!ok(sec) || sec > 3 * 3600) return null;
  const counterSide = c.channel === 'counter' || c.channel === 'kiosk';
  const parts = noParts();
  if (!counterSide && c.inLine !== true && c.wasInLine !== true) {
    const x = timesOf({ stage: 'pickup', since: String(c.arrivedAt), stageAt: c.stageAt || {}, inLine: false, ahead: c.ahead === true, greetedAt: c.greetedAt || null }, end);
    for (const p of ['greet', 'ordering', 'toWindow', 'atWindow'] as Part[]) { const v = x[p]; if (v !== null && ok(v)) parts[p] = Math.min(v, sec); }
  }
  return { ch: counterSide ? 'counter' : 'drive', sec, hour: hourOf(start), endHour: hourOf(end), startMs: start, parts, number: String(c.number || '').slice(0, 12), orderId: typeof c.orderId === 'string' ? c.orderId : null };
}
/** A guest who ordered ahead and came for it (inside, or at the drive-thru), or a café curbside order, once handed over:
 *  from when they said they're here. */
export function aheadRec(o: any, hourOf: (ms: number) => number): SpeedRec | null {
  if (!o || o.channel !== 'ahead' || o.status !== 'done') return null;
  const way = String(o.ahead?.way || 'inside'); if (way === 'delivery') return null;
  const start = Date.parse(String(o.ahead?.hereAt || '')); const end = Date.parse(String((way === 'curbside' ? o.ahead?.curb?.handedAt : null) || o.doneAt || ''));
  const sec = Math.round((end - start) / 1000); if (!ok(sec) || sec > 3 * 3600) return null;
  return { ch: way === 'curbside' ? 'curb' : 'ahead', sec, hour: hourOf(start), endHour: hourOf(end), startMs: start, parts: noParts(), number: String(o.number || '').slice(0, 12), orderId: typeof o.id === 'string' ? o.id : null, name: o.guestName || null };
}
/** A shop order collected at the curb, once handed over: from when they said they're here. */
export function shopCurbRec(o: any, hourOf: (ms: number) => number): SpeedRec | null {
  if (!o || String(o.method || '') !== 'curbside' || o.stage !== 'completed') return null;
  const start = Date.parse(String(o.curbside?.arrivedAt || '')), end = Date.parse(String(o.completedAt || ''));
  const sec = Math.round((end - start) / 1000); if (!ok(sec) || sec > 3 * 3600) return null;
  return { ch: 'curb', sec, hour: hourOf(start), endHour: hourOf(end), startMs: start, parts: noParts(), number: o.orderNumber ? `#${String(o.orderNumber).slice(0, 10)}` : 'Shop order', orderId: null, name: o.customerName ? String(o.customerName).split(/\s+/)[0] : null };
}

/** A day's records, kept small (the ten longest waits of each kind with their names). */
export function dayOf(day: string, wd: number, recs: SpeedRec[], iso: (ms: number) => string): SpeedDay {
  const ch = Object.fromEntries(SPEED_CHS.map((c) => [c.id, { r: [] as number[], long: [] as LongWait[] }])) as SpeedDay['ch'];
  for (const x of recs) ch[x.ch].r.push(x.sec, x.hour, x.endHour ?? x.hour, x.parts.greet, x.parts.ordering, x.parts.toWindow, x.parts.atWindow);
  for (const c of SPEED_CHS) ch[c.id].long = recs.filter((x) => x.ch === c.id).sort((a, b) => b.sec - a.sec).slice(0, 10)
    .map((x) => ({ ch: x.ch, number: x.number, name: x.name || null, at: iso(x.startMs), sec: x.sec, parts: x.parts, orderId: x.orderId || null }));
  return { v: SPEED_DAY_VERSION, day, wd, ch };
}

export type Cell = { n: number; sum: number; parts: Record<Part, [number, number]> };
export type SpeedReport = {
  ch: SpeedCh; range: SpeedRange; target: number; n: number; average: number | null; under: number | null; longest: LongWait | null;
  /** Where the time goes (the drive-thru): each part's average, for the guests that had it. */
  parts: Record<Part, number | null> | null;
  /** Guests by weekday (0 Sunday) and hour, and how long they waited. */
  heat: Record<string, { n: number; avg: number }>; hours: [number, number]; days: Record<number, number>;
  busiest: { wd: number | null; hour: number; perDay: number } | null;
  slowest: { wd: number | null; hour: number; avg: number; part: Part | null } | null;
  long: LongWait[];
};

/** The report for one kind of guest across some days (`target`: their target, in seconds). */
export function speedReport(days: SpeedDay[], chId: SpeedCh, range: SpeedRange, target: number): SpeedReport {
  const cells = new Map<string, Cell>(); const dayCount: Record<number, number> = {};
  const partSum: Record<Part, [number, number]> = { greet: [0, 0], ordering: [0, 0], toWindow: [0, 0], atWindow: [0, 0] };
  let n = 0, sum = 0, under = 0; const long: LongWait[] = [];
  for (const d of days) {
    dayCount[d.wd] = (dayCount[d.wd] || 0) + 1;
    const c = d.ch?.[chId]; if (!c) continue;
    long.push(...(c.long || []));
    for (let i = 0; i + STRIDE <= c.r.length; i += STRIDE) {
      const sec = c.r[i], hour = c.r[i + 1]; n++; sum += sec; if (sec <= target) under++;
      // (One who got here the day before is in the totals, in no hour.)
      const ps = (['greet', 'ordering', 'toWindow', 'atWindow'] as Part[]).map((p, j) => [p, c.r[i + 3 + j]] as [Part, number]).filter(([, v]) => v >= 0);
      for (const [p, v] of ps) { partSum[p][0] += v; partSum[p][1]++; }
      if (hour < 0) continue;
      const k = `${d.wd}-${hour}`; const cell = cells.get(k) || { n: 0, sum: 0, parts: { greet: [0, 0], ordering: [0, 0], toWindow: [0, 0], atWindow: [0, 0] } };
      cell.n++; cell.sum += sec;
      for (const [p, v] of ps) { cell.parts[p][0] += v; cell.parts[p][1]++; }
      cells.set(k, cell);
    }
  }
  const heat: SpeedReport['heat'] = {}; let lo = 23, hi = 0;
  for (const [k, c] of Array.from(cells.entries())) { heat[k] = { n: c.n, avg: Math.round(c.sum / c.n) }; const h = Number(k.split('-')[1]); lo = Math.min(lo, h); hi = Math.max(hi, h); }
  // Busiest: the weekday and hour with the most guests on an average such day (today: the busiest hour).
  let busiest: SpeedReport['busiest'] = null;
  for (const [k, c] of Array.from(cells.entries())) { const [wd, h] = k.split('-').map(Number); const per = c.n / Math.max(1, dayCount[wd] || 1); if (!busiest || per > busiest.perDay) busiest = { wd, hour: h, perDay: per }; }
  // Slowest: the weekday and hour with the longest average wait, among those with a few guests at least; and the part
  // that took longest then (the drive-thru).
  let slowest: SpeedReport['slowest'] = null;
  const fewest = range === 'today' ? 2 : 3;
  for (const [k, c] of Array.from(cells.entries())) {
    if (c.n < fewest) continue; const [wd, h] = k.split('-').map(Number); const avg = Math.round(c.sum / c.n);
    if (!slowest || avg > slowest.avg) {
      const avgs = (Object.keys(c.parts) as Part[]).filter((p) => c.parts[p][1]).map((p) => [p, c.parts[p][0] / c.parts[p][1]] as [Part, number]);
      slowest = { wd, hour: h, avg, part: avgs.length ? avgs.sort((a, b) => b[1] - a[1])[0][0] : null };
    }
  }
  if (range === 'today') { if (busiest) busiest.wd = null; if (slowest) slowest.wd = null; }
  const hasParts = chId === 'drive' && (Object.values(partSum) as [number, number][]).some((x) => x[1] > 0);
  const top = long.sort((a, b) => b.sec - a.sec);
  return {
    ch: chId, range, target, n, average: n ? Math.round(sum / n) : null, under: n ? under / n : null, longest: top[0] || null,
    parts: hasParts ? (Object.fromEntries((Object.keys(partSum) as Part[]).map((p) => [p, partSum[p][1] ? Math.round(partSum[p][0] / partSum[p][1]) : null])) as Record<Part, number | null>) : null,
    heat, hours: cells.size ? [Math.min(lo, 7), Math.max(hi, 19)] : [7, 19], days: dayCount, busiest, slowest,
    long: top.filter((x) => x.sec > target).slice(0, 8),
  };
}

const WD = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const WD_ONE = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** "12 to 1", "8 to 9 am". */
export function hourWords(h: number): string {
  const f = (x: number) => { const y = x % 12 || 12; return String(y); };
  const ap = (x: number) => (x % 24 < 12 ? 'am' : 'pm');
  return ap(h) === ap(h + 1) ? `${f(h)} to ${f(h + 1)} ${ap(h)}` : `${f(h)} ${ap(h)} to ${f(h + 1)} ${ap(h + 1)}`;
}
/** "Saturdays, 12 to 1 pm" (a weekday seen once in the days asked for: "Saturday, …"; today: "12 to 1 pm"). */
export function whenWords(wd: number | null, hour: number, days: Record<number, number>): string {
  if (wd === null) return hourWords(hour);
  return `${(days[wd] || 0) > 1 ? WD[wd] : WD_ONE[wd]}, ${hourWords(hour)}`;
}
/** Where a long wait went: "Most of it at the window: 6:10". */
export function longWords(w: LongWait): string {
  const ps = (Object.keys(w.parts) as Part[]).filter((p) => w.parts[p] >= 0);
  if (!ps.length) return '';
  const p = ps.sort((a, b) => w.parts[b] - w.parts[a])[0];
  return `Most of it ${PARTS.find((x) => x.id === p)!.words}: ${clock(w.parts[p])}`;
}

// ── THE LONG WAIT ALERT ─────────────────────────────────────────────────────────────────────────────────────────────
export const LONG_WAITS: { sec: number; label: string }[] = [{ sec: 240, label: '4:00' }, { sec: 300, label: '5:00' }, { sec: 0, label: 'Off' }];
/** When a car has waited long enough to buzz the shift lead: the business's choice, 5 minutes until it makes one; 0 off. */
export function longWaitOf(tenant: any): number {
  const v = tenant?.driveThru?.longWaitSec;
  return v === 0 ? 0 : v === 240 || v === 300 ? v : 300;
}
