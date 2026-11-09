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
