// src/lib/drive-lanes.ts — TWO ORDERING LANES THAT MERGE (pure; design board "Two lanes that merge"). A drive-thru can
// have two speakers side by side whose lanes meet in one line to the window (Menu page, Drive-thru: Ordering lanes).
// - Every car carries its lane: the speaker it pulled up to (each speaker tablet and order board is set to its lane),
//   or the button tapped on the lane screen. With one lane nothing changes, and a car has no lane.
// - The line to the window: in the order cars finished ordering (their order sent), each lane keeping its own order,
//   until someone at the window taps which car merged first. Only the front car of each lane is ever in question, and
//   only while both are waiting and neither has started paying; a car that starts paying at the window first merged
//   first, whatever was assumed. A car taken in line goes from when it got there; one left behind for hours never counts.
// - The window screens, the card reader, the lane screen and the kitchen all follow that one line (the kitchen bags
//   drive-thru orders in it).

export type Lane = 1 | 2;
type CarLike = { id?: string; stage?: string; lane?: unknown; inLine?: unknown; wasInLine?: unknown; hereAt?: unknown; mergeAt?: unknown; mergeSure?: unknown;
  arrivedAt?: unknown; stageAt?: Record<string, unknown> | null; orderId?: unknown; aheadId?: unknown; channel?: unknown };

/** How many ordering lanes the drive-thru has: 2 only when set so (Menu page). */
export const lanesOf = (tenant: any): 1 | 2 => (tenant?.driveThru?.lanes === 2 ? 2 : 1);
/** A lane as given by a screen: 1 or 2, else none. */
export function cleanLane(v: unknown): Lane | null { const n = Number(v); return n === 1 || n === 2 ? n : null; }
/** The lane a car ordered in (1 when it has none: one made before there were two, or at the window). */
export const laneOf = (c: CarLike | null | undefined): Lane => (c?.lane === 2 ? 2 : 1);

/** Where a car stands in the line to the window, as a moment: one taken in line from when it got there; with two lanes,
 *  where the window put it, else when it finished ordering; with one lane, as it arrived (a car can't pass another). */
export function windowKey(c: CarLike, two: boolean): string {
  if (c.hereAt) return String(c.hereAt);
  if (!two) return String(c.arrivedAt || '');
  return String(c.mergeAt || c.stageAt?.pay || c.arrivedAt || '');
}
/** Sorted into the line to the window (first at the window first). */
export const byWindow = (two: boolean) => (a: CarLike, b: CarLike) => windowKey(a, two).localeCompare(windowKey(b, two)) || String(a.arrivedAt || '').localeCompare(String(b.arrivedAt || ''));
/** The lane screen's order: with two lanes, the line to the window, then the cars still ordering as they arrived; with
 *  one, as they arrived. */
export const forLaneScreen = (two: boolean) => (a: CarLike, b: CarLike) => {
  if (!two) return String(a.arrivedAt || '').localeCompare(String(b.arrivedAt || ''));
  const s = (c: CarLike) => Number(c.stage === 'speaker');
  return s(a) - s(b) || (s(a) ? String(a.arrivedAt || '').localeCompare(String(b.arrivedAt || '')) : byWindow(true)(a, b));
};

/** A car counts toward the lane for three hours from when it arrived: one left behind this morning never does. */
export const FRESH_MS = 3 * 3600000;
const fresh = (c: CarLike, nowMs: number) => Date.parse(String(c.arrivedAt || '')) >= nowMs - FRESH_MS;
/** Waiting to merge: ordered at a lane's speaker (with a lane: not taken in line, nor made at the window for an order
 *  placed ahead, nor from before there were two lanes), sent, not paid yet, and in the lane now. */
const waiting = (c: CarLike, nowMs: number) => c.stage === 'pay' && cleanLane(c.lane) !== null && c.inLine !== true && c.wasInLine !== true && !c.hereAt
  && (c.channel || 'drive-thru') === 'drive-thru' && fresh(c, nowMs);

/** The front car of each lane, both waiting to merge: `next` the one in front by the line's order. Null with one lane, or
 *  when only one lane has a car waiting. */
export function laneHeads<C extends CarLike>(cars: C[], two: boolean, nowMs: number = Date.now()): { next: C; other: C } | null {
  if (!two) return null;
  const line = cars.filter((c) => waiting(c, nowMs)).sort(byWindow(true));
  const h1 = line.find((c) => laneOf(c) === 1), h2 = line.find((c) => laneOf(c) === 2);
  if (!h1 || !h2) return null;
  return byWindow(true)(h1, h2) <= 0 ? { next: h1, other: h2 } : { next: h2, other: h1 };
}

/** The question at the merge: the front car of each lane, both waiting, neither paying yet (`paying`: car ids whose card
 *  is on the reader), and the one in front not yet said to be first. Null with one lane, or nothing to ask. */
export function mergeAsk<C extends CarLike>(cars: C[], two: boolean, paying: Set<string> = new Set(), nowMs: number = Date.now()): { next: C; other: C } | null {
  const h = laneHeads(cars, two, nowMs);
  if (!h || paying.has(String(h.next.id)) || paying.has(String(h.other.id)) || h.next.mergeSure === true) return null;
  return h;
}

/** A car that pays at the window (or starts paying) while the other lane's front car is taken to be ahead of it merged
 *  first, whatever was assumed or said: what changes on it, or null when it's in front already (or not a front car). */
export function paidFirst(cars: CarLike[], carId: string, two: boolean, nowMs: number = Date.now()): { mergeAt?: string; mergeSure: true } | null {
  const h = laneHeads(cars, two, nowMs);
  return h && h.other.id === carId ? mergeFirst(h.other, h) : null;
}

/** Tapped "this one merged first": what changes on that car. Already in front, it's only marked as said; behind, it goes
 *  just ahead of the other lane's front car. */
export function mergeFirst(chosen: CarLike, ask: { next: CarLike; other: CarLike }): { mergeAt?: string; mergeSure: true } {
  if (chosen.id === ask.next.id) return { mergeSure: true };
  const k = Date.parse(windowKey(ask.next, true));
  return { mergeAt: new Date((Number.isFinite(k) ? k : Date.now()) - 1).toISOString(), mergeSure: true };
}

/** Each drive-thru order's place in the line to the window (1: next at the window) and its lane, for the kitchen. Only
 *  cars whose order was sent and that are still coming to the window, in the line's order (a car parked in a spot has
 *  been to the window: its order is taken out to it; one taken in line gets its place once it's there). */
export function windowPlaces(cars: CarLike[], two: boolean, nowMs: number = Date.now()): Map<string, { place: number; lane: Lane | null }> {
  const out = new Map<string, { place: number; lane: Lane | null }>();
  const line = cars.filter((c) => (c.channel || 'drive-thru') === 'drive-thru' && (c.stage === 'pay' || c.stage === 'pickup') && c.inLine !== true && fresh(c, nowMs)).sort(byWindow(two));
  line.forEach((c, i) => {
    // (Its lane only when it ordered at one: not a car taken in line, or one made at the window for an order placed ahead.)
    const v = { place: i + 1, lane: two && c.inLine !== true && c.wasInLine !== true ? cleanLane(c.lane) : null };
    for (const id of [c.orderId, c.aheadId]) if (typeof id === 'string' && id) out.set(id, v);
  });
  return out;
}
