// src/lib/drive-live.ts — DRIVE-THRU LIVE (pure; design board "Drive-thru live", layout A: the lane, from above). Every
// car in the lane, where it is, as it moves: from the entry (counted by the lane entry sensor, when there is one) to the
// speaker, the pay window, the pickup window and the pull-forward spots, each with how long it's been waiting against
// the business's drive-thru target. Curbside, orders placed ahead and the counter's line sit underneath.
// - Where each car is drawn (placeLane): the lane is one line of cars from the pickup window back to the entry; a car
//   sits at its stage's place (the speaker, the pay window, the pickup window) unless the car in front is already there,
//   then just behind it. With two ordering lanes, each lane's cars at its own speaker until the lanes meet.
// - Its color (toneOf): on time, near the target (three quarters of it), or over it.
// Read by the page every few seconds (lib/drive-live-server); nothing here changes a car.
import { byWindow, cleanLane, type Lane } from '@/lib/drive-lanes';

export type LiveStage = 'speaker' | 'pay' | 'pickup' | 'forward';
export const LIVE_STAGES: LiveStage[] = ['speaker', 'pay', 'pickup', 'forward'];
export type KitchenNow = 'not sent' | 'making' | 'ready';

/** One car as the live view shows it. `since`: when its wait started (it pulled up, or was taken in line); `stageAt`:
 *  when it reached each stage. */
export type LiveCar = {
  id: string; number: string; name: string | null; looks: string | null; stage: LiveStage; lane: Lane | null; spot: number | null;
  /** (`window`: when the pickup window's sensor saw it get there.) */
  since: string; stageAt: Partial<Record<LiveStage | 'window', string>>; ahead: boolean; inLine: boolean;
  kitchen: KitchenNow; waitingOn: string[]; mergeAt?: string | null; hereAt?: string | null;
  /** When someone started its order, when the speaker's sensor saw it pull up before that (lib/lane-entry). */
  greetedAt?: string | null;
};
export type LiveSide = {
  /** Curbside: guests outside now (the one waiting longest since when), and those on their way. */
  curbside: { here: number; longestSince: string | null; coming: number } | null;
  /** Orders placed ahead for the drive-thru, paid and not picked up: how many, how many are here, the next one due. */
  ahead: { open: number; here: number; nextAt: string | null } | null;
  /** The counter's line: guests waiting, and since when the longest has. */
  counter: { waiting: number; longestSince: string | null } | null;
};
export type LiveNow = {
  now: string; target: number; lanes: 1 | 2; spots: number; cars: LiveCar[];
  /** Cars counted at the lane entry that haven't reached the speaker yet, by lane (lib/lane-entry). */
  waiting: Record<1 | 2, number>; sensor: boolean; rush: boolean; side: LiveSide;
  location: { id: string; name: string | null } | null; timeZone: string;
  /** Cars the speaker's sensor saw pull up that nobody has started an order for yet: their lane, and since when. */
  atSpeaker?: { lane: 1 | 2; since: string }[];
  /** A car drove past the exit that nobody handed over, and the exit's sensor couldn't tell which: when. */
  exitAsk?: string | null;
};

/** Seconds from an ISO time to now (0 when it isn't one). */
export const secondsSince = (iso: string | null | undefined, nowMs: number) => { const t = Date.parse(String(iso || '')); return Number.isFinite(t) ? Math.max(0, Math.round((nowMs - t) / 1000)) : 0; };
/** "3:02", "12:40", "1:02:10". */
export function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

export type Tone = 'ok' | 'near' | 'over';
/** Near the target from three quarters of it. */
export const NEAR_SHARE = 0.75;
export function toneOf(sec: number, target: number): Tone {
  if (sec >= target) return 'over';
  return sec >= target * NEAR_SHARE ? 'near' : 'ok';
}
export const TONE_WORDS: Record<Tone, string> = { ok: 'on time', near: 'near the target', over: 'over the target' };
/** A car at the speaker nobody has greeted: fine for a few seconds, worth a look from 15, too long from 30. */
export const greetTone = (sec: number): Tone => (sec >= 30 ? 'over' : sec >= 15 ? 'near' : 'ok');

/** Where a car's time has gone so far, in seconds: waiting to be greeted (from pulling up to the speaker until someone
 *  started its order, when the speaker's sensor saw it), ordering (until its order was sent), getting to the window
 *  (until it reached the pickup window, as its sensor saw it, or else until it paid), and at the window (since then:
 *  waiting for its order, or parked in a spot). A part it never had (one taken in line, or come for an order placed
 *  ahead) is null. */
export function timesOf(c: Pick<LiveCar, 'stage' | 'since' | 'stageAt' | 'inLine' | 'ahead'> & { greetedAt?: string | null }, nowMs: number): { greet: number | null; ordering: number | null; toWindow: number | null; atWindow: number | null } {
  const t = (k: LiveStage | 'window') => { const v = Date.parse(String(c.stageAt?.[k] || '')); return Number.isFinite(v) ? v : null; };
  const start = Date.parse(String(c.stageAt?.speaker || c.since || '')); const pay = t('pay'), pickup = t('pickup');
  const greeted = Date.parse(String(c.greetedAt || '')); const hi = Number.isFinite(greeted) && greeted > start ? greeted : null;
  // (At the window: from when its sensor saw it there, once it had paid; or from when it paid.)
  const win = t('window'); const at = win !== null && pickup !== null ? Math.max(win, pickup) : pickup;
  const span = (a: number | null, z: number | null) => (a === null || !Number.isFinite(a) ? null : Math.max(0, Math.round(((z ?? nowMs) - a) / 1000)));
  const direct = !c.stageAt?.speaker && !pay;
  return {
    greet: direct || hi === null ? null : span(start, hi),
    ordering: direct ? null : span(hi ?? start, pay ?? (c.stage === 'speaker' ? null : pickup)),
    toWindow: pay === null ? null : span(pay, at),
    atWindow: at === null ? null : span(at, null),
  };
}

/** What a car is stuck on, in words, when it's near or over its time: the part taking longest, and what the kitchen is
 *  still making. */
export function stuckWords(c: LiveCar, nowMs: number): string {
  const x = timesOf(c, nowMs);
  const parts: [string, number | null][] = [['waiting to be greeted', x.greet], ['ordering', x.ordering], ['getting to the window', x.toWindow], ['at the window', x.atWindow]];
  const [name, sec] = parts.reduce((a, b) => ((b[1] ?? -1) > (a[1] ?? -1) ? b : a));
  const kitchen = c.kitchen === 'making' && c.waitingOn.length ? `, waiting on ${c.waitingOn.slice(0, 2).join(' and ')}` : c.kitchen === 'ready' && c.stage !== 'speaker' ? ', its order is ready' : '';
  return sec === null ? `${c.stage === 'speaker' ? 'Ordering' : 'Waiting'}${kitchen}` : `Most of it ${name}: ${clock(sec)}${kitchen}`;
}

/** The line to the window (paying, then waiting at the window), first car first; then each lane's cars still ordering,
 *  as they arrived. Parked cars aren't in the line. */
export function lineOrder(cars: LiveCar[], two: boolean): { line: LiveCar[]; ordering: Record<1 | 2, LiveCar[]> } {
  const rank = (c: LiveCar) => (c.stage === 'pickup' ? 0 : 1);
  // (In the order the lane screen and the windows keep: lib/drive-lanes, from when each pulled up.)
  const key = (c: LiveCar) => ({ ...c, arrivedAt: c.since });
  const line = cars.filter((c) => c.stage === 'pickup' || c.stage === 'pay').sort((a, b) => rank(a) - rank(b) || byWindow(two)(key(a), key(b)));
  const ordering: Record<1 | 2, LiveCar[]> = { 1: [], 2: [] };
  for (const c of cars.filter((x) => x.stage === 'speaker').sort((a, b) => String(a.since).localeCompare(String(b.since)))) ordering[two && cleanLane(c.lane) === 2 ? 2 : 1].push(c);
  return { line, ordering };
}

// ── WHERE EACH CAR IS DRAWN ─────────────────────────────────────────────────────────────────────────────────────────
// Positions run along the lane (`along`: 0 at the entry, `length` at the exit) and across it (`across`: 0 on the lane's
// middle, the kitchen on the minus side, the spots on the plus side). The page turns them into x and y: across the screen
// on a wide one, down it on a phone.

export type LaneShape = {
  length: number; slot: number; laneWidth: number;
  /** Where the speaker(s), the windows, the lanes' meeting point and the entry are, along the lane. */
  at: { entry: number; speaker: number; merge: number | null; pay: number; pickup: number };
  /** The lane's middle for each ordering lane, across (both 0 with one lane). */
  laneAcross: Record<1 | 2, number>; spotsAcross: number;
};
export type Placed = { id: string; along: number; across: number };
export type LanePlan = { shape: LaneShape; cars: Placed[]; waiting: { lane: 1 | 2; along: number; across: number }[]; moreWaiting: Record<1 | 2, number>;
  /** Cars at the back of a line too long to show a car apart on a wide screen: counted, not drawn. */
  moreCars: string[];
  /** Cars at the speaker nobody has greeted yet (the `i`th that lane's, longest there first). */
  greeting: { lane: 1 | 2; i: number; along: number; across: number }[];
  spots: { n: number; along: number; across: number; carId: string | null }[]; moreParked: string[] };

/** The lane's places for a length (`fit`: fixed, as on a wide screen: a long line squeezes up; otherwise the lane grows
 *  to hold every car, as on a phone that scrolls). */
export function laneShape(o: { length: number; slot: number; laneWidth: number; two: boolean }): LaneShape {
  const { slot, two } = o; const L = o.length;
  const pickup = L - slot * 0.9, pay = pickup - slot * 2.6;
  const merge = two ? pay - slot * 1.6 : null;
  const speaker = two ? merge! - slot * 1.4 : pay - slot * 2.6;
  const gap = two ? o.laneWidth * 0.62 : 0;
  return { length: L, slot, laneWidth: o.laneWidth, at: { entry: slot * 0.45, speaker, merge, pay, pickup }, laneAcross: { 1: -gap, 2: gap }, spotsAcross: o.laneWidth * (two ? 1.55 : 1.25) };
}

/** How long a phone's lane must be to hold every car without squeezing (it scrolls): at least `min`, longer by however
 *  far the line runs back past the entry. */
export function lengthFor(cars: LiveCar[], o: { min: number; slot: number; laneWidth: number; two: boolean; waiting: Record<1 | 2, number>; spots: number; atSpeaker?: Record<1 | 2, number> }): number {
  const min = Math.max(o.min, Math.min(8, Math.max(1, Math.floor(o.spots) || 4)) * o.slot + o.slot);
  const shape = laneShape({ length: min, slot: o.slot, laneWidth: o.laneWidth, two: o.two });
  const plan = placeLane(cars, shape, { two: o.two, waiting: o.waiting, spots: o.spots, squeeze: false, atSpeaker: o.atSpeaker });
  const parked = new Set(plan.spots.map((s) => s.carId).filter(Boolean));
  const lo = shape.at.entry + o.slot * 0.55;
  const least = Math.min(lo, ...plan.cars.filter((p) => !parked.has(p.id)).map((p) => p.along), ...plan.waiting.map((w) => w.along), ...plan.greeting.map((w) => w.along));
  return Math.ceil(min + (lo - least));
}

/** Every car's place. Squeezes a long line into the room there is (`squeeze`), or lets it run past the entry (the lane
 *  was made long enough: lengthFor). Waiting cars beyond what fits are counted (`moreWaiting`); parked cars beyond the
 *  spots too (`moreParked`). */
export function placeLane(cars: LiveCar[], shape: LaneShape, o: { two: boolean; waiting: Record<1 | 2, number>; spots: number; squeeze: boolean; perRow?: number; minGap?: number; atSpeaker?: Record<1 | 2, number> }): LanePlan {
  const { slot, at } = shape; const lo = at.entry + slot * 0.55; const minGap = o.minGap ?? slot * 0.9;
  const { line, ordering } = lineOrder(cars, o.two);
  const placed: Placed[] = [];
  // Squeezed: the last one at the floor, and each in front of it no closer than `minGap` (a car at its window stays
  // there while there's room behind it).
  const squeeze = (xs: number[], floor: number) => {
    if (!o.squeeze || !xs.length || xs[xs.length - 1] >= floor) return xs;
    const ys = xs.slice(); ys[ys.length - 1] = floor;
    for (let i = ys.length - 2; i >= 0; i--) ys[i] = Math.max(xs[i], ys[i + 1] + minGap);
    return ys;
  };
  // A queue from its first place backward: each car at its own stage's place, or just behind the car in front.
  const queue = (list: { anchor: number }[], startBehind: number | null) => {
    const xs: number[] = []; let prev = startBehind;
    for (const c of list) { const x = prev === null ? c.anchor : Math.min(c.anchor, prev - slot); xs.push(x); prev = x; }
    return xs;
  };
  const anchor = (c: LiveCar) => ({ anchor: c.stage === 'pickup' ? at.pickup : c.stage === 'pay' ? at.pay : at.speaker });
  const waiting: LanePlan['waiting'] = []; const moreWaiting: Record<1 | 2, number> = { 1: 0, 2: 0 }; const moreCars: string[] = [];
  // The cars counted at the entry, not at the speaker yet: shown up to a few (as many as there's room for, squeezed),
  // the rest counted.
  const toShow = (l: 1 | 2) => { const want = Math.max(0, Math.floor(o.waiting[l] || 0)); const n = Math.min(want, o.squeeze ? 6 : 8); moreWaiting[l] = want - n; return n; };
  // One lane: one line from the pickup window back to the entry (paying and waiting at the window, then ordering, then
  // waiting to order), squeezed together when it's longer than the lane.
  // Two lanes: the line to the window runs back to where the lanes meet; each lane's cars from its own speaker.
  // (Cars at the speaker nobody has greeted yet: behind those ordering, before those waiting to order.)
  const greetN = (l: 1 | 2) => Math.max(0, Math.min(4, Math.floor(o.atSpeaker?.[l] || 0)));
  const runs: { cars: LiveCar[]; greet: number; waiting: number; lane: 1 | 2; across: number; floor: number; line: boolean }[] = o.two
    ? [{ cars: line, greet: 0, waiting: 0, lane: 1, across: 0, floor: at.merge! + slot * 0.2, line: true },
      { cars: ordering[1], greet: greetN(1), waiting: toShow(1), lane: 1, across: shape.laneAcross[1], floor: lo, line: false },
      { cars: ordering[2], greet: greetN(2), waiting: toShow(2), lane: 2, across: shape.laneAcross[2], floor: lo, line: false }]
    : [{ cars: [...line, ...ordering[1]], greet: greetN(1), waiting: toShow(1), lane: 1, across: 0, floor: lo, line: true }];
  const greeting: LanePlan['greeting'] = [];
  let lineTail = null as number | null;
  for (const r of runs) {
    // (Two lanes on a phone: a line to the window backed up past where the lanes meet holds each lane's cars behind it.)
    const behind: number | null = o.two && !r.line && !o.squeeze && lineTail !== null && lineTail < at.merge! + slot * 0.2 ? lineTail : null;
    let cs = r.cars; let w = r.waiting; let g = r.greet;
    const build = (): number[] => queue([...cs.map(anchor), ...Array.from({ length: g }, () => ({ anchor: at.speaker })), ...Array.from({ length: w }, () => ({ anchor: at.speaker - slot }))], behind);
    let xs: number[] = build();
    if (o.squeeze && xs.length && xs[xs.length - 1] < r.floor) {
      // More than fits a car apart: the waiting ones are counted instead first, then the cars at the back.
      const room = Math.max(1, Math.floor((xs[0] - r.floor) / minGap) + 1);
      if (cs.length + g + w > room) {
        const drop = Math.min(w, cs.length + g + w - room); w -= drop; moreWaiting[r.lane] += drop;
        g = Math.max(0, Math.min(g, room - cs.length));
        if (cs.length > room) { moreCars.push(...cs.slice(room).map((c) => c.id)); cs = cs.slice(0, room); }
        xs = build();
      }
      xs = squeeze(xs, r.floor);
    }
    cs.forEach((c, i) => placed.push({ id: c.id, along: xs[i], across: r.across }));
    for (let i = 0; i < g; i++) greeting.push({ lane: r.lane, i, along: xs[cs.length + i], across: r.across });
    for (let i = 0; i < w; i++) waiting.push({ lane: r.lane, along: xs[cs.length + g + i], across: r.across });
    if (r.line) lineTail = cs.length ? xs[cs.length - 1] : null;
  }
  // Parked: each in the spot it was given (or the first free one), in a row beside the lane up to the exit.
  // (Up to `perRow` in a row, then a second row further out: four on a wide screen, all eight down a phone's.)
  const n = Math.max(1, Math.min(8, Math.floor(o.spots) || 4)); const per = Math.max(1, Math.min(8, o.perRow ?? 8)); const inRow = Math.min(n, per);
  const spots: LanePlan['spots'] = Array.from({ length: n }, (_, i) => ({ n: i + 1, along: shape.length - slot * (inRow - (i % per) - 0.5), across: shape.spotsAcross + Math.floor(i / per) * shape.laneWidth * 0.95, carId: null as string | null }));
  const moreParked: string[] = [];
  const parked = cars.filter((c) => c.stage === 'forward').sort((a, b) => String(a.stageAt.forward || a.since).localeCompare(String(b.stageAt.forward || b.since)));
  for (const c of parked.filter((x) => x.spot && x.spot >= 1 && x.spot <= n)) { const s = spots[c.spot! - 1]; if (!s.carId) s.carId = c.id; }
  for (const c of parked) {
    if (spots.some((s) => s.carId === c.id)) continue;
    const free = spots.find((s) => !s.carId);
    if (free) free.carId = c.id; else moreParked.push(c.id);
  }
  for (const s of spots) if (s.carId) placed.push({ id: s.carId, along: s.along, across: s.across });
  return { shape, cars: placed, waiting, moreWaiting, moreCars, greeting, spots, moreParked };
}

/** The strip above the lane: cars in it now, those waiting to order, the longest wait now, and how many are over. */
export function liveTotals(d: Pick<LiveNow, 'cars' | 'waiting' | 'target'>, nowMs: number): { inLane: number; waiting: number; longest: { id: string; sec: number } | null; over: number } {
  let longest: { id: string; sec: number } | null = null; let over = 0;
  for (const c of d.cars) { const s = secondsSince(c.since, nowMs); if (!longest || s > longest.sec) longest = { id: c.id, sec: s }; if (s >= d.target) over++; }
  return { inLane: d.cars.length, waiting: (d.waiting[1] || 0) + (d.waiting[2] || 0), longest, over };
}
