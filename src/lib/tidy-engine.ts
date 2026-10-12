// src/lib/tidy-engine.ts — TIDY MY DAY (design canvas TD1). Pure rules; the server half is lib/tidy-server.
//
// A gap in a provider's day is closed by moving their OWN clients earlier — without making another gap. The free time
// has to end up at the end of the day (they finish early) or against a break, never as a new hole in the middle. So it
// isn't "move whoever can move": it searches for the smallest set of people whose moves leave the rest of the day solid,
// and the server asks only them, moving nobody until all of them say yes.
//
//   only earlier, never later · never more than maxEarlierMin earlier (4 hours unless changed) · never with less than minNoticeMin notice
//   fewest people first (often the LAST client of the day steps into the gap — one yes) · then finishing earliest
//   · then the smallest moves · ties to people who are keen (asked to come in sooner, or here early)
//
// CLEAR A DAY: a working day with only one or two visits on it, when each of those visits fits exactly into a gap on
// another working day nearby — move them, and the light day is free.

export type Visit = { id: string; start: number; end: number; name?: string; clientId?: string | null; serviceId?: string | null; padBefore?: number; padAfter?: number; fixed?: string | null; keen?: boolean };
export type Block = { start: number; end: number; kind: 'break' | 'blocked' };
export type TidySettings = { maxEarlierMin: number; minNoticeMin: number; maxAsks: number; lightMax: number };
export const TIDY_DEFAULTS: TidySettings = { maxEarlierMin: 240, minNoticeMin: 90, maxAsks: 4, lightMax: 2 };
export type Move = { id: string; from: number; to: number };
export type Plan = { key: string; moves: Move[]; asks: number; finishFrom: number; finishTo: number; freeAt: 'end' | 'break'; freedMin: number; shiftMin: number; keen: number };

const MIN = 60000;
const TOL = 10 * MIN;               // a few minutes between visits isn't a gap (clean-down)
const MIN_GAP = 15 * MIN;           // smaller than this isn't worth asking anyone about
const span = (v: Visit) => ({ s: v.start - (v.padBefore || 0) * MIN, e: v.end + (v.padAfter || 0) * MIN });
const len = (v: Visit) => { const x = span(v); return x.e - x.s; };
export const planKey = (moves: Move[]) => moves.map((m) => `${m.id}@${m.to}`).sort().join('|');

/** The first gap worth closing: idle time after `from` that has a visit after it. */
export function firstGap(visits: Visit[], blocks: Block[], from: number): { start: number; end: number } | null {
  const busy = [...visits.map((v) => ({ ...span(v), v: true })), ...blocks.map((b) => ({ s: b.start, e: b.end, v: false }))].sort((a, b) => a.s - b.s);
  let cursor = -Infinity;
  for (const b of busy) {
    if (cursor > -Infinity && b.v && b.s - Math.max(cursor, from) >= MIN_GAP && b.s > from) return { start: Math.max(cursor, from), end: b.s };
    cursor = Math.max(cursor, b.e);
  }
  return null;
}

/** Why someone can't be moved to `to` — or null if they can. */
export function cantMove(v: Visit, to: number, now: number, s: TidySettings): string | null {
  if (v.fixed) return v.fixed;
  if (to >= v.start) return 'only earlier';
  if (v.start - to > s.maxEarlierMin * MIN) return `more than ${Math.round(s.maxEarlierMin / 60)} hours earlier`;
  if (to - now < s.minNoticeMin * MIN) return 'not enough notice to get here';
  return null;
}

/** Every way to close the day's gaps with no new holes, best first (at most `limit`). `fits` is the booking engine's
 * say on a move (shifts, rooms, buffers) — plans it rejects are dropped. */
export function planDay(o: { visits: Visit[]; blocks?: Block[]; now: number; settings?: Partial<TidySettings>; fits?: (v: Visit, to: number, moving: Set<string>) => boolean; limit?: number }): { gap: { start: number; end: number } | null; plans: Plan[]; why: string | null } {
  const S = { ...TIDY_DEFAULTS, ...(o.settings || {}) }; const blocks = (o.blocks || []).slice().sort((a, b) => a.start - b.start);
  const gap = firstGap(o.visits, blocks, o.now);
  if (!gap) return { gap: null, plans: [], why: 'no gap to close' };
  const items = o.visits.filter((v) => span(v).s >= gap.start - TOL).sort((a, b) => span(a).s - span(b).s);
  const later = blocks.filter((b) => b.start >= gap.start - TOL);
  const finishFrom = Math.max(...items.map((v) => span(v).e));
  const found = new Map<string, Plan>(); let nodes = 0;
  const go = (cursor: number, rest: Visit[], bl: Block[], moves: Move[], freeAt: 'end' | 'break') => {
    if (++nodes > 40000 || moves.length > S.maxAsks) return;
    if (!rest.length) {
      if (!moves.length) return;
      const finishTo = cursor; if (finishTo >= finishFrom - TOL && freeAt === 'end') return;   // no better off
      const p: Plan = { key: planKey(moves), moves, asks: moves.length, finishFrom, finishTo, freeAt, freedMin: Math.round((finishFrom - finishTo) / MIN),
        shiftMin: Math.round(moves.reduce((t, m) => t + (m.from - m.to), 0) / MIN), keen: moves.filter((m) => items.find((v) => v.id === m.id)?.keen).length };
      if (!found.has(p.key)) found.set(p.key, p); return;
    }
    const r0 = rest[0]; const b0 = bl[0];
    if (b0 && b0.start <= span(r0).s && b0.start <= cursor + TOL) { if (cursor > b0.start + TOL) return; return go(Math.max(cursor, b0.end), rest, bl.slice(1), moves, freeAt); }
    if (cursor > span(r0).s + TOL) return;                                   // ran into someone who stays — they'd have to go later
    if (span(r0).s - cursor <= TOL) return go(Math.max(cursor, span(r0).e), rest.slice(1), bl, moves, freeAt);   // no hole: they stay
    const holeEnd = Math.min(span(r0).s, b0 ? b0.start : Infinity);
    // Fill the hole with someone from later who can come earlier: the last of the day first, then whoever fits it exactly, then the next one along.
    const cands = rest.filter((v) => !v.fixed).sort((a, b) => (span(b).s - span(a).s));
    for (const m of cands) {
      const to = cursor + (m.padBefore || 0) * MIN; const nextFixed = Math.min(...rest.filter((v) => v !== m).map((v) => span(v).s), b0 ? b0.start : Infinity);
      if (m !== r0 && cursor + len(m) > nextFixed + TOL && cursor + len(m) > holeEnd + TOL) continue;
      if (cantMove(m, to, o.now, S)) continue;
      const moving = new Set([...moves.map((x) => x.id), m.id]);
      if (o.fits && !o.fits(m, to, moving)) continue;
      go(cursor + len(m), rest.filter((v) => v !== m), bl, [...moves, { id: m.id, from: m.start, to }], freeAt);
    }
    // Or leave it — only when it runs into a break (a longer break, not a hole).
    if (b0 && holeEnd === b0.start) go(b0.end, rest, bl.slice(1), moves, 'break');
  };
  go(gap.start, items, later, [], 'end');
  const plans = [...found.values()].sort((a, b) => a.asks - b.asks || (a.freeAt === 'end' ? 0 : 1) - (b.freeAt === 'end' ? 0 : 1) || a.finishTo - b.finishTo || a.shiftMin - b.shiftMin || b.keen - a.keen).slice(0, o.limit ?? 3);
  return { gap, plans, why: plans.length ? null : 'nobody can move up without leaving another gap' };
}

// ── Clear a light day ────────────────────────────────────────────────────────────────
export type Slot = { id: string; date: string; start: number; end: number; touch: number; exact: boolean };
/** How well a slot sits in that day: touching the visit before and after (exact fill) is best; touching neither would
 * just make a new hole, so it isn't a candidate. */
export function touchOf(start: number, end: number, dayVisits: Visit[]): { touch: number; exact: boolean } {
  const before = dayVisits.some((v) => Math.abs(span(v).e - start) <= TOL); const after = dayVisits.some((v) => Math.abs(span(v).s - end) <= TOL);
  return { touch: (before ? 1 : 0) + (after ? 1 : 0), exact: before && after };
}
/** One slot per visit, no two overlapping, best fits first. Null if any visit has nowhere good to go. */
export function clearDay(visits: Visit[], slots: Map<string, Slot[]>): Move[] | null {
  const order = [...visits].sort((a, b) => (slots.get(a.id)?.length || 0) - (slots.get(b.id)?.length || 0));
  const pick = (i: number, used: Slot[]): Slot[] | null => {
    if (i === order.length) return used;
    const opts = (slots.get(order[i].id) || []).filter((s) => s.touch > 0 && !used.some((u) => u.start < s.end && s.start < u.end)).sort((a, b) => b.touch - a.touch || Math.abs(a.start - order[i].start) - Math.abs(b.start - order[i].start));
    for (const s of opts) { const r = pick(i + 1, [...used, s]); if (r) return r; }
    return null;
  };
  const got = pick(0, []); if (!got) return null;
  return order.map((v, i) => ({ id: v.id, from: v.start, to: got[i].start + (v.padBefore || 0) * MIN }));
}

// ── The words ────────────────────────────────────────────────────────────────────────
export const askText = (o: { first: string; provider: string; to: string; from: string; service: string; link: string; sameDay: boolean }) =>
  o.sameDay
    ? `Hi ${o.first}, ${o.provider || 'we'} ${o.provider ? 'has' : 'have'} an earlier opening today. Would you like to come in at ${o.to} instead of ${o.from}? Your ${o.service || 'appointment'} and its price will stay the same. There's no pressure at all. If it suits you, please let us know here: ${o.link}`
    : `Hi ${o.first}, would it suit you to move your ${o.service || 'appointment'} from ${o.from} to ${o.to}${o.provider ? ` with ${o.provider}` : ''}? Everything else will stay the same. There's no pressure at all. If it suits you, please let us know here: ${o.link}`;
export const doneText = (o: { first: string; to: string }) => `Hi ${o.first}, your appointment is confirmed for ${o.to}. Thank you so much for being flexible. We're looking forward to seeing you.`;
export const noChangeText = (o: { first: string; from: string }) => `Hi ${o.first}, thank you for agreeing to move. As it turns out, we won't need to change your appointment after all, so your ${o.from} appointment will stay exactly as it is. We're sorry for any confusion.`;
