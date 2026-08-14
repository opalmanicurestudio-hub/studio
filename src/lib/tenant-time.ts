// ─── src/lib/tenant-time.ts ───────────────────────────────────────────────
// ONE place that knows what "today", "8am" and "by the 3rd" mean for a shop.
//
// The problem this exists to end: Vercel runs in UTC and the browser runs in
// whatever the person's laptop says, so the SAME code produces two different
// answers depending on where it executed. `new Date().toISOString().slice(0,10)`
// is "today" in London — for a shop in Los Angeles it silently becomes
// tomorrow every day after 5pm. A calendar date like '2026-03-03' parsed as an
// instant is UTC midnight, which is the EVENING BEFORE across the Americas.
// Neither mistake throws. Both just quietly produce a day that is off by one,
// which is how a shop gets flagged late on an order it shipped on time.
//
// Rules this file follows, and that callers should follow too:
//   1. STORE instants (ISO with Z) or calendar days ('YYYY-MM-DD'). Never a
//      "local time" string with no zone — that is a date nobody can read back.
//   2. A calendar day has no time. Turning it into an instant is a DECISION:
//      a deadline means the END of that day, a start means the BEGINNING, and
//      both depend on the shop's zone. Say which one you mean by calling
//      startOfDay or endOfDay rather than letting Date.parse decide for you.
//   3. Never store a fixed offset (-300) as a shop's timezone. An offset is
//      not a zone — it cannot know that -300 becomes -240 in March, so every
//      derived time is an hour wrong for eight months of the year.
//
// Safe in both runtimes: Intl only, no imports, no dependencies, no `next`.
// Client components and API routes can both use it.

/** Fallback when a shop has not chosen a zone. UTC deliberately: a neutral
 *  wrong answer the shop can see and correct beats a plausible wrong answer
 *  (a hardcoded 'America/New_York') that silently suits one tenant. */
export const FALLBACK_TIME_ZONE = 'UTC';

export type WallParts = {
  year: number; month: number; day: number;
  hour: number; minute: number; second: number;
};

/** Does this runtime recognise the zone? Guards against a typo saved years ago. */
export function isValidTimeZone(timeZone?: string | null): boolean {
  const tz = String(timeZone || '').trim();
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/**
 * The shop's zone, from wherever it was set. Checked in order of how
 * specifically it was chosen; an invalid or missing value falls through
 * rather than throwing, because a bad zone string must never be able to take
 * a page down.
 */
export function tenantTimeZone(tenant?: any, location?: any): string {
  const candidates = [
    location?.timezone,
    location?.timeZone,
    tenant?.timezone,
    tenant?.timeZone,
    tenant?.retailSettings?.timezone,
  ];
  for (const c of candidates) if (isValidTimeZone(c)) return String(c).trim();
  return FALLBACK_TIME_ZONE;
}

/** True when the shop has actually chosen — so a surface can prompt for it
 *  instead of quietly showing UTC and looking broken. */
export function hasTimeZone(tenant?: any, location?: any): boolean {
  return tenantTimeZone(tenant, location) !== FALLBACK_TIME_ZONE;
}

function safeZone(timeZone?: string | null): string {
  return isValidTimeZone(timeZone) ? String(timeZone).trim() : FALLBACK_TIME_ZONE;
}

/** What the clock on the shop's wall reads at this instant. */
export function wallParts(date: Date, timeZone?: string | null): WallParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: safeZone(timeZone),
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value;
  return {
    year: +map.year,
    month: +map.month,
    day: +map.day,
    hour: +map.hour % 24, // Intl emits "24" for midnight in some locales
    minute: +map.minute,
    second: +map.second,
  };
}

/** Offset of the zone from UTC at that instant, in ms. EDT = -14400000. */
export function tzOffsetMs(timeZone: string | null | undefined, date: Date): number {
  const p = wallParts(date, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime();
}

/**
 * A wall-clock time in the shop's zone → the actual instant.
 * wallToUtc('2026-03-08', 2, 30, 'America/New_York') lands correctly even
 * though 2:30am does not exist that morning: the second pass re-reads the
 * offset AT the candidate instant, which is what makes DST boundaries work.
 */
export function wallToUtc(
  dateStr: string,
  hour: number,
  minute: number,
  timeZone?: string | null,
  second = 0,
): Date {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return new Date(NaN);
  const guess = new Date(Date.UTC(y, m - 1, d, hour, minute, second));
  const off1 = tzOffsetMs(timeZone, guess);
  let out = new Date(guess.getTime() - off1);
  const off2 = tzOffsetMs(timeZone, out);
  if (off2 !== off1) out = new Date(guess.getTime() - off2);
  return out;
}

/** First instant of that calendar day in the shop's zone. */
export function startOfDay(dateStr: string, timeZone?: string | null): Date {
  return wallToUtc(dateStr, 0, 0, timeZone, 0);
}

/** Last instant of that calendar day in the shop's zone. */
export function endOfDay(dateStr: string, timeZone?: string | null): Date {
  return wallToUtc(dateStr, 23, 59, timeZone, 59);
}

/**
 * THE DEADLINE RULE, in one place. "By March 3" means any time on March 3 in
 * the shop's zone still counts — so the deadline is the END of that day, not
 * its beginning. A value that is already a full instant is returned as-is,
 * because someone has already decided.
 *
 * This is what every "ship by", "closes on", "due by" date should run
 * through. Getting it wrong in either direction is expensive: too early and
 * the shop is late on an order it shipped on time; too late and a promise
 * outlives the day it named.
 */
export function deadlineAt(value?: string | null, timeZone?: string | null): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = endOfDay(raw, timeZone);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** 'YYYY-MM-DD' for that instant in the shop's zone — the honest replacement
 *  for `.toISOString().slice(0, 10)`, which is only ever correct in London. */
export function dayKey(date: Date, timeZone?: string | null): string {
  const p = wallParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** The shop's today, whatever the server thinks. */
export function todayIn(timeZone?: string | null, now: Date = new Date()): string {
  return dayKey(now, timeZone);
}

/** Same calendar day on the shop's wall? Two instants hours apart can be. */
export function isSameDay(a: Date, b: Date, timeZone?: string | null): boolean {
  return dayKey(a, timeZone) === dayKey(b, timeZone);
}

/** Hour 0-23 on the shop's wall. What quiet-hours and auto-run checks need. */
export function hourIn(date: Date, timeZone?: string | null): number {
  return wallParts(date, timeZone).hour;
}

/** Calendar-safe day arithmetic that never drifts across a DST boundary,
 *  because it works on the day NUMBERS, not on a 24-hour millisecond count. */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days, 12));
  return t.toISOString().slice(0, 10);
}

// ── Display ──────────────────────────────────────────────────────────────────
// Every formatter takes the zone explicitly. A formatter that defaults to the
// runtime's zone is the bug this file exists to remove, so none of them do.

export function formatDay(value: Date | string, timeZone?: string | null): string {
  const d = toDate(value, timeZone);
  if (!d) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: safeZone(timeZone), month: 'long', day: 'numeric', year: 'numeric',
  }).format(d);
}

export function formatShortDay(value: Date | string, timeZone?: string | null): string {
  const d = toDate(value, timeZone);
  if (!d) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: safeZone(timeZone), weekday: 'short', month: 'short', day: 'numeric',
  }).format(d);
}

export function formatTime(value: Date | string, timeZone?: string | null): string {
  const d = toDate(value, timeZone);
  if (!d) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: safeZone(timeZone), hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d);
}

export function formatDateTime(value: Date | string, timeZone?: string | null): string {
  const d = toDate(value, timeZone);
  if (!d) return '';
  return `${formatShortDay(d, timeZone)} at ${formatTime(d, timeZone)}`;
}

/** Short zone label for a footer or an email — 'EDT', 'PST'. Says which clock
 *  a time is on, which is the difference between a time and a guess. */
export function zoneLabel(timeZone?: string | null, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: safeZone(timeZone), timeZoneName: 'short',
    }).formatToParts(at);
    return parts.find((p) => p.type === 'timeZoneName')?.value || '';
  } catch {
    return '';
  }
}

/**
 * Accepts what the codebase actually holds: a Date, an ISO instant, or a bare
 * calendar day. A bare day is anchored at MIDDAY in the shop's zone — never
 * midnight — so that formatting it can never land on the day before.
 */
function toDate(value: Date | string, timeZone?: string | null): Date | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return wallToUtc(raw, 12, 0, timeZone);
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
}
