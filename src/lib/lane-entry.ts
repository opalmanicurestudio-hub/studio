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
