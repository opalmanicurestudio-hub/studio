// src/lib/appointment-merge.ts — HOW A STORED APPOINTMENT BECOMES WHAT SCREENS SEE. Dates become Dates, the visit
// link's day-of progress (on my way, running late, in the chair) is laid over a confirmed booking, and contact
// details are removed for people the privacy setting hides them from. One function, so the shared lists and every
// date-range read look exactly the same.

const DAY_OF_PROGRESS = new Set(['arrived', 'checked_in', 'servicing', 'ready_for_checkout', 'completed']);
const DAY = 86_400_000;

export function visitDate(val: any): Date {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  if (typeof val?.toDate === 'function') return val.toDate();
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000);
  const d = new Date(val);
  return Number.isFinite(d.getTime()) ? d : new Date();
}

export function mergeVisit(apt: any, ci: any | null | undefined): any {
  return {
    ...apt,
    startTime: visitDate(apt.startTime),
    endTime: visitDate(apt.endTime),
    actualStartTime: apt.actualStartTime ? visitDate(apt.actualStartTime) : undefined,
    actualEndTime: apt.actualEndTime ? visitDate(apt.actualEndTime) : undefined,
    checkInStatus: ci?.checkInStatus || apt.checkInStatus || 'pending',
    lateTimeMinutes: ci?.lateTimeMinutes ?? apt.lateTimeMinutes ?? 0,
    // The visit link's copy may only add day-of progress on top of a confirmed booking, never an old booking stage.
    status: (apt.status === 'confirmed' && DAY_OF_PROGRESS.has(String(ci?.status || ''))) ? ci.status : apt.status,
  };
}

export function mergeVisits(raw: any[] | null | undefined, checkIns: Map<string, any>, mask: ((a: any) => any) | null): any[] {
  if (!raw) return [];
  const out = raw.map((a: any) => mergeVisit(a, a?.checkInToken ? checkIns.get(a.checkInToken) : null));
  return mask ? out.map(mask) : out;
}

/**
 * Visit-link tokens worth watching: only visits from three days ago to two days ahead. Older ones are settled on the
 * appointment itself (checkout writes "completed" there), so their visit-link copies change nothing on screen.
 */
export function liveTokens(lists: (any[] | null | undefined)[], now = Date.now()): string[] {
  const lo = now - 3 * DAY, hi = now + 2 * DAY; const out = new Set<string>();
  for (const list of lists) for (const a of list || []) {
    if (!a?.checkInToken) continue;
    const t = visitDate(a.startTime).getTime();
    if (t >= lo && t <= hi) out.add(String(a.checkInToken));
  }
  return [...out].sort();
}
