// src/lib/lane-entry.ts — THE LINE BEFORE THE SPEAKER, AND ORDERS AS THEY'RE SAID (pure; design board "Rush and the lane
// entry"). A sensor at the lane entry calls a link each time a car passes (lib/lane-entry-server keeps the link and the
// count), so the drive-thru knows how many cars are waiting to order, not only those already at the speaker or past it.
// - Waiting to order: cars counted at the entry that haven't reached the speaker. Each car that reaches the speaker
//   takes off the one counted first before it; a count drops off after 20 minutes; "Line's clear" on the lane screen
//   sets it to none. A car the sensor missed takes nothing off, so a miss never makes the count go wrong for long.
// - A rush: RUSH_CARS or more cars in the lane, counting those waiting (the voice assistant keeps orders short, and the
//   kitchen sees orders as they're said).
// - Orders as they're said: on the kitchen screen, what's being ordered at the speaker before it's sent (in a rush, by
//   default; always, or never, as the business sets it). Only shown: nothing is taken from stock and no ticket is made
//   until the order is sent, and an item taken off goes away.

import { RUSH_CARS } from '@/lib/counter-orders';

/** A count at the entry lasts this long; the same car seen again within the gap is one car. */
export const ENTRY_KEEP_MS = 20 * 60000, ENTRY_GAP_MS = 1500, ENTRY_MAX = 80;
export type EntryLog = { at: string[]; clearedAt?: string | null };
export type EarlyMode = 'rush' | 'always' | 'off';

/** When the kitchen sees orders as they're said (Menu page): in a rush unless set otherwise. */
export const earlyModeOf = (tenant: any): EarlyMode => {
  const v = tenant?.driveThru?.kitchenEarly; return v === 'always' || v === 'off' ? v : 'rush';
};

/** A car seen at the entry, now: kept (with the counts still good), or not, the same car seen again within the gap. */
export function addEntry(log: EntryLog | null | undefined, nowMs: number): { log: EntryLog; counted: boolean } {
  const kept = (Array.isArray(log?.at) ? log!.at : []).filter((x) => { const t = Date.parse(String(x)); return Number.isFinite(t) && t > nowMs - ENTRY_KEEP_MS && t <= nowMs + 60000; }).sort();
  const last = kept.length ? Date.parse(kept[kept.length - 1]) : -Infinity;
  if (nowMs - last < ENTRY_GAP_MS) return { log: { at: kept, clearedAt: log?.clearedAt || null }, counted: false };
  return { log: { at: [...kept, new Date(nowMs).toISOString()].slice(-ENTRY_MAX), clearedAt: log?.clearedAt || null }, counted: true };
}

/** Cars waiting to order, in each lane: counted at that lane's entry (since its line was last clear, in the last 20
 *  minutes) and not yet matched by a car that's started ordering. `arrivals`: when each car got to order (at a speaker,
 *  or taken in line, or come for an order placed ahead), with its lane when it has one; one with none takes off the
 *  earliest car counted in either lane. With one lane, everything is lane 1. */
export function waitingByLane(logs: Partial<Record<1 | 2, EntryLog | null>>, arrivals: { at: string; lane: 1 | 2 | null }[], nowMs: number): Record<1 | 2, number> {
  const left: Record<1 | 2, number[]> = { 1: [], 2: [] };
  const from: Record<1 | 2, number> = { 1: -Infinity, 2: -Infinity };
  for (const l of [1, 2] as const) {
    const log = logs[l]; if (!log) continue;
    from[l] = Math.max(nowMs - ENTRY_KEEP_MS, Date.parse(String(log.clearedAt || '')) || -Infinity);
    left[l] = (Array.isArray(log.at) ? log.at : []).map((x) => Date.parse(String(x))).filter((t) => Number.isFinite(t) && t > from[l] && t <= nowMs).sort((a, b) => a - b);
  }
  const reached = arrivals.map((a) => ({ t: Date.parse(String(a.at)), lane: a.lane })).filter((a) => Number.isFinite(a.t) && a.t <= nowMs).sort((a, b) => a.t - b.t);
  // Each car that got to order takes off the earliest car counted before it, in its lane (a car the sensor missed takes
  // off nothing).
  for (const r of reached) {
    const ok = (l: 1 | 2) => left[l].length > 0 && left[l][0] <= r.t && r.t > from[l];
    const l: 1 | 2 | null = r.lane ? (ok(r.lane) ? r.lane : null) : ok(1) && ok(2) ? (left[1][0] <= left[2][0] ? 1 : 2) : ok(1) ? 1 : ok(2) ? 2 : null;
    if (l) left[l].shift();
  }
  return { 1: left[1].length, 2: left[2].length };
}

/** A rush: this many cars in the lane, counting those waiting to order. */
export const isRush = (inLane: number, waiting: number) => inLane + waiting >= RUSH_CARS;

/** Whether the kitchen sees orders as they're said, now. */
export const showEarly = (mode: EarlyMode, rush: boolean) => mode === 'always' || (mode === 'rush' && rush);

export type EarlyLine = { name: string; quantity: number; choicesText: string | null; itemId: string };
/** What's been said so far on an order still being taken: its lines, as the guest said them (nothing about prices). */
export function earlyLines(order: any): EarlyLine[] {
  if (!order || order.status !== 'building' || order.sentAt) return [];
  return (Array.isArray(order.lines) ? order.lines : []).slice(0, 30).map((l: any) => ({
    name: String(l?.name || 'Item').slice(0, 80), quantity: Math.max(1, Math.round(Number(l?.quantity) || 1)),
    choicesText: l?.choicesText ? String(l.choicesText).slice(0, 160) : null, itemId: String(l?.itemId || ''),
  })).filter((l: EarlyLine) => l.itemId);
}

// ── SENSORS ALONG THE LANE (design board "Speed of service, and what slows it", part 4) ─────────────────────────────
// Besides the lane entry, a sensor can call a link of its own at three more places:
// - The speaker: a car pulled up. Its time starts then (not when someone first spoke to it), and a car nobody has
//   started an order for yet shows on Drive-thru live, counting up.
// - The pickup window: a car got there. The first paid car in the line to the window that isn't there yet is.
// - The exit: a car drove off. When there's no doubt which car it was (one car at the window, ready and paid, none
//   parked), it's handed over on its own; otherwise Drive-thru live asks the window to check.

export type SensorPoint = 'entry' | 'speaker' | 'pay' | 'window' | 'exit' | 'mobile';
export const SENSOR_POINTS: { id: SensorPoint; label: string; hint: string; perLane: boolean }[] = [
  { id: 'entry', label: 'Lane entry', hint: 'A car joins the line: counts the cars waiting to order.', perLane: true },
  { id: 'speaker', label: 'Speaker', hint: 'A car pulls up: its time starts then, and a car nobody has greeted shows.', perLane: true },
  { id: 'pay', label: 'Pay window', hint: 'A car reaches the pay window: its pay time is timed from there.', perLane: false },
  { id: 'window', label: 'Pickup window', hint: 'A car reaches the window: where its time goes, to the second.', perLane: false },
  { id: 'exit', label: 'Exit', hint: 'A car drives off: handed over on its own when there’s no doubt which car it was.', perLane: false },
  { id: 'mobile', label: 'Mobile pickup spots', hint: 'A car parks for an order placed ahead: if nobody has said they’re here, the curbside screen and Drive-thru live say so.', perLane: false },
];
export const pointOf = (v: unknown): SensorPoint => (v === 'speaker' || v === 'pay' || v === 'window' || v === 'exit' || v === 'mobile' ? v : 'entry');

/** A car at the speaker that nobody has started an order for counts this long (after that it's taken to have left, and
 *  never makes the next car's time start early). */
export const SPEAKER_KEEP_MS = 90000;
/** The same car seen again by a sensor past the entry within this long is the same car: a long or slow car, or a sensor
 *  that fires again while it's there. A car can't leave the speaker, the window or the exit and the next take its place
 *  any sooner. */
export const POINT_GAP_MS: Record<Exclude<SensorPoint, 'entry'>, number> = { speaker: 12000, pay: 15000, window: 15000, exit: 15000, mobile: 15000 };
/** A car parked in a mobile pickup spot counts this long for a guest to say they're here. */
export const MOBILE_KEEP_MS = 10 * 60000;
/** Where the cars the mobile pickup sensor saw park are kept (tenants/{t}/private/…), at one location. */
export const mobileDocId = (at?: string | null) => (at ? `laneMobile_${at}` : 'laneMobile');
/** A car started at the speaker this recently is the one the speaker's sensor just saw pull up (the crew was quick). */
export const SPEAKER_MATCH_MS = 30000;
export type ArrivalLog = { at: string[] };
/** Where the cars the speaker's sensor saw pull up are kept (tenants/{t}/private/…), for one lane at one location. */
export const speakerDocId = (lane: 1 | 2, at?: string | null) => (at ? `laneSpeaker_${at}_${lane}` : `laneSpeaker_${lane}`);
const keptArrivals = (log: ArrivalLog | null | undefined, nowMs: number, keepMs = SPEAKER_KEEP_MS) =>
  (Array.isArray(log?.at) ? log!.at : []).filter((x) => { const t = Date.parse(String(x)); return Number.isFinite(t) && t > nowMs - keepMs && t <= nowMs + 60000; }).sort();

/** A car pulled up to the speaker, or parked in a mobile pickup spot (`keepMs`: how long it counts), the same car seen
 *  again within a moment, once. */
export function addArrival(log: ArrivalLog | null | undefined, nowMs: number, keepMs = SPEAKER_KEEP_MS): { log: ArrivalLog; counted: boolean } {
  const kept = keptArrivals(log, nowMs, keepMs);
  const last = kept.length ? Date.parse(kept[kept.length - 1]) : -Infinity;
  if (nowMs - last < ENTRY_GAP_MS) return { log: { at: kept }, counted: false };
  return { log: { at: [...kept, new Date(nowMs).toISOString()].slice(-20) }, counted: true };
}
/** Someone started an order at the speaker: the car that pulled up first and hasn't been started yet is this one. */
export function claimArrival(log: ArrivalLog | null | undefined, nowMs: number): { at: string | null; log: ArrivalLog } {
  const kept = keptArrivals(log, nowMs).filter((x) => Date.parse(x) <= nowMs);
  return kept.length ? { at: kept[0], log: { at: keptArrivals(log, nowMs).filter((x) => x !== kept[0]) } } : { at: null, log: { at: keptArrivals(log, nowMs) } };
}
/** Cars at the speaker nobody has started an order for yet: when each pulled up (`keepMs`: or parked, for mobile pickup). */
export const unclaimedArrivals = (log: ArrivalLog | null | undefined, nowMs: number, keepMs = SPEAKER_KEEP_MS): string[] => keptArrivals(log, nowMs, keepMs).filter((x) => Date.parse(x) <= nowMs);
/** A guest can say they're here as they pull in, this long before the sensor sees their car park. */
export const TOLD_BEFORE_PARKED_MS = 2 * 60000;
/** Cars parked in mobile pickup spots lately whose guest hasn't said they're here: each curbside guest who said so, or
 *  was handed their order (`here`: when), takes the earliest car still unaccounted for that parked before then (or just
 *  after, TOLD_BEFORE_PARKED_MS); those left over, and since when the first of them parked. */
export function parkedUnknown(log: ArrivalLog | null | undefined, here: string[], nowMs: number): { n: number; since: string | null } {
  const cars = unclaimedArrivals(log, nowMs, MOBILE_KEEP_MS).map((at) => ({ at, t: Date.parse(at), took: false }));
  const told = here.map((x) => Date.parse(String(x))).filter((t) => Number.isFinite(t) && t <= nowMs + 60000).sort((a, b) => a - b);
  for (const t of told) { const c = cars.find((x) => !x.took && x.t >= t - MOBILE_KEEP_MS && x.t <= t + TOLD_BEFORE_PARKED_MS); if (c) c.took = true; }
  const left = cars.filter((x) => !x.took);
  return { n: left.length, since: left[0]?.at || null };
}

/** The car the pay window's sensor saw: the first car in the line to the window that's on its way to pay and hasn't
 *  reached the pay window yet. */
export const payCar = <C extends { id: string; stage?: unknown; stageAt?: Record<string, unknown> | null }>(line: C[]): C | null => line.find((c) => c.stage === 'pay' && !c.stageAt?.payWindow) || null;

type LaneCar = { id: string; stage?: unknown; stageAt?: Record<string, unknown> | null; goneAt?: unknown; left?: unknown; exitAt?: unknown };
/** The car the pickup window's sensor saw: the first paid car in the line to the window (`line`, in its order) that
 *  hasn't reached the window yet; none when every one has. */
export const windowCar = <C extends LaneCar>(line: C[]): C | null => line.find((c) => c.stage === 'pickup' && !c.stageAt?.window) || null;

/** A car drove past the exit: a car just handed over (in the last minute, not yet seen leaving) is the one; or, when
 *  there's no doubt, the one car at the window with none parked (`handover`: handed over on its own, if its order is
 *  ready and paid); otherwise the window is asked to check. `atWindow`: cars waiting at the pickup window, `parked`:
 *  cars in the spots, `gone`: cars handed over lately. */
export function exitPick<C extends LaneCar>(o: { atWindow: C[]; parked: C[]; gone: C[] }, nowMs: number): { kind: 'handed' | 'handover'; car: C } | { kind: 'ask' } {
  const just = o.gone.filter((c) => !c.left && !c.exitAt && nowMs - (Date.parse(String(c.goneAt || '')) || 0) < 60000).sort((a, b) => String(a.goneAt).localeCompare(String(b.goneAt)))[0];
  if (just) return { kind: 'handed', car: just };
  // (Those the window's sensor saw at the window, or with no window sensor, every paid car waiting.)
  const seen = o.atWindow.filter((c) => !!c.stageAt?.window);
  const at = seen.length ? seen : o.atWindow;
  return at.length === 1 && !o.parked.length ? { kind: 'handover', car: at[0] } : { kind: 'ask' };
}
