// src/lib/booth-rental-types.ts
// ClarityFlow Booth Rental System — shared types, constants, and pure helpers.
// Conventions:
//   - All money amounts are INTEGER CENTS. $250.00 = 25000.
//   - All dates are ISO 8601 strings ("2026-06-10"). No Firestore Timestamps here.
//   - Firestore paths: everything lives under tenants/{tenantId}/ (see BOOTH_RENTAL_COLLECTIONS).

// ─── Primitives ──────────────────────────────────────────────────────────────

export type RentFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly';

export type RenterStatus =
  | 'prospective'
  | 'active'
  | 'on_leave'
  | 'maternity_leave'
  | 'subletting'
  | 'past'
  | 'archived';

export type BoothStatus =
  | 'vacant'
  | 'occupied'
  | 'partial'       // shared — some slots taken, some open
  | 'maintenance'
  | 'inactive';

export type LeaseStatus =
  | 'draft'
  | 'pending_signature'
  | 'active'
  | 'on_leave'
  | 'ending_soon'   // derived in UI, storable for query convenience
  | 'ended'
  | 'terminated'
  | 'cancelled';

export type WeekDay = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0=Sun … 6=Sat

// ─── Schedule slot (for shared/part-time booths) ─────────────────────────────

export interface ScheduleSlot {
  days: WeekDay[];          // which days of the week
  startTime?: string;       // "09:00" – optional, for half-day splits
  endTime?: string;         // "13:00"
  label?: string;           // "Morning slot", "Tuesday/Thursday", etc.
}

// ─── Perk ────────────────────────────────────────────────────────────────────

export type PerkTrigger =
  | 'on_signup'
  | 'after_3_months'
  | 'after_6_months'
  | 'after_12_months'
  | 'annually'
  | 'custom';

export type PerkType = 'free_week' | 'rent_discount' | 'product_credit' | 'custom';

export interface LeasePerk {
  id: string;
  type: PerkType;
  label: string;
  trigger: PerkTrigger;
  /** for rent_discount: percentage 0-100; for product_credit / custom: cents */
  valueCents?: number;
  valuePercent?: number;
  /** ISO date when applied to ledger, null = not yet applied */
  appliedAt: string | null;
  ledgerEntryId: string | null;
}

// ─── Booth ───────────────────────────────────────────────────────────────────

export interface Booth {
  id: string;
  name: string;
  type: 'booth' | 'chair' | 'room' | 'suite';
  status: BoothStatus;
  baseRentCents: number;
  baseRentFrequency: RentFrequency;
  amenities: string[];
  notes?: string;
  currentLeaseId: string | null;
  // Floor-plan canvas position
  canvasX: number;
  canvasY: number;
  canvasW: number;
  canvasH: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Renter ──────────────────────────────────────────────────────────────────

export interface Renter {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  businessName?: string;
  specialty?: string;
  notes?: string;
  status: RenterStatus;
  stripeCustomerId: string | null;
  defaultPaymentMethodId: string | null;
  autopayEnabled: boolean;
  portalAccessToken: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Lease ───────────────────────────────────────────────────────────────────

export interface LateFeePolicy {
  enabled: boolean;
  graceDays: number;
  type: 'flat' | 'percent';
  amountCents?: number;
  percent?: number;
  maxFeeCents?: number | null;
}

export interface Deposit {
  amountCents: number;
  refundable: boolean;
  refundConditions: string;
  collectedLedgerEntryId: string | null;
  refundedLedgerEntryId: string | null;
}

export interface Lease {
  id: string;
  boothId: string;
  renterId: string;
  status: LeaseStatus;
  rentAmountCents: number;
  frequency: RentFrequency;
  dueDay: number;
  firstChargeDate: string;
  lastChargeDate: string | null;
  startDate: string;
  endDate: string | null;
  autoRenew: boolean;
  earlyTerminationNoticeDays: number;
  deposit: Deposit | null;
  lateFeePolicy: LateFeePolicy;
  /** days of week renter has access — empty = full week (exclusive lease) */
  scheduleSlot: ScheduleSlot | null;
  perks: LeasePerk[];
  includedAmenities: string[];
  houseRules: string;
  signedDocumentUrl: string | null;
  signedAt: string | null;
  stripeSubscriptionId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Ledger entries ───────────────────────────────────────────────────────────
// Sign convention: charges are POSITIVE (owed to owner), payments/credits are
// NEGATIVE. A renter's balance is the sum of non-waived, non-failed entries.

export type LedgerEntryType =
  // current naming
  | 'rent'
  | 'late_fee'
  | 'deposit_collected'
  | 'deposit_refunded'
  | 'perk_credit'
  | 'adjustment'
  | 'expense'
  // original naming used by the rent roll page
  | 'rent_charge'
  | 'one_off_charge'
  | 'payment'
  | 'deposit_charge'
  | 'deposit_refund'
  | 'credit';

export type LedgerEntryStatus = 'pending' | 'paid' | 'waived' | 'failed';

export interface LedgerEntry {
  id: string;
  leaseId: string;
  renterId: string;
  boothId: string;
  type: LedgerEntryType;
  amountCents: number;        // positive = owed to owner, negative = credit
  status: LedgerEntryStatus;
  dueDate: string;
  paidAt: string | null;
  receiptId: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/** Ledger entry shape used by the rent roll page (superset, mostly optional). */
export interface RentLedgerEntry {
  id: string;
  leaseId: string;
  renterId: string;
  boothId?: string;
  type: LedgerEntryType;
  amountCents: number;
  status: LedgerEntryStatus;
  dueDate: string;
  paidAt?: string | null;
  description?: string;
  notes?: string;
  method?: string;            // how a payment was made: cash, venmo, zelle, etc.
  receiptId?: string | null;
  waivedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

// ─── Receipt ─────────────────────────────────────────────────────────────────

export interface ReceiptLineItem {
  description: string;
  amountCents: number;
}

export interface Receipt {
  id: string;
  receiptNumber: string;      // e.g. "RCP-2024-0042"
  leaseId: string;
  renterId: string;
  boothId: string;
  ledgerEntryIds: string[];
  lineItems: ReceiptLineItem[];
  totalCents: number;
  periodStart: string;
  periodEnd: string;
  issuedAt: string;
  pdfUrl: string | null;
  createdAt: string;
}

// ─── Expense (owner write-off) ────────────────────────────────────────────────

export type ExpenseCategory =
  | 'rent_income'       // income offset tracking — what renters pay you
  | 'maintenance'
  | 'supplies'
  | 'utilities'
  | 'insurance'
  | 'marketing'
  | 'equipment'
  | 'professional_fees'
  | 'other';

export interface Expense {
  id: string;
  category: ExpenseCategory;
  description: string;
  amountCents: number;
  date: string;
  receiptUrl: string | null;
  boothId: string | null;     // link to booth if applicable
  notes: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Firestore collection paths ───────────────────────────────────────────────
// NOTE: rentLedger is the original, live collection — your existing ledger data
// lives at tenants/{t}/rentLedger. Both keys below intentionally point there.

export const BOOTH_RENTAL_COLLECTIONS = {
  booths:     (t: string) => `tenants/${t}/booths`,
  renters:    (t: string) => `tenants/${t}/renters`,
  leases:     (t: string) => `tenants/${t}/leases`,
  rentLedger: (t: string) => `tenants/${t}/rentLedger`,
  ledger:     (t: string) => `tenants/${t}/rentLedger`,
  receipts:   (t: string) => `tenants/${t}/receipts`,
  expenses:   (t: string) => `tenants/${t}/expenses`,
};

/** Back-compat alias — some earlier files referenced COLLECTIONS directly. */
export const COLLECTIONS = BOOTH_RENTAL_COLLECTIONS;

// ─── Display helpers ──────────────────────────────────────────────────────────

export const FREQUENCY_LABELS: Record<RentFrequency, string> = {
  daily:    'Daily',
  weekly:   'Weekly',
  biweekly: 'Every 2 weeks',
  monthly:  'Monthly',
};

export const RENTER_STATUS_LABELS: Record<RenterStatus, string> = {
  prospective:     'Prospective',
  active:          'Active',
  on_leave:        'On leave',
  maternity_leave: 'Maternity leave',
  subletting:      'Subletting',
  past:            'Past',
  archived:        'Archived',
};

export const BOOTH_STATUS_LABELS: Record<BoothStatus, string> = {
  vacant:      'Vacant',
  occupied:    'Occupied',
  partial:     'Partial',
  maintenance: 'Maintenance',
  inactive:    'Inactive',
};

export const LEASE_STATUS_LABELS: Record<LeaseStatus, string> = {
  draft:             'Draft',
  pending_signature: 'Pending signature',
  active:            'Active',
  on_leave:          'On leave',
  ending_soon:       'Ending soon',
  ended:             'Ended',
  terminated:        'Terminated',
  cancelled:         'Cancelled',
};

export const BOOTH_STATUS_COLORS: Record<BoothStatus, { bg: string; text: string; border: string }> = {
  vacant:      { bg: '#EAF3DE', text: '#27500A', border: '#97C459' },
  occupied:    { bg: '#E6F1FB', text: '#0C447C', border: '#378ADD' },
  partial:     { bg: '#FAEEDA', text: '#633806', border: '#EF9F27' },
  maintenance: { bg: '#FCEBEB', text: '#791F1F', border: '#E24B4A' },
  inactive:    { bg: '#F1EFE8', text: '#444441', border: '#B4B2A9' },
};

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  rent_income:      'Rent income',
  maintenance:      'Maintenance',
  supplies:         'Supplies',
  utilities:        'Utilities',
  insurance:        'Insurance',
  marketing:        'Marketing',
  equipment:        'Equipment',
  professional_fees: 'Professional fees',
  other:            'Other',
};

export const LEDGER_TYPE_LABELS: Record<LedgerEntryType, string> = {
  rent:              'Rent',
  rent_charge:       'Rent charge',
  late_fee:          'Late fee',
  one_off_charge:    'One-off charge',
  payment:           'Payment',
  deposit_collected: 'Deposit collected',
  deposit_refunded:  'Deposit refunded',
  deposit_charge:    'Deposit charge',
  deposit_refund:    'Deposit refund',
  perk_credit:       'Perk credit',
  credit:            'Credit',
  adjustment:        'Adjustment',
  expense:           'Expense',
};

export const LEDGER_STATUS_LABELS: Record<LedgerEntryStatus, string> = {
  pending: 'Pending',
  paid:    'Paid',
  waived:  'Waived',
  failed:  'Failed',
};

export const PERK_TYPE_LABELS: Record<PerkType, string> = {
  free_week:      'Free week',
  rent_discount:  'Rent discount',
  product_credit: 'Product credit',
  custom:         'Custom perk',
};

export const PERK_TRIGGER_LABELS: Record<PerkTrigger, string> = {
  on_signup:        'On sign-up',
  after_3_months:   'After 3 months',
  after_6_months:   'After 6 months',
  after_12_months:  'After 12 months',
  annually:         'Annually',
  custom:           'Custom date',
};

export const WEEKDAY_LABELS: Record<WeekDay, string> = {
  0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat',
};

// ─── Utility ──────────────────────────────────────────────────────────────────

export function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function parseIsoDate(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00`);
}

export function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function generateReceiptNumber(index: number): string {
  const year = new Date().getFullYear();
  return `RCP-${year}-${String(index).padStart(4, '0')}`;
}

/** Returns true if two ScheduleSlots share any day */
export function slotsOverlap(a: ScheduleSlot, b: ScheduleSlot): boolean {
  return a.days.some((d) => b.days.includes(d));
}

// ─── Ledger math (used by the rent roll page) ─────────────────────────────────

/**
 * Net balance owed across a renter's ledger.
 * Charges are positive, payments/credits negative; waived and failed entries
 * are excluded. Positive result = renter owes money.
 */
export function computeBalanceCents(ledger: RentLedgerEntry[]): number {
  return ledger
    .filter((e) => e.status !== 'waived' && e.status !== 'failed')
    .reduce((sum, e) => sum + e.amountCents, 0);
}

/** Pending charges whose due date + grace period has passed. */
export function getPastDueEntries(
  entries: RentLedgerEntry[],
  graceDays: number,
  todayIso: string
): RentLedgerEntry[] {
  const today = parseIsoDate(todayIso);
  return entries.filter((e) => {
    if (e.status !== 'pending') return false;
    if (e.amountCents <= 0) return false;
    if (!e.dueDate) return false;
    const dueWithGrace = addDays(parseIsoDate(e.dueDate), graceDays);
    return today > dueWithGrace;
  });
}

/** Late fee for a given policy and rent charge. Returns 0 if none. */
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

// ─── Dashboard rollup ─────────────────────────────────────────────────────────

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
