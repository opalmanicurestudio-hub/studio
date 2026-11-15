// src/lib/kitchen-pace.ts — PACING THAT KNOWS THE KITCHEN (design canvas "Kitchen pace"; lib/kitchen-pace-server). How far
// behind the kitchen is right now, from its own tickets: what's still being made against how long each dish usually
// takes, and what came out in the last twenty minutes against the same. Not enough to go on (a quiet kitchen, a few
// tickets) is never called behind. When it is behind, the host stand's likely free times and the waits it quotes (and a
// waiting guest's own link) count it for tables still waiting on food, ordering ahead offers its first pickup time that
// much later and says so, and the kitchen screen shows it. The business can turn it off, and says when it counts as busy.
// Pure.

export type PaceSettings = { on: boolean; busyMin: number };
export const DEFAULT_PACE: PaceSettings = { on: true, busyMin: 5 };
export const BUSY_MIN = 2, BUSY_MAX = 30;
export function paceSettingsOf(tenant: any): PaceSettings {
  const raw = tenant?.kitchenSettings?.pace || {};
  const n = Math.round(Number(raw.busyMin));
  return { on: raw.on !== false, busyMin: Number.isFinite(n) && n >= BUSY_MIN && n <= BUSY_MAX ? n : DEFAULT_PACE.busyMin };
}
export function cleanPace(raw: any): PaceSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const on = raw.on === undefined ? true : raw.on; if (typeof on !== 'boolean') return null;
  const n = raw.busyMin === undefined ? DEFAULT_PACE.busyMin : Math.round(Number(raw.busyMin));
  if (!Number.isFinite(n) || n < BUSY_MIN || n > BUSY_MAX) return null;
  return { on, busyMin: n };
}

/** A kitchen ticket as pacing reads it. */
export type PaceTicket = { status?: string; firedAt?: string | null; requestedAt?: string | null; createdAt?: string | null; readyAt?: string | null; makeSeconds?: number | null; holdUntil?: string | null;
  source?: string | null; visitId?: string | null; course?: number | null; orderId?: string | null };
export type PaceLevel = 'calm' | 'busy' | 'slammed';
export type Pace = { behindMin: number; level: PaceLevel; making: number; samples: number };
export const CALM: Pace = { behindMin: 0, level: 'calm', making: 0, samples: 0 };
/** How long a dish is expected to take when the menu doesn't say. */
export const DEFAULT_MAKE_MIN = 6;
/** What came out this long ago still counts. */
export const RECENT_MIN = 20;
/** Fewer than this many tickets to go on: not called behind. */
export const MIN_SAMPLES = 4;
/** A ticket still open after this long was left behind (a screen turned off at close, a table that left), not cooking. */
export const STALE_MIN = 120;
/** No dish counts as more than an hour late, and the kitchen is never called more than an hour behind. */
export const MAX_BEHIND_MIN = 60;

const ms = (v: unknown) => { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? t : NaN; };
const startOf = (t: PaceTicket) => { for (const v of [t.firedAt, t.requestedAt, t.createdAt]) { const x = ms(v); if (Number.isFinite(x)) return x; } return NaN; };
/** Sent together within a minute: the kitchen screen starts the quicker dishes later so they finish with the slowest
 *  (lib/table-service startPlan), so each is due when the slowest is. */
const TOGETHER_MS = 60000;
const groupOf = (t: PaceTicket) => (t.source === 'tab' && t.visitId ? `tab|${t.visitId}|${t.course ?? '-'}` : t.orderId ? `order|${t.orderId}` : null);

/** How far behind the kitchen is: of what it's making now and what came out in the last twenty minutes, the minutes
 *  past each dish's usual time (on time counts as none; a dish sent with a slower one is due with it when the kitchen
 *  finishes them together), three-quarters of the way up, so one slow dish doesn't make a night look slammed and a run
 *  of late ones does. Busy at the business's minutes behind, slammed at twice that. */
export function kitchenPace(tickets: PaceTicket[], now: number, s: PaceSettings = DEFAULT_PACE, o: { together?: boolean } = {}): Pace {
  const over: number[] = []; let making = 0;
  const list = (Array.isArray(tickets) ? tickets : []).filter((t) => t && typeof t === 'object');
  const own = (t: PaceTicket) => (Number(t.makeSeconds) > 0 ? Number(t.makeSeconds) / 60 : DEFAULT_MAKE_MIN);
  const groups = new Map<string, PaceTicket[]>();
  if (o.together !== false) for (const t of list) { const k = groupOf(t); if (!k) continue; const g = groups.get(k); if (g) g.push(t); else groups.set(k, [t]); }
  for (const t of list) {
    const st = String(t.status || '');
    const start = startOf(t); if (!Number.isFinite(start)) continue;
    const k = groupOf(t); const mates = k ? groups.get(k) || [] : [];
    const usual = Math.max(own(t), ...mates.filter((x) => Number(x.makeSeconds) > 0 && Math.abs(startOf(x) - start) <= TOGETHER_MS).map(own));
    if (st === 'pending' || st === 'in_progress') {
      // A later order waiting for its time isn't late.
      if (ms(t.holdUntil) > now) continue;
      if (now - start > STALE_MIN * 60000) continue;
      making++; over.push(Math.min(MAX_BEHIND_MIN, Math.max(0, (now - start) / 60000 - usual)));
    } else if (st === 'ready' || st === 'delivered' || st === 'served') {
      const done = ms(t.readyAt); if (!Number.isFinite(done) || now - done > RECENT_MIN * 60000 || done < start) continue;
      over.push(Math.min(MAX_BEHIND_MIN, Math.max(0, (done - start) / 60000 - usual)));
    }
  }
  if (!s.on || over.length < MIN_SAMPLES) return { ...CALM, making, samples: over.length };
  // Three-quarters of the way up (nearest rank): with four to go on, one slow dish is the top one and doesn't count.
  const sorted = over.sort((a, b) => a - b);
  const behindMin = Math.round(sorted[Math.max(0, Math.ceil(sorted.length * 0.75) - 1)]);
  const level: PaceLevel = behindMin >= s.busyMin * 2 ? 'slammed' : behindMin >= s.busyMin ? 'busy' : 'calm';
  return { behindMin: level === 'calm' ? 0 : behindMin, level, making, samples: over.length };
}

/** "The kitchen is about 8 minutes behind." */
export const paceWords = (p: Pace) => (p.level === 'calm' ? '' : `The kitchen is about ${p.behindMin} ${p.behindMin === 1 ? 'minute' : 'minutes'} behind${p.level === 'slammed' ? ', and slammed' : ''}.`);

/** A table's likely free time with the kitchen's delay counted: only for a table still waiting on its food to be made (a
 *  table whose food is already at the pass, or that's eating, paying or being cleared, isn't slowed by the kitchen). */
const BEFORE_FOOD = new Set(['seated', 'no_order', 'ordered', 'cooking', 'between']);
export function pacedFreeIn(stageKey: string, freeIn: number | null, p: Pace): number | null {
  if (freeIn === null || p.level === 'calm' || !BEFORE_FOOD.has(String(stageKey))) return freeIn;
  return freeIn + p.behindMin;
}
/** How much later ordering ahead's first pickup time is (whole minutes; none when calm). */
export const pickupDelayMin = (p: Pace) => (p.level === 'calm' ? 0 : p.behindMin);
