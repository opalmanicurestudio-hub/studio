// src/lib/booth-rental-pricing.ts
//
// Answers two questions per booth: (1) should this even be offered as
// day-use, and (2) if so, what hourly/daily rate is actually profitable —
// not just "similar studios charge $X" guesswork.
//
// Deliberately built on ACTUAL utilization (computeBoothUtilization from
// booth-rental-types.booking-additions.ts), not an assumed occupancy %.
// A rate suggestion based on a made-up 70% occupancy assumption is
// worthless the moment a booth actually books at 20%.

import { BoothUtilization } from './booth-rental-types.booking-additions';

export interface StudioOverheadInputs {
  /** This booth's share of rent + utilities + insurance, monthly, in cents. */
  monthlyFixedCostAllocationCents: number;
  /** Labor/supplies cost per turnover (cleaning, resetting), in cents. */
  variableCostPerBookingCents: number;
  /** e.g. 0.029 for Stripe's 2.9% */
  stripeFeePct: number;
  /** e.g. 30 for Stripe's $0.30 fixed fee */
  stripeFixedFeeCents: number;
  /** Owner's target margin on top of true cost, e.g. 0.35 for 35%. */
  targetMarginPct: number;
}

export interface DayUseRateRecommendation {
  boothId: string;
  eligible: boolean;
  reason: string;
  suggestedHourlyCents: number | null;
  suggestedDailyCents: number | null;
  breakEvenHourlyCents: number | null;      // rate at which margin is exactly zero
  effectiveHoursPerMonth: number;            // from actual trailing utilization
  confidence: 'measured' | 'estimated';      // 'estimated' = not enough booking history yet
}

/**
 * Grosses up a target take-home amount so that AFTER Stripe's cut, you
 * still net the intended amount. Charging exactly your cost means Stripe's
 * fee eats into it — this is what people forget.
 */
function grossUpForStripeFee(netTargetCents: number, feePct: number, fixedFeeCents: number): number {
  return Math.ceil((netTargetCents + fixedFeeCents) / (1 - feePct));
}

export function recommendDayUseRate(params: {
  boothId: string;
  dayUseEnabled: boolean;
  hasExclusiveLease: boolean;                 // fully booked by a long-term lease, no day-use gap at all
  trailingUtilization: BoothUtilization | null; // last 30 days, from computeBoothUtilization; null = no history yet
  overhead: StudioOverheadInputs;
  minViableHoursPerMonth?: number;             // below this, day-use isn't worth the coordination overhead
}): DayUseRateRecommendation {
  const { boothId, dayUseEnabled, hasExclusiveLease, trailingUtilization, overhead, minViableHoursPerMonth = 8 } = params;

  if (hasExclusiveLease) {
    return {
      boothId, eligible: false, reason: 'Fully occupied by an exclusive long-term lease — no open hours to sell.',
      suggestedHourlyCents: null, suggestedDailyCents: null, breakEvenHourlyCents: null,
      effectiveHoursPerMonth: 0, confidence: 'measured',
    };
  }
  if (!dayUseEnabled) {
    return {
      boothId, eligible: false, reason: 'Day-use not enabled for this booth.',
      suggestedHourlyCents: null, suggestedDailyCents: null, breakEvenHourlyCents: null,
      effectiveHoursPerMonth: 0, confidence: 'measured',
    };
  }

  // Prefer real data; fall back to a conservative estimate (25% of a
  // 10hrs/day, 6-day week) only when there's no booking history yet, and
  // say so via `confidence` — never silently present a guess as fact.
  const confidence: DayUseRateRecommendation['confidence'] = trailingUtilization ? 'measured' : 'estimated';
  const effectiveHoursPerMonth = trailingUtilization
    ? (trailingUtilization.bookedMinutes / 60) * (30 / 30) // already a 30-day window; scale if you pass a different one
    : 0.25 * 10 * 6 * 4.33;

  if (effectiveHoursPerMonth < minViableHoursPerMonth) {
    return {
      boothId, eligible: false,
      reason: `Only ~${effectiveHoursPerMonth.toFixed(1)} sellable hrs/mo (measured) — not enough volume to justify day-use overhead. Consider a long-term lease instead.`,
      suggestedHourlyCents: null, suggestedDailyCents: null, breakEvenHourlyCents: null,
      effectiveHoursPerMonth, confidence,
    };
  }

  const fixedCostPerHourCents = overhead.monthlyFixedCostAllocationCents / effectiveHoursPerMonth;
  const netCostPerHourCents = fixedCostPerHourCents + overhead.variableCostPerBookingCents; // variable cost treated as per-session, folded in per hour here for simplicity
  const netTargetPerHourCents = netCostPerHourCents * (1 + overhead.targetMarginPct);

  const suggestedHourlyCents = grossUpForStripeFee(netTargetPerHourCents, overhead.stripeFeePct, overhead.stripeFixedFeeCents);
  const breakEvenHourlyCents = grossUpForStripeFee(netCostPerHourCents, overhead.stripeFeePct, overhead.stripeFixedFeeCents);
  const suggestedDailyCents = Math.round(suggestedHourlyCents * 8 * 0.85); // 8hr day, 15% multi-hour discount

  return {
    boothId, eligible: true,
    reason: confidence === 'estimated'
      ? 'No booking history yet — rate is a conservative estimate; revisit after ~30 days of real bookings.'
      : `Based on ${effectiveHoursPerMonth.toFixed(1)} measured booked hrs/mo.`,
    suggestedHourlyCents, suggestedDailyCents, breakEvenHourlyCents,
    effectiveHoursPerMonth, confidence,
  };
}
