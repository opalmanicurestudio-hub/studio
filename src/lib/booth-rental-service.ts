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
 *
 * Rewritten against the REAL src/lib/booth-rental-types.ts and
 * src/lib/ledger.ts (the first pass guessed several shapes — see
 * TYPE-CORRECTIONS below for what changed and why).
 */

import {
  Firestore,
  collection,
  doc,
  writeBatch,
  getDocs,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';
import {
  Booth,
  Renter,
  Lease,
  LeasePerk,
  RentLedgerEntry,
  Receipt,
  RentFrequency,
  LedgerEntryType,
  BOOTH_RENTAL_COLLECTIONS,
  generateReceiptNumber,
  toIsoDate,
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
//    of silently `any`-typed:
const RENT_LEDGER_TYPE_GAP_NOTE =
  'RentLedgerEntry usage includes fields (stripePaymentIntentId, ' +
  'appliesToEntryIds, createdBy, note, transactionId) not present on the ' +
  'declared type in booth-rental-types.ts. Recommend adding them to the ' +
  'real interface rather than leaving them as an untyped extension — see ' +
  'RentLedgerEntryWrite below.';
void RENT_LEDGER_TYPE_GAP_NOTE; // referenced only for the comment's sake

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
//    against the real type. Removed from the rewritten settlement logic
//    (still flagged in the page-level review below); kept out of anything
//    new written here.
//
// 5. Booth has no `description` field (it has `type` + optional `notes`).
//    BoothsPage's form reads/writes a `description` field that doesn't
//    exist on the real Booth type — that's a pre-existing bug in
//    BoothsPage itself, addressed in the page rewrite, not here.

// ─────────────────────────────────────────────────────────────────────────
// Canonical "is this lease currently in force" predicate
// ─────────────────────────────────────────────────────────────────────────
//
// FIX-7 (original review): BoothsPage used ['active','on_leave'],
// RentersPage used ['active','on_leave','pending_signature'], RentRollPage
// used ['active'] only. One lease could be "active" on Renters, "vacant"
// on Booths, and "unbilled" on Rent — simultaneously.
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
 * FIX-8 (original review): the original handleCreateLease in RentersPage
 * did `await addDoc(lease); await updateDoc(booth); await
 * updateDoc(renter);` sequentially — a dropped connection between any two
 * left the system half-written (lease exists, booth still vacant). All
 * three writes now go in one writeBatch.
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

  const leaseDoc: Omit<Lease, 'id'> = {
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
 * FIX-2 (original review): the original handleEndLease set
 *   currentLeaseId: remainingLeases.length > 0 ? lease.boothId : null
 * — `lease.boothId` (a BOOTH id) written into a field that should hold a
 * LEASE id. Confirmed against the real type: Booth.currentLeaseId is
 * `string | null`, meant to reference a Lease document, not a Booth. On a
 * shared booth with a remaining renter this wrote the wrong id type
 * entirely. Fixed to use remainingLeases[0].id.
 *
 * Note the two different statuses being set are NOT the same enum:
 * the LEASE goes to 'ended' (a LeaseStatus); the RENTER goes to 'past'
 * (a RenterStatus). They look similar but are intentionally different
 * fields on different documents.
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
      // FIX-2: was `lease.boothId` (booth id, wrong type entirely) — now
      // the remaining lease's own id, or null once the booth is empty.
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
 * FIX-6 (original review): nothing in the original code ever set
 * LeasePerk.appliedAt, so ReceiptsPage's filter
 *   p.appliedAt && period.start <= p.appliedAt && p.appliedAt <= period.end
 * never matched anything — every configured perk was permanently
 * invisible on receipts. This is the missing write: call it once when the
 * trigger condition is met (e.g. right after createLease() for
 * 'on_signup' perks, or from the rent-cycle runner for date-based
 * triggers like 'after_3_months').
 *
 * Uses 'perk_credit' as the ledger entry type — note this is from the
 * NEWER half of the LedgerEntryType union (see TYPE-CORRECTIONS #3
 * above). buildRentRollSummary() doesn't read perk_credit specifically
 * either way (it only sums by sign via computeBalanceCents, which is
 * type-agnostic), so this is safe, but it does mean perk credits won't
 * appear as their own labeled bucket in any future type-specific
 * reporting unless that reporting also recognizes 'perk_credit'.
 */
export async function applyPerk(
  firestore: Firestore,
  tenantId: string,
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
    const entry: RentLedgerEntryWrite = {
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
      // (both are falsy, so existing `if (entry.dueDate)` checks behave
      // identically) but WOULD break a Firestore query filtering on
      // `where('dueDate', '==', null)` if one exists anywhere. Grep for
      // that pattern before adopting this — if none exists, '' is safe
      // and arguably more correct; if one exists, keep `null` and instead
      // fix the TYPE to `string | null` in booth-rental-types.ts.
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
 * four multi-doc write paths using it. No behavior change.
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

  const paymentEntry: RentLedgerEntryWrite = {
    leaseId: input.lease?.id ?? '',
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
 * FIX-14 (original review): the original ReceiptsPage always generated
 * calendar-month periods regardless of the lease's billing frequency. A
 * weekly renter's "June 2026" receipt showed one week's rent amount but
 * was labeled as covering the whole month — wrong on a document pitched
 * explicitly as tax documentation.
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
  lease: Lease;
  booth: Booth;
  renterId: string;
  period: ReceiptPeriod;
  customItems: { description: string; amountCents: number }[];
  existingReceiptCount: number;
}

/**
 * FIX-3 (original review): the original handleGenerate fetched the
 * latest receipt via a Firestore query and then never used the result —
 * numbering came from the client's local `receipts.length` instead, which
 * concurrent tabs (or a deleted receipt) can desync. `fetchReceiptCount`
 * below gives callers a server-fresh count to pass in here immediately
 * before generating, removing the dead query. True atomicity against
 * concurrent generation still needs a transactional counter doc — flagged
 * as an open TODO, not fixed by this alone.
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

  const receiptDoc: Omit<Receipt, 'id'> = {
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
 */
export async function fetchReceiptCount(
  firestore: Firestore,
  tenantId: string
): Promise<number> {
  const snap = await getDocs(
    query(
      collection(firestore, BOOTH_RENTAL_COLLECTIONS.receipts(tenantId)),
      orderBy('createdAt', 'desc'),
      limit(1000) // bounded; swap for a counters/ doc at real scale
    )
  );
  return snap.size;
}

// ─────────────────────────────────────────────────────────────────────────
// Layout (booth canvas drag/resize) batched writes
// ─────────────────────────────────────────────────────────────────────────

/**
 * FIX-11 (original review): autoArrangeBooths originally fired N awaited
 * updateDocs inside Promise.all (N round trips). Batched into one write.
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
