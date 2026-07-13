/**
 * lib/booth-rental-service.ts
 *
 * Single place for every Firestore *write* that touches more than one
 * booth-rental collection. Pulled out of the 4 page components so that:
 *
 *   1. Multi-document writes are atomic (writeBatch instead of sequential
 *      awaited updateDocs).
 *   2. "What counts as an active lease" has ONE answer instead of three
 *      slightly different ones across pages.
 *   3. Bugs found in review live in exactly one place to fix, not four.
 *   4. Every write now carries `locationId`, matching the location-scoped
 *      Firestore security rules (see firestore.rules) — without this,
 *      isStaffForLocation() in the rules has nothing to check and every
 *      write from this file would be rejected outright once those rules
 *      are deployed.
 *
 * Rewritten against the real src/lib/booth-rental-types.ts and
 * src/lib/ledger.ts (see TYPE-CORRECTIONS below for the first-pass
 * inference errors this caught and fixed) and against the real
 * firestore.rules (see LOCATION-SCOPING below for what changed once
 * multi-location entered the design).
 *
 * MERGE NOTE: this file now also includes the hourly/daily "day-use
 * booking" lifecycle (createBookingHold / confirmBooking / releaseBookingHold)
 * previously staged in booth-rental-service.booking-additions.ts. Search
 * "DAY-USE:" comments below for exactly what that merge added.
 */

import {
  Firestore,
  collection,
  doc,
  writeBatch,
  runTransaction,
  updateDoc,
  getDocs,
  query,
  orderBy,
  limit,
  where,
} from 'firebase/firestore';
import {
  Booth,
  Renter,
  Lease,
  LeasePerk,
  RentLedgerEntry,
  Receipt,
  Location,
  RentFrequency,
  LedgerEntryType,
  BOOTH_RENTAL_COLLECTIONS,
  generateReceiptNumber,
  toIsoDate,
  // DAY-USE
  Booking,
  BookingStatus,
  ACTIVE_BOOKING_STATUSES,
  isBoothAvailable,
  computeBookingTotalCents,
} from '@/lib/booth-rental-types';
import { buildLedgerEntry, ledgerEntryId } from '@/lib/ledger';

// ─────────────────────────────────────────────────────────────────────────
// TYPE-CORRECTIONS — what changed once the real types file arrived
// ─────────────────────────────────────────────────────────────────────────
//
// 1. PaymentMethodKind doesn't exist in booth-rental-types.ts. RentRollPage
//    used it as a local union ('cash'|'venmo'|'zelle'|'check'|'card'|'ach'
//    |'other') that was never actually exported from the types file —
//    it's a page-local type, not a shared one. recordPayment() below now
//    takes `method: string` to match what RentLedgerEntry.method actually
//    is (an optional plain string), and the page keeps its own
//    PaymentMethodKind for its UI <Select> options.
//
// 2. RentLedgerEntry, per the real type, does NOT have
//    stripePaymentIntentId, appliesToEntryIds, createdBy, note, or
//    transactionId. The ORIGINAL RentRollPage wrote all five of these
//    anyway — that's a pre-existing type/usage drift in the source code,
//    not something introduced here. I'm preserving those writes (removing
//    them would silently drop data your real Firestore docs already rely
//    on, e.g. `appliesToEntryIds` is read back by settleCharges()) but
//    typing them as an explicit extension so the gap is visible instead
//    of silently `any`-typed — see RentLedgerEntryWrite below.
//
// 3. LedgerEntryType has two overlapping naming schemes in the real union:
//    a newer one (rent, deposit_collected, deposit_refunded, perk_credit,
//    adjustment, expense) and the original one RentRollPage actually uses
//    (rent_charge, one_off_charge, payment, deposit_charge, deposit_refund,
//    credit). Critically, buildRentRollSummary() — which this service does
//    NOT reimplement, it's still imported from booth-rental-types.ts as-is
//    — filters on `e.type === 'payment'` for collected-this-cycle totals.
//    That means the OLD scheme is the one actually load-bearing today.
//    Everything below uses the OLD scheme ('rent_charge', 'payment',
//    'late_fee', 'one_off_charge') so totals computed by
//    buildRentRollSummary stay correct. 'perk_credit' (new scheme) is used
//    for perk credits specifically because no old-scheme equivalent exists
//    and buildRentRollSummary doesn't special-case perks either way.
//
// 4. LedgerEntryStatus is only 'pending' | 'paid' | 'waived' | 'failed'.
//    There is no 'refunded' status — RentRollPage's settleCharges() had a
//    whole 'refunded' branch in ChargeSettlement that can never trigger
//    against the real type. Removed from the rewritten settlement logic.
//
// 5. Booth has no `description` field (it has `type` + optional `notes`).
//    BoothsPage's form reads/writes a `description` field that doesn't
//    exist on the real Booth type — a pre-existing bug in BoothsPage
//    itself, to be addressed in the page rewrite, not here.

/**
 * What the codebase actually writes to a rentLedger document, vs. what
 * RentLedgerEntry declares. This widens the real type with the fields in
 * active use so TypeScript catches typos here instead of silently
 * allowing `any`. The real fix is adding these to RentLedgerEntry itself
 * in booth-rental-types.ts — this is a bridge, not a replacement.
 */
export type RentLedgerEntryWrite = Omit<RentLedgerEntry, 'id'> & {
  stripePaymentIntentId?: string | null;
  appliesToEntryIds?: string[];
  createdBy?: 'system' | 'owner';
  note?: string;
  transactionId?: string;
};

// ─────────────────────────────────────────────────────────────────────────
// LOCATION-SCOPING — what changed once multi-location entered the design
// ─────────────────────────────────────────────────────────────────────────
//
// Every document this file writes now carries `locationId`. This isn't
// optional plumbing — the updated firestore.rules check
// `isStaffForLocation(tenantId, resource.data.locationId)` (or
// `request.resource.data.locationId` on create) on booths, renters,
// leases, rentLedger, and receipts. A write missing locationId will be
// REJECTED by those rules (the field would be `undefined`, which never
// matches a staff member's assigned `locationIds` array). Every function
// signature below that creates a new document now requires a
// `locationId` parameter for exactly this reason — it's not decoration,
// it's the thing the security rule reads.
//
// Functions that only UPDATE an existing document (endLease, applyPerk,
// recordPayment's charge-settling loop) don't need a locationId
// parameter — they inherit it implicitly because Firestore rules check
// the EXISTING document's locationId for updates (resource.data, not
// request.resource.data), and this code never changes a document's
// locationId after creation. If you ever need to MOVE a booth between
// locations, that's a deliberate separate operation, not a side effect
// of any function here.

// ─────────────────────────────────────────────────────────────────────────
// Canonical "is this lease currently in force" predicate
// ─────────────────────────────────────────────────────────────────────────
//
// LeaseStatus per the real type: draft | pending_signature | active |
// on_leave | ending_soon | ended | terminated | cancelled.
// (No 'past' — that status belongs to Renter, not Lease; endLease() below
// sets the LEASE to 'ended' and the RENTER to 'past', which are different
// enums, correctly.)

/** Lease occupies a booth and should appear on the renter's record. */
export const OCCUPYING_LEASE_STATUSES: Lease['status'][] = [
  'active',
  'on_leave',
  'pending_signature',
];

/** Lease should generate new rent charges / late fees during a rent cycle. */
export const BILLABLE_LEASE_STATUSES: Lease['status'][] = ['active'];

export function isOccupyingLease(lease: Lease): boolean {
  return OCCUPYING_LEASE_STATUSES.includes(lease.status);
}

export function isBillableLease(lease: Lease): boolean {
  return BILLABLE_LEASE_STATUSES.includes(lease.status);
}

/**
 * One occupying lease per booth (first match wins). For shared/partial
 * booths with multiple concurrent leases, callers that need *all* leases
 * for a booth should filter the raw `leases` array themselves — this map
 * is for "what's the primary lease for this booth" (cards/canvas).
 */
export function indexOccupyingLeaseByBooth(
  leases: Lease[]
): Map<string, Lease> {
  const m = new Map<string, Lease>();
  leases.forEach((l) => {
    if (isOccupyingLease(l) && !m.has(l.boothId)) m.set(l.boothId, l);
  });
  return m;
}

export function indexOccupyingLeaseByRenter(
  leases: Lease[]
): Map<string, Lease> {
  const m = new Map<string, Lease>();
  leases.forEach((l) => {
    if (isOccupyingLease(l)) m.set(l.renterId, l);
  });
  return m;
}

export function indexBillableLeases(leases: Lease[]): Lease[] {
  return leases.filter(isBillableLease);
}

// ─────────────────────────────────────────────────────────────────────────
// Lease lifecycle: create
// ─────────────────────────────────────────────────────────────────────────

export interface CreateLeaseInput {
  tenantId: string;
  locationId: string;
  boothId: string;
  renterId: string;
  rentAmountCents: number;
  frequency: RentFrequency;
  dueDay: number;
  firstChargeDate: string;
  startDate: string;
  endDate: string | null;
  autoRenew: boolean;
  earlyTerminationNoticeDays: number;
  deposit: Lease['deposit'];
  lateFeePolicy: Lease['lateFeePolicy'];
  scheduleSlot: Lease['scheduleSlot'];
  perks: Omit<LeasePerk, 'appliedAt' | 'ledgerEntryId'>[];
  includedAmenities: string[];
  houseRules: string;
  signedDocumentUrl: string | null;
  isShared: boolean;
}

/**
 * Creates a lease + updates booth status + updates renter status as one
 * atomic batch.
 *
 * The original handleCreateLease in RentersPage did `await addDoc(lease);
 * await updateDoc(booth); await updateDoc(renter);` sequentially — a
 * dropped connection between any two left the system half-written (lease
 * exists, booth still vacant). All three writes now go in one writeBatch.
 *
 * Caller is responsible for passing the correct `locationId` — normally
 * read off the Booth being leased (input.boothId's own locationId), since
 * a lease's location should always match its booth's location. This
 * function does not look that up itself to avoid an extra read inside
 * what's otherwise a pure-write batch; pass `booth.locationId` from
 * whatever booth the caller already has loaded.
 */
export async function createLease(
  firestore: Firestore,
  input: CreateLeaseInput
): Promise<string> {
  const now = new Date().toISOString();
  const batch = writeBatch(firestore);

  const leaseRef = doc(
    collection(firestore, BOOTH_RENTAL_COLLECTIONS.leases(input.tenantId))
  );

  const perksWithMeta: LeasePerk[] = input.perks.map((p) => ({
    ...p,
    appliedAt: null,
    ledgerEntryId: null,
  }));

  const leaseDoc: Omit<Lease, 'id'> & { locationId: string } = {
    locationId: input.locationId,
    boothId: input.boothId,
    renterId: input.renterId,
    status: 'active',
    rentAmountCents: input.rentAmountCents,
    frequency: input.frequency,
    dueDay: input.dueDay,
    firstChargeDate: input.firstChargeDate,
    lastChargeDate: null,
    startDate: input.startDate,
    endDate: input.endDate,
    autoRenew: input.autoRenew,
    earlyTerminationNoticeDays: input.earlyTerminationNoticeDays,
    deposit: input.deposit,
    lateFeePolicy: input.lateFeePolicy,
    scheduleSlot: input.scheduleSlot,
    perks: perksWithMeta,
    includedAmenities: input.includedAmenities,
    houseRules: input.houseRules,
    signedDocumentUrl: input.signedDocumentUrl,
    signedAt: input.signedDocumentUrl ? now : null,
    stripeSubscriptionId: null,
    createdAt: now,
    updatedAt: now,
  };
  batch.set(leaseRef, leaseDoc);

  const boothStatus = input.isShared ? 'partial' : 'occupied';
  batch.update(
    doc(
      firestore,
      BOOTH_RENTAL_COLLECTIONS.booths(input.tenantId),
      input.boothId
    ),
    { status: boothStatus, currentLeaseId: leaseRef.id, updatedAt: now }
  );

  batch.update(
    doc(
      firestore,
      BOOTH_RENTAL_COLLECTIONS.renters(input.tenantId),
      input.renterId
    ),
    { status: 'active', updatedAt: now }
  );

  await batch.commit();
  return leaseRef.id;
}

// ─────────────────────────────────────────────────────────────────────────
// Lease lifecycle: end
// ─────────────────────────────────────────────────────────────────────────

/**
 * Ends a lease + frees (or partially frees) the booth + marks the renter
 * past, as one atomic batch.
 *
 * The original handleEndLease set
 *   currentLeaseId: remainingLeases.length > 0 ? lease.boothId : null
 * — `lease.boothId` (a BOOTH id) written into a field that should hold a
 * LEASE id. Booth.currentLeaseId is `string | null`, meant to reference a
 * Lease document, not a Booth. On a shared booth with a remaining renter
 * this wrote the wrong id type entirely. Fixed to use
 * remainingLeases[0].id.
 *
 * No locationId parameter needed — this only updates existing documents,
 * and Firestore rules check the EXISTING locationId (resource.data) for
 * updates, which this function never changes.
 */
export async function endLease(
  firestore: Firestore,
  tenantId: string,
  lease: Lease,
  renterId: string,
  allLeases: Lease[]
): Promise<void> {
  const now = new Date().toISOString();
  const batch = writeBatch(firestore);

  batch.update(
    doc(firestore, BOOTH_RENTAL_COLLECTIONS.leases(tenantId), lease.id),
    {
      status: 'ended' as Lease['status'],
      lastChargeDate: toIsoDate(new Date()),
      updatedAt: now,
    }
  );

  const remainingLeases = allLeases.filter(
    (l) => l.boothId === lease.boothId && l.id !== lease.id && isOccupyingLease(l)
  );

  batch.update(
    doc(firestore, BOOTH_RENTAL_COLLECTIONS.booths(tenantId), lease.boothId),
    {
      status: remainingLeases.length > 0 ? 'partial' : 'vacant',
      currentLeaseId: remainingLeases.length > 0 ? remainingLeases[0].id : null,
      updatedAt: now,
    }
  );

  batch.update(
    doc(firestore, BOOTH_RENTAL_COLLECTIONS.renters(tenantId), renterId),
    { status: 'past' as Renter['status'], updatedAt: now }
  );

  await batch.commit();
}

// ─────────────────────────────────────────────────────────────────────────
// Perks: apply on a trigger (signup, renewal, etc.)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Nothing in the original code ever set LeasePerk.appliedAt, so
 * ReceiptsPage's filter
 *   p.appliedAt && period.start <= p.appliedAt && p.appliedAt <= period.end
 * never matched anything — every configured perk was permanently
 * invisible on receipts. This is the missing write: call it once when the
 * trigger condition is met (e.g. right after createLease() for
 * 'on_signup' perks, or from the daily automation job for date-based
 * triggers like 'after_3_months').
 *
 * Uses 'perk_credit' as the ledger entry type — the newer half of the
 * LedgerEntryType union (see TYPE-CORRECTIONS #3 above).
 *
 * Takes locationId explicitly (from the lease, normally — pass
 * `lease.locationId` once that field exists) rather than reading it off
 * `lease` directly, so this still type-checks today even before the
 * Lease interface itself is updated with the new field, and so a caller
 * with a stale/partial Lease object can't silently write `undefined`.
 */
export async function applyPerk(
  firestore: Firestore,
  tenantId: string,
  locationId: string,
  lease: Lease,
  perk: LeasePerk,
  appliedDateIso: string
): Promise<void> {
  if (perk.appliedAt) return; // already applied — don't double-credit

  const batch = writeBatch(firestore);
  const now = new Date().toISOString();

  const creditCents =
    perk.type === 'rent_discount'
      ? Math.round(lease.rentAmountCents * ((perk.valuePercent ?? 0) / 100))
      : perk.valueCents ?? 0;

  let ledgerRef: ReturnType<typeof doc> | null = null;
  if (creditCents > 0) {
    ledgerRef = doc(
      collection(firestore, BOOTH_RENTAL_COLLECTIONS.rentLedger(tenantId))
    );
    const entry: RentLedgerEntryWrite & { locationId: string } = {
      locationId,
      leaseId: lease.id,
      renterId: lease.renterId,
      boothId: lease.boothId,
      type: 'perk_credit' as LedgerEntryType,
      status: 'paid',
      amountCents: -creditCents,
      description: `Perk: ${perk.label}`,
      // DECISION POINT: RentLedgerEntry.dueDate is typed as a required
      // `string`, but the ORIGINAL RentRollPage wrote `dueDate: null` for
      // payment/credit entries (entries with no due date) — already a
      // type violation in the source code, not introduced here. Using ''
      // satisfies the declared type without changing runtime truthiness
      // (both are falsy) but WOULD break a Firestore query filtering on
      // `where('dueDate', '==', null)` if one exists anywhere. Grep for
      // that pattern before relying on this; otherwise it's safe.
      dueDate: '',
      paidAt: appliedDateIso,
      method: undefined,
      appliesToEntryIds: [],
      createdBy: 'system',
      createdAt: now,
      updatedAt: now,
    };
    batch.set(ledgerRef, entry);
  }

  const updatedPerks = lease.perks.map((p) =>
    p.id === perk.id
      ? { ...p, appliedAt: appliedDateIso, ledgerEntryId: ledgerRef?.id ?? null }
      : p
  );
  batch.update(
    doc(firestore, BOOTH_RENTAL_COLLECTIONS.leases(tenantId), lease.id),
    { perks: updatedPerks, updatedAt: now }
  );

  await batch.commit();
}

// ─────────────────────────────────────────────────────────────────────────
// Payments
// ─────────────────────────────────────────────────────────────────────────

export interface RecordPaymentInput {
  tenantId: string;
  /** Location the payment is recorded at — normally `lease.locationId` or
   *  `booth.locationId`. Required even when `lease` is undefined (a
   *  payment with no matched lease can still happen, e.g. a one-off
   *  charge payment) so the ledger write always satisfies the security
   *  rules' locationId check. */
  locationId: string;
  renterId: string;
  renterName: string;
  lease: Lease | undefined;
  booth: Booth | undefined;
  amountCents: number;
  /** Free-form label, e.g. 'Venmo', 'Cash'. RentLedgerEntry.method is an
   *  optional plain string — PaymentMethodKind is a page-local UI type
   *  for the <Select>, not something shared/exported from
   *  booth-rental-types.ts (see TYPE-CORRECTIONS #1). */
  method: string;
  date: string;
  note: string;
  unpaidChargesOldestFirst: RentLedgerEntry[];
}

/**
 * Same logic as the original RentRollPage.handleRecordPayment, extracted
 * so the writeBatch discipline it already had isn't the only one of the
 * four multi-doc write paths using it. No behavior change beyond adding
 * `locationId` to the new ledger entry.
 */
export async function recordPayment(
  firestore: Firestore,
  input: RecordPaymentInput
): Promise<void> {
  const now = new Date().toISOString();
  const batch = writeBatch(firestore);

  let remaining = input.amountCents;
  const settledIds: string[] = [];
  for (const charge of input.unpaidChargesOldestFirst) {
    if (remaining < charge.amountCents) break;
    remaining -= charge.amountCents;
    settledIds.push(charge.id);
  }

  const paymentRef = doc(
    collection(firestore, BOOTH_RENTAL_COLLECTIONS.rentLedger(input.tenantId))
  );
  const txnRef = doc(
    collection(firestore, 'tenants', input.tenantId, 'transactions'),
    ledgerEntryId('booth_rent', paymentRef.id)
  );

  const paymentEntry: RentLedgerEntryWrite & { locationId: string } = {
    locationId: input.locationId,
    leaseId: input.lease?.id ?? null,
    renterId: input.renterId,
    boothId: input.lease?.boothId,
    type: 'payment' as LedgerEntryType, // old scheme — see TYPE-CORRECTIONS #3
    status: 'paid',
    amountCents: -input.amountCents,
    description: `Payment — ${input.method}`,
    // See the matching dueDate comment in applyPerk() above — same
    // null-vs-'' decision point, same caveat about Firestore filters.
    dueDate: '',
    paidAt: input.date,
    method: input.method,
    appliesToEntryIds: settledIds,
    createdBy: 'owner',
    note: input.note.trim(),
    transactionId: txnRef.id,
    createdAt: now,
    updatedAt: now,
  };
  batch.set(paymentRef, paymentEntry);

  const entry = buildLedgerEntry({
    source: 'booth_rent',
    sourceId: paymentRef.id,
    amountCents: input.amountCents,
    category: 'Booth Rent',
    description: `Booth rent — ${input.booth ? input.booth.name : 'booth'} — ${input.renterName}`,
    clientOrVendor: input.renterName,
    date: input.date,
    paymentMethod: input.method,
  });
  batch.set(txnRef, { ...entry, id: txnRef.id });

  for (const chargeId of settledIds) {
    batch.update(
      doc(
        firestore,
        BOOTH_RENTAL_COLLECTIONS.rentLedger(input.tenantId),
        chargeId
      ),
      { status: 'paid', paidAt: input.date, updatedAt: now }
    );
  }

  await batch.commit();
}

// ─────────────────────────────────────────────────────────────────────────
// Charge settlement (display-only — mirrors recordPayment's oldest-first
// application order so the UI always agrees with the actual balance)
// ─────────────────────────────────────────────────────────────────────────

export type ChargeSettlementStatus = 'paid' | 'partial' | 'unpaid' | 'waived';
// NOTE: 'refunded' removed. LedgerEntryStatus per the real type is only
// 'pending' | 'paid' | 'waived' | 'failed' — there is no 'refunded' value
// an entry can hold, so the original RentRollPage's 'refunded' branch in
// ChargeSettlement could never actually trigger. If refund tracking is
// wanted, it needs a real status value added to LedgerEntryStatus first
// (or a separate `refundedAt` field) rather than a UI branch that can't
// fire.

export const SETTLEMENT_LABELS: Record<ChargeSettlementStatus, string> = {
  paid: 'Paid',
  partial: 'Partially paid',
  unpaid: 'Unpaid',
  waived: 'Waived',
};

export interface ChargeSettlement {
  status: ChargeSettlementStatus;
  paidCents: number;
  remainingCents: number;
}

export function settleCharges(
  entries: RentLedgerEntry[]
): Map<string, ChargeSettlement> {
  const result = new Map<string, ChargeSettlement>();

  let credit = entries
    .filter((e) => e.amountCents < 0 && e.status !== 'failed')
    .reduce((sum, e) => sum + Math.abs(e.amountCents), 0);

  const charges = entries
    .filter((e) => e.amountCents > 0)
    .sort((a, b) =>
      (a.dueDate ?? a.createdAt ?? '').localeCompare(b.dueDate ?? b.createdAt ?? '')
    );

  for (const charge of charges) {
    if (charge.status === 'waived') {
      result.set(charge.id, { status: 'waived', paidCents: 0, remainingCents: 0 });
      continue;
    }
    const applied = Math.min(credit, charge.amountCents);
    credit -= applied;
    const remainingCents = charge.amountCents - applied;
    const status: ChargeSettlementStatus =
      applied === 0 ? 'unpaid' : remainingCents === 0 ? 'paid' : 'partial';
    result.set(charge.id, { status, paidCents: applied, remainingCents });
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────
// Receipts
// ─────────────────────────────────────────────────────────────────────────

export interface ReceiptPeriod {
  label: string;
  start: string;
  end: string;
  isNativeCycle: boolean;
}

/**
 * The original ReceiptsPage always generated calendar-month periods
 * regardless of the lease's billing frequency. A weekly renter's "June
 * 2026" receipt showed one week's rent amount but was labeled as covering
 * the whole month — wrong on a document pitched explicitly as tax
 * documentation.
 *
 * Generates periods matching the LEASE's own frequency instead of
 * assuming monthly. Calendar-month periods are kept for monthly leases
 * (where they're correct); weekly/biweekly/daily leases get periods built
 * from their own firstChargeDate cadence.
 */
export function buildPeriodOptionsForLease(
  lease: Lease,
  count = 12
): ReceiptPeriod[] {
  if (lease.frequency === 'monthly') {
    const opts: ReceiptPeriod[] = [];
    const now = new Date();
    for (let i = 0; i < count; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const start = toIsoDate(new Date(d.getFullYear(), d.getMonth(), 1));
      const end = toIsoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
      opts.push({
        label: d.toLocaleString('default', { month: 'long', year: 'numeric' }),
        start,
        end,
        isNativeCycle: true,
      });
    }
    return opts;
  }

  const stepDays =
    lease.frequency === 'daily' ? 1 : lease.frequency === 'weekly' ? 7 : 14;
  const opts: ReceiptPeriod[] = [];
  const anchor = new Date(lease.firstChargeDate + 'T00:00:00');
  const today = new Date();

  const cycles = Math.floor(
    (today.getTime() - anchor.getTime()) / (stepDays * 86400000)
  );
  for (let i = 0; i < count && cycles - i >= 0; i++) {
    const start = new Date(anchor);
    start.setDate(start.getDate() + (cycles - i) * stepDays);
    const end = new Date(start);
    end.setDate(end.getDate() + stepDays - 1);
    opts.push({
      label: `${toIsoDate(start)} – ${toIsoDate(end)}`,
      start: toIsoDate(start),
      end: toIsoDate(end),
      isNativeCycle: true,
    });
  }
  return opts;
}

export interface GenerateReceiptInput {
  tenantId: string;
  locationId: string;
  lease: Lease;
  booth: Booth;
  renterId: string;
  period: ReceiptPeriod;
  customItems: { description: string; amountCents: number }[];
  existingReceiptCount: number;
}

/**
 * The original handleGenerate fetched the latest receipt via a Firestore
 * query and then never used the result — numbering came from the
 * client's local `receipts.length` instead, which concurrent tabs (or a
 * deleted receipt) can desync. `fetchReceiptCount` below gives callers a
 * server-fresh count to pass in here immediately before generating,
 * removing the dead query. True atomicity against concurrent generation
 * still needs a transactional counter doc — flagged as an open TODO, not
 * fixed by this alone.
 */
export async function generateReceipt(
  firestore: Firestore,
  input: GenerateReceiptInput
): Promise<string> {
  const now = new Date().toISOString();

  const lineItems = [
    {
      description: `Booth rent — ${input.booth.name} (${input.period.label})`,
      amountCents: input.lease.rentAmountCents,
    },
    ...input.customItems.filter((ci) => ci.description.trim() && ci.amountCents > 0),
  ];

  (input.lease.perks ?? [])
    .filter(
      (p) =>
        p.appliedAt &&
        input.period.start <= p.appliedAt &&
        p.appliedAt <= input.period.end
    )
    .forEach((p) => {
      lineItems.push({
        description: `Perk: ${p.label}`,
        amountCents: -(p.valueCents ?? 0),
      });
    });

  const totalCents = lineItems.reduce((s, li) => s + li.amountCents, 0);
  const receiptNumber = generateReceiptNumber(input.existingReceiptCount + 1);

  const receiptDoc: Omit<Receipt, 'id'> & { locationId: string } = {
    locationId: input.locationId,
    receiptNumber,
    leaseId: input.lease.id,
    renterId: input.renterId,
    boothId: input.booth.id,
    ledgerEntryIds: [],
    lineItems,
    totalCents,
    periodStart: input.period.start,
    periodEnd: input.period.end,
    issuedAt: now,
    pdfUrl: null,
    createdAt: now,
  };

  const ref = doc(
    collection(firestore, BOOTH_RENTAL_COLLECTIONS.receipts(input.tenantId))
  );
  await writeBatch(firestore).set(ref, receiptDoc).commit();
  return ref.id;

  // TODO (open, not a regression introduced here): for hard guarantees
  // against duplicate receipt numbers under concurrent generation, replace
  // generateReceiptNumber(existingReceiptCount + 1) with a Firestore
  // transaction that increments a `counters/receipts` doc and uses the
  // returned value. fetchReceiptCount() removes the dead-code bug but a
  // server count read-then-write still has a race window between two
  // simultaneous "Generate receipt" clicks.
}

/**
 * Server-fresh receipt count for numbering — call right before
 * generateReceipt() instead of trusting a possibly-stale local snapshot.
 *
 * Optionally scoped to one location: when receipt numbering is meant to
 * restart/separate per location (common for separately-branded studios
 * under one tenant), pass `locationId` to count only that location's
 * receipts. Omit it to count tenant-wide, matching the original
 * tenant-global numbering behavior.
 */
export async function fetchReceiptCount(
  firestore: Firestore,
  tenantId: string,
  locationId?: string
): Promise<number> {
  const baseQuery = collection(firestore, BOOTH_RENTAL_COLLECTIONS.receipts(tenantId));
  const constraints = locationId
    ? [where('locationId', '==', locationId), orderBy('createdAt', 'desc'), limit(1000)]
    : [orderBy('createdAt', 'desc'), limit(1000)];
  const snap = await getDocs(query(baseQuery, ...constraints));
  return snap.size;
}

// ─────────────────────────────────────────────────────────────────────────
// Layout (booth canvas drag/resize) batched writes
// ─────────────────────────────────────────────────────────────────────────

/**
 * autoArrangeBooths originally fired N awaited updateDocs inside
 * Promise.all (N round trips). Batched into one write.
 *
 * No locationId parameter needed — canvas position updates never change
 * which location a booth belongs to, so the existing document's
 * locationId (checked by the rules via resource.data) is untouched.
 */
export async function batchUpdateBoothLayout(
  firestore: Firestore,
  tenantId: string,
  updates: { boothId: string; x: number; y: number; w: number; h: number }[]
): Promise<void> {
  if (updates.length === 0) return;
  const batch = writeBatch(firestore);
  const now = new Date().toISOString();
  updates.forEach((u) => {
    batch.update(
      doc(firestore, BOOTH_RENTAL_COLLECTIONS.booths(tenantId), u.boothId),
      { canvasX: u.x, canvasY: u.y, canvasW: u.w, canvasH: u.h, updatedAt: now }
    );
  });
  await batch.commit();
}

// ─────────────────────────────────────────────────────────────────────────
// Booth creation (new — was previously inline in BoothsPage.handleSave)
// ─────────────────────────────────────────────────────────────────────────
//
// Pulled in here specifically because booth creation needs a locationId
// at write time same as everything else, and BoothsPage's original
// addDoc call had no concept of location at all. Update/delete for an
// existing booth don't need a wrapper here — they're single-document
// operations with no cross-collection side effects, so the page can keep
// calling updateDoc/deleteDoc directly; only multi-effect or
// creation-with-required-new-fields operations get a service function.

export interface CreateBoothInput {
  tenantId: string;
  locationId: string;
  name: string;
  type: Booth['type'];
  notes?: string;
  baseRentCents: number;
  baseRentFrequency: RentFrequency;
  amenities: string[];
  canvasX?: number;
  canvasY?: number;
  canvasW?: number;
  canvasH?: number;
  // DAY-USE: optional at creation — defaults to disabled. Owner opts a
  // booth into day-use later from the booth edit dialog once
  // recommendDayUseRate() (booth-rental-pricing.ts) has real data to work
  // from, rather than every new booth defaulting to bookable.
  dayUseEnabled?: boolean;
  dayUseHourlyCents?: number;
  dayUseDailyCents?: number;
  dayUseMinHours?: number;
  dayUseBufferMinutes?: number;
}

export async function createBooth(
  firestore: Firestore,
  input: CreateBoothInput
): Promise<string> {
  const now = new Date().toISOString();
  const boothDoc: Omit<Booth, 'id'> & { locationId: string } = {
    locationId: input.locationId,
    name: input.name,
    type: input.type,
    status: 'vacant',
    baseRentCents: input.baseRentCents,
    baseRentFrequency: input.baseRentFrequency,
    photoUrls: (input as any).photoUrls || [],
    amenities: input.amenities,
    notes: input.notes,
    currentLeaseId: null,
    canvasX: input.canvasX ?? 0,
    canvasY: input.canvasY ?? 0,
    canvasW: input.canvasW ?? 140,
    canvasH: input.canvasH ?? 100,
    dayUseEnabled: input.dayUseEnabled ?? false,
    dayUseHourlyCents: input.dayUseHourlyCents,
    dayUseDailyCents: input.dayUseDailyCents,
    dayUseMinHours: input.dayUseMinHours,
    dayUseBufferMinutes: input.dayUseBufferMinutes,
    createdAt: now,
    updatedAt: now,
  };
  const ref = doc(collection(firestore, BOOTH_RENTAL_COLLECTIONS.booths(input.tenantId)));
  await writeBatch(firestore).set(ref, boothDoc).commit();
  return ref.id;
}

// ─────────────────────────────────────────────────────────────────────────
// Renter creation (new — was previously inline in RentersPage.handleSaveRenter)
// ─────────────────────────────────────────────────────────────────────────

/**
 * DEPENDENCY: written against the TARGET Renter shape from
 * booth-rental-types.additions.ts (authUid, portalInviteStatus,
 * portalInviteSentAt) — not today's real Renter interface, which still
 * has a required `portalAccessToken: string | null` field and no
 * `locationId`. This will fail to compile until that merge lands.
 * Two ways to unblock if you need this sooner than the full merge:
 *   (a) merge just the Renter portion of the additions doc now, or
 *   (b) temporarily add `portalAccessToken: null` back into the object
 *       below and drop the three new fields until the merge happens.
 * Left written against the target shape rather than the current one so
 * nothing here needs touching twice.
 */
export interface CreateRenterInput {
  tenantId: string;
  locationId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  businessName?: string;
  specialty?: string;
  notes?: string;
}

export async function createRenter(
  firestore: Firestore,
  input: CreateRenterInput
): Promise<string> {
  const now = new Date().toISOString();
  const renterDoc: Omit<Renter, 'id'> & {
    locationId: string;
    authUid: string | null;
    portalInviteStatus: 'not_sent' | 'sent' | 'accepted';
    portalInviteSentAt: string | null;
  } = {
    locationId: input.locationId,
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    phone: input.phone,
    businessName: input.businessName,
    specialty: input.specialty,
    notes: input.notes,
    status: 'prospective',
    stripeCustomerId: null,
    defaultPaymentMethodId: null,
    autopayEnabled: false,
    authUid: null,
    portalInviteStatus: 'not_sent',
    portalInviteSentAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const ref = doc(collection(firestore, BOOTH_RENTAL_COLLECTIONS.renters(input.tenantId)));
  await writeBatch(firestore).set(ref, renterDoc).commit();
  return ref.id;
}

// ─────────────────────────────────────────────────────────────────────────
// Location creation (new — was missing entirely)
// ─────────────────────────────────────────────────────────────────────────
//
// There was no create path anywhere for Location documents until now.
// The schema, security rules, and useLocations() read hook all assumed
// locations would exist, but nothing could ever write the first one —
// which is exactly why RentersPage's "No locations set up yet" empty
// state was unavoidable for any tenant starting from zero. This is the
// missing piece that closes that gap.

export interface CreateLocationInput {
  tenantId: string;
  name: string;
  address?: string;
  timezone: string;
}

export async function createLocation(
  firestore: Firestore,
  input: CreateLocationInput
): Promise<string> {
  const now = new Date().toISOString();
  const locationDoc: Omit<Location, 'id'> = {
    tenantId: input.tenantId,
    name: input.name,
    address: input.address,
    timezone: input.timezone,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  const ref = doc(
    collection(firestore, BOOTH_RENTAL_COLLECTIONS.locations(input.tenantId))
  );
  await writeBatch(firestore).set(ref, locationDoc).commit();
  return ref.id;
}

// ─────────────────────────────────────────────────────────────────────────
// Default-location auto-provisioning
// ─────────────────────────────────────────────────────────────────────────
//
// CONTEXT: this app is a multi-tenant SaaS product where each Tenant
// optionally has multiple physical locations. The large majority of
// tenants have exactly ONE location, and that location's data (address,
// name) already lives on fields the existing single-location Settings
// page has always written directly to the Tenant document
// (tenantData.name, tenantData.studioAddress, tenantData.studioAddressParts,
// tenantData.studioLocation — see the real SettingsPage component).
//
// Without this function, every tenant — including ones that have used
// this app for years under the old single-location model — would hit
// RentersPage's "No locations set up yet" wall and have to manually
// re-enter information they already typed into Settings once. That's
// the wrong UX for the common case. This function closes that gap: call
// it once, automatically, the moment a tenant with zero Location
// documents is detected (e.g. from LocationContext's loading effect, or
// a one-time migration script across all existing tenants) — never
// requiring a manual "set up your first location" step for the common
// single-location case.
//
// Tenant typing note: `tenant` is typed loosely here (not importing the
// real Tenant interface from '@/lib/data', which lives outside the
// booth-rental module boundary) — only the specific fields this function
// actually reads are declared, so this stays decoupled from the full
// Tenant shape and won't break if unrelated Tenant fields change.

export interface TenantLocationSeedFields {
  name?: string;
  studioAddress?: string;
  studioLocation?: { lat: number; lng: number };
}

/**
 * Creates exactly one default Location for a tenant, seeded from
 * whatever the tenant already has in Settings. Call this only when you've
 * already confirmed (via useLocations or an equivalent query) that the
 * tenant has zero Location documents — it does not check for you, to
 * avoid an extra read inside what should be a single, deliberate
 * provisioning call.
 */
export async function provisionDefaultLocation(
  firestore: Firestore,
  tenantId: string,
  tenant: TenantLocationSeedFields,
  timezone = 'America/New_York'
): Promise<string> {
  return createLocation(firestore, {
    tenantId,
    name: tenant.name ? `${tenant.name} — Main Location` : 'Main Location',
    address: tenant.studioAddress,
    timezone,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// DAY-USE: Booking lifecycle
// ─────────────────────────────────────────────────────────────────────────
//
// Bookings get their own lifecycle rather than reusing createLease/
// endLease — see the Booking type's doc comment in booth-rental-types.ts
// for why a short-term booking isn't a one-day Lease. The three functions
// below (hold → confirm, or hold → release) are the client-SDK
// counterparts to the admin-SDK version embedded directly in
// /api/stripe/book-station/route.ts — that route can't import client-SDK
// `firebase/firestore` code, so its transaction logic is intentionally
// duplicated there rather than shared. If the two ever drift, the route
// is the one actually enforcing the guarantee (it's server-side and
// authoritative); treat these as the client-side / non-Stripe-payment
// entry points (e.g. a "comp this booking, no charge" owner action).

const BOOKINGS_HOLD_TTL_MINUTES = 10;

/** Bookings currently occupying a booth (held-not-expired + confirmed + checked_in). */
export async function getActiveBookingsForBooth(
  firestore: Firestore,
  tenantId: string,
  boothId: string
): Promise<Booking[]> {
  const nowIso = new Date().toISOString();
  const snap = await getDocs(
    query(
      collection(firestore, BOOTH_RENTAL_COLLECTIONS.bookings(tenantId)),
      where('boothId', '==', boothId)
    )
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as Booking))
    .filter(
      (b) =>
        ACTIVE_BOOKING_STATUSES.includes(b.status) ||
        (b.status === 'held' && b.holdExpiresAt !== null && b.holdExpiresAt > nowIso)
    );
}

export class BookingConflictError extends Error {
  constructor() {
    super('That slot is no longer available — someone else just booked it.');
    this.name = 'BookingConflictError';
  }
}

export interface CreateBookingHoldInput {
  tenantId: string;
  locationId: string;
  boothId: string;
  renterId: string;
  startAt: string;
  endAt: string;
  rateType: 'hourly' | 'daily';
  booth: Pick<Booth, 'dayUseHourlyCents' | 'dayUseDailyCents' | 'dayUseBufferMinutes'>;
  occupyingLease: { scheduleSlot: Lease['scheduleSlot'] } | undefined;
  bufferMinutes?: number;
}

/**
 * Reserves the slot atomically before payment is attempted — the
 * transaction re-checks overlap against whatever's actually in Firestore
 * right now, which is what closes the race condition a client-side-only
 * availability check can't.
 */
export async function createBookingHold(
  firestore: Firestore,
  input: CreateBookingHoldInput
): Promise<{ bookingId: string; totalCents: number }> {
  const bookingsRef = collection(firestore, BOOTH_RENTAL_COLLECTIONS.bookings(input.tenantId));
  const now = new Date().toISOString();
  const holdExpiresAt = new Date(Date.now() + BOOKINGS_HOLD_TTL_MINUTES * 60_000).toISOString();
  const totalCents = computeBookingTotalCents(input.booth, { startAt: input.startAt, endAt: input.endAt }, input.rateType);
  const newRef = doc(bookingsRef);

  await runTransaction(firestore, async (tx) => {
    const existingSnap = await getDocs(
      query(collection(firestore, BOOTH_RENTAL_COLLECTIONS.bookings(input.tenantId)), where('boothId', '==', input.boothId))
    );
    const nowForFilter = new Date().toISOString();
    const blocking = existingSnap.docs
      .map((d) => d.data() as Booking)
      .filter(
        (b) =>
          ACTIVE_BOOKING_STATUSES.includes(b.status) ||
          (b.status === 'held' && b.holdExpiresAt !== null && b.holdExpiresAt > nowForFilter)
      );

    const available = isBoothAvailable({
      range: { startAt: input.startAt, endAt: input.endAt },
      occupyingLease: input.occupyingLease,
      existingBookings: blocking,
      bufferMinutes: input.bufferMinutes ?? input.booth.dayUseBufferMinutes ?? 0,
    });
    if (!available) throw new BookingConflictError();

    const bookingDoc: Omit<Booking, 'id'> = {
      tenantId: input.tenantId,
      locationId: input.locationId,
      boothId: input.boothId,
      renterId: input.renterId,
      status: 'held',
      startAt: input.startAt,
      endAt: input.endAt,
      rateType: input.rateType,
      rateCentsSnapshot:
        input.rateType === 'daily' ? input.booth.dayUseDailyCents ?? 0 : input.booth.dayUseHourlyCents ?? 0,
      totalCents,
      stripePaymentIntentId: null,
      stripeChargeId: null,
      paymentStatus: 'unpaid',
      transactionId: null,
      ledgerEntryId: null,
      holdExpiresAt,
      cancelledAt: null,
      cancellationReason: null,
      createdAt: now,
      updatedAt: now,
    };
    tx.set(newRef, bookingDoc);
  });

  return { bookingId: newRef.id, totalCents };
}

export interface ConfirmBookingInput {
  tenantId: string;
  bookingId: string;
  stripePaymentIntentId: string;
  stripeChargeId: string | null;
  transactionId: string;
  ledgerEntryId: string | null;
}

/** Called after a charge succeeds — flips the hold to confirmed and attaches payment/ledger linkage. */
export async function confirmBooking(firestore: Firestore, input: ConfirmBookingInput): Promise<void> {
  const ref = doc(firestore, BOOTH_RENTAL_COLLECTIONS.bookings(input.tenantId), input.bookingId);
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Booking not found.');
    tx.set(
      ref,
      {
        status: 'confirmed' as BookingStatus,
        paymentStatus: 'paid',
        stripePaymentIntentId: input.stripePaymentIntentId,
        stripeChargeId: input.stripeChargeId,
        transactionId: input.transactionId,
        ledgerEntryId: input.ledgerEntryId,
        holdExpiresAt: null,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  });
}

/** Releases a hold that failed payment or was abandoned, freeing the slot immediately. */
export async function releaseBookingHold(
  firestore: Firestore,
  tenantId: string,
  bookingId: string,
  reason = 'payment_failed_or_expired'
): Promise<void> {
  const ref = doc(firestore, BOOTH_RENTAL_COLLECTIONS.bookings(tenantId), bookingId);
  await updateDoc(ref, {
    status: 'cancelled' as BookingStatus,
    cancelledAt: new Date().toISOString(),
    cancellationReason: reason,
    updatedAt: new Date().toISOString(),
  });
}
