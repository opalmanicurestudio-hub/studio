// src/lib/booth-rental-types.booking-additions.ts
//
// STAGED ADDITIONS for hourly/daily "day-use" bookings — a booth can now
// have BOTH a long-term Lease AND take short-term Bookings when open,
// per the hybrid model decided for this feature.
//
// Merge into booth-rental-types.ts: append the new types/consts/functions
// below, and apply the two `Booth`/`RentLedgerEntry` extensions noted
// inline (they're written here as separate exported types rather than
// edited in place, so this file has zero risk of silently diverging from
// booth-rental-types.ts until you do the actual merge — same pattern the
// file's own header already uses for staged changes).
//
// DESIGN GOAL: every piece here exists to make utilization measurable and
// optimizable, not just "bookings work" — see computeBoothUtilization and
// suggestAlternativeBooths at the bottom, which are the actual point of
// this feature, not an afterthought.

import type { Booth, RentLedgerEntry, WeekDay } from './booth-rental-types';

// ─── Booth: day-use pricing (MERGE into Booth interface) ─────────────────────
//
// Kept separate from baseRentCents/baseRentFrequency (the long-term rate) —
// a booth under an exclusive Lease with no scheduleSlot simply never
// surfaces as day-use-bookable regardless of these fields; a booth with a
// shared Lease or no Lease at all can be booked into whatever's open.

export interface BoothDayUseFields {
  dayUseEnabled: boolean;
  dayUseHourlyCents?: number;
  dayUseDailyCents?: number;
  dayUseMinHours?: number;        // e.g. 2 — minimum bookable block
  dayUseBufferMinutes?: number;   // turnover/cleaning gap enforced between bookings
}

export type BoothWithDayUse = Booth & BoothDayUseFields;

// ─── Booking ───────────────────────────────────────────────────────────────

export type BookingStatus =
  | 'held'          // transient — payment in flight, expires if not confirmed
  | 'confirmed'
  | 'checked_in'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export const ACTIVE_BOOKING_STATUSES: BookingStatus[] = ['confirmed', 'checked_in'];

export interface Booking {
  id: string;
  tenantId: string;
  locationId: string;
  boothId: string;
  renterId: string;
  status: BookingStatus;
  startAt: string;                // full ISO datetime, e.g. "2026-07-15T13:00:00-04:00"
  endAt: string;
  rateType: 'hourly' | 'daily';
  rateCentsSnapshot: number;      // price at booking time; booth rate changes don't rewrite history
  totalCents: number;
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
  paymentStatus: 'unpaid' | 'paid' | 'refunded';
  transactionId: string | null;   // tenants/{t}/transactions doc id (fee/dispute reconciliation)
  ledgerEntryId: string | null;   // tenants/{t}/rentLedger doc id (rent-roll visibility)
  holdExpiresAt: string | null;   // only set while status === 'held'
  cancelledAt: string | null;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── RentLedgerEntry: bookingId + optional leaseId (MERGE) ───────────────────
//
// RentLedgerEntry.leaseId is currently required. Bookings don't have a
// lease. Widen it — this is a superset type for the merge, same technique
// booth-rental-service.ts already uses for RentLedgerEntryWrite.

export type RentLedgerEntryWithBooking = Omit<RentLedgerEntry, 'leaseId'> & {
  leaseId: string | null;
  bookingId?: string | null;
};

// ─── Overlap / availability ───────────────────────────────────────────────

export interface TimeRange {
  startAt: string;
  endAt: string;
}

/** True if two [startAt, endAt) ranges overlap, buffer-inclusive on `b`. */
export function rangesOverlap(a: TimeRange, b: TimeRange, bufferMinutes = 0): boolean {
  const bufferMs = bufferMinutes * 60_000;
  const aStart = new Date(a.startAt).getTime();
  const aEnd = new Date(a.endAt).getTime();
  const bStart = new Date(b.startAt).getTime() - bufferMs;
  const bEnd = new Date(b.endAt).getTime() + bufferMs;
  return aStart < bEnd && bStart < aEnd;
}

/**
 * True if `booth` is free for `range`, given its occupying long-term lease
 * (if any) and every other booking already on it. This is the single
 * source of truth both the quick-book dialog and the server-side hold
 * transaction must call — never duplicate this check.
 */
export function isBoothAvailable(params: {
  range: TimeRange;
  occupyingLease: { scheduleSlot: { days: WeekDay[]; startTime?: string; endTime?: string } | null } | undefined;
  existingBookings: TimeRange[];
  bufferMinutes?: number;
}): boolean {
  const { range, occupyingLease, existingBookings, bufferMinutes = 0 } = params;

  if (occupyingLease) {
    // Exclusive lease (no scheduleSlot) blocks day-use entirely.
    if (!occupyingLease.scheduleSlot) return false;
    // Shared lease: block only the days/times it actually occupies.
    const day = new Date(range.startAt).getDay() as WeekDay;
    if (occupyingLease.scheduleSlot.days.includes(day)) {
      // No time-of-day on the slot = it blocks the whole day.
      if (!occupyingLease.scheduleSlot.startTime) return false;
      const slotRange: TimeRange = {
        startAt: `${range.startAt.slice(0, 10)}T${occupyingLease.scheduleSlot.startTime}:00`,
        endAt: `${range.startAt.slice(0, 10)}T${occupyingLease.scheduleSlot.endTime ?? '23:59'}:00`,
      };
      if (rangesOverlap(range, slotRange)) return false;
    }
  }

  return !existingBookings.some((b) => rangesOverlap(range, b, bufferMinutes));
}

/** Cents for a proposed booking, given the booth's day-use rates. */
export function computeBookingTotalCents(
  booth: BoothDayUseFields,
  range: TimeRange,
  rateType: 'hourly' | 'daily'
): number {
  if (rateType === 'daily') return booth.dayUseDailyCents ?? 0;
  const hours = (new Date(range.endAt).getTime() - new Date(range.startAt).getTime()) / 3_600_000;
  return Math.round((booth.dayUseHourlyCents ?? 0) * hours);
}

// ─── Utilization / optimization ───────────────────────────────────────────
//
// The actual point of this feature: turn "is the floor plan full" into a
// number, per booth, so an owner can see which stations are worth more
// day-use inventory and which are sitting empty.

export interface BoothUtilization {
  boothId: string;
  windowStart: string;
  windowEnd: string;
  bookedMinutes: number;
  availableMinutes: number;       // total minutes NOT blocked by an exclusive lease
  occupancyRate: number;          // bookedMinutes / availableMinutes, 0 if no available time
  bookingCount: number;
  revenueCents: number;
}

export function computeBoothUtilization(params: {
  boothId: string;
  windowStart: string;
  windowEnd: string;
  bookings: Pick<Booking, 'startAt' | 'endAt' | 'totalCents' | 'status'>[];
  exclusiveLeaseBlocksAllTime: boolean;
}): BoothUtilization {
  const { boothId, windowStart, windowEnd, bookings, exclusiveLeaseBlocksAllTime } = params;
  const windowMs = new Date(windowEnd).getTime() - new Date(windowStart).getTime();
  const availableMinutes = exclusiveLeaseBlocksAllTime ? 0 : windowMs / 60_000;

  const counted = bookings.filter((b) => ACTIVE_BOOKING_STATUSES.includes(b.status) || b.status === 'completed');
  const bookedMinutes = counted.reduce(
    (sum, b) => sum + (new Date(b.endAt).getTime() - new Date(b.startAt).getTime()) / 60_000,
    0
  );
  const revenueCents = counted.reduce((sum, b) => sum + b.totalCents, 0);

  return {
    boothId,
    windowStart,
    windowEnd,
    bookedMinutes,
    availableMinutes,
    occupancyRate: availableMinutes > 0 ? Math.min(1, bookedMinutes / availableMinutes) : 0,
    bookingCount: counted.length,
    revenueCents,
  };
}

/**
 * When the requested booth/time is unavailable, rank other day-use-enabled
 * booths by how free they are for the same window — lowest occupancy
 * first, so the suggestion actively steers demand toward underused
 * stations instead of just listing "whatever's technically open."
 */
export function suggestAlternativeBooths(params: {
  candidates: { booth: BoothWithDayUse; utilizationForWindow: BoothUtilization; available: boolean }[];
}): BoothWithDayUse[] {
  return params.candidates
    .filter((c) => c.available && c.booth.dayUseEnabled)
    .sort((a, b) => a.utilizationForWindow.occupancyRate - b.utilizationForWindow.occupancyRate)
    .map((c) => c.booth);
}
