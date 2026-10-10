// src/lib/my-rent.ts — A RENTER'S OWN RENT PICTURE for the staff portal: their renter record, lease, invoices, booth,
// unused-time credits, upcoming booth bookings and rent payments. Read on the server so a renter's phone sees only
// what's theirs — the database never hands one renter another renter's records.
const norm = (v: any) => String(v || '').trim().toLowerCase();
const digits = (v: any) => String(v || '').replace(/\D/g, '');
const rows = (snap: any) => snap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));

export function matchRenter(renters: any[], me: { id: string; email?: string; phone?: string }) {
  return renters.find((r) => r.linkedStaffId === me.id)
    || (me.email ? renters.find((r) => norm(r.email) && norm(r.email) === norm(me.email)) : null)
    || (me.phone ? renters.find((r) => digits(r.phone) && digits(r.phone) === digits(me.phone)) : null)
    || null;
}

export async function myRent(db: any, tenantId: string, staffId: string) {
  const T = `tenants/${tenantId}`;
  const me: any = (await db.doc(`${T}/staff/${staffId}`).get()).data();
  if (!me) return { renter: null };
  const renter: any = matchRenter(rows(await db.collection(`${T}/renters`).get()), { id: staffId, email: me.email, phone: me.phone });
  if (!renter) return { renter: null };
  const leases = rows(await db.collection(`${T}/leases`).where('renterId', '==', renter.id).get());
  const lease: any = leases.find((l: any) => ['active', 'on_leave', 'pending_signature'].includes(l.status)) || null;
  const [inv, booth, credits, res, txns] = await Promise.all([
    lease ? db.collection(`${T}/rentInvoices`).where('leaseId', '==', lease.id).get().then(rows) : Promise.resolve([]),
    lease?.boothId ? db.doc(`${T}/booths/${lease.boothId}`).get().then((s: any) => s.exists ? { id: s.id, ...s.data() } : null) : Promise.resolve(null),
    db.collection(`${T}/boothCredits`).get().then(rows),
    db.collection(`${T}/boothReservations`).get().then(rows),
    db.collection(`${T}/transactions`).where('source', '==', 'booth_rent').get().then(rows),
  ]);
  const keys = [norm(renter.email), norm(me.email), digits(renter.phone), digits(me.phone)].filter(Boolean);
  const emails = [norm(renter.email), norm(me.email)].filter(Boolean); const phones = [digits(renter.phone), digits(me.phone)].filter(Boolean);
  const names = [`${renter.firstName || ''} ${renter.lastName || ''}`.trim(), me.name || ''].map((n) => n.toLowerCase()).filter(Boolean);
  return {
    renter, leases, invoices: inv, booth,
    credits: credits.filter((c: any) => { const k = String(c.contactKey || ''); return keys.includes(norm(k)) || keys.includes(digits(k)); }),
    reservations: res.filter((r: any) => emails.includes(norm(r.email)) || phones.includes(digits(r.phone))),
    payments: txns.filter((t: any) => t.type === 'income' && names.includes(String(t.clientOrVendor || '').toLowerCase())),
  };
}
