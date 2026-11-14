// src/lib/table-stage.ts — WHERE EACH TABLE IS IN ITS MEAL, and when it's likely to be free. Pure: the server works it
// out from the table's tab and the kitchen's tickets (lib/floor-server) and the host stand shows it on every table.
// - The stage: just seated, nothing ordered yet, ordered, a course cooking or waiting at the pass, a course out (and
//   whether another is still to fire), asked for the check, paid. A table the guests have just left is "being cleared".
// - When it's likely free: from how long a table this size usually stays here (the business's own times), and never
//   sooner than what's left of its meal: food still to come takes a while to eat, and the check takes its own time.
//   Clearing and resetting the table is added on, so "free" means ready to seat.
// None of this is a guess dressed up as a fact: the words say what's known ("Mains cooking"), and the time is the
// business's own usual stay worked forward from when they sat down.

import { PREORDER_NOTE, type Course } from '@/lib/table-service';

export type SeatOrder = 'longest' | 'fit';
export type FloorSettings = {
  /** How long a table usually stays, in minutes: 1 or 2 guests, 3 or 4, 5 or more. */
  turnSmall: number; turnMid: number; turnLarge: number;
  /** From asking for the check to leaving. */
  payMin: number;
  /** Clearing and resetting a table after guests leave (0: ready right away). */
  clearMin: number;
  /** Who to seat next: whoever has waited longest, or the party that fits the table best. */
  seatOrder: SeatOrder;
  /** When two tables fit, suggest the one in the section with the fewest guests. */
  balance: boolean;
  /** Suggest holding a table and texting the party this long before it's free (0: only once it's free). */
  textAheadMin: number;
};
export const DEFAULT_FLOOR: FloorSettings = { turnSmall: 50, turnMid: 65, turnLarge: 80, payMin: 10, clearMin: 3, seatOrder: 'longest', balance: true, textAheadMin: 5 };
const RANGES: Record<Exclude<keyof FloorSettings, 'seatOrder' | 'balance'>, [number, number]> = {
  turnSmall: [10, 300], turnMid: [10, 300], turnLarge: [10, 300], payMin: [1, 60], clearMin: [0, 30], textAheadMin: [0, 20],
};
/** Food still to come: at least this long to finish it, before the check. */
export const EAT_MIN = 15;
/** A paid table usually leaves within this. */
export const LEAVE_MIN = 3;

/** The business's floor settings (tenants/{t}.hostingSettings.floor), each in its range, the rest the defaults. */
export function floorSettingsOf(tenant: any): FloorSettings {
  const raw = tenant?.hostingSettings?.floor || {};
  return cleanFloor(raw);
}
export function cleanFloor(raw: any): FloorSettings {
  const out: FloorSettings = { ...DEFAULT_FLOOR };
  for (const [k, [lo, hi]] of Object.entries(RANGES) as [keyof typeof RANGES, [number, number]][]) {
    const n = Math.round(Number(raw?.[k]));
    if (raw?.[k] !== undefined && raw?.[k] !== null && raw?.[k] !== '' && Number.isFinite(n) && n >= lo && n <= hi) out[k] = n;
  }
  if (raw?.seatOrder === 'fit' || raw?.seatOrder === 'longest') out.seatOrder = raw.seatOrder;
  if (typeof raw?.balance === 'boolean') out.balance = raw.balance;
  return out;
}

/** How long a party this size usually stays. */
export function turnFor(size: number, s: FloorSettings): number {
  const n = Math.max(1, Math.floor(Number(size) || 1));
  return n <= 2 ? s.turnSmall : n <= 4 ? s.turnMid : s.turnLarge;
}

export type StageKey = 'seated' | 'no_order' | 'ordered' | 'cooking' | 'at_pass' | 'between' | 'eating' | 'check' | 'paid' | 'clearing';
export type Stage = {
  key: StageKey;
  /** In a few words: "Mains cooking", "Asked for the check". */
  words: string;
  /** Minutes until it's likely ready to seat again (0: any minute now). Null when nobody knows when they sat down. */
  freeIn: number | null;
  /** How far along the meal is, 1 to 5 (seated, ordered, food out, last course, check). */
  step: number;
  /** Minutes since they sat down (null: not known), and how far past the usual stay. */
  seatedMin: number | null; over: number;
  /** The usual stay for this party. */
  turn: number;
  /** Lingering: paid a while ago, or asked for the check longer ago than the check usually takes. */
  lingering: boolean;
};
export const STAGE_STEPS = 5;

export type StageLine = { course?: number | null; courseName?: string | null; firedAt?: string | null; kdsId?: string | null; at?: string | null; note?: string | null };
export type StageTicket = { status: string; readyAt?: string | null; deliveredAt?: string | null };
export type StageInput = {
  seatedAt: string | null; size: number; tab: StageLine[]; tickets: Record<string, StageTicket>; courses: Course[];
  /** When the table asked for the check (null: not yet), and when it paid. */
  checkAt?: string | null; paidAt?: string | null;
};

const ms = (v: unknown) => { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? t : NaN; };
const minsSince = (t: number, now: number) => (Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 60000)) : null);
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Where one seated table is in its meal, and when it's likely ready to seat again. */
export function tableStage(t: StageInput, s: FloorSettings, now: number): Stage {
  const turn = turnFor(t.size, s);
  const seated = ms(t.seatedAt);
  const seatedMin = minsSince(seated, now);
  const over = seatedMin === null ? 0 : Math.max(0, seatedMin - turn);
  const turnLeft = Number.isFinite(seated) ? Math.ceil((seated + turn * 60000 - now) / 60000) : null;
  // Ready to seat: when they'll likely be gone, plus clearing.
  const ready = (leave: number | null) => (leave === null ? null : Math.max(0, leave) + s.clearMin);
  const done = (key: StageKey, words: string, step: number, leave: number | null, lingering = false): Stage => ({ key, words, step, freeIn: ready(leave), seatedMin, over, turn, lingering });

  const paid = ms(t.paidAt);
  if (Number.isFinite(paid)) {
    const m = minsSince(paid, now) || 0;
    return done('paid', m >= 5 ? `Paid ${m} min ago` : 'Paid, leaving soon', STAGE_STEPS, LEAVE_MIN - m, m >= 5);
  }
  const check = ms(t.checkAt);
  if (Number.isFinite(check)) {
    const m = minsSince(check, now) || 0;
    return done('check', m >= 1 ? `Asked for the check ${m} min ago` : 'Asked for the check', STAGE_STEPS, Math.max(1, s.payMin - m), m > s.payMin);
  }

  // The rest follows the usual stay, and never sooner than what's left of the meal.
  const atLeast = (still: boolean) => (turnLeft === null ? null : Math.max(turnLeft, (still ? EAT_MIN : 0) + s.payMin));
  // Drinks they ordered from their wait link aren't the table ordering (lib/wait-line).
  const lines = (Array.isArray(t.tab) ? t.tab : []).filter((l) => !!l && l.note !== PREORDER_NOTE);
  if (!lines.length) {
    if (seatedMin !== null && seatedMin >= 5) return done('no_order', `Seated ${seatedMin} min, nothing ordered`, 1, atLeast(true));
    return done('seated', 'Just seated', 1, atLeast(true));
  }
  // Each course as it stands.
  type G = { n: number; name: string; live: StageTicket[]; held: number };
  const by = new Map<number, G>();
  for (const l of lines) {
    const n = Number(l.course) || 0;
    const c = t.courses.find((x) => x.n === n);
    const g = by.get(n) || { n, name: c?.name || l.courseName || (n ? `Course ${n}` : 'Order'), live: [], held: 0 };
    const k = l.kdsId ? t.tickets[l.kdsId] : null;
    if (!l.firedAt && l.kdsId && (!k || k.status === 'unfired')) g.held += 1;
    else if (k && k.status !== 'cancelled' && k.status !== 'unfired') g.live.push(k);
    by.set(n, g);
  }
  const list = Array.from(by.values()).sort((a, b) => a.n - b.n);
  const isOut = (g: G) => g.live.length > 0 && g.live.every((k) => k.status === 'delivered');
  const atPass = list.filter((g) => g.live.some((k) => k.status === 'ready')).pop();
  const cooking = list.filter((g) => g.live.some((k) => k.status === 'pending' || k.status === 'in_progress')).pop();
  const heldNext = list.find((g) => g.held > 0);
  const lastOut = list.filter(isOut).pop();
  const word = (g: G) => (g.n ? g.name : 'Order');
  // What's at the pass, unless a later course is still cooking (a drink waiting while mains cook says mains).
  if (atPass && (!cooking || atPass.n >= cooking.n)) return done('at_pass', `${word(atPass)} at the pass`, 3, atLeast(true));
  if (cooking) return done('cooking', `${word(cooking)} cooking`, list.some(isOut) ? 3 : 2, atLeast(true));
  if (lastOut && heldNext) return done('between', `${word(lastOut)} out, ${lower(heldNext.name)} to fire`, 3, atLeast(true));
  if (heldNext) return done('ordered', 'Ordered', 2, atLeast(true));
  if (lastOut) {
    // The last course the business has (dessert, by default) means the meal is nearly done.
    const last = t.courses.length ? Math.max(...t.courses.map((c) => c.n)) : 0;
    const step = lastOut.n && lastOut.n >= last ? 4 : lastOut.n === 1 && list.length === 1 ? 2 : 3;
    return done('eating', `${word(lastOut)} out`, step, atLeast(false));
  }
  return done('ordered', 'Ordered', 2, atLeast(true));
}

/** A table the guests have just left: being cleared and reset, and ready in a few minutes. Null once it's ready (or
 *  when the business doesn't clear between tables). */
export function clearingStage(leftAt: string | null | undefined, s: FloorSettings, now: number): Stage | null {
  if (s.clearMin <= 0) return null;
  const left = ms(leftAt); if (!Number.isFinite(left)) return null;
  const gone = Math.floor((now - left) / 60000);
  if (gone >= s.clearMin || gone < -2) return null;
  const freeIn = Math.max(0, s.clearMin - Math.max(0, gone));
  return { key: 'clearing', words: 'Being cleared', freeIn, step: 0, seatedMin: null, over: 0, turn: 0, lingering: false };
}

/** "Free about 9:05" (or "Free any minute"): when it's likely ready to seat, in the business's time. */
export function freeWords(freeIn: number | null, now: number, tz?: string): string {
  if (freeIn === null) return '';
  if (freeIn <= 1) return 'Free any minute';
  const at = new Date(now + freeIn * 60000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) });
  return `Free about ${at}`;
}
