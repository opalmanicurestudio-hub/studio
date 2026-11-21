// src/lib/cook-ahead.ts — COOK AHEAD (pure; design board "Cook ahead"). For what can be held (lib/holding: fries,
// nuggets, a pot of coffee), the kitchen screen says how many batches to start, and by when, before the next stretch
// needs them: "Fries: 2 batches (12) by 11:45". Always a guess, and said to be one.
// - A usual day like today: the same weekday, the last four weeks (lib/cook-ahead-server reads them), in 15-minute steps,
//   planned for the busier ones: each step is the average of the busier half of the days that sold the item at all. With
//   fewer than two such days, nothing is said for it.
// - The next hour only: the first time in it that what's held (and still good then) won't cover what sells from now.
//   The batches are for the stretch from that 15-minute step, as long as the item can be held: what it sells, less
//   what's held and still good then (after what sells before it), in whole batches.
// - By when: that step's start, less the time it takes to make; already past, it's now.
// It never starts a batch by itself: Start a batch is the same tap as the + on the screen.

export const SLOT_MIN = 15, SLOTS = 96, WEEKS = 4, HORIZON_MIN = 60, MIN_DAYS = 2;
export type CookItem = { id: string; name: string; holdMinutes: number; batchSize: number; makeSeconds?: number };
/** One past day: for each item, what sold in each 15-minute step of the day (96 of them, by the local clock). */
export type PastDay = Record<string, number[]>;
export type CookBin = { itemId: string; quantity: number; expiresAt: string; status: string };
export type CookPlan = { itemId: string; name: string; batches: number; batchSize: number;
  /** When to start, in minutes of the local day; null: now. */ byMin: number | null;
  /** About how many the stretch sells, and the stretch (minutes of the local day). */ need: number; fromMin: number; toMin: number;
  /** Held now and still good. */ held: number };

/** The usual day for one item: each step, planned for the busier days; null with too few days to go on. */
export function usualOf(days: PastDay[], itemId: string): { slots: number[]; days: number } | null {
  const sold = days.map((d) => d[itemId]).filter((s): s is number[] => Array.isArray(s) && s.some((n) => n > 0));
  if (sold.length < MIN_DAYS) return null;
  const slots = Array.from({ length: SLOTS }, (_, i) => {
    const v = sold.map((s) => Number(s[i]) || 0).sort((a, b) => b - a);
    const top = v.slice(0, Math.ceil(v.length / 2));
    return top.reduce((a, b) => a + b, 0) / top.length;
  });
  return { slots, days: sold.length };
}

/** What the usual day sells from one minute of the day to another (a step partly in it counts in part). Past midnight
 *  (minute 1440 on) it carries on into the small hours of the same business day: a past day's after-midnight sales are
 *  in its first steps, by the clock. */
export function soldBetween(slots: number[], fromMin: number, toMin: number): number {
  let sum = 0;
  for (let i = Math.max(0, Math.floor(fromMin / SLOT_MIN)); i < 2 * SLOTS && i * SLOT_MIN < toMin; i++) {
    const a = Math.max(fromMin, i * SLOT_MIN), b = Math.min(toMin, (i + 1) * SLOT_MIN);
    if (b > a) sum += (slots[i % SLOTS] || 0) * ((b - a) / SLOT_MIN);
  }
  return sum;
}

/** What to cook ahead, now (`nowMin`: minutes into the local day; `nowMs`: the time, for what's held). Most urgent first.
 *  (Its minutes can run past 1440 near midnight: the server turns them into moments.) */
export function cookAhead(items: CookItem[], days: PastDay[], bins: CookBin[], nowMin: number, nowMs: number): CookPlan[] {
  const out: CookPlan[] = [];
  for (const it of items) {
    const u = usualOf(days, it.id); if (!u) continue;
    const hold = Math.max(SLOT_MIN, Math.round(Number(it.holdMinutes) || 0));
    const size = Math.max(1, Math.floor(Number(it.batchSize) || 1));
    const makeMin = Math.round((Number(it.makeSeconds) || 0) / 60);
    const mine = bins.filter((b) => b.status === 'held' && b.itemId === it.id);
    // Held and still good at a minute of the day (counted from now).
    const goodAt = (m: number) => mine.filter((b) => Date.parse(b.expiresAt) > nowMs + (m - nowMin) * 60000).reduce((a, b) => a + Math.max(0, Number(b.quantity) || 0), 0);
    const held = goodAt(nowMin);
    // The first minute in the next hour that what's held (and still good then) won't cover what's sold since now.
    let shortAt = -1;
    for (let t = nowMin; t < nowMin + HORIZON_MIN; t++) if (soldBetween(u.slots, nowMin, t + 1) > goodAt(t) + 0.5) { shortAt = t; break; }
    if (shortAt < 0) continue;
    // The batch is for the stretch from that 15-minute step (or now), as long as it can be held.
    const s = Math.max(nowMin, Math.floor(shortAt / SLOT_MIN) * SLOT_MIN);
    const to = s + hold;
    const need = soldBetween(u.slots, s, to);
    if (need < 1) continue;
    const have = Math.max(0, goodAt(s) - soldBetween(u.slots, nowMin, s));
    const short = Math.max(1, Math.ceil(need) - Math.floor(have));
    const by = s - makeMin;
    out.push({ itemId: it.id, name: it.name, batches: Math.ceil(short / size), batchSize: size, byMin: by <= nowMin ? null : by, need: Math.ceil(need), fromMin: s, toMin: to, held });
  }
  return out.sort((a, b) => (a.byMin ?? -1) - (b.byMin ?? -1) || a.name.localeCompare(b.name));
}
