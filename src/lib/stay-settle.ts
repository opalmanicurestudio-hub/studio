// src/lib/stay-settle.ts — WHAT A DAY OR HOURLY STAY COMES TO AT CHECK-OUT. One sum for every way a stay ends: the
// desk's Check out (the Spaces page and Guests today) and the renter's own check-out in their portal. Only an hourly stay
// with a booked window is settled:
//   - Past its booked end by more than the space's grace (default 10 minutes): each started block of overtime (the
//     space's block, default 15 minutes) at the hourly rate, due.
//   - Out 30 minutes or more early: the unused quarter hours as a possible credit (the business decides), from $1.
// The booked end is the business's wall clock on the booking's day (lib/tenant-time), never the server's, so a stay is
// never billed hours of overtime for a time zone. A business that hasn't set its time zone: the desk's own clock (the
// desk is at the business); with no clock to go by (the portal, or before the business has loaded), the stay is just
// completed, never billed on a guess. Pure: the caller saves what comes back.
import { wallToUtc, hasTimeZone, tenantTimeZone, isValidTimeZone } from '@/lib/tenant-time';

export interface StaySettlement {
  status: 'completed'; completedAt: string; actualCheckOut: string;
  overageMinutes?: number; overageDueCents?: number; overageStatus?: 'due';
  unusedMinutes?: number; potentialCreditCents?: number; creditDecision?: 'pending';
  /** An hourly stay with a rate that couldn't be checked for overtime (no clock to go by), for the desk to look at. */
  overtimeUnchecked?: true;
}

/** The booked end of an hourly stay, as a moment, on the business's clock. Null when there isn't one. */
export function bookedEndAt(r: any, timeZone?: string | null): Date | null {
  const m = /^(\d{2}):(\d{2})/.exec(String(r?.endTime || ''));
  const day = String(r?.endDate || r?.startDate || '').slice(0, 10);
  if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const at = wallToUtc(day, Number(m[1]), Number(m[2]), timeZone || null);
  return isNaN(at.getTime()) ? null : at;
}

/** The clock a stay is settled on: the business's time zone; else the desk's own (passed in by the desk); else none. */
export function stayClock(tenant: any, deskZone?: string | null): string | null {
  if (tenant && hasTimeZone(tenant)) return tenantTimeZone(tenant);
  return deskZone && isValidTimeZone(deskZone) ? String(deskZone) : null;
}

/** The desk's own time zone, from the browser it runs in. Null where there isn't one. */
export function deskZone(): string | null {
  try { const z = Intl.DateTimeFormat().resolvedOptions().timeZone; return z && isValidTimeZone(z) ? z : null; } catch { return null; }
}

/** The space's overtime rules: grace before overtime starts, and the block it's charged in (minutes). */
export function overtimeRules(space: any): { graceMinutes: number; blockMinutes: number } {
  const g = Number(space?.rental?.graceMinutes);
  return { graceMinutes: Number.isFinite(g) && g >= 0 ? g : 10, blockMinutes: Math.max(5, Number(space?.rental?.blockMinutes) || 15) };
}

export function settleStay(r: any, o: { now: Date; timeZone?: string | null; hourlyCents: number; space?: any }): StaySettlement {
  const out: StaySettlement = { status: 'completed', completedAt: o.now.toISOString(), actualCheckOut: o.now.toISOString() };
  // No clock to go by: completed, nothing billed or offered on a guess.
  const end = o.timeZone && r?.bookingType === 'hourly' && r?.startTime && r?.actualCheckIn ? bookedEndAt(r, o.timeZone) : null;
  const rate = Math.max(0, Math.round(Number(o.hourlyCents) || 0));
  if (!end && !o.timeZone && rate > 0 && r?.bookingType === 'hourly' && r?.startTime && r?.endTime && r?.actualCheckIn) out.overtimeUnchecked = true;
  if (!end || rate <= 0) return out;
  const { graceMinutes, blockMinutes } = overtimeRules(o.space);
  const diffMs = o.now.getTime() - end.getTime();
  if (diffMs > graceMinutes * 60_000) {
    const blocks = Math.ceil((diffMs - graceMinutes * 60_000) / (blockMinutes * 60_000));
    out.overageMinutes = blocks * blockMinutes;
    out.overageDueCents = Math.round(rate * (blocks * blockMinutes) / 60);
    out.overageStatus = 'due';
  } else if (diffMs < -30 * 60_000) {
    const quarters = Math.floor(-diffMs / (15 * 60_000));
    const credit = Math.round(rate * (quarters * 15) / 60);
    if (credit >= 100) { out.unusedMinutes = quarters * 15; out.potentialCreditCents = credit; out.creditDecision = 'pending'; }
  }
  return out;
}
