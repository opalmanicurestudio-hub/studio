// src/lib/leave-policy.ts
//
// LEAVE — MATERNITY, MEDICAL, FAMILY — WITHOUT THE RENT BECOMING A FIGHT.
//
// The renter record already knew the words 'on_leave' and 'maternity_leave'
// but nothing changed when they were set: rent kept invoicing, the lease kept
// ending on its date, and the conversation happened by text. This module
// gives leave a record, a request/approve flow, and a rent treatment the shop
// chooses — and it changes invoicing only through an APPROVED leave.
//
// Owner control, the same way as everything else: which treatments a shop
// offers is a setting; every request needs the owner's approval; nothing
// here pauses rent on its own.
//
// Treatments:
//   pause    — no invoices while on leave; the lease end date extends by the
//              same number of days (recorded on the leave, applied at end)
//   reduced  — invoices continue at N% of rent (a holding rate)
//   bank     — full rent continues; each week accrues rental-day credits the
//              renter redeems on return (recorded on the leave as a total)
//   sublet   — the space returns to the public listing for day rentals while
//              they are away; day income offsets their rent
//
// THE SUBLET WINDOW IS DERIVED, NEVER STORED AS A FLAG. The booth carries
// subletFrom / subletUntil / subletLeaseId, and every booking path asks
// "is this DATE inside the window?" rather than reading a boolean somebody
// had to remember to switch back. A flag left on after a renter came home
// sells their chair out from under them; a date range cannot.

export type LeaveTreatment = 'pause' | 'reduced' | 'bank' | 'sublet';
export type LeaveType = 'maternity' | 'medical' | 'family' | 'personal' | 'other';
export type LeaveStatus = 'requested' | 'approved' | 'declined' | 'ended' | 'cancelled';

export interface LeavePolicy {
  /** Treatments this shop offers at all. Empty = leave is not offered. */
  offered: LeaveTreatment[];
  /** Holding rate for 'reduced', percent of rent. */
  reducedPercent: number;
  /** Credits per week on 'bank', in rental days. */
  bankDaysPerWeek: number;
  /** Longest leave the shop will approve, in weeks (guidance, not a wall). */
  maxWeeks: number;
  /** Notice the shop asks for, in days (guidance shown to the renter). */
  noticeDays: number;
  /**
   * Close a leave on its agreed return date without being asked.
   *
   * This is the ONE automation here that defaults ON, and deliberately: every
   * other automation in this app suspends money and so defaults off, while
   * this one RESTORES normal rent on the date the renter named and the owner
   * approved. Off is the dangerous setting — a leave nobody closes invoices
   * nothing forever. Turn it off and the return date raises a decision for
   * you instead of acting.
   */
  autoEnd: boolean;
}

export const DEFAULT_LEAVE: LeavePolicy = {
  offered: [], reducedPercent: 50, bankDaysPerWeek: 1, maxWeeks: 16, noticeDays: 14, autoEnd: true,
};

export const LEAVE_TREATMENT_LABEL: Record<LeaveTreatment, string> = {
  pause: 'Pause rent',
  reduced: 'Reduced holding rate',
  bank: 'Keep paying, bank days',
  sublet: 'Sublet while away',
};
export const LEAVE_TREATMENT_NOTE: Record<LeaveTreatment, string> = {
  pause: 'No rent while away. The lease end date moves out by the same number of days.',
  reduced: 'A smaller amount keeps the space theirs.',
  bank: 'Rent continues in full; each week banks rental-day credits to use on return.',
  sublet: 'The space is listed for day rentals while they are away; that income credits their rent.',
};
export const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  maternity: 'Maternity / parental', medical: 'Medical', family: 'Family', personal: 'Personal', other: 'Other',
};

export function resolveLeavePolicy(tenant: any): LeavePolicy {
  const p = (tenant && tenant.leavePolicy) || {};
  const all: LeaveTreatment[] = ['pause', 'reduced', 'bank', 'sublet'];
  const offered = Array.isArray(p.offered) ? p.offered.filter((t: any) => all.includes(t)) : DEFAULT_LEAVE.offered;
  const n = (v: any, d: number, lo: number, hi: number) => { const x = Number(v); return Number.isFinite(x) && x >= lo && x <= hi ? x : d; };
  return {
    offered,
    reducedPercent: n(p.reducedPercent, DEFAULT_LEAVE.reducedPercent, 0, 100),
    bankDaysPerWeek: n(p.bankDaysPerWeek, DEFAULT_LEAVE.bankDaysPerWeek, 0, 7),
    maxWeeks: n(p.maxWeeks, DEFAULT_LEAVE.maxWeeks, 1, 104),
    noticeDays: n(p.noticeDays, DEFAULT_LEAVE.noticeDays, 0, 90),
    autoEnd: p.autoEnd === false ? false : DEFAULT_LEAVE.autoEnd,
  };
}

export interface LeaveRedeemRequest {
  days: number;
  note: string;
  requestedAt: string;
  status: 'requested' | 'approved' | 'declined';
  decidedAt?: string | null;
  creditCents?: number | null;
}

export interface LeaveRecord {
  id: string;
  renterId: string;
  /** Denormalised at request time so a notification can name them without a lookup. */
  renterName?: string;
  leaseId: string;
  type: LeaveType;
  startDate: string;       // YYYY-MM-DD
  endDate: string;         // expected return, YYYY-MM-DD
  treatment: LeaveTreatment | null;   // null until approved
  status: LeaveStatus;
  note: string;
  requestedAt: string;
  decidedAt?: string | null;
  decidedBy?: string | null;
  decisionNote?: string | null;
  /** Filled while active / at end. */
  pausedDays?: number;      // for 'pause': days to extend the lease by
  bankedDays?: number;      // for 'bank': credits accrued
  redeemedDays?: number;    // banked days already spent
  redeem?: LeaveRedeemRequest | null;
  endedAt?: string | null;
  endedBy?: 'system' | 'owner' | null;
  returnDueNotifiedAt?: string | null;
}

/** Is `dayIso` inside an approved leave for this lease? */
export function leaveCovering(leaves: LeaveRecord[] | any[], leaseId: string, dayIso: string): LeaveRecord | null {
  for (const l of leaves || []) {
    if (l.leaseId !== leaseId || l.status !== 'approved') continue;
    if (String(l.startDate) <= dayIso && dayIso <= String(l.endDate)) return l as LeaveRecord;
  }
  return null;
}

/**
 * What to invoice on a due day, given an approved leave covering it.
 * Returns null to skip the invoice entirely.
 */
export function rentUnderLeave(leave: LeaveRecord | null, rentCents: number, policy: LeavePolicy): { amountCents: number; label: string } | null {
  if (!leave) return { amountCents: rentCents, label: '' };
  switch (leave.treatment) {
    case 'pause': return null;
    case 'reduced': return { amountCents: Math.round(rentCents * (policy.reducedPercent / 100)), label: `holding rate · ${policy.reducedPercent}% while on leave` };
    case 'bank': return { amountCents: rentCents, label: 'on leave · banking rental days' };
    case 'sublet': return { amountCents: rentCents, label: 'on leave · space sublet' };
    default: return { amountCents: rentCents, label: '' };
  }
}

export function leaveDays(startDate: string, endDate: string): number {
  const p = (v: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
  const a = p(startDate), b = p(endDate);
  if (isNaN(a) || isNaN(b) || b < a) return 0;
  return Math.round((b - a) / 86_400_000) + 1;
}

/** Add days to a YYYY-MM-DD, staying in UTC so a timezone can never eat a day. */
export function addDays(dateIso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateIso || '');
  if (!m || !Number.isFinite(days)) return dateIso;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Approved leaves whose return date has passed — the ones that should close.
 * A leave ends the day AFTER its last day, so someone returning on the 15th
 * is still on leave on the 15th.
 */
export function leavesDueToEnd(leaves: LeaveRecord[] | any[], todayIso: string): LeaveRecord[] {
  return (leaves || []).filter((l: any) => l.status === 'approved' && String(l.endDate) < todayIso) as LeaveRecord[];
}

/**
 * One rental day in money, from whatever rhythm the lease is billed on.
 * A banked day has to be worth something before it can be redeemed, and the
 * only honest number is the renter's own rent divided by the days it covers.
 */
export function dailyRentCents(lease: any): number {
  const rent = Number(lease?.rentAmountCents) || 0;
  switch (String(lease?.frequency || 'monthly')) {
    case 'daily': return rent;
    case 'weekly': return Math.round(rent / 7);
    case 'biweekly': return Math.round(rent / 14);
    default: return Math.round(rent / 30);
  }
}

/** Banked days still available to spend. */
export function bankedAvailable(leave: any): number {
  return Math.max(0, (Number(leave?.bankedDays) || 0) - (Number(leave?.redeemedDays) || 0));
}

/** What redeeming N banked days is worth against this lease. */
export function redeemValueCents(lease: any, days: number): number {
  const d = Math.max(0, Math.floor(Number(days) || 0));
  return d * dailyRentCents(lease);
}

/**
 * Is this booth sublet-open on this date?
 *
 * Read from the booth's own window, by DATE, every time. Booking paths call
 * this instead of trusting a stored boolean, so a sublet cannot outlive the
 * leave that created it even if a cron misses a night.
 */
export function subletOpenOn(booth: any, dateIso: string): boolean {
  const from = typeof booth?.subletFrom === 'string' ? booth.subletFrom : '';
  const until = typeof booth?.subletUntil === 'string' ? booth.subletUntil : '';
  if (!from || !until || !dateIso) return false;
  return from <= dateIso && dateIso <= until;
}

/**
 * What a sublet actually earned, and what of it has already been handed back.
 *
 * Counts only reservations that are real money in the till: a confirmed or
 * checked-in booking, cancelled ones excluded, and holds that were never paid
 * excluded. A day redeemed from a prepaid PASS contributes nothing here on
 * purpose — that revenue was recognised when the pack was sold, so counting
 * it again would credit the renter twice for one sale. The booking count is
 * returned alongside the money so a small number is explicable rather than
 * suspicious.
 */
export function subletIncome(reservations: any[] | null | undefined, leaseId: string, alreadyCreditedCents = 0): {
  grossCents: number; bookings: number; passBookings: number; creditedCents: number; uncreditedCents: number;
} {
  let grossCents = 0, bookings = 0, passBookings = 0;
  for (const r of reservations || []) {
    if (!r || r.subletLeaseId !== leaseId) continue;
    if (!['confirmed', 'checked_in', 'completed'].includes(String(r.status))) continue;
    if (r.paidWithPassId) { passBookings++; bookings++; continue; }
    grossCents += Math.max(0, Number(r.amountCents) || 0);
    bookings++;
  }
  const creditedCents = Math.max(0, Number(alreadyCreditedCents) || 0);
  return { grossCents, bookings, passBookings, creditedCents, uncreditedCents: Math.max(0, grossCents - creditedCents) };
}

/** The fields that open a booth for sublet, and the fields that close it. */
export function subletWindowFields(leave: { id: string; leaseId: string; startDate: string; endDate: string; renterId: string }) {
  return {
    subletFrom: leave.startDate, subletUntil: leave.endDate,
    subletLeaseId: leave.leaseId, subletLeaveId: leave.id, subletRenterId: leave.renterId,
  };
}
export const SUBLET_CLEAR_FIELDS = { subletFrom: null, subletUntil: null, subletLeaseId: null, subletLeaveId: null, subletRenterId: null };
