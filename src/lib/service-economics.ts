// ─── service-economics.ts ─────────────────────────────────────────────────────
// Renter billing cadences.
//
// This file briefly also carried a breakeven calculator, a fee-policy engine
// and a settlement ladder. All three were removed, because the app already had
// them in better form and two engines computing the same number is how
// settings screens start disagreeing with reality:
//
//   • Breakeven per service = the "matrix basis" in CancelAppointmentDialog
//     (TMHR × duration + materials + burdened labour) — per service, and
//     tier-aware, which the version here was not.
//   • Cancellation and reschedule fees = src/lib/opal/cancellation-policy.ts,
//     which handles matrix / percentage / flat modes, per-service overrides,
//     and applies a studio flat fee once per appointment rather than once
//     per service.
//   • Charging and arrears = functions/src/onCancellationEvent.ts, which
//     charges off-session and records a balance when it cannot.
//
// What remains is the one idea with no prior art: different rental rhythms
// need differently shaped notifications. Booth renters are not all monthly —
// a chair let by the day, a station booked by the hour, and a full-time lease
// are three different rhythms, and the message that keeps each one paid is
// different. An hourly renter needs a receipt; a warning before an hourly
// charge is noise. A monthly renter needs three days to move the money.

export type RentCadence = 'hourly' | 'daily' | 'weekly' | 'biweekly' | 'monthly';

export interface CadenceProfile {
  cadence: RentCadence;
  /** Hours before the charge to warn. 0 = no warning; the receipt is enough. */
  warnHours: number;
  /** Send a receipt after a successful charge? */
  receipt: boolean;
  /** Hours after a failure before the first chase. */
  chaseAfterHours: number;
  note: string;
}

const CADENCE_DEFAULTS: Record<RentCadence, CadenceProfile> = {
  hourly: {
    cadence: 'hourly', warnHours: 0, receipt: true, chaseAfterHours: 1,
    note: 'Charged per session. A warning before an hourly charge is noise; the receipt is the message that matters.',
  },
  daily: {
    cadence: 'daily', warnHours: 12, receipt: true, chaseAfterHours: 4,
    note: 'Warned the evening before, charged in the morning.',
  },
  weekly: {
    cadence: 'weekly', warnHours: 48, receipt: true, chaseAfterHours: 24,
    note: 'Two days\u2019 notice is enough to move money without being nagging.',
  },
  biweekly: {
    cadence: 'biweekly', warnHours: 72, receipt: true, chaseAfterHours: 24,
    note: 'Three days\u2019 notice, matching most pay cycles.',
  },
  monthly: {
    cadence: 'monthly', warnHours: 72, receipt: true, chaseAfterHours: 48,
    note: 'Three days\u2019 notice \u2014 the largest amount deserves the most warning.',
  },
};

export function resolveCadence(tenant: any, cadence: string | null | undefined): CadenceProfile {
  const key = (['hourly', 'daily', 'weekly', 'biweekly', 'monthly'] as RentCadence[])
    .includes(cadence as RentCadence) ? cadence as RentCadence : 'monthly';
  const base = CADENCE_DEFAULTS[key];
  const stored = ((tenant && tenant.rentNotifications) || {})[key] || {};
  const n = (v: any, d: number) => {
    const x = Number(v);
    return Number.isFinite(x) && x >= 0 ? x : d;
  };
  return {
    ...base,
    warnHours: n(stored.warnHours, base.warnHours),
    receipt: stored.receipt === undefined ? base.receipt : stored.receipt === true,
    chaseAfterHours: n(stored.chaseAfterHours, base.chaseAfterHours),
  };
}
