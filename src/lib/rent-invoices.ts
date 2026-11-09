// src/lib/rent-invoices.ts
//
// AN INVOICE PER DUE DAY, MADE FOR YOU.
//
// Rent lived in two collections that never spoke: rentLedger (what the rent
// page showed and "Run rent cycle" wrote) and rentInvoices (what the late-fee
// sweep, the due reminder, the planner and the renter portal's pay button all
// read). Nothing anywhere created a rentInvoices document — so none of those
// ever had anything to act on, and the only way to see who was behind was to
// press a button that wrote to the other collection.
//
// This module is the one rule for turning a lease into the invoice it owes on
// a due day. The nightly job runs it every morning; the rent page can run it
// on demand for today. Both write the same document, so every reader finally
// sees the same thing.
//
// START CLEAN: a lease that has been running for months with no invoices is
// not back-filled. The first invoice is the next due day after this ships.
// Historical arrears are the owner's to record deliberately, not something a
// sweep should invent overnight and then charge late fees on.

import { nextChargeDate, billCents, billingStart } from './rent-schedule';

export interface RentInvoiceDoc {
  id: string;
  leaseId: string;
  renterId: string;
  boothId: string;
  renterName: string;
  boothName: string;
  amountCents: number;
  lateFeeCents: number;
  status: 'due' | 'late' | 'paid' | 'void';
  dueDate: string;               // YYYY-MM-DD
  paidAt: string | null;
  ledgerEntryId: string | null;  // set when a payment settles it
  dueSoonNotifiedAt: string | null;
  source: 'nightly' | 'manual';
  createdAt: string;
  updatedAt: string;
}

/** Is `dayIso` a due day for this lease? Same rule the autopay cron uses. */
export function isDueOn(lease: any, dayIso: string): boolean {
  return nextChargeDate(lease, dayIso) === dayIso;
}

export function buildRentInvoice(input: {
  id: string; lease: any; renter: any; booth: any; dueDate: string;
  source: 'nightly' | 'manual'; nowIso: string;
}): RentInvoiceDoc {
  const { id, lease, renter, booth, dueDate, source, nowIso } = input;
  return {
    id,
    leaseId: lease.id,
    renterId: lease.renterId,
    boothId: lease.boothId,
    renterName: `${renter?.firstName || ''} ${renter?.lastName || ''}`.trim() || 'Renter',
    boothName: booth?.name || 'Space',
    amountCents: billCents(lease, dueDate),   // the lease's rent; a prorated first bill when the lease is set to
    lateFeeCents: 0,
    status: 'due',
    dueDate,
    paidAt: null,
    ledgerEntryId: null,
    dueSoonNotifiedAt: null,
    source,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

/**
 * Which active leases owe an invoice for `dayIso` that does not exist yet.
 * `existing` is the set of "leaseId|dueDate" keys already in rentInvoices.
 */
export function leasesToInvoice(leases: any[], dayIso: string, existing: Set<string>): any[] {
  return (leases || []).filter((l) =>
    l?.status === 'active'
    && (Number(l.rentAmountCents) || 0) > 0
    && isDueOn(l, dayIso)
    && !existing.has(`${l.id}|${dayIso}`));
}

export const invoiceKey = (leaseId: string, dueDate: string) => `${leaseId}|${dueDate}`;

/** The id a lease's bill for a day always has (written with create), so two runs at once can't make two bills. */
export const billDocId = (leaseId: string, dueDate: string) => `${String(leaseId).replace(/[^A-Za-z0-9_-]/g, '')}_${dueDate}`;

/**
 * A monthly lease's regular bill when that month already has another regular bill for it (an older rule billed leases
 * due on the 29th to 31st on the 28th): not billed again. The lease's first bill is its own (a part-month), and a void
 * bill doesn't count. `leaseBills` are that lease's bills.
 */
export function monthAlreadyBilled(lease: any, dueDate: string, leaseBills: any[]): boolean {
  if ((lease?.frequency || 'monthly') !== 'monthly') return false;
  const first = billingStart(lease);
  if (dueDate === first) return false;
  const ym = dueDate.slice(0, 7);
  return (leaseBills || []).some((b: any) => {
    const d = String(b?.dueDate || '').slice(0, 10);
    return d.slice(0, 7) === ym && d !== dueDate && d !== first && String(b?.status || '') !== 'void';
  });
}
