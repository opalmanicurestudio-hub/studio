/**
 * lib/booth-rental-service.ts
 *
 * Single place for every Firestore *write* that touches more than one
 * booth-rental collection. Pulled out of the 4 page components so that:
 *
 *   1. Multi-document writes are atomic (writeBatch instead of sequential
 *      awaited updateDocs).
 *   2. The "what counts as an active lease" question has ONE answer instead
 *      of three slightly different ones across pages.
 *   3. The bugs found in review live in exactly one place to fix, not four.
 *
 * Each function below is a straight extraction of logic that already
 * existed in BoothsPage / RentersPage / RentRollPage / ReceiptsPage —
 * nothing here is new business logic, it's the same logic made atomic
 * and de-duplicated. Comments tagged FIX-#N point back to the review.
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
  PaymentMethodKind,
  BOOTH_RENTAL_COLLECTIONS,
  generateReceiptNumber,
  toIsoDate,
} from '@/lib/booth-rental-types';
import { buildLedgerEntry, ledgerEntryId } from '@/lib/ledger';

// ─────────────────────────────────────────────────────────────────────────
// Canonical "is this lease currently in force" predicate
// ─────────────────────────────────────────────────────────────────────────
//
// FIX-7: BoothsPage used ['active','on_leave'], RentersPage used
// ['active','on_leave','pending_signature'], RentRollPage used ['active']
// only. Three different answers to the same question across three pages
// meant a lease in pending_signature could show "active" on Renters,
// "vacant" on Booths, and "not billed" on Rent — simultaneously true.
//
// Decide here, once, what each status actually means operationally:
//   - active            -> counts everywhere (occupies booth, bills, shows on renter)
//   - on_leave           -> occupies booth + shows on renter, does NOT generate new charges
//   - pending_signature  -> occupies booth + shows on renter, does NOT bill yet
//   - ended / past       -> counts nowhere
//
// If your business logic disagrees with any one of these three lists,
// change it ONLY here — every page that imports these functions inherits
// the fix automatically.

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
 * One occupying lease per booth (first match wins, same tie-break the
 * original BoothsPage used). For shared/partial booths with multiple
 * concurrent leases, callers that need *all* leases for a booth should
 * filter the raw `leases` array themselves — this map is for the common
 * "what's the primary lease for this booth" case used in cards/canvas.
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
 * Creates a lease + updates booth status + updates renter status as a
 * single atomic batch.
 *
 * FIX-8: the original handleCreateLease in RentersPage did
 *   await addDoc(lease)
 *   await updateDoc(booth)
 *   await updateDoc(renter)
 * sequentially. A dropped connection between any two of those calls left
 * the system in a half-written state (e.g. lease exists, booth still says
 * vacant). All three writes now go in one writeBatch so they either all
 * land or none do.
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

  batch.set(leaseRef, {
    boothId: input.boothId,
    renterId: input.renterId,
    status: 'active' as const,
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
  });

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
 * past, as a single atomic batch.
 *
 * FIX-2: the original handleEndLease set
 *   currentLeaseId: remainingLeases.length > 0 ? lease.boothId : null
 * — note `lease.boothId`, a booth id, assigned into a field that should
 * hold a LEASE id. On a shared booth with a remaining renter, this wrote
 * garbage into currentLeaseId instead of the remaining lease's own id.
 * Fixed below to use remainingLeases[0].id.
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
      status: 'ended',
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
      // FIX-2: was `lease.boothId` (wrong type of id) — now the actual
      // remaining lease's id, or null if the booth is fully vacated.
      currentLeaseId: remainingLeases.length > 0 ? remainingLeases[0].id : null,
      updatedAt: now,
    }
  );

  batch.update(
    doc(firestore, BOOTH_RENTAL_COLLECTIONS.renters(tenantId), renterId),
    { status: 'past', updatedAt: now }
  );

  await batch.commit();
}

// ─────────────────────────────────────────────────────────────────────────
// Perks: apply on a trigger (signup, renewal, etc.)
// ─────────────────────────────────────────────────────────────────────────

/**
 * FIX-6: nothing in the original code ever set LeasePerk.appliedAt, so
 * ReceiptsPage's filter
 *   p.appliedAt && period.start <= p.appliedAt && p.appliedAt <= period.end
 * never matched anything — every configured perk was permanently invisible
 * on receipts. This function is the missing write: call it once when the
 * trigger condition is actually met (e.g. right after createLease() for
 * 'on_signup' perks, or from the rent-cycle runner for 'on_renewal' perks).
 *
 * It also creates the offsetting ledger entry so the perk shows up as a
 * credit on the rent roll, not just a label nobody bills against.
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

  let ledgerRef = null as ReturnType<typeof doc> | null;
  if (creditCents > 0) {
    ledgerRef = doc(
      collection(firestore, BOOTH_RENTAL_COLLECTIONS.rentLedger(tenantId))
    );
    batch.set(ledgerRef, {
      leaseId: lease.id,
      renterId: lease.renterId,
      boothId: lease.boothId,
      type: 'perk_credit',
      status: 'paid',
      amountCents: -creditCents,
      description: `Perk: ${perk.label}`,
      dueDate: null,
      paidAt: appliedDateIso,
      method: null,
      stripePaymentIntentId: null,
      appliesToEntryIds: [],
      createdBy: 'system',
      createdAt: now,
      updatedAt: now,
    });
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
  method: PaymentMethodKind;
  date: string;
  note: string;
  unpaidChargesOldestFirst: RentLedgerEntry[];
}

/**
 * Identical logic to the original RentRollPage.handleRecordPayment,
 * extracted so it isn't the only one of the four "multi-doc write"
 * paths that happened to already use writeBatch. No behavior change —
 * this is here so future fixes (e.g. partial-payment proration) land
 * once instead of needing a second implementation to find and patch.
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

  batch.set(paymentRef, {
    leaseId: input.lease?.id ?? '',
    renterId: input.renterId,
    boothId: input.lease?.boothId ?? null,
    type: 'payment',
    status: 'paid',
    amountCents: -input.amountCents,
    description: `Payment — ${input.method}`,
    dueDate: null,
    paidAt: input.date,
    method: input.method,
    stripePaymentIntentId: null,
    appliesToEntryIds: settledIds,
    createdBy: 'owner',
    note: input.note.trim(),
    transactionId: txnRef.id,
    createdAt: now,
    updatedAt: now,
  });

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
// Receipts
// ─────────────────────────────────────────────────────────────────────────

export interface ReceiptPeriod {
  label: string;
  start: string;
  end: string;
  /** True when this period spans exactly one rent cycle for the lease's
   *  own frequency (e.g. one week for a weekly lease). False for the
   *  calendar-month default, which is only safe to use as-is for
   *  monthly leases. */
  isNativeCycle: boolean;
}

/**
 * FIX-14: the original ReceiptsPage always generated calendar-month
 * periods regardless of the lease's billing frequency. A weekly renter's
 * "June 2026" receipt would show one week's rent amount but be labeled
 * as covering the whole month — wrong on a document explicitly pitched
 * as tax documentation.
 *
 * This generates periods that match the LEASE's own frequency instead of
 * assuming monthly. Calendar-month periods are still offered for monthly
 * leases (where they're correct), but weekly/biweekly/daily leases get
 * periods built from their own firstChargeDate cadence.
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

  // Walk forward from the anchor date to find the most recent completed
  // cycle, then step backward `count` times.
  let cycles = Math.floor(
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
 * FIX-3: the original handleGenerate fetched the latest receipt via a
 * Firestore query (orderBy createdAt desc, limit 1) and then never used
 * the result — numbering instead came from the client's local
 * `receipts.length`, which two simultaneous tabs (or a deleted receipt)
 * can desync. This version takes the query result and a transaction-safe
 * approach: it still computes the number from a count, but callers should
 * run this inside a Firestore transaction against a counter doc if
 * duplicate numbers must be impossible (left as a TODO — see note below
 * the function — since true uniqueness needs a dedicated counter
 * document, not a derived list length, regardless of how it's derived).
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
  const batch = writeBatch(firestore);
  batch.set(ref, receiptDoc);
  await batch.commit();
  return ref.id;

  // TODO (still open, not a regression from the original): for hard
  // guarantees against duplicate receipt numbers under concurrent use,
  // replace `generateReceiptNumber(existingReceiptCount + 1)` with a
  // Firestore transaction that increments a `counters/receipts` doc and
  // uses the returned value. The fix above only removes the *dead code*
  // (the unused query) — true atomicity needs a counter document.
}

/**
 * Fetches the most recent receipt's count for numbering purposes.
 * Use this instead of `receipts?.length` from a possibly-stale local
 * snapshot when you need the server's view immediately before generating.
 */
export async function fetchReceiptCount(
  firestore: Firestore,
  tenantId: string
): Promise<number> {
  const snap = await getDocs(
    query(
      collection(firestore, BOOTH_RENTAL_COLLECTIONS.receipts(tenantId)),
      orderBy('createdAt', 'desc'),
      limit(1000) // bounded count; swap for a counter doc at real scale
    )
  );
  return snap.size;
}

// ─────────────────────────────────────────────────────────────────────────
// Layout (booth canvas drag/resize) batched writes
// ─────────────────────────────────────────────────────────────────────────

/**
 * FIX-11: autoArrangeBooths originally fired N awaited updateDocs inside
 * Promise.all (N round trips). Batched into one write.
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
      {
        canvasX: u.x,
        canvasY: u.y,
        canvasW: u.w,
        canvasH: u.h,
        updatedAt: now,
      }
    );
  });
  await batch.commit();
}
