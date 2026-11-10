// src/app/api/renters/spaces/route.ts — THE SPACES LIST. One row per space, worked out with lib/spaces-board: its
// status, who has it, lease end, rent, what it brought in this year and how much it was used, and the detail panel.
//   GET ?tenantId[&locationId] → { rows, chips, leaseable }
// Guarded by requireCan('money.view'): it shows rent and deposits. With a location chosen, only that location's spaces.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireCan } from '@/lib/route-guard';
import { spacesBoard } from '@/lib/spaces-board';
import { leaseableRenters, plusDays } from '@/lib/rentals-home';
import { todayIn, tenantTimeZone } from '@/lib/tenant-time';

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
    const today = todayIn(tenantTimeZone(tenant, location));
    // Only what the list can use: this year's bills and any still open, guests from the last twelve months (and a stay
    // that began a little before), open repairs, open applications. Every ledger line: a deposit can be any age.
    const yearStart = `${today.slice(0, 4)}-01-01`; const from = plusDays(today, -364);
    const col = (name: string) => db.collection(`${T}/${name}`);
    const [booths, leases, renters, yearBills, openBills, ledger, reservations, applications, tickets, documents] = await Promise.all([
      col('booths').get().then(rows), col('leases').get().then(rows), col('renters').get().then(rows),
      col('rentInvoices').where('dueDate', '>=', yearStart).get().then(rows),
      col('rentInvoices').where('status', 'in', ['due', 'late']).get().then(rows),
      col('rentLedger').get().then(rows),
      col('boothReservations').where('startDate', '>=', plusDays(yearStart < from ? yearStart : from, -31)).get().then(rows),
      col('boothApplications').where('status', 'in', ['new', 'in_review']).get().then(rows),
      col('tickets').where('status', 'in', ['open', 'in_progress']).get().then(rows),
      col('renterDocuments').where('status', '==', 'sent').get().then(rows),
    ]);
    const invoices = Array.from(new Map([...yearBills, ...openBills].map((i: any) => [i.id, i])).values());
    const bs = booths.filter((b: any) => !locationId || !b.locationId || b.locationId === locationId);
    const ids = new Set(bs.map((b: any) => b.id));
    const out = spacesBoard({
      todayIso: today, booths: bs, leases: leases.filter((l: any) => ids.has(l.boothId)), renters, invoices: invoices.filter((i: any) => !i.boothId || ids.has(i.boothId)),
      ledger, reservations: reservations.filter((r: any) => ids.has(r.boothId)), applications, tickets: tickets.filter((t: any) => !t.boothId || ids.has(t.boothId)), documents,
    });
    // Who a lease for an open space can be written for: anyone not holding a space anywhere now.
    const leaseable = leaseableRenters(renters.filter((r: any) => !locationId || !r.locationId || r.locationId === locationId), leases);
    return j({ ok: true, ...out, leaseable });
  } catch {
    return j({ ok: false, error: 'The spaces didn’t load. Try again in a moment.' }, 500);
  }
}
