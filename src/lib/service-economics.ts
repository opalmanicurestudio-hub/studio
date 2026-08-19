// ─── service-economics.ts ─────────────────────────────────────────────────────
// What a booking actually costs the business, and what it costs the business
// when that booking falls apart.
//
// The gap this closes: "breakeven" deposits were computed as PRODUCT COST
// ALONE. That is not breakeven. A two-hour appointment consumes two hours of
// a chair that could have been sold to somebody else, and the products are
// often the smallest part of the number. A shop collecting a $12 product-cost
// deposit on a $200 four-hour service believed it was protected and was not.
//
// True breakeven for a reserved slot has three parts:
//
//   1. PRODUCTS      — what gets used up and cannot be resold.
//   2. RESERVED TIME — the chair-hour floor. Rent, power, insurance, software
//      and everything else that runs whether or not somebody sits down,
//      divided by the hours you can actually sell. This is the part that was
//      missing, and it is usually the biggest.
//   3. LABOUR        — commission or hourly pay owed for the booking, where
//      the shop pays regardless (a guaranteed hour, a booked-out contractor).
//      Zero for pure commission staff who earn nothing on a no-show.
//
// Everything here is pure and dependency-free so the booking sheet, the API,
// and the settings preview all produce the same number.

export interface ShopEconomics {
  /** The chair-hour floor in cents: fixed monthly costs ÷ sellable hours. */
  hourlyFloorCents: number;
  /** Include staff pay in breakeven? True when you pay for the hour whether
   *  or not the client shows. */
  includeLabour: boolean;
  /** Fallback labour rate when the staff record has none. */
  defaultLabourHourlyCents: number;
}

export function resolveShopEconomics(tenant: any): ShopEconomics {
  const e = (tenant && tenant.economics) || {};
  const n = (v: any, d: number) => {
    const x = Number(v);
    return Number.isFinite(x) && x >= 0 ? x : d;
  };
  return {
    hourlyFloorCents: n(e.hourlyFloorCents, 0),
    includeLabour: e.includeLabour === true,
    defaultLabourHourlyCents: n(e.defaultLabourHourlyCents, 0),
  };
}

/** Helper for the settings screen: turn "my fixed costs are $X a month and I
 *  can sell Y hours a week" into the floor. Stated as its own function so the
 *  UI can show the working rather than asking for a number nobody has. */
export function hourlyFloorFrom(monthlyFixedCents: number, sellableHoursPerWeek: number): number {
  const hoursPerMonth = (Number(sellableHoursPerWeek) || 0) * 52 / 12;
  if (hoursPerMonth <= 0) return 0;
  return Math.round((Number(monthlyFixedCents) || 0) / hoursPerMonth);
}

export interface BreakevenInput {
  tenant: any;
  service: any;
  /** Total minutes the slot occupies INCLUDING padding — padding is time you
   *  cannot sell either, so it belongs in the floor calculation. */
  minutes?: number;
  staff?: any;
}

export interface BreakevenBreakdown {
  productCents: number;
  timeCents: number;
  labourCents: number;
  totalCents: number;
  minutes: number;
  /** Plain-language explanation, for the settings preview and for staff who
   *  ask why the deposit is what it is. */
  explanation: string;
}

export function computeBreakeven(input: BreakevenInput): BreakevenBreakdown {
  const { tenant, service, staff } = input;
  const econ = resolveShopEconomics(tenant);

  const minutes = Math.max(
    0,
    Number(input.minutes)
      || (Number(service?.duration) || 0) + (Number(service?.padBefore) || 0) + (Number(service?.padAfter) || 0),
  );
  const hours = minutes / 60;

  const productCents = Math.round((Number(service?.cost) || 0) * 100);
  const timeCents = Math.round(hours * econ.hourlyFloorCents);

  let labourCents = 0;
  if (econ.includeLabour) {
    const staffHourly = Number(staff?.hourlyRateCents);
    const rate = Number.isFinite(staffHourly) && staffHourly > 0
      ? staffHourly
      : econ.defaultLabourHourlyCents;
    labourCents = Math.round(hours * rate);
  }

  const totalCents = productCents + timeCents + labourCents;
  const $ = (c: number) => `$${(c / 100).toFixed(2)}`;
  const parts = [`${$(productCents)} in products`];
  if (timeCents > 0) parts.push(`${$(timeCents)} for ${minutes} minutes of chair time`);
  if (labourCents > 0) parts.push(`${$(labourCents)} in labour`);

  return {
    productCents, timeCents, labourCents, totalCents, minutes,
    explanation: econ.hourlyFloorCents > 0
      ? `${$(totalCents)} — ${parts.join(' + ')}.`
      : `${$(totalCents)} in products only. Set your chair-hour floor in Settings to include the cost of the reserved time, which is usually the larger number.`,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// WHAT A BROKEN BOOKING COSTS, AND WHO PAYS IT
//
// A deposit is not a fee. The deposit is money already held; the FEE is what
// the shop's policy says the client owes. The two are related only at
// settlement:
//
//     owed  =  fee
//     paid  =  deposit already held (when the policy forfeits it)
//     short =  owed − paid          ← the part nobody was collecting
//
// That shortfall is the gap in the system today. When a client cancels late
// with a $25 deposit against a $60 late-cancel fee, $35 simply evaporated.
// It should be charged to the card on file, and when there is no card or the
// card fails, it should become a recorded balance — not a rounding error the
// shop absorbs silently.

export type FeeEvent = 'late_cancel' | 'no_show' | 'reschedule';

export interface FeePolicy {
  /** Percentage of the service price. */
  pct: number;
  /** Flat amount in cents, added to the percentage. */
  flatCents: number;
  /** Never charge more than this. 0 = no cap. */
  capCents: number;
  /** Free reschedules before the fee applies (reschedule only). */
  freeCount: number;
  /** Reschedules inside this many hours of the appointment attract the fee. */
  windowHours: number;
  /** Charge the card on file automatically when the fee lands. */
  autoCharge: boolean;
}

const FEE_DEFAULTS: Record<FeeEvent, FeePolicy> = {
  late_cancel: { pct: 0, flatCents: 0, capCents: 0, freeCount: 0, windowHours: 24, autoCharge: true },
  no_show:     { pct: 0, flatCents: 0, capCents: 0, freeCount: 0, windowHours: 0,  autoCharge: true },
  reschedule:  { pct: 0, flatCents: 0, capCents: 0, freeCount: 1, windowHours: 24, autoCharge: true },
};

export function resolveFeePolicy(tenant: any, event: FeeEvent): FeePolicy {
  const stored = ((tenant && tenant.feePolicy) || {})[event] || {};
  const d = FEE_DEFAULTS[event];
  const n = (v: any, fallback: number) => {
    const x = Number(v);
    return Number.isFinite(x) && x >= 0 ? x : fallback;
  };
  return {
    pct: Math.min(100, n(stored.pct, d.pct)),
    flatCents: n(stored.flatCents, d.flatCents),
    capCents: n(stored.capCents, d.capCents),
    freeCount: n(stored.freeCount, d.freeCount),
    windowHours: n(stored.windowHours, d.windowHours),
    autoCharge: stored.autoCharge === undefined ? d.autoCharge : stored.autoCharge === true,
  };
}

export interface SettlementInput {
  tenant: any;
  event: FeeEvent;
  /** Service price in cents. */
  priceCents: number;
  /** Deposit already held, in cents. */
  depositHeldCents: number;
  /** True when the policy says the shop keeps that deposit. */
  depositForfeited: boolean;
  /** Reschedules already used on this booking (reschedule only). */
  priorRescheduleCount?: number;
  /** Hours between now and the appointment. Negative = already passed. */
  hoursUntilAppointment?: number;
  /** Breakeven floor — a fee below this leaves the shop out of pocket, and
   *  the settlement says so rather than pretending otherwise. */
  breakevenCents?: number;
}

export interface Settlement {
  /** What the policy says they owe. */
  feeCents: number;
  /** Covered by the forfeited deposit. */
  coveredByDepositCents: number;
  /** Still owed after the deposit — charge it or record it. */
  shortfallCents: number;
  /** Deposit left over when the fee is smaller than the deposit. Refundable. */
  depositSurplusCents: number;
  /** True when even the full fee does not reach breakeven. */
  belowBreakeven: boolean;
  breakevenGapCents: number;
  /** No fee applies — a free reschedule, outside the window, or not configured. */
  waived: boolean;
  reason: string;
}

export function settleFee(input: SettlementInput): Settlement {
  const {
    tenant, event, priceCents, depositHeldCents, depositForfeited,
    priorRescheduleCount = 0, hoursUntilAppointment, breakevenCents = 0,
  } = input;
  const p = resolveFeePolicy(tenant, event);

  const nothing = (reason: string): Settlement => ({
    feeCents: 0,
    coveredByDepositCents: 0,
    shortfallCents: 0,
    depositSurplusCents: depositForfeited ? 0 : depositHeldCents,
    belowBreakeven: false,
    breakevenGapCents: 0,
    waived: true,
    reason,
  });

  if (p.pct <= 0 && p.flatCents <= 0) return nothing('No fee is configured for this situation.');

  if (event === 'reschedule') {
    if (priorRescheduleCount < p.freeCount) {
      return nothing(`Within the ${p.freeCount} free reschedule${p.freeCount === 1 ? '' : 's'}.`);
    }
    if (p.windowHours > 0 && Number.isFinite(hoursUntilAppointment as number)
      && (hoursUntilAppointment as number) > p.windowHours) {
      return nothing(`More than ${p.windowHours} hours' notice — no fee.`);
    }
  }
  if (event === 'late_cancel' && p.windowHours > 0
    && Number.isFinite(hoursUntilAppointment as number)
    && (hoursUntilAppointment as number) > p.windowHours) {
    return nothing(`More than ${p.windowHours} hours' notice — treated as an early cancellation.`);
  }

  let feeCents = Math.round((priceCents * p.pct) / 100) + p.flatCents;
  if (p.capCents > 0) feeCents = Math.min(feeCents, p.capCents);
  feeCents = Math.max(0, Math.min(feeCents, priceCents));

  const covered = depositForfeited ? Math.min(depositHeldCents, feeCents) : 0;
  const shortfall = Math.max(0, feeCents - covered);
  const surplus = depositForfeited ? Math.max(0, depositHeldCents - feeCents) : depositHeldCents;
  const gap = Math.max(0, breakevenCents - feeCents);

  return {
    feeCents,
    coveredByDepositCents: covered,
    shortfallCents: shortfall,
    depositSurplusCents: surplus,
    belowBreakeven: gap > 0,
    breakevenGapCents: gap,
    waived: false,
    reason: covered > 0
      ? `${fmt(feeCents)} fee — ${fmt(covered)} covered by the deposit held, ${fmt(shortfall)} outstanding.`
      : `${fmt(feeCents)} fee, none of it covered by a deposit.`,
  };
}

function fmt(c: number): string {
  return `$${((Number(c) || 0) / 100).toFixed(2)}`;
}

// ═════════════════════════════════════════════════════════════════════════════
// RENTER BILLING CADENCES
//
// Booth renters are not all monthly. A chair let by the day, a station booked
// by the hour, and a full-time lease are three different rhythms, and the
// notifications that keep each one paid are different: an hourly renter needs
// a receipt, a daily renter needs a morning confirmation, a monthly renter
// needs three days' warning before the money moves.

export type RentCadence = 'hourly' | 'daily' | 'weekly' | 'biweekly' | 'monthly';

export interface CadenceProfile {
  cadence: RentCadence;
  /** Hours before the charge to warn. 0 = no warning; charge and receipt only. */
  warnHours: number;
  /** Send a receipt after a successful charge? */
  receipt: boolean;
  /** Hours after a failure before the first chase. */
  chaseAfterHours: number;
  note: string;
}

const CADENCE_DEFAULTS: Record<RentCadence, CadenceProfile> = {
  hourly:   { cadence: 'hourly',   warnHours: 0,   receipt: true,  chaseAfterHours: 1,  note: 'Charged per session. A warning before an hourly charge is noise; the receipt is the message that matters.' },
  daily:    { cadence: 'daily',    warnHours: 12,  receipt: true,  chaseAfterHours: 4,  note: 'Warned the evening before, charged in the morning.' },
  weekly:   { cadence: 'weekly',   warnHours: 48,  receipt: true,  chaseAfterHours: 24, note: 'Two days\u2019 notice is enough to move money without being nagging.' },
  biweekly: { cadence: 'biweekly', warnHours: 72,  receipt: true,  chaseAfterHours: 24, note: 'Three days\u2019 notice, matching most pay cycles.' },
  monthly:  { cadence: 'monthly',  warnHours: 72,  receipt: true,  chaseAfterHours: 48, note: 'Three days\u2019 notice \u2014 the largest amount deserves the most warning.' },
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
