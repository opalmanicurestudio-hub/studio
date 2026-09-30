// src/lib/rent-desk.ts — RENT AT THE DESK (server). The same rule as the Rent page's "Record payment": the payment
// settles whole charges oldest-first (anything left over stays as credit on their account), and is written to the
// renter's rent ledger. Taken through the shared checkout, so the till, receipt, Today's sales, split and void all work.
const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const renterName = (r: any) => `${r?.firstName || ''} ${r?.lastName || ''}`.trim() || r?.name || 'Renter';

export async function renterAccount(db: any, T: string, renterId: string) {
  const r: any = (await db.doc(`${T}/renters/${renterId}`).get()).data(); if (!r) return null;
  const entries = (await db.collection(`${T}/rentLedger`).where('renterId', '==', renterId).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
  const unpaid = entries.filter((e: any) => num(e.amountCents) > 0 && !['paid', 'waived', 'refunded', 'voided'].includes(String(e.status || '')))
    .sort((a: any, b: any) => String(a.dueDate || a.createdAt || '').localeCompare(String(b.dueDate || b.createdAt || '')));
  const balanceCents = entries.filter((e: any) => !['waived', 'refunded', 'voided'].includes(String(e.status || ''))).reduce((s: number, e: any) => s + num(e.amountCents), 0);
  const lease: any = ((await db.collection(`${T}/leases`).where('renterId', '==', renterId).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }))
    .find((l: any) => !['ended', 'terminated', 'cancelled'].includes(String(l.status || '')))) || null;
  const booth: any = lease?.boothId ? { id: lease.boothId, ...((await db.doc(`${T}/booths/${lease.boothId}`).get()).data() || {}) } : null;
  return { renter: { id: renterId, ...r }, name: renterName(r), lease, booth, unpaid, balanceCents: Math.max(0, balanceCents), owedCents: unpaid.reduce((s: number, e: any) => s + num(e.amountCents), 0) };
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
  return { renterId: acct.renter.id, entryId: ref.id, settled };
}

/** A void puts it back: the payment is marked voided (it no longer counts) and the charges it settled are owed again. */
export function reverseRentPayment(batch: any, db: any, T: string, x: { entryId: string; settled: { id: string; status: string }[] }, now: string, reason: string) {
  // 'refunded' is the status every rent screen already leaves out of what's been paid — so the Rent page, statements and
  // balances all agree at once; `voided` + the reason say what actually happened.
  batch.set(db.doc(`${T}/rentLedger/${x.entryId}`), { status: 'refunded', voided: true, voidedAt: now, voidReason: reason, updatedAt: now }, { merge: true });
  for (const c of x.settled || []) batch.set(db.doc(`${T}/rentLedger/${c.id}`), { status: c.status && c.status !== 'paid' ? c.status : 'pending', paidAt: null, updatedAt: now }, { merge: true });
}
export { renterName };
