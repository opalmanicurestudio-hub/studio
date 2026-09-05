// src/lib/deposit-accounting.ts
//
// A DEPOSIT IS SOMEBODY'S MONEY.
//
// The lease knows the deposit was agreed (amount, refundable, conditions) and
// the ledger knows if it was collected and if it was refunded. Nothing knew
// about the part in between — deductions, with reasons — which is exactly
// where every deposit dispute lives. This module derives the whole position
// from the ledger, so the number the owner sees, the number on the renter's
// statement and the number on the final move-out sheet are the same number.
//
// Pure. It computes; it never moves money. Refunding, deducting and forfeiting
// are all deliberate acts recorded by the owner, and the deposit is never
// touched by a status change (see offboardingTodos in booth-rental-service).
//
// Ledger vocabulary (all on tenants/{t}/rentLedger, keyed by leaseId):
//   deposit_charge     +cents   the deposit invoiced / collected
//   deposit_deduction  +cents   an amount withheld, with a reason (NEW)
//   deposit_refund     -cents   money returned to the renter
//   deposit_forfeit    -cents   deposit applied to a balance instead of returned (NEW)

export type DepositStatus = 'none' | 'not_collected' | 'held' | 'partly_returned' | 'returned' | 'forfeited';

export interface DepositDeduction {
  id: string;
  at: string;
  cents: number;
  reason: string;
  by?: string;
  evidenceUrls?: string[];
}

export interface DepositPosition {
  agreedCents: number;
  refundable: boolean;
  conditions: string;
  collectedCents: number;
  deductions: DepositDeduction[];
  deductedCents: number;
  refundedCents: number;
  forfeitedCents: number;
  /** What is still in the shop's hands: collected − refunded − forfeited. */
  heldCents: number;
  /** What the renter would get back today: held − deductions (never below 0). */
  returnableCents: number;
  status: DepositStatus;
}

const c = (v: any) => Number(v) || 0;

export function depositPosition(lease: any, ledger: any[]): DepositPosition {
  const dep = lease?.deposit || null;
  const agreedCents = c(dep?.amountCents);
  const mine = (ledger || []).filter((e) => e.leaseId === lease?.id);

  const collectedCents = mine.filter((e) => e.type === 'deposit_charge' && e.status === 'paid').reduce((n, e) => n + Math.abs(c(e.amountCents)), 0);
  const deductions: DepositDeduction[] = mine.filter((e) => e.type === 'deposit_deduction').map((e) => ({
    id: e.id, at: String(e.paidAt || e.createdAt || '').slice(0, 10), cents: Math.abs(c(e.amountCents)),
    reason: e.description || e.note || 'Deduction', by: e.createdBy, evidenceUrls: Array.isArray(e.evidenceUrls) ? e.evidenceUrls : [],
  }));
  const deductedCents = deductions.reduce((n, d) => n + d.cents, 0);
  const refundedCents = mine.filter((e) => e.type === 'deposit_refund').reduce((n, e) => n + Math.abs(c(e.amountCents)), 0);
  const forfeitedCents = mine.filter((e) => e.type === 'deposit_forfeit').reduce((n, e) => n + Math.abs(c(e.amountCents)), 0);

  const heldCents = Math.max(0, collectedCents - refundedCents - forfeitedCents);
  const returnableCents = Math.max(0, heldCents - deductedCents);

  let status: DepositStatus = 'none';
  if (agreedCents > 0 || collectedCents > 0) {
    if (collectedCents === 0) status = 'not_collected';
    else if (heldCents === 0 && forfeitedCents > 0 && refundedCents === 0) status = 'forfeited';
    else if (heldCents === 0) status = 'returned';
    else if (refundedCents > 0 || forfeitedCents > 0) status = 'partly_returned';
    else status = 'held';
  }

  return {
    agreedCents, refundable: dep?.refundable !== false, conditions: String(dep?.refundConditions || ''),
    collectedCents, deductions, deductedCents, refundedCents, forfeitedCents, heldCents, returnableCents, status,
  };
}

export const DEPOSIT_STATUS_LABEL: Record<DepositStatus, string> = {
  none: 'No deposit', not_collected: 'Agreed, not collected', held: 'Held',
  partly_returned: 'Partly returned', returned: 'Returned', forfeited: 'Applied to balance',
};

/**
 * The move-out sheet. What they still owe, what the shop still holds, and
 * which way the money goes at the end.
 */
export interface MoveOutSummary {
  unpaidRentCents: number;      // open invoices, net of part-payments, incl. late fees
  otherChargesCents: number;    // open ledger charges with no invoice (keys, damages, …)
  owedCents: number;            // the two above
  deposit: DepositPosition;
  /** > 0: refund due TO the renter. < 0: balance due FROM the renter. */
  netCents: number;
}

export function moveOutSummary(lease: any, invoices: any[], ledger: any[]): MoveOutSummary {
  const unpaidRentCents = (invoices || [])
    .filter((i) => i.leaseId === lease?.id && (i.status === 'due' || i.status === 'late'))
    .reduce((n, i) => n + c(i.amountCents) + c(i.lateFeeCents) - c(i.paidCents), 0);
  const invoiced = new Set((invoices || []).map((i) => String(i.ledgerEntryId || '')).filter(Boolean));
  const otherChargesCents = (ledger || [])
    .filter((e) => e.leaseId === lease?.id && c(e.amountCents) > 0
      && !['paid', 'waived', 'refunded'].includes(String(e.status))
      && !['deposit_charge', 'deposit_deduction'].includes(String(e.type))
      && !(e.type === 'rent_charge' && invoiced.has(e.id)))
    .reduce((n, e) => n + c(e.amountCents), 0);
  const owedCents = Math.max(0, unpaidRentCents) + otherChargesCents;
  const deposit = depositPosition(lease, ledger);
  return { unpaidRentCents: Math.max(0, unpaidRentCents), otherChargesCents, owedCents, deposit, netCents: deposit.returnableCents - owedCents };
}
