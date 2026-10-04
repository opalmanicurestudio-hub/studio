// src/lib/rent-desk.ts — RENT AT THE DESK (server). The same rule as the Rent page's "Record payment": the payment
// settles whole charges oldest-first (anything left over stays as credit on their account), and is written to the
// renter's rent ledger. Taken through the shared checkout, so the till, receipt, Today's sales, split and void all work.
const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const renterName = (r: any) => `${r?.firstName || ''} ${r?.lastName || ''}`.trim() || r?.name || 'Renter';

export async function renterAccount(db: any, T: string, renterId: string) {
  const r: any = (await db.doc(`${T}/renters/${renterId}`).get()).data(); if (!r) return null;
  // Money the desk collected FOR them (owed to them) and invoice-side credits aren't rent they owe.
  const entries = (await db.collection(`${T}/rentLedger`).where('renterId', '==', renterId).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((e: any) => !['desk_collected', 'desk_offset', 'prepaid_credit'].includes(String(e.type || '')) && e.status !== 'migrated' && !e.migratedToInvoiceId);   // old-cycle charges count only until the nightly job has folded them into invoices
  // The rent invoices autopay, late notices and reminders work from — a desk payment must settle these too.
  const allInv = (await db.collection(`${T}/rentInvoices`).where('renterId', '==', renterId).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
  const invoices = allInv.filter((i: any) => ['due', 'late'].includes(String(i.status || '')))
    .map((i: any) => ({ ...i, owedCents: Math.max(0, num(i.amountCents) + num(i.lateFeeCents) - num(i.paidCents)) })).filter((i: any) => i.owedCents > 0)
    .sort((a: any, b: any) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')));
  const unpaid = entries.filter((e: any) => num(e.amountCents) > 0 && !['paid', 'waived', 'refunded', 'voided'].includes(String(e.status || '')))
    .sort((a: any, b: any) => String(a.dueDate || a.createdAt || '').localeCompare(String(b.dueDate || b.createdAt || '')));
  const balanceCents = entries.filter((e: any) => !['waived', 'refunded', 'voided'].includes(String(e.status || ''))).reduce((s: number, e: any) => s + num(e.amountCents), 0);
  const lease: any = ((await db.collection(`${T}/leases`).where('renterId', '==', renterId).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }))
    .find((l: any) => !['ended', 'terminated', 'cancelled'].includes(String(l.status || '')))) || null;
  const booth: any = lease?.boothId ? { id: lease.boothId, ...((await db.doc(`${T}/booths/${lease.boothId}`).get()).data() || {}) } : null;
  const invoiceOwedCents = invoices.reduce((s: number, i: any) => s + i.owedCents, 0);
  return { renter: { id: renterId, ...r }, name: renterName(r), lease, booth, unpaid, invoices, usesInvoices: allInv.length > 0, invoiceOwedCents,
    balanceCents: Math.max(0, balanceCents), owedCents: Math.max(unpaid.reduce((s: number, e: any) => s + num(e.amountCents), 0), invoiceOwedCents) };
}

/** Writes the rent payment (in the checkout's batch). Returns what a void needs to undo it. */
export function applyRentPayment(batch: any, db: any, T: string, acct: any, o: { amountCents: number; method: string; receiptId: string; transactionId: string; now: string; by: string }) {
  let remaining = o.amountCents; const settled: { id: string; status: string }[] = [];
  for (const c of acct.unpaid) { if (remaining < num(c.amountCents)) break; remaining -= num(c.amountCents); settled.push({ id: c.id, status: String(c.status || 'pending') }); }
  const ref = db.collection(`${T}/rentLedger`).doc();
  batch.set(ref, { locationId: acct.lease?.locationId || acct.booth?.locationId || null, leaseId: acct.lease?.id || null, renterId: acct.renter.id, boothId: acct.lease?.boothId || null,
    type: 'payment', status: 'paid', amountCents: -o.amountCents, description: `Payment — ${o.method.replace(/_/g, ' ')} (at the desk)`, dueDate: '', paidAt: o.now, method: o.method,
    appliesToEntryIds: settled.map((x) => x.id), createdBy: o.by, note: 'Paid at the front desk', receiptId: o.receiptId, transactionId: o.transactionId, createdAt: o.now, updatedAt: o.now });
  for (const c of settled) batch.set(db.doc(`${T}/rentLedger/${c.id}`), { status: 'paid', paidAt: o.now, updatedAt: o.now }, { merge: true });
  // Rent invoices (what autopay, late notices and reminders read): oldest first, part-payments recorded. Anything
  // over what's owed becomes credit that comes off their next rent invoice — never a tip.
  let left = o.amountCents; const invoices: { id: string; status: string; paidCents: number }[] = []; let creditId: string | null = null; let creditCents = 0;
  if (acct.usesInvoices) {
    for (const inv of acct.invoices || []) { if (left <= 0) break; const take = Math.min(left, inv.owedCents); left -= take;
      invoices.push({ id: inv.id, status: String(inv.status || 'due'), paidCents: num(inv.paidCents) });
      const full = take >= inv.owedCents;
      batch.set(db.doc(`${T}/rentInvoices/${inv.id}`), { paidCents: num(inv.paidCents) + take, updatedAt: o.now, ...(full ? { status: 'paid', paidAt: o.now, paidVia: 'desk', ledgerEntryId: ref.id } : {}) }, { merge: true }); }
    if (left > 0) { const c = db.collection(`${T}/rentLedger`).doc(); creditId = c.id; creditCents = left;
      batch.set(c, { renterId: acct.renter.id, leaseId: acct.lease?.id || null, type: 'prepaid_credit', status: 'paid', amountCents: -left, note: 'Paid ahead at the front desk — comes off the next rent', receiptId: o.receiptId, createdAt: o.now, date: o.now }); }
  }
  return { renterId: acct.renter.id, entryId: ref.id, settled, invoices, creditId, creditCents };
}

/** A void puts it back: the payment is marked voided (it no longer counts) and the charges it settled are owed again. */
export function reverseRentPayment(batch: any, db: any, T: string, x: { entryId: string; settled: { id: string; status: string }[]; invoices?: { id: string; status: string; paidCents: number }[]; creditId?: string | null }, now: string, reason: string) {
  for (const i of x.invoices || []) batch.set(db.doc(`${T}/rentInvoices/${i.id}`), { status: i.status, paidCents: i.paidCents, paidAt: null, paidVia: null, ledgerEntryId: null, updatedAt: now }, { merge: true });
  if (x.creditId) batch.set(db.doc(`${T}/rentLedger/${x.creditId}`), { type: 'prepaid_credit_voided', voidedAt: now, voidReason: reason }, { merge: true });
  // 'refunded' is the status every rent screen already leaves out of what's been paid — so the Rent page, statements and
  // balances all agree at once; `voided` + the reason say what actually happened.
  batch.set(db.doc(`${T}/rentLedger/${x.entryId}`), { status: 'refunded', voided: true, voidedAt: now, voidReason: reason, updatedAt: now }, { merge: true });
  for (const c of x.settled || []) batch.set(db.doc(`${T}/rentLedger/${c.id}`), { status: c.status && c.status !== 'paid' ? c.status : 'pending', paidAt: null, updatedAt: now }, { merge: true });
}
export { renterName };
