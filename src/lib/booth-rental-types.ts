// src/lib/booth-rental-types.ts
// ClarityFlow Booth Rental System — shared types, constants, and pure helpers.
// Conventions for this module:
//   - All money amounts are INTEGER CENTS (Stripe convention). $250.00 = 25000.
//   - All dates are ISO 8601 strings (e.g. "2026-06-09") for predictable cycle math.
//     Do not store Firestore Timestamps in booth-rental documents.
//   - Firestore paths: everything lives under tenants/{tenantId}/ (see COLLECTIONS).

// ---------------------------------------------------------------------------
// Status unions
// ---------------------------------------------------------------------------

export type BoothStatus = 'vacant' | 'occupied' | 'maintenance' | 'inactive';

export type RenterStatus = 'prospective' | 'active' | 'past' | 'archived';

export type LeaseStatus =
  | 'draft'
  | 'pending_signature'
  | 'active'
  | 'ending_soon' // derived in UI, but storable for query convenience
  | 'ended'
  | 'terminated';

export type RentFrequency = 'weekly' | 'biweekly' | 'monthly';

export type LedgerEntryType =
  | 'rent_charge'
  | 'late_fee'
  | 'one_off_charge'   // backbar product, damages, key replacement, etc.
  | 'deposit_charge'
  | 'deposit_refund'
  | 'payment'
  | 'credit';          // owner-issued goodwill credit / adjustment

export type LedgerEntryStatus =
  | 'pending'    // charge created, not yet due or not yet paid
  | 'processing' // ACH initiated, awaiting settlement
  | 'paid'
  | 'failed'
  | 'past_due'
  | 'waived'
  | 'refunded';

export type PaymentMethodKind = 'ach' | 'card' | 'cash' | 'check' | 'venmo' | 'zelle' | 'other';

// ---------------------------------------------------------------------------
// Core documents
// ---------------------------------------------------------------------------

export interface Booth {
  id: string;
  name: string;                 // "Booth 3", "Suite B"
  description?: string;
  photoUrl?: string;
  amenities: string[];          // "Backbar product", "Laundry", "Reception", "Storage"
  baseRentCents: number;        // default asking rent
  baseRentFrequency: RentFrequency;
  status: BoothStatus;
  currentLeaseId?: string | null;
  sortOrder?: number;
  createdAt: string;            // ISO
  updatedAt: string;            // ISO
}

export interface Renter {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  businessName?: string;        // her independent business / DBA
  specialty?: string;           // "Nails", "Hair", "Lashes"
  status: RenterStatus;
  stripeCustomerId?: string | null;   // customer on the TENANT's connected account
  defaultPaymentMethodId?: string | null;
  autopayEnabled: boolean;
  portalAccessToken?: string | null;  // magic-link token for the public renter portal
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LateFeePolicy {
  enabled: boolean;
  graceDays: number;            // days after due date before fee applies
  type: 'flat' | 'percent';
  amountCents?: number;         // when type === 'flat'
  percent?: number;             // when type === 'percent', e.g. 5 = 5% of rent
  maxFeeCents?: number;         // optional cap
}

export interface DepositTerms {
  amountCents: number;
  refundable: boolean;
  refundConditions?: string;    // human-readable terms
  collectedLedgerEntryId?: string | null;
  refundedLedgerEntryId?: string | null;
}

export interface Lease {
  id: string;
  boothId: string;
  renterId: string;
  status: LeaseStatus;

  // Rent terms
  rentAmountCents: number;
  frequency: RentFrequency;
  // For weekly/biweekly: 0–6 (Sunday=0). For monthly: 1–28 (day of month).
  dueDay: number;
  firstChargeDate: string;      // ISO date of the first rent charge
  lastChargeDate?: string | null; // set when lease ends; charges stop after this

  // Term
  startDate: string;            // ISO
  endDate?: string | null;      // null = month-to-month / open
  autoRenew: boolean;
  earlyTerminationNoticeDays?: number;
  earlyTerminationFeeCents?: number;

  // Deposit & fees
  deposit?: DepositTerms | null;
  lateFeePolicy: LateFeePolicy;

  // What's included — mirrors booth amenities but lease is the contract of record
  includedAmenities: string[];
  houseRules?: string;

  // Documents
  signedDocumentUrl?: string | null;  // uploaded PDF of the signed agreement
  signedAt?: string | null;

  // Stripe (on the tenant's connected account)
  stripeSubscriptionId?: string | null;

  createdAt: string;
  updatedAt: string;
}

export interface RentLedgerEntry {
  id: string;
  leaseId: string;
  renterId: string;
  boothId?: string;

  type: LedgerEntryType;
  status: LedgerEntryStatus;

  // Sign convention: charges are POSITIVE, payments/credits/refunds are NEGATIVE.
  // A renter's balance = sum of all entry amounts. Balance > 0 means they owe.
  amountCents: number;

  description: string;          // "Rent — week of Jun 8", "Late fee", "Gel polish restock"
  dueDate?: string | null;      // ISO; for charges
  paidAt?: string | null;       // ISO; for payments
  method?: PaymentMethodKind | null;

  // Stripe references (tenant's connected account)
  stripePaymentIntentId?: string | null;
  stripeInvoiceId?: string | null;
  stripeRefundId?: string | null;

  // Linkage: a payment can reference the charge(s) it covers
  appliesToEntryIds?: string[];

  // Audit
  createdBy: 'system' | 'owner' | 'renter' | 'stripe_webhook';
  note?: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Firestore paths
// ---------------------------------------------------------------------------

export const BOOTH_RENTAL_COLLECTIONS = {
  booths: (tenantId: string) => `tenants/${tenantId}/booths`,
  renters: (tenantId: string) => `tenants/${tenantId}/renters`,
  leases: (tenantId: string) => `tenants/${tenantId}/leases`,
  rentLedger: (tenantId: string) => `tenants/${tenantId}/rentLedger`,
} as const;

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export const FREQUENCY_LABELS: Record<RentFrequency, string> = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
};

export const LEDGER_TYPE_LABELS: Record<LedgerEntryType, string> = {
  rent_charge: 'Rent',
  late_fee: 'Late fee',
  one_off_charge: 'Charge',
  deposit_charge: 'Deposit',
  deposit_refund: 'Deposit refund',
  payment: 'Payment',
  credit: 'Credit',
};

// ---------------------------------------------------------------------------
// Date helpers (pure, ISO-string based — no Firestore Timestamp handling here)
// ---------------------------------------------------------------------------

/** Parse "YYYY-MM-DD" (or full ISO) into a Date at local midnight. */
export function parseIsoDate(iso: string): Date {
  const [datePart] = iso.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * Given a lease and "today", return the ISO date of the next rent charge.
 * Returns null if the lease has stopped charging (lastChargeDate passed or status ended).
 */
export function getNextChargeDate(lease: Lease, todayIso: string): string | null {
  if (lease.status === 'ended' || lease.status === 'terminated') return null;

  const today = parseIsoDate(todayIso);
  const first = parseIsoDate(lease.firstChargeDate);
  const last = lease.lastChargeDate ? parseIsoDate(lease.lastChargeDate) : null;

  let candidate = new Date(first);

  if (lease.frequency === 'monthly') {
    while (candidate < today) {
      const next = new Date(candidate);
      next.setMonth(next.getMonth() + 1);
      // Clamp dueDay for short months (dueDay is 1–28 by rule, so this is safety)
      next.setDate(Math.min(lease.dueDay, 28));
      candidate = next;
    }
  } else {
    const step = lease.frequency === 'weekly' ? 7 : 14;
    while (candidate < today) {
      candidate = addDays(candidate, step);
    }
  }

  if (last && candidate > last) return null;
  return toIsoDate(candidate);
}

/**
 * Prorated rent for a partial period (move-in or move-out mid-cycle).
 * daysOccupied / daysInPeriod * rent, rounded to the nearest cent.
 */
export function prorateRent(
  rentAmountCents: number,
  daysOccupied: number,
  daysInPeriod: number
): number {
  if (daysInPeriod <= 0) return 0;
  const clamped = Math.max(0, Math.min(daysOccupied, daysInPeriod));
  return Math.round((rentAmountCents * clamped) / daysInPeriod);
}

/** Days in a charge period for proration math. */
export function daysInPeriod(frequency: RentFrequency, periodStartIso: string): number {
  if (frequency === 'weekly') return 7;
  if (frequency === 'biweekly') return 14;
  const start = parseIsoDate(periodStartIso);
  return new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
}

// ---------------------------------------------------------------------------
// Money / ledger helpers
// ---------------------------------------------------------------------------

/**
 * Renter balance from ledger entries.
 * Charges are positive, payments/credits negative; > 0 means the renter owes.
 * Waived entries are excluded.
 */
export function computeBalanceCents(entries: RentLedgerEntry[]): number {
  return entries.reduce((sum, entry) => {
    if (entry.status === 'waived') return sum;
    return sum + entry.amountCents;
  }, 0);
}

/** Charges that are unpaid and past their due date + grace period. */
export function getPastDueEntries(
  entries: RentLedgerEntry[],
  graceDays: number,
  todayIso: string
): RentLedgerEntry[] {
  const today = parseIsoDate(todayIso);
  return entries.filter((entry) => {
    if (entry.amountCents <= 0) return false; // not a charge
    if (entry.status === 'paid' || entry.status === 'waived' || entry.status === 'refunded') {
      return false;
    }
    if (!entry.dueDate) return false;
    const cutoff = addDays(parseIsoDate(entry.dueDate), graceDays);
    return today > cutoff;
  });
}

/** Late fee for a single overdue rent charge, per the lease policy. Returns 0 if none. */
export function computeLateFeeCents(policy: LateFeePolicy, rentChargeCents: number): number {
  if (!policy.enabled) return 0;
  let fee = 0;
  if (policy.type === 'flat') {
    fee = policy.amountCents ?? 0;
  } else {
    fee = Math.round((rentChargeCents * (policy.percent ?? 0)) / 100);
  }
  if (policy.maxFeeCents != null) fee = Math.min(fee, policy.maxFeeCents);
  return fee;
}

/** Lease is within `windowDays` of its end date (renewal-reminder logic). */
export function isLeaseEndingSoon(lease: Lease, todayIso: string, windowDays = 60): boolean {
  if (!lease.endDate || lease.status !== 'active') return false;
  const today = parseIsoDate(todayIso);
  const end = parseIsoDate(lease.endDate);
  const windowStart = addDays(end, -windowDays);
  return today >= windowStart && today <= end;
}

// ---------------------------------------------------------------------------
// Dashboard rollup
// ---------------------------------------------------------------------------

export interface RentRollSummary {
  totalRentersActive: number;
  totalBooths: number;
  vacantBooths: number;
  collectedThisCycleCents: number;
  outstandingCents: number;
  pastDueRenterIds: string[];
  leasesEndingSoonIds: string[];
}

/** Build the exception-driven dashboard summary from raw collections. */
export function buildRentRollSummary(params: {
  booths: Booth[];
  renters: Renter[];
  leases: Lease[];
  ledger: RentLedgerEntry[];
  todayIso: string;
  cycleStartIso: string; // start of the current reporting window (e.g. this month)
}): RentRollSummary {
  const { booths, renters, leases, ledger, todayIso, cycleStartIso } = params;

  const activeLeases = leases.filter((l) => l.status === 'active');
  const leaseById = new Map(activeLeases.map((l) => [l.id, l]));

  const collectedThisCycleCents = ledger
    .filter(
      (e) =>
        e.type === 'payment' &&
        e.status === 'paid' &&
        e.paidAt != null &&
        e.paidAt >= cycleStartIso
    )
    .reduce((sum, e) => sum + Math.abs(e.amountCents), 0);

  const outstandingCents = Math.max(0, computeBalanceCents(ledger));

  const pastDueRenterIds = Array.from(
    new Set(
      ledger
        .filter((e) => {
          const lease = leaseById.get(e.leaseId);
          const grace = lease?.lateFeePolicy?.graceDays ?? 0;
          return getPastDueEntries([e], grace, todayIso).length > 0;
        })
        .map((e) => e.renterId)
    )
  );

  return {
    totalRentersActive: renters.filter((r) => r.status === 'active').length,
    totalBooths: booths.filter((b) => b.status !== 'inactive').length,
    vacantBooths: booths.filter((b) => b.status === 'vacant').length,
    collectedThisCycleCents,
    outstandingCents,
    pastDueRenterIds,
    leasesEndingSoonIds: activeLeases
      .filter((l) => isLeaseEndingSoon(l, todayIso))
      .map((l) => l.id),
  };
}