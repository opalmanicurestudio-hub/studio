// src/lib/booking-policies.ts — WHAT APPLIES TO THIS APPOINTMENT, FOR THIS CLIENT.
//
// One answer for everything that needs it (booking, the front desk, cancel &
// reschedule, emails, the booking-page FAQ): business default → service →
// provider/renter → client privileges, with WHERE each rule came from.
//
// It reads the settings that already exist first (cancellationWindowHours,
// depositPolicy, bookingRelease, …) so nothing changes until the owner edits;
// new rules live under tenant.bookingPolicies with the defaults below.
// Pure — safe on the server and in the browser.

import { resolveDepositPolicy, type DepositPolicy } from '@/lib/deposit-policy';

export type Source = 'default' | 'business' | 'service' | 'provider' | 'member';
export type Ruled<T> = { value: T; source: Source };

/** The new, per-business rules (owner decisions 2026-09-28) and their defaults. */
export interface BookingPoliciesSettings {
  lateCancelConsequence?: 'both' | 'fee' | 'deposit';     // default 'both' — the deposit counts toward the fee
  changeCutoffHours?: number;                             // no client changes inside this; 0 = any time (default 2 — today's behaviour)
  rescheduleLimit?: number;                               // changes allowed before the next needs a person; 0 = unlimited (default 2)
  overLimit?: 'approval' | 'block';                       // default 'approval'
  rescheduleDeadline?: 'original' | 'new';                // default 'original' — moving can't push the deadline back
  maxUpcomingBookings?: number;                           // 0 = no limit (default)
  balanceDue?: 'visit' | 'booking';                       // default 'visit'
  onlineCheckIn?: boolean;                                // clients can check themselves in from their link (default on)
  unpaidFeeRule?: 'next_visit' | 'before_booking' | 'keep_booking'; // a change fee their card can't pay (default: next visit)
  renterDeskSupport?: { billing: 'included' | 'per_booking' | 'monthly'; amount?: number }; // default included
}
export const POLICY_DEFAULTS: Required<Omit<BookingPoliciesSettings, 'renterDeskSupport'>> & { renterDeskSupport: { billing: 'included'; amount: number } } = {
  lateCancelConsequence: 'both', changeCutoffHours: 2, rescheduleLimit: 2, overLimit: 'approval', rescheduleDeadline: 'original',
  maxUpcomingBookings: 0, balanceDue: 'visit', onlineCheckIn: true, unpaidFeeRule: 'next_visit', renterDeskSupport: { billing: 'included', amount: 0 },
};

export interface EffectivePolicy {
  deposit: { required: Ruled<boolean>; kind: Ruled<'flat' | 'percent' | 'full' | 'breakeven' | 'none'>; amount: Ruled<number>; appliesToBalance: Ruled<boolean>; outcomes: DepositPolicy; balanceDue: Ruled<'visit' | 'booking'> };
  cancel: { windowHours: Ruled<number>; feeMode: Ruled<'flat' | 'percentage' | 'matrix' | 'none'>; feeValue: Ruled<number>; lateConsequence: Ruled<'both' | 'fee' | 'deposit'> };
  change: { cutoffHours: Ruled<number>; feeWindowHours: Ruled<number>; fee: Ruled<number>; limit: Ruled<number>; overLimit: Ruled<'approval' | 'block'>; deadline: Ruled<'original' | 'new'> };
  noShow: { feeMode: Ruled<'full_service' | 'flat' | 'matrix' | 'none'>; flatFee: Ruled<number> };
  late: { graceMinutes: Ruled<number>; fee: Ruled<number>; autoCancel: Ruled<boolean> };
  access: { publicDays: Ruled<number>; memberDays: Ruled<number>; minNoticeMinutes: Ruled<number>; maxUpcoming: Ruled<number>; membersOnly: Ruled<boolean> };
  holds: { holdMinutes: Ruled<number>; paymentGraceHours: Ruled<number> };
  renterDesk: { billing: Ruled<'included' | 'per_booking' | 'monthly'>; amount: Ruled<number> };
}

const has = (v: any) => v !== undefined && v !== null && v !== '';
const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
/** First defined value wins, with its source. */
function pick<T>(...c: [any, Source][]): Ruled<T> { for (const [v, s] of c) if (has(v)) return { value: v as T, source: s }; return { value: undefined as any, source: 'default' }; }

export function resolvePolicy(tenant: any, service?: any, opts: { isMember?: boolean } = {}): EffectivePolicy {
  const t = tenant || {}; const s = service || {}; const bp: BookingPoliciesSettings = t.bookingPolicies || {}; const bm = t.bookingMode || {}; const rel = t.bookingRelease || {};
  const svcDeposit = !!s.depositType && s.depositType !== 'none' && (s.depositType !== 'deposit' || num(s.depositAmount) > 0);
  const svcFeeMode = s.cancellationFeeMode && s.cancellationFeeMode !== 'inherit' ? s.cancellationFeeMode : undefined;
  // Unset → 'matrix' (your costs): that's what the cancellation screen charges when no type was chosen.
  const tenantFeeMode = t.defaultCancellationMode || undefined;
  return {
    deposit: {
      required: svcDeposit ? { value: true, source: 'service' } : { value: false, source: 'default' },
      kind: svcDeposit ? { value: s.depositType === 'full' ? 'full' : s.depositType === 'breakeven' ? 'breakeven' : s.depositSubType === 'percentage' ? 'percent' : 'flat', source: 'service' } : { value: 'none', source: 'default' },
      amount: svcDeposit ? { value: num(s.depositAmount), source: 'service' } : { value: 0, source: 'default' },
      appliesToBalance: pick<boolean>([s.depositAppliesToBalance, 'service'], [true, 'default']),
      outcomes: resolveDepositPolicy(t),
      balanceDue: pick<'visit' | 'booking'>([bp.balanceDue, 'business'], [POLICY_DEFAULTS.balanceDue, 'default']),
    },
    cancel: {
      windowHours: pick<number>([num(s.cancellationWindowHours) || undefined, 'service'], [num(t.cancellationWindowHours) || undefined, 'business'], [24, 'default']),
      feeMode: pick([svcFeeMode, 'service'], [tenantFeeMode, 'business'], ['matrix', 'default']),
      feeValue: pick<number>([num(s.cancellationFeeValue ?? s.customCancellationFee) || undefined, 'service'], [num(t.cancellationFee) || undefined, 'business'], [0, 'default']),
      lateConsequence: pick([bp.lateCancelConsequence, 'business'], [POLICY_DEFAULTS.lateCancelConsequence, 'default']),
    },
    change: {
      // One cutoff: the new setting, else the older clientNotify.rescheduleCutoffHours, else 2h (what clients get today).
      cutoffHours: pick<number>([bp.changeCutoffHours, 'business'], [has(t.clientNotify?.rescheduleCutoffHours) ? num(t.clientNotify.rescheduleCutoffHours) : undefined, 'business'], [POLICY_DEFAULTS.changeCutoffHours, 'default']),
      feeWindowHours: pick<number>([num(t.rescheduleFeeWindowHours) || undefined, 'business'], [0, 'default']),
      fee: pick<number>([num(t.rescheduleFee) || undefined, 'business'], [0, 'default']),
      limit: pick<number>([bp.rescheduleLimit, 'business'], [POLICY_DEFAULTS.rescheduleLimit, 'default']),
      overLimit: pick([bp.overLimit, 'business'], [POLICY_DEFAULTS.overLimit, 'default']),
      deadline: pick([bp.rescheduleDeadline, 'business'], [POLICY_DEFAULTS.rescheduleDeadline, 'default']),
    },
    noShow: {
      feeMode: pick([t.noShowFeeMode, 'business'], ['full_service', 'default']), // what the no-show path charges today when unset
      flatFee: pick<number>([num(t.flatNoShowFee ?? t.noShowFee) || undefined, 'business'], [0, 'default']),
    },
    late: {
      graceMinutes: pick<number>([has(t.lateArrivalGracePeriod) ? num(t.lateArrivalGracePeriod) : undefined, 'business'], [15, 'default']),
      fee: pick<number>([num(t.lateArrivalFee) || undefined, 'business'], [0, 'default']),
      autoCancel: pick<boolean>([has(t.autoCancelLateArrivals) ? !!t.autoCancelLateArrivals : undefined, 'business'], [false, 'default']),
    },
    access: {
      publicDays: pick<number>([num(rel.horizonDays) || undefined, 'business'], [num(t.bookingHorizonDays) || undefined, 'business'], [0, 'default']),
      memberDays: pick<number>([opts.isMember ? (num(rel.memberHorizonDays) || undefined) : undefined, 'member'], [num(rel.memberHorizonDays) || undefined, 'business'], [0, 'default']),
      minNoticeMinutes: pick<number>([num(t.bookingLeadMinutes) || (num(t.bookingLeadHours) ? num(t.bookingLeadHours) * 60 : undefined), 'business'], [0, 'default']),
      maxUpcoming: pick<number>([bp.maxUpcomingBookings, 'business'], [POLICY_DEFAULTS.maxUpcomingBookings, 'default']),
      membersOnly: pick<boolean>([s.membersOnly === true ? true : undefined, 'service'], [false, 'default']),
    },
    holds: {
      holdMinutes: pick<number>([num(bm.holdMinutes) || undefined, 'business'], [30, 'default']),
      paymentGraceHours: pick<number>([has(bm.paymentGraceHours) ? num(bm.paymentGraceHours) : undefined, 'business'], [24, 'default']),
    },
    renterDesk: {
      billing: pick([bp.renterDeskSupport?.billing, 'business'], [POLICY_DEFAULTS.renterDeskSupport.billing, 'default']),
      amount: pick<number>([bp.renterDeskSupport?.amount, 'business'], [0, 'default']),
    },
  };
}

/** For the owner: "Business default", "This service", … */
export const sourceLabel = (s: Source) => ({ default: 'ClarityFlow default', business: 'Your setting', service: 'This service', provider: 'This provider', member: 'Members' } as const)[s];


// ── A CHANGE FEE THEIR CARD CAN'T PAY (no card, or declined) ─────────────
//   next_visit     → added to their balance, due at their next visit (default)
//   before_booking → added to their balance; they must pay it before booking again
//   keep_booking   → the change isn't made; their appointment stays as it was
/** How a repeat series is secured (Booking policies → Repeat bookings). */
export type SeriesDeposit = 'first' | 'before_each' | 'all_now' | 'none';
export const seriesDepositOf = (tenant: any, override?: any): SeriesDeposit => {
  const ok = (v: any) => ['first', 'before_each', 'all_now', 'none'].includes(v);
  return ok(override) ? override : ok(tenant?.bookingPolicies?.seriesDeposit) ? tenant.bookingPolicies.seriesDeposit : 'first';
};
export const seriesDepositDaysOf = (tenant: any) => Math.max(1, Math.min(30, Number(tenant?.bookingPolicies?.seriesDepositDaysBefore) || 7));
/** When a visit's scheduled deposit can't be taken. */
export type SeriesDepositFailed = 'link_flag' | 'release' | 'keep_flag';
export const seriesDepositFailedOf = (tenant: any): SeriesDepositFailed => (['link_flag', 'release', 'keep_flag'].includes(tenant?.bookingPolicies?.seriesDepositFailed) ? tenant.bookingPolicies.seriesDepositFailed : 'link_flag');

export type UnpaidFeeRule = 'next_visit' | 'before_booking' | 'keep_booking' | 'with_deposit';
export const unpaidFeeRuleOf = (tenant: any): UnpaidFeeRule => (['next_visit', 'before_booking', 'keep_booking', 'with_deposit'].includes(tenant?.bookingPolicies?.unpaidFeeRule) ? tenant.bookingPolicies.unpaidFeeRule : 'next_visit');
/** What clients are told (before booking, and at the change). */
export function unpaidFeeLine(rule: UnpaidFeeRule): string {
  return rule === 'keep_booking' ? 'Change fees are charged to your card on file; if it can’t be charged, your appointment stays as it is.'
    : rule === 'before_booking' ? 'Change fees are charged to your card on file; if it can’t be charged, the fee needs to be paid before you book again.'
    : rule === 'with_deposit' ? 'Change fees are charged to your card on file; if it can’t be charged, it’s paid together with the deposit when you next book.'
    : 'Change fees are charged to your card on file; if it can’t be charged, the fee is added to your next visit.';
}
