// src/app/api/renters/roster/route.ts — THE RENTERS LIST, BY STAGE. One row per renter, worked out with
// lib/renters-roster: space, lease, what they owe, autopay, insurance, license and portal, and the stages to filter by.
//   GET ?tenantId[&locationId] → { rows, chips }
// Guarded by requireCan('money.view'): it shows what renters owe. With a location chosen, the renters on its leases
// and anyone tied to it without a lease elsewhere.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireCan } from '@/lib/route-guard';
import { rentersRoster } from '@/lib/renters-roster';
import { OCCUPYING } from '@/lib/rentals-home';
import { todayIn, tenantTimeZone } from '@/lib/tenant-time';
import { spacePayAccount } from '@/lib/space-stripe';

export const dynamic = 'force-dynamic';
const j = (b: any, status = 200) => NextResponse.json(b, { status, headers: { 'Cache-Control': 'no-store' } });
const rows = (s: any) => s.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));

export async function GET(req: NextRequest) {
  const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '').trim().slice(0, 120);
  const locationId = String(req.nextUrl.searchParams.get('locationId') || '').trim().slice(0, 120);
  const g = await requireCan(req, tenantId, 'money.view'); if (g.deny) return g.deny;
  try {
    const db = getAdminDb(); const T = `tenants/${tenantId}`;
    const tenant: any = ((await db.doc(T).get()).data() as any) || {};
    const location: any = locationId ? (((await db.doc(`${T}/locations/${locationId}`).get()).data() as any) || null) : null;
    const timeZone = tenantTimeZone(tenant, location);
    const today = todayIn(timeZone);
    const col = (name: string) => db.collection(`${T}/${name}`);
    const [booths, leases, renters, invoices, ledger, leaves] = await Promise.all([
      col('booths').get().then(rows), col('leases').get().then(rows), col('renters').get().then(rows),
      col('rentInvoices').where('status', 'in', ['due', 'late']).get().then(rows), col('rentLedger').get().then(rows),
      col('renterLeaves').where('status', '==', 'approved').get().then(rows),
    ]);
    const here = (x: any) => !locationId || !x?.locationId || x.locationId === locationId;
    const boothIds = new Set(booths.filter(here).map((b: any) => b.id));
    const ls = leases.filter((l: any) => !locationId || ((l.boothId ? boothIds.has(l.boothId) : true) && here(l)));
    // At one location: whoever holds a space here; and anyone who had one here, or is tied to here, unless they hold a
    // space somewhere else now (then they belong to that location's list).
    const holdsHere = (id: string) => ls.some((l: any) => l.renterId === id && OCCUPYING.includes(String(l.status)));
    const hadHere = new Set(ls.map((l: any) => String(l.renterId)));
    const elsewhere = (id: string) => leases.some((l: any) => l.renterId === id && OCCUPYING.includes(String(l.status)) && !ls.includes(l));
    const rs = renters.filter((r: any) => !locationId || holdsHere(r.id) || ((hadHere.has(r.id) || here(r)) && !elsewhere(r.id)));
    const out = rentersRoster({ todayIso: today, tenant, renters: rs, leases: ls, booths, invoices, ledger, leaves, businessAccount: spacePayAccount(tenant), timeZone });
    return j({ ok: true, ...out });
  } catch {
    return j({ ok: false, error: 'The renters didn’t load. Try again in a moment.' }, 500);
  }
}
