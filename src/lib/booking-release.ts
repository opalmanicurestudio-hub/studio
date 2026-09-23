// src/lib/booking-release.ts
//
// HOW FAR OUT CAN THIS CLIENT BOOK, TODAY?
//
// Renters release their calendars in different ways, and each one sets it
// for themselves in Book → Setup → Memberships → Booking release:
//
//   rolling  — "always up to N days out" (members: M days).
//   monthly  — "next month opens on the 25th at 9am" (members: an earlier
//              day/hour). Before the release moment, the calendar ends at
//              the end of the current month; after it, at the end of next.
//   off      — no limit of the renter's own (the studio's default applies).
//
// This module is pure: hand it the settings, whether the client is a member,
// and the moment, and it returns the number of days the booking engine
// should allow (its existing `maxHorizonDays`). The public page, the book
// route and the portal all call the same function, so what the client sees
// and what the server enforces can never disagree.

export interface ReleaseSettings {
  mode?: 'off' | 'rolling' | 'monthly';
  // rolling
  horizonDays?: number;          // everyone
  memberHorizonDays?: number;    // members (>= horizonDays)
  // monthly
  releaseDay?: number;           // 1–28: day of the current month next month opens to everyone
  releaseHour?: number;          // 0–23, studio local
  memberReleaseDay?: number;     // members' earlier day (<= releaseDay)
  memberReleaseHour?: number;
}

export function cleanRelease(x: any): ReleaseSettings {
  const mode = x?.mode === 'monthly' ? 'monthly' : x?.mode === 'rolling' ? 'rolling' : (Number(x?.horizonDays) > 0 || Number(x?.memberHorizonDays) > 0) ? 'rolling' : 'off';
  const clamp = (v: any, lo: number, hi: number, d: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
  const horizonDays = clamp(x?.horizonDays, 0, 365, 0);
  return {
    mode,
    horizonDays,
    memberHorizonDays: Math.max(horizonDays, clamp(x?.memberHorizonDays, 0, 365, horizonDays)),
    releaseDay: clamp(x?.releaseDay, 1, 28, 25),
    releaseHour: clamp(x?.releaseHour, 0, 23, 9),
    memberReleaseDay: Math.min(clamp(x?.releaseDay, 1, 28, 25), clamp(x?.memberReleaseDay, 1, 28, 20)),
    memberReleaseHour: clamp(x?.memberReleaseHour, 0, 23, 9),
  };
}

/** A local-calendar view of `now` in a zone, without a date library. */
function localParts(now: Date, timeZone: string) {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' })
      .formatToParts(now).reduce((acc: any, x) => { acc[x.type] = x.value; return acc; }, {});
    return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24 };
  } catch {
    return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate(), h: now.getHours() };
  }
}
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based

/**
 * Days from today (inclusive of today = 0) through the last bookable day.
 * `null` means "no limit set by the renter".
 */
export function horizonDaysFor(settings: ReleaseSettings | null | undefined, isMember: boolean, now = new Date(), timeZone = 'America/New_York'): number | null {
  const s = cleanRelease(settings);
  if (s.mode === 'off') return null;
  if (s.mode === 'rolling') {
    const n = isMember ? (s.memberHorizonDays || s.horizonDays || 0) : (s.horizonDays || 0);
    return n > 0 ? n : null;
  }
  // monthly
  const { y, m, d, h } = localParts(now, timeZone);
  const day = isMember ? (s.memberReleaseDay as number) : (s.releaseDay as number);
  const hour = isMember ? (s.memberReleaseHour as number) : (s.releaseHour as number);
  const released = d > day || (d === day && h >= hour);
  // Days remaining in this month, plus all of next month if released.
  const restOfThisMonth = daysInMonth(y, m) - d;
  const nextMonth = released ? daysInMonth(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1) : 0;
  return restOfThisMonth + nextMonth;
}

/** One sentence for the renter's settings panel and the client's page. */
export function releaseSentence(settings: ReleaseSettings | null | undefined, now = new Date(), timeZone = 'America/New_York'): { everyone: string; members: string | null } {
  const s = cleanRelease(settings);
  if (s.mode === 'off') return { everyone: 'No booking limit of your own — the studio\'s default applies.', members: null };
  if (s.mode === 'rolling') {
    const mem = (s.memberHorizonDays || 0) > (s.horizonDays || 0);
    return { everyone: `Clients can book up to ${s.horizonDays} days ahead.`, members: mem ? `Members up to ${s.memberHorizonDays} days.` : null };
  }
  const { y, m } = localParts(now, timeZone);
  const next = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 1 : m, 1)).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
  const cur = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
  const clock = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}`;
  const ord = (n: number) => `${n}${[, 'st', 'nd', 'rd'][(n % 10 > 3 || Math.floor((n % 100) / 10) === 1) ? 0 : n % 10] || 'th'}`;
  const earlier = (s.memberReleaseDay as number) < (s.releaseDay as number) || ((s.memberReleaseDay as number) === (s.releaseDay as number) && (s.memberReleaseHour as number) < (s.releaseHour as number));
  return {
    everyone: `${next} opens on ${cur} ${ord(s.releaseDay as number)} at ${clock(s.releaseHour as number)}. Until then, clients can book through the end of ${cur}.`,
    members: earlier ? `Members get ${next} on the ${ord(s.memberReleaseDay as number)} at ${clock(s.memberReleaseHour as number)}.` : null,
  };
}
