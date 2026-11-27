// src/lib/renter-rent-history.ts — ONE RENTER'S RENT AND SPACE PAYMENTS from the books (transactions, source
// 'booth_rent'), found by who they belong to, never by name: two renters with the same name must never see each other's
// payments. A payment belongs to a renter when it carries their renterId (every payment recorded from now on does), or,
// for older records, when it was recorded against one of their own records: a lease, a rent bill, a rent-ledger line,
// or a booking (the record's sourceId).
const IN_LIMIT = 30;

/** The ids of a renter's own records that older payment lines point back to. */
export async function renterSourceIds(db: any, tenantId: string, renterId: string): Promise<string[]> {
  const T = `tenants/${tenantId}`;
  const [leases, invoices, ledger, bookings] = await Promise.all([
    db.collection(`${T}/leases`).where('renterId', '==', renterId).get(),
    db.collection(`${T}/rentInvoices`).where('renterId', '==', renterId).get(),
    db.collection(`${T}/rentLedger`).where('renterId', '==', renterId).get(),
    db.collection(`${T}/boothReservations`).where('renterId', '==', renterId).get(),
  ]);
  return [...leases.docs, ...invoices.docs, ...ledger.docs, ...bookings.docs].map((d: any) => String(d.id));
}

/** Rent and space payments for one renter (and any extra records of theirs, such as bookings found by their contact). */
export async function renterRentPayments(db: any, tenantId: string, opts: { renterId?: string | null; extraSourceIds?: string[] }): Promise<any[]> {
  const T = `tenants/${tenantId}`;
  const found = new Map<string, any>();
  // A refund to their card of one of these (lib/renter-refund, or one made in the Stripe Dashboard, lib/outside-refund)
  // is kept with them, and counts against what they paid (rentRefundOf names the payment).
  const keep = (docs: any[]) => { for (const d of docs) { const x: any = d.data() || {}; if (x.source === 'booth_rent' || x.rentRefundOf) found.set(d.id, { ...x, id: x.id || d.id }); } };
  const sources = new Set<string>((opts.extraSourceIds || []).filter(Boolean).map(String));
  if (opts.renterId) {
    keep((await db.collection(`${T}/transactions`).where('renterId', '==', opts.renterId).get()).docs);
    for (const id of await renterSourceIds(db, tenantId, opts.renterId)) sources.add(id);
  }
  const ids = [...sources];
  for (let i = 0; i < ids.length; i += IN_LIMIT) {
    keep((await db.collection(`${T}/transactions`).where('sourceId', 'in', ids.slice(i, i + IN_LIMIT)).get()).docs);
  }
  return [...found.values()];
}

/** Lines in the books that take back or correct these payments: an undo or a correction (type reversal, reversalOf), a
 *  void (voidOf), or a correction's new line (correctionOf). They carry none of the renter's ids, so they're found by
 *  the payment they point at. */
export async function rentTakeBacks(db: any, tenantId: string, paymentIds: string[]): Promise<any[]> {
  const T = `tenants/${tenantId}`; const out = new Map<string, any>(); const ids = [...new Set(paymentIds.filter(Boolean).map(String))];
  for (const field of ['reversalOf', 'voidOf', 'correctionOf']) {
    for (let i = 0; i < ids.length; i += IN_LIMIT) {
      const snap = await db.collection(`${T}/transactions`).where(field, 'in', ids.slice(i, i + IN_LIMIT)).get();
      for (const d of snap.docs) { const x: any = d.data() || {}; out.set(d.id, { ...x, id: x.id || d.id }); }
    }
  }
  return [...out.values()];
}

const RENT_CATEGORIES = new Set(['Booth Rent', 'Renter Incidental', 'Renter Add-on', 'No-show Fee']);
const isDeposit = (t: any) => t?.category === 'Booth Deposit' || t?.taxBucket === 'transfer';
/** The line a take-back or correction points at, if any. */
export const rentLineTarget = (t: any): string => String(t?.rentRefundOf || t?.reversalOf || t?.voidOf || t?.correctionOf || '');
/** One line's part of what a renter paid, in cents (`byId`: their payments and the lines that take them back): a
 *  payment counts; a refund to their card, an undo, a void or a correction for less comes off; a correction for more
 *  counts while it stays rent. A security deposit held, and anything taking one back, isn't rent. */
export function rentLineCents(t: any, byId: Map<string, any>): number {
  if (!t || t.removed) return 0;
  const c = Math.round(Math.abs(typeof t.amountCents === 'number' ? t.amountCents : (Number(t.amount) || 0) * 100));
  const o = byId.get(rentLineTarget(t));
  if (t.rentRefundOf || t.type === 'reversal' || t.voidOf) return o && isDeposit(o) ? 0 : o || t.rentRefundOf ? -c : 0;
  if (isDeposit(t)) return 0;
  if (t.correctionOf) return o && t.type === o.type && t.type === 'income' && (t.category === o.category || RENT_CATEGORIES.has(String(t.category))) ? c : 0;
  return t.type === 'income' ? c : 0;
}

/** Money the business owed the renter that went toward their rent instead of being paid out (front-desk collections,
 *  gift cards, online shop sales: rent-ledger credits), as much of each as the nightly job has used on a rent bill
 *  (appliedCents), in the year it was last used (lastAppliedAt). Paid all the same. Credit not used yet isn't, and
 *  nor is a discount (time away, a closure, a lease perk). */
export const RENT_PAID_CREDITS: Record<string, string> = { desk_offset: 'money collected for you at the front desk', gift_card_credit: 'the business’s gift cards your clients used', retail_sale_credit: 'your online shop sales' };
export function rentCreditsUsed(ledger: any[], year: number): { id: string; date: string; cents: number; what: string }[] {
  return ledger.filter((r) => RENT_PAID_CREDITS[String(r?.type)] && r?.status !== 'voided' && Number(r?.appliedCents) > 0
    && String(r.lastAppliedAt || r.date || r.createdAt || '').slice(0, 4) === String(year))
    .map((r) => ({ id: String(r.id || ''), date: String(r.lastAppliedAt || r.date || r.createdAt || '').slice(0, 10), cents: Math.round(Number(r.appliedCents)), what: RENT_PAID_CREDITS[String(r.type)] }));
}
