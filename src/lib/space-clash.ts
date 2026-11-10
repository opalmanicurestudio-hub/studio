// src/lib/space-clash.ts — DOES THIS TIME CLASH WITH ONE ALREADY TAKEN? One rule for a space's day and hourly bookings,
// whichever way they were made: a guest's day rental (api/booths/reserve, boothReservations) or a renter's station
// booking (api/stripe/book-station, bookings). Each route checks the other's, so a space is never sold twice.
// Times are the business's wall clock ("2026-11-10T09:00:00", no zone), as both kinds are stored; a time carrying a zone
// is read as the wall time it shows. The turnover gap the business set (dayUseBufferMinutes) keeps that many minutes clear
// between two timed bookings; a whole-day booking ends at midnight and needs no gap (the next day is free). A time that
// can't be read is never taken as free. Pure: no database (lib/space-clash-server reads the bookings).

export interface DayBookingTime { startDate: string; endDate?: string | null; bookingType?: string | null; startTime?: string | null; endTime?: string | null }

/** How long a day rental waiting on its payment page keeps its time. Its payment page closes well before this. */
export const PENDING_HOLD_MS = 40 * 60 * 1000;
/** The payment page for a day rental closes after this (Stripe's shortest is 30 minutes), inside the hold, so nobody can
 *  pay for a time that's been let go. */
export const CHECKOUT_OPEN_SECONDS = 33 * 60;

/** A wall-clock range: start, end (not included), and whether it's whole days. */
export type WallRange = [string, string, boolean?];

const day = (v: unknown) => String(v || '').slice(0, 10);

const nextDay = (iso: string) => { const t = Date.parse(`${iso}T12:00:00Z`); return Number.isFinite(t) ? new Date(t + 86_400_000).toISOString().slice(0, 10) : iso; };

/** A day rental's time as a wall-clock range: an hourly one its hours, a daily one its whole days (to midnight after). */
export function wallRange(r: DayBookingTime): WallRange {
  const start = day(r.startDate); const end = day(r.endDate) || start;
  const hourly = r.bookingType === 'hourly' && /^\d{2}:\d{2}/.test(String(r.startTime || '')) && /^\d{2}:\d{2}/.test(String(r.endTime || ''));
  return hourly ? [`${start}T${String(r.startTime).slice(0, 5)}:00`, `${end}T${String(r.endTime).slice(0, 5)}:00`] : [`${start}T00:00:00`, `${nextDay(end)}T00:00:00`, true];
}

const ms = (wall: string) => { const t = Date.parse(`${String(wall).slice(0, 19)}Z`); return Number.isFinite(t) ? t : NaN; };

/** Do two wall-clock ranges overlap, with the turnover gap kept clear between two timed ones? Ends aren't included, so
 *  back to back (11:00 to 11:00, or one day to the next) is fine with no gap. */
export function wallOverlap(a: WallRange | [string, string], b: WallRange | [string, string], bufferMinutes = 0): boolean {
  const [as, ae, bs, be] = [ms(a[0]), ms(a[1]), ms(b[0]), ms(b[1])];
  if ([as, ae, bs, be].some((x) => !Number.isFinite(x))) return true;   // unreadable: never assume it's free
  const gap = (a as WallRange)[2] || (b as WallRange)[2] ? 0 : Math.max(0, bufferMinutes) * 60_000;
  return as < be + gap && bs < ae + gap;
}

/** A guest's day rental that keeps its time: paid, checked in, a cancellation not yet settled, or waiting on its payment page. */
export function reservationHolds(r: any, now = Date.now()): boolean {
  const st = String(r?.status || '');
  if (['confirmed', 'checked_in', 'cancel_requested'].includes(st)) return true;
  return st === 'pending_payment' && !!r?.createdAt && now - Date.parse(String(r.createdAt)) < PENDING_HOLD_MS;
}

/** A renter's station booking that keeps its time (as api/stripe/book-station holds it). */
export function stationHolds(b: any, nowIso = new Date().toISOString()): boolean {
  const st = String(b?.status || '');
  if (['confirmed', 'checked_in'].includes(st)) return true;
  return st === 'held' && (!!b?.chargeClaimAt || (!!b?.holdExpiresAt && String(b.holdExpiresAt) > nowIso));
}

/** The shortest booking a space takes, in minutes: the space's own (rented-out rooms and equipment keep theirs in
 *  minutes) or its hours setting, whichever is longer. 0 when none is set. */
export function shortestMinutes(space: any): number {
  return Math.max(0, Number(space?.rental?.minMinutes) || 0, Math.round((Number(space?.dayUseMinHours) || 0) * 60));
}

/** "2 hours", "90 minutes". */
export function minutesWords(m: number): string {
  return m % 60 === 0 ? `${m / 60} hour${m === 60 ? '' : 's'}` : `${m} minutes`;
}
