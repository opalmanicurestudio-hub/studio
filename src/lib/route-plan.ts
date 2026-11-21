// src/lib/route-plan.ts — A DRIVER'S STOPS IN THE BEST ORDER (pure; design board "Routes in the best order"). Read by
// lib/route-server (the plan, with drive times from the map) and lib/food-delivery-server (hot food that goes together).
// - The order with the least driving that still keeps each stop's time: a shop order's delivery window (not before it
//   opens, and not after it closes) or a hot food order's arrive-by. Being late costs far more than driving, so a stop
//   is late only when no order keeps it; then it's flagged, so the driver can tell the customer.
// - Hot food first, then shop orders. A stop the driver skipped to come back to stays at the end, in the order they
//   skipped them; a stop whose place isn't on the map goes after the others of its kind, by its time (a usual while for
//   it, and the next drive from where the driver was before it), and its time isn't given as if it were known.
// - Up to 8 stops of a kind: every order is tried. More: the best found from a nearest-first start, by reversing runs of
//   stops and moving single stops, until nothing helps.
// - Drive times by road from the map (lib/route-server) when there are some; otherwise from the distance (as the live
//   arrival times are, lib/delivery-live). A few minutes at each door. Back to the shop at the end.
import { milesBetween } from '@/lib/delivery-plan';
import { DOOR_MINUTES, UNKNOWN_STOP_MINUTES, driveMinutes, type LatLng } from '@/lib/delivery-live';

export type RouteStop = { key: string; at: LatLng | null; open: number | null; due: number | null; hot: boolean; skippedAt?: number | null };
/** Drive minutes (and miles) between points: index 0 is where the route starts, then the stops, then the shop. */
export type Legs = { min: number[][]; miles: number[][]; road: boolean };
export type Plan = { order: string[]; eta: Record<string, { at: number; late: boolean; placed: boolean }>; driveMin: number; miles: number; backAt: number | null; road: boolean;
  /** Minutes less than going by each stop's time. */
  savedMin: number; exact: boolean };

/** Being late by a minute costs this many minutes of driving. */
const LATE_WEIGHT = 12;
/** Every order of up to this many stops of a kind is tried. */
export const EXACT_UP_TO = 8;
const MAX_PASSES = 60;

/** Drive times worked out from the distance (by road, roughly): for when the map service isn't there. */
export function estimateLegs(points: (LatLng | null)[]): Legs {
  const min = points.map((a) => points.map((b) => (a && b && a !== b ? driveMinutes(a, b) : 0)));
  const miles = points.map((a) => points.map((b) => (a && b && a !== b ? milesBetween(a, b) * 1.35 : 0)));
  return { min, miles, road: false };
}

type Sim = { cost: number; drive: number; wait: number; late: number; t: number; arrive: number[]; pos: number };
/** Drives `seq` (indexes into the legs) from `from` at minute `t0`: arrival at each, waiting for a window to open, and
 *  lateness. A stop that isn't on the map (`placed` false) takes a usual while and the next drive is from where the
 *  driver was before it (as the live arrival times do). */
function simulate(L: Legs, from: number, t0: number, seq: number[], open: (number | null)[], due: (number | null)[], home: number | null, placed?: boolean[]): Sim {
  let t = t0, pos = from, drive = 0, wait = 0, late = 0; const arrive: number[] = [];
  for (const i of seq) {
    if (placed && !placed[i]) { t += UNKNOWN_STOP_MINUTES; arrive.push(t); const u = due[i]; if (u !== null && t > u) late += t - u; continue; }
    const d = L.min[pos][i]; drive += d; t += d;
    const o = open[i]; if (o !== null && t < o) { wait += o - t; t = o; }
    arrive.push(t);
    const u = due[i]; if (u !== null && t > u) late += t - u;
    t += DOOR_MINUTES; pos = i;
  }
  if (home !== null && seq.length) { drive += L.min[pos][home]; t += L.min[pos][home]; }
  return { cost: drive + wait + LATE_WEIGHT * late, drive, wait, late, t, arrive, pos };
}

/** The best order of `idx` starting at `from` (at minute `t0`): every order when there are few, otherwise improved
 *  from nearest-first by reversing runs and moving single stops. */
function bestOrder(L: Legs, from: number, t0: number, idx: number[], open: (number | null)[], due: (number | null)[], home: number | null): { seq: number[]; exact: boolean } {
  if (idx.length <= 1) return { seq: idx.slice(), exact: true };
  const cost = (s: number[]) => simulate(L, from, t0, s, open, due, home).cost;
  if (idx.length <= EXACT_UP_TO) {
    // Every order, depth first, dropping a partial order once it already costs more than the best whole one.
    let best = idx.slice().sort((a, b) => (due[a] ?? Infinity) - (due[b] ?? Infinity)); let bestCost = cost(best);
    const used = new Array(L.min.length).fill(false); const cur: number[] = [];
    const go = (pos: number, t: number, partial: number) => {
      if (partial >= bestCost) return;
      if (cur.length === idx.length) { const c = partial + (home !== null ? L.min[pos][home] : 0); if (c < bestCost) { bestCost = c; best = cur.slice(); } return; }
      for (const i of idx) {
        if (used[i]) continue;
        let tt = t + L.min[pos][i]; let add = L.min[pos][i];
        const o = open[i]; if (o !== null && tt < o) { add += o - tt; tt = o; }
        const u = due[i]; if (u !== null && tt > u) add += LATE_WEIGHT * (tt - u);
        used[i] = true; cur.push(i); go(i, tt + DOOR_MINUTES, partial + add); cur.pop(); used[i] = false;
      }
    };
    go(from, t0, 0);
    return { seq: best, exact: true };
  }
  // Nearest first (the soonest due breaking a tie), then better by reversing a run of stops or moving one, until nothing helps.
  const left = new Set(idx); const seq: number[] = []; let pos = from;
  while (left.size) {
    let pick = -1, score = Infinity;
    for (const i of left) { const s = L.min[pos][i] + (due[i] !== null ? 0 : 0.001); if (s < score || (s === score && (due[i] ?? Infinity) < (due[pick] ?? Infinity))) { score = s; pick = i; } }
    seq.push(pick); left.delete(pick); pos = pick;
  }
  let curCost = cost(seq);
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let better = false;
    for (let i = 0; i < seq.length - 1 && !better; i++) for (let j = i + 1; j < seq.length && !better; j++) {
      const s = [...seq.slice(0, i), ...seq.slice(i, j + 1).reverse(), ...seq.slice(j + 1)]; const c = cost(s);
      if (c < curCost - 1e-9) { seq.splice(0, seq.length, ...s); curCost = c; better = true; }
    }
    for (let i = 0; i < seq.length && !better; i++) for (let j = 0; j < seq.length && !better; j++) {
      if (i === j) continue;
      const s = seq.slice(); const [x] = s.splice(i, 1); s.splice(j, 0, x); const c = cost(s);
      if (c < curCost - 1e-9) { seq.splice(0, seq.length, ...s); curCost = c; better = true; }
    }
    if (!better) break;
  }
  return { seq, exact: false };
}

/**
 * The plan for one driver's stops. `start`: where they are (or the shop when they're setting out); `home`: the shop, to
 * come back to (null: the route ends at its last stop). `legs`: drive times from the map for [start, ...stops, home]
 * (stops in the order given); none: worked out from the distance. Times are milliseconds.
 */
export function planRoute(input: { start: LatLng | null; home: LatLng | null; stops: RouteStop[]; now: number; legs?: Legs | null }): Plan {
  const { stops, now } = input;
  const points: (LatLng | null)[] = [input.start, ...stops.map((s) => s.at), input.home];
  const given = input.legs && input.legs.min.length === points.length ? input.legs : estimateLegs(points);
  const L: Legs = { min: given.min.map((r) => r.slice()), miles: given.miles.map((r) => r.slice()), road: given.road };
  const home = input.home ? points.length - 1 : null;
  const startIdx = 0;
  const mins = (ms: number | null) => (ms === null ? null : (ms - now) / 60000);
  const open = points.map((_, i) => (i >= 1 && i <= stops.length ? mins(stops[i - 1].open) : null));
  const due = points.map((_, i) => (i >= 1 && i <= stops.length ? mins(stops[i - 1].due) : null));
  // No start at all (no shop on the map): the route starts at its first stop, so every drive from "the start" is nothing.
  if (!input.start) for (let i = 0; i < points.length; i++) { L.min[startIdx][i] = 0; L.miles[startIdx][i] = 0; }
  const byTime = (a: number, b: number) => (due[a] ?? open[a] ?? Infinity) - (due[b] ?? open[b] ?? Infinity);
  const idxOf = (s: RouteStop) => stops.indexOf(s) + 1;
  const live = stops.filter((s) => !s.skippedAt);
  const skipped = stops.filter((s) => s.skippedAt).sort((a, b) => (a.skippedAt || 0) - (b.skippedAt || 0)).map(idxOf);
  const placed = points.map((p, i) => i === startIdx || i === home || !!p);
  const located = (hot: boolean) => live.filter((s) => s.hot === hot && s.at).map(idxOf);
  const unplaced = (hot: boolean) => live.filter((s) => s.hot === hot && !s.at).map(idxOf).sort(byTime);
  // Hot food first, from the start; then the shop orders, from wherever the hot food left the driver (the last one
  // on the map).
  const hot = bestOrder(L, startIdx, 0, located(true), open, due, null);
  const hotSeq = [...hot.seq, ...unplaced(true)];
  const afterHot = simulate(L, startIdx, 0, hotSeq, open, due, null, placed);
  const shop = bestOrder(L, afterHot.pos, hotSeq.length ? afterHot.t : 0, located(false), open, due, home);
  const seq = [...hotSeq, ...shop.seq, ...unplaced(false), ...skipped];
  const run = simulate(L, startIdx, 0, seq, open, due, home, placed);
  // Against going by each stop's time (hot food first all the same).
  const plain = [...live.filter((s) => s.hot).map(idxOf).sort(byTime), ...live.filter((s) => !s.hot).map(idxOf).sort(byTime), ...skipped];
  const base = simulate(L, startIdx, 0, plain, open, due, home, placed);
  let miles = 0; let pos = startIdx; for (const i of seq) { if (!placed[i]) continue; miles += L.miles[pos][i]; pos = i; } if (home !== null && seq.length) miles += L.miles[pos][home];
  const eta: Plan['eta'] = {};
  seq.forEach((i, n) => { const at = now + Math.round(run.arrive[n] * 60000); const u = due[i]; eta[stops[i - 1].key] = { at, late: u !== null && run.arrive[n] > u + 0.5, placed: placed[i] }; });
  return { order: seq.map((i) => stops[i - 1].key), eta, driveMin: Math.round(run.drive), miles: Math.round(miles * 10) / 10,
    backAt: home !== null && seq.length ? now + Math.round(run.t * 60000) : null, road: L.road,
    savedMin: Math.max(0, Math.round(base.drive + base.wait - (run.drive + run.wait))), exact: hot.exact && shop.exact };
}

/**
 * Two hot food orders as one trip from the shop: the better way round, how much longer the trip is than taking the
 * first alone (out and back), and whether both still get there in time. Null when either isn't on the map.
 */
export function goesWith(shop: LatLng, a: { at: LatLng | null; due: number | null }, b: { at: LatLng | null; due: number | null }, now: number):
  { addMin: number; onTime: boolean; first: 'a' | 'b' } | null {
  if (!a.at || !b.at) return null;
  const m = (x: LatLng, y: LatLng) => driveMinutes(x, y);
  const alone = m(shop, a.at) + DOOR_MINUTES + m(a.at, shop);
  const ab = { first: 'a' as const, arriveA: m(shop, a.at), arriveB: m(shop, a.at) + DOOR_MINUTES + m(a.at, b.at), trip: m(shop, a.at) + DOOR_MINUTES + m(a.at, b.at) + DOOR_MINUTES + m(b.at, shop) };
  const ba = { first: 'b' as const, arriveB: m(shop, b.at), arriveA: m(shop, b.at) + DOOR_MINUTES + m(b.at, a.at), trip: m(shop, b.at) + DOOR_MINUTES + m(b.at, a.at) + DOOR_MINUTES + m(a.at, shop) };
  const ok = (w: { arriveA: number; arriveB: number }) => (a.due === null || now + w.arriveA * 60000 <= a.due) && (b.due === null || now + w.arriveB * 60000 <= b.due);
  const pick = ok(ab) && !ok(ba) ? ab : ok(ba) && !ok(ab) ? ba : ab.trip <= ba.trip ? ab : ba;
  return { addMin: Math.max(0, Math.round(pick.trip - alone)), onTime: ok(pick), first: pick.first };
}
/** Two hot orders go together when it adds no more than this to the trip and both stay on time. */
export const TOGETHER_MAX_ADD_MIN = 8;

/** A whole route in the maps app (Google Maps directions, which takes several stops; the first ten). */
export function routeLink(from: string | null, stops: string[]): string | null {
  const s = stops.filter(Boolean).slice(0, 10);
  if (!s.length) return null;
  const q = new URLSearchParams({ api: '1', travelmode: 'driving', destination: s[s.length - 1] });
  if (from) q.set('origin', from);
  if (s.length > 1) q.set('waypoints', s.slice(0, -1).join('|'));
  return `https://www.google.com/maps/dir/?${q.toString()}`;
}
