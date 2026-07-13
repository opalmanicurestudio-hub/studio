// src/lib/booth-rental-types.ts
// ClarityFlow Booth Rental System — shared types, constants, and pure helpers.
// Conventions:
//   - All money amounts are INTEGER CENTS. $250.00 = 25000.
//   - All dates are ISO 8601 strings ("2026-06-10"). No Firestore Timestamps here.
//   - Firestore paths: everything lives under tenants/{tenantId}/ (see BOOTH_RENTAL_COLLECTIONS).
//
// MERGE NOTE: this file now includes the multi-location + renter-portal
// additions designed alongside firestore.rules and booth-rental-service.ts.
// Search "MERGED:" comments below for exactly what was added or changed
// relative to the original version of this file, and why.
//
// MERGE NOTE 2: this file now also includes the hourly/daily "day-use
// booking" additions (Booth day-use fields, Booking, overlap/availability,
// utilization) previously staged in booth-rental-types.booking-additions.ts.
// Search "DAY-USE:" comments below for exactly what that merge added.

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

// ─── MERGED: Location ─────────────────────────────────────────────────────
//
// A tenant is one business. A business can run multiple physical studios.
// Booth, Renter, Lease (and optionally RentLedgerEntry/Receipt) below each
// gain a `locationId` field rather than splitting into per-location
// Firestore paths — every existing tenants/{t}/booths-style path stays
// valid; nothing renamed, nothing moved.

export interface Location {
  id: string;
  tenantId: string;
  name: string;                // "Downtown", "Westside" — owner's own label
  address?: string;
  timezone: string;            // IANA tz, e.g. "America/New_York" — the
                                // daily automation job runs once per
                                // tenant but "due at midnight" means a
                                // different UTC instant per location
  isActive: boolean;            // soft-disable a closed location without
                                 // deleting its historical data
  createdAt: string;
  updatedAt: string;
}

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
  // MERGED: required — every booth belongs to exactly one location.
  // Existing booth docs created before this field existed will read back
  // as `undefined` here; backfill them with a one-time migration script
  // before relying on locationId-scoped queries/rules for those records.
  locationId: string;
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
  // DAY-USE: hourly/daily booking config. A booth can carry a long-term
  // Lease AND take short-term Bookings when open — these fields are
  // independent of baseRentCents/baseRentFrequency (the long-term rate).
  // A booth under an EXCLUSIVE lease (Lease.scheduleSlot === null) never
  // surfaces as bookable regardless of dayUseEnabled — see
  // isBoothAvailable() below, which is the actual source of truth.
  dayUseEnabled: boolean;
  dayUseHourlyCents?: number;
  dayUseDailyCents?: number;
  dayUseMinHours?: number;        // e.g. 2 — minimum bookable block
  dayUseBufferMinutes?: number;   // turnover/cleaning gap enforced between bookings
  createdAt: string;
  updatedAt: string;
}

// ─── Renter ──────────────────────────────────────────────────────────────────

export interface Renter {
  id: string;
  // MERGED: required, same backfill caveat as Booth.locationId above.
  locationId: string;
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
  // MERGED: portalAccessToken REMOVED. A bare token string isn't how
  // Firebase Auth grants scoped Firestore access — security rules need
  // to compare request.auth.uid against a real UID, not validate an
  // arbitrary token against a Firestore field (which would require a
  // rule that reads the renter doc to check the token, defeating the
  // purpose of having auth at all). Replaced with:
  authUid: string | null;
  portalInviteStatus: 'not_sent' | 'sent' | 'accepted';
  portalInviteSentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── MERGED: StaffMember ────────────────────────────────────────────────────
//
// Not previously modeled as a TS interface in this file (the original
// firestore.rules referenced tenants/{t}/staff/{staffId} with a `role`
// field, but nothing here declared its shape). Added now because
// isStaffForLocation() in the updated rules reads `locationIds` off this
// document — without a typed interface, that field has no compile-time
// guarantee of existing when staff docs are created in app code.

export type StaffRole = 'owner' | 'manager' | 'staff';

export interface StaffMember {
  id: string;               // matches the Firebase Auth uid
  role: StaffRole;
  // Owners conventionally have implicit access to every location (see
  // isOwner() short-circuit in firestore.rules) but locationIds is still
  // stored explicitly even for owners, rather than leaving "owner = all
  // locations" as an unwritten rule — so a future co-owner restricted to
  // one location doesn't require a schema change later.
  locationIds: string[];
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
  // MERGED: required. Denormalized from the booth's own locationId
  // (rather than requiring a join through Booth on every lease query) —
  // leases are read far more often than written, so this trades a small
  // write-time duplication for a much cheaper, much more common
  // read-time filter. Must always equal the locationId of `boothId`.
  locationId: string;
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
  // MERGED: optional — added for symmetry with RentLedgerEntry below and
  // for cheap location-filtered queries on this entry type, but this
  // interface isn't currently written anywhere in the four pages (they
  // all use RentLedgerEntry instead), so it's optional rather than
  // required to avoid retroactively breaking anything that does use it.
  locationId?: string;
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
  // MERGED: optional, same reasoning as LedgerEntry.locationId above —
  // existing rentLedger documents predate this field.
  locationId?: string;
  // DAY-USE: widened from required `string` to `string | null` — a
  // booking-originated ledger entry has no lease. Every EXISTING read of
  // `.leaseId` in this codebase (buildRentRollSummary, settleCharges,
  // recordPayment's settlement loop) treats it as an opaque grouping key
  // and never assumes non-null, so this widening is safe without touching
  // those call sites. New code that writes a lease-originated entry should
  // still always set a real leaseId, same as before.
  leaseId: string | null;
  // DAY-USE: new, optional. Set on entries created by createBookingHold /
  // the book-station route; null/absent for lease-originated entries.
  bookingId?: string | null;
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
  // MERGED: optional, same backfill reasoning as RentLedgerEntry.locationId.
  locationId?: string;
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

// ─── MERGED: StudioSettings — the owner policy layer ──────────────────────────
//
// One per LOCATION, not per tenant — late fee grace days, reminder
// cadence, and vacancy thresholds are operational decisions that
// reasonably differ between a flagship downtown studio and a smaller
// satellite location.

export type AutoVacancyAction = 'none' | 'discount_percent';
export type AutoRenewalAction = 'none' | 'auto_renew' | 'auto_end';

export interface StudioSettings {
  id: string;             // == locationId, one settings doc per location
  tenantId: string;
  locationId: string;

  defaultLeaseTerms: {
    graceDays: number;
    lateFeeType: 'flat' | 'percent';
    lateFeeAmountCents?: number;
    lateFeePercent?: number;
    autoRenew: boolean;
    noticeDays: number;
  };

  reminders: {
    daysBeforeDueToRemindRenter: number;       // e.g. 3
    daysLateBeforeRenagging: number;           // e.g. 2 — re-send after this many late days
    daysLateBeforeNotifyingOwner: number;      // e.g. 5 — escalate to owner
  };

  renewal: {
    flagWindowDays: number;              // matches isLeaseEndingSoon's windowDays
    autoSendOfferAtDays: number | null;  // null = never auto-send
    autoActionIfNoResponse: AutoRenewalAction;
    autoActionGraceDays: number;         // days after offer before auto-action fires
  };

  vacancy: {
    alertAfterDays: number;
    autoAction: AutoVacancyAction;
    autoDiscountPercent?: number;       // only used if autoAction = discount_percent
    autoDiscountAfterDays?: number;     // only used if autoAction = discount_percent
  };

  notificationChannels: {
    owner: { email: boolean; sms: boolean; inApp: boolean };
    renter: { email: boolean; sms: boolean; inApp: boolean };
  };

  createdAt: string;
  updatedAt: string;
}

// ─── MERGED: NotificationLog ───────────────────────────────────────────────

export type NotificationRecipientType = 'owner' | 'renter';
export type NotificationChannel = 'email' | 'sms' | 'in_app';
export type NotificationEventType =
  | 'rent_due_soon'
  | 'rent_late'
  | 'late_fee_applied'
  | 'lease_ending_soon'
  | 'renewal_offer_sent'
  | 'booth_vacant_alert'
  | 'payment_received'
  | 'perk_applied';
export type NotificationStatus = 'pending' | 'sent' | 'failed';

export interface NotificationLogEntry {
  id: string;
  tenantId: string;
  locationId: string;
  recipientType: NotificationRecipientType;
  recipientId: string;       // renterId or staff/owner uid
  channel: NotificationChannel;
  eventType: NotificationEventType;
  relatedId: string;         // leaseId / boothId / ledgerEntryId, depending on eventType
  status: NotificationStatus;
  // Checked before sending so the same event never notifies twice across
  // daily job re-runs, e.g. `rent_due_soon:{leaseId}:{dueDate}`.
  dedupeKey: string;
  createdAt: string;
  sentAt: string | null;
  error?: string;
}

// ─── DAY-USE: Booking ───────────────────────────────────────────────────────
//
// A single short-term reservation of a booth, separate from Lease. Leases
// model open-ended recurring occupancy (dueDay cycles, autoRenew, a term
// to end/renew); a Booking models one fixed-window transaction paid
// upfront. Trying to represent a 2-hour booking as a one-day Lease breaks
// OCCUPYING_LEASE_STATUSES semantics and has no time-of-day granularity
// (Lease.startDate/endDate are date-only) — this is why it's a separate
// type rather than a Lease variant.

export type BookingStatus =
  | 'held'          // transient — payment in flight, expires if not confirmed
  | 'confirmed'
  | 'checked_in'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export const ACTIVE_BOOKING_STATUSES: BookingStatus[] = ['confirmed', 'checked_in'];

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  held: 'Held',
  confirmed: 'Confirmed',
  checked_in: 'Checked in',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No-show',
};

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
  // MERGED: new collections for multi-location + automation.
  locations:        (t: string) => `tenants/${t}/locations`,
  studioSettings:   (t: string) => `tenants/${t}/studioSettings`,
  notificationLog:  (t: string) => `tenants/${t}/notificationLog`,
  staff:            (t: string) => `tenants/${t}/staff`,
  // DAY-USE: new collection for hourly/daily bookings.
  bookings:         (t: string) => `tenants/${t}/bookings`,
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

// ─── DAY-USE: Overlap / availability ──────────────────────────────────────────

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
 * True if a booth is free for `range`, given its occupying long-term lease
 * (if any) and every other booking already on it. This is the single
 * source of truth both the quick-book dialog and the server-side hold
 * transaction (in booth-rental-service.ts / the book-station route) must
 * call — never duplicate this check elsewhere.
 */
export function isBoothAvailable(params: {
  range: TimeRange;
  occupyingLease: { scheduleSlot: ScheduleSlot | null } | undefined;
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
  booth: Pick<Booth, 'dayUseHourlyCents' | 'dayUseDailyCents'>,
  range: TimeRange,
  rateType: 'hourly' | 'daily'
): number {
  if (rateType === 'daily') return booth.dayUseDailyCents ?? 0;
  const hours = (new Date(range.endAt).getTime() - new Date(range.startAt).getTime()) / 3_600_000;
  return Math.round((booth.dayUseHourlyCents ?? 0) * hours);
}

// ─── DAY-USE: Utilization / optimization ──────────────────────────────────────
//
// Turns "is the floor plan full" into a number, per booth, so an owner can
// see which stations are worth more day-use inventory and which are
// sitting empty. Also what booth-rental-pricing.ts's recommendDayUseRate()
// consumes for its "measured, not assumed" occupancy input.

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
  candidates: { booth: Booth; utilizationForWindow: BoothUtilization; available: boolean }[];
}): Booth[] {
  return params.candidates
    .filter((c) => c.available && c.booth.dayUseEnabled)
    .sort((a, b) => a.utilizationForWindow.occupancyRate - b.utilizationForWindow.occupancyRate)
    .map((c) => c.booth);
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
          const lease = e.leaseId ? leaseById.get(e.leaseId) : undefined;
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
