// src/lib/waitlist-engine.ts — THE WAITLIST, v2 (design canvas Op10–Op12, Op15–Op17). Pure rules; the server half is
// lib/waitlist-server. An opening (a cancelled visit's time) is offered to the people it really fits — their service
// fits the time with no useless scrap left over, the provider they asked for, the days and times they said, enough
// notice — and HOW depends on how far away it is:
//   more than a day   → one person at a time, 30 minutes each (fair; nobody gets "someone beat you to it")
//   later today       → the top three at once, first to tap
//   under an hour     → no texts; the desk handles it (people in the building, the walk-in line, the next client)
// Moving someone up ("come in sooner") is only allowed when the slot it frees is fillable — far enough away, or someone
// new on the list wants it — and never more than two moves in a row, so a move never just shifts the hole.

export type Part = 'morning' | 'afternoon' | 'evening';
export const PARTS: Part[] = ['morning', 'afternoon', 'evening'];
export const partOf = (hour: number): Part => (hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening');
export type Mode = 'one' | 'first' | 'desk';
const H = 3600e3, DAY = 864e5;
export const HOLD_ONE_MIN = 30;     // how long one person's offer is theirs
export const HOLD_FIRST_MIN = 20;   // how long a first-to-tap round runs before the next three
export const FIRST_BATCH = 3;
export const MAX_CHAIN = 2;

export function offerModeFor(startMs: number, now: number): Mode {
  const lead = startMs - now;
  return lead >= 24 * H ? 'one' : lead >= 1 * H ? 'first' : 'desk';
}

/** When could they come? `windows` maps weekday (0 = Sunday) to the parts of the day; none saved = any time. */
export function windowFits(windows: Record<string, string[]> | null | undefined, weekday: number, hour: number): boolean {
  if (!windows || !Object.keys(windows).length) return true;
  const parts = windows[String(weekday)] || []; return parts.includes(partOf(hour));
}

export interface Entry { id: string; kind?: 'new' | 'sooner'; clientId?: string | null; name?: string; phone?: string; email?: string; serviceId?: string | null; serviceIds?: string[]; staffId?: string | null; preferredStaffId?: string | null;
  windows?: Record<string, string[]> | null; noticeHours?: number; until?: string | null; createdAt?: string; addedAt?: string; appointmentId?: string | null; status?: string; visits?: number; reliability?: 'ok' | 'misses' }
export interface Opening { id: string; staffId: string; start: string; end: string; minutes: number; serviceId?: string | null; chainDepth?: number; offered?: string[] }

const OPEN = ['waiting', 'active', 'open', 'empty', 'notified', 'offered'];
export const isWaiting = (e: Entry) => OPEN.includes(String(e.status || 'waiting'));
const ms = (v: any) => (typeof v === 'string' ? Date.parse(v) || 0 : Number(v) || 0);
export const serviceOf = (e: Entry) => String(e.serviceId || (e.serviceIds || [])[0] || '');
export const staffWanted = (e: Entry) => { const s = e.staffId || e.preferredStaffId || null; return s && s !== 'any' ? String(s) : null; };

/** Whether this person could take this opening, and if not, why (shown on the desk so nothing is a mystery). */
export function fitFor(e: Entry, o: Opening, x: { now: number; tz: { weekday: number; hour: number; date: string }; serviceMinutes: number | null; shortest: number; bookable: boolean; sameDayBooked: boolean }): { ok: true; leftover: number } | { ok: false; why: string } {
  if (!isWaiting(e)) return { ok: false, why: 'not waiting' };
  const want = staffWanted(e); if (want && want !== o.staffId) return { ok: false, why: 'wants someone else' };
  if (!windowFits(e.windows, x.tz.weekday, x.tz.hour)) return { ok: false, why: 'not a time they can come' };
  const notice = Number(e.noticeHours ?? 3); if (ms(o.start) - x.now < notice * H) return { ok: false, why: `needs ${notice >= 24 ? 'a day' : `${notice} hour${notice === 1 ? '' : 's'}`}’ notice` };
  if (e.until && x.tz.date > String(e.until).slice(0, 10)) return { ok: false, why: 'past the date they gave' };
  if (x.sameDayBooked) return { ok: false, why: 'already booked that day' };
  if (e.reliability === 'misses' && ms(o.start) - x.now < 24 * H) return { ok: false, why: 'missed visits — no same-day offers' };
  if (!x.bookable || x.serviceMinutes === null) return { ok: false, why: 'their service doesn’t fit this time' };
  const leftover = o.minutes - x.serviceMinutes;
  if (leftover < 0) return { ok: false, why: 'their service is longer than the opening' };
  if (leftover > 0 && leftover < x.shortest) return { ok: false, why: `would leave ${leftover} min nobody can book` };
  return { ok: true, leftover };
}

/** A move-up frees their later time. Only if that time can be filled again: 3+ days away, or someone new wants it. */
export function moveUpOk(o: Opening, freedStartMs: number, now: number, newcomerForFreed: boolean): { ok: boolean; why?: string } {
  if ((o.chainDepth || 0) >= MAX_CHAIN) return { ok: false, why: 'two moves already — the chain stops here' };
  if (freedStartMs <= ms(o.start)) return { ok: false, why: 'not sooner' };
  if (newcomerForFreed) return { ok: true };
  if (freedStartMs - now >= 3 * DAY) return { ok: true };
  return { ok: false, why: 'would leave a hole too soon to fill' };
}

/** Order: someone new first (one more visit), the provider they asked for, no leftover, then who's waited longest,
 * then regulars (the tie-break). */
export function rank<T extends { e: Entry; leftover: number }>(list: T[]): T[] {
  const w = (e: Entry) => ms(e.createdAt || e.addedAt) || 0;
  return [...list].sort((a, b) => (a.e.kind === 'sooner' ? 1 : 0) - (b.e.kind === 'sooner' ? 1 : 0)
    || (staffWanted(b.e) ? 1 : 0) - (staffWanted(a.e) ? 1 : 0)
    || (a.leftover === 0 ? 0 : 1) - (b.leftover === 0 ? 0 : 1)
    || w(a.e) - w(b.e)
    || (b.e.visits || 0) - (a.e.visits || 0));
}

/** Who to text now, given the offers already out. */
export function nextOffers(mode: Mode, offers: { status: string; holdUntil?: string }[], ranked: { e: Entry }[], now: number): number {
  if (mode === 'desk') return 0;
  const live = offers.filter((f) => f.status === 'sent' && ms(f.holdUntil) > now);
  if (live.length) return 0;                       // someone's still holding it (or a round is still running)
  return Math.min(mode === 'one' ? 1 : FIRST_BATCH, ranked.length);
}

/** The words. Hello-first doesn't apply here: they asked to be told, so the link goes in. */
export function offerText(o: { first: string; provider: string; when: string; service: string; price: string; link: string; mode: Mode; holdMin: number; sooner?: { was: string } | null; business: string }): string {
  const p = o.provider ? ` with ${o.provider}` : '';
  if (o.sooner) return `Hi ${o.first}! A sooner time opened${p}: ${o.when} instead of ${o.sooner.was}. Want it? ${o.link} — if not, your time stays just as it is.`;
  return o.mode === 'one'
    ? `Hi ${o.first}! ${o.when}${p} just opened up — your ${o.service}${o.price ? `, ${o.price}` : ''}. It’s yours for the next ${o.holdMin} minutes if you’d like it: ${o.link}`
    : `Hi ${o.first}! ${o.when}${p} just opened up — your ${o.service}${o.price ? `, ${o.price}` : ''}. It goes to whoever taps first: ${o.link}`;
}

/** What's wanted most and never got — the waitlist as demand, for staffing. */
export function demandOf(entries: Entry[], now: number, days = 30): { weekday: number; part: Part; asked: number; served: number }[] {
  const cells = new Map<string, { weekday: number; part: Part; asked: number; served: number }>();
  for (const e of entries) {
    if (now - ms(e.createdAt || e.addedAt) > days * DAY || !e.windows) continue;
    for (const [d, parts] of Object.entries(e.windows)) for (const p of parts as Part[]) {
      const k = `${d}|${p}`; const c = cells.get(k) || { weekday: Number(d), part: p, asked: 0, served: 0 };
      c.asked++; if (['booked', 'converted'].includes(String(e.status))) c.served++; cells.set(k, c);
    }
  }
  return [...cells.values()].sort((a, b) => (b.asked - b.served) - (a.asked - a.served));
}
