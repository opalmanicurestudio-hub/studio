// src/app/api/renters/home/route.ts — THE RENTALS HOME. Reads what the Home needs and works it out with
// lib/rentals-home: the numbers, one list of what needs the owner, leases ending soon and today at the spaces.
//   GET ?tenantId[&locationId] → { kpis, needs, ending, today, leaseable, counts, businessName }
// Guarded by requireCan('money.view'): it shows rent and deposits. With a location chosen, only that location's
// spaces and leases count, and the renters on those leases (or tied to that location), with what they owe, and the
// location's own time zone sets what "today" is. Reads only what can still matter: open and this month's bills, open
// repairs, time away asked for or under way, new applications, open closures and recent guests.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireCan } from '@/lib/route-guard';
import { rentalsHome, plusDays } from '@/lib/rentals-home';
import { todayIn, tenantTimeZone } from '@/lib/tenant-time';

export const dynamic = 'force-dynamic';
const j = (b: any, status = 200) => NextResponse.json(b, { status, headers: { 'Cache-Control': 'no-store' } });
const rows = (s: any) => s.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
const byId = (...lists: any[][]) => Array.from(new Map(lists.flat().map((x) => [x.id, x])).values());

export async function GET(req: NextRequest) {
  const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '').trim().slice(0, 120);
  const locationId = String(req.nextUrl.searchParams.get('locationId') || '').trim().slice(0, 120);
  const g = await requireCan(req, tenantId, 'money.view'); if (g.deny) return g.deny;
  try {
    const db = getAdminDb(); const T = `tenants/${tenantId}`;
    const tenant: any = ((await db.doc(T).get()).data() as any) || {};
    const location: any = locationId ? (((await db.doc(`${T}/locations/${locationId}`).get()).data() as any) || null) : null;
    const timeZone = tenantTimeZone(tenant, location);
    const now = new Date(); const today = todayIn(timeZone, now); const monthStart = `${today.slice(0, 7)}-01`;
    const col = (name: string) => db.collection(`${T}/${name}`);
    const [booths, leases, renters, openBills, monthBills, ledger, documents, grievances, threads, tickets, leaves, applications, reservations, interruptions] = await Promise.all([
      col('booths').get().then(rows), col('leases').get().then(rows), col('renters').get().then(rows),
      col('rentInvoices').where('status', 'in', ['due', 'late']).get().then(rows),
      col('rentInvoices').where('dueDate', '>=', monthStart).get().then(rows),
      // Every ledger line: deposits held go back years, and open one-off charges can be any age.
      col('rentLedger').get().then(rows),
      col('renterDocuments').where('status', '==', 'sent').get().then(rows),
      col('renterGrievances').where('status', '==', 'open').get().then(rows),
      col('renterThreads').where('unreadForOwner', '==', true).get().then(rows),
      col('tickets').where('status', 'in', ['open', 'in_progress']).get().then(rows),
      col('renterLeaves').where('status', 'in', ['requested', 'approved']).get().then(rows),
      col('boothApplications').where('status', '==', 'new').get().then(rows),
      // A stay that started up to a month ago may still be going today.
      col('boothReservations').where('startDate', '>=', plusDays(today, -31)).get().then(rows),
      col('interruptions').where('status', '==', 'open').get().then(rows),
    ]);
    const invoices = byId(openBills, monthBills);

    const here = (x: any) => !locationId || !x?.locationId || x.locationId === locationId;
    const bs = booths.filter(here); const boothIds = new Set(bs.map((b: any) => b.id));
    const ls = leases.filter((l: any) => !locationId || ((l.boothId ? boothIds.has(l.boothId) : true) && here(l)));
    const leaseIds = new Set(ls.map((l: any) => l.id));
    // The renters on this location's leases, and anyone tied to this location without one.
    const onLeases = new Set(ls.map((l: any) => String(l.renterId)));
    const rs = renters.filter((r: any) => !locationId || onLeases.has(r.id) || (here(r) && !leases.some((l: any) => l.renterId === r.id && ['active', 'on_leave', 'pending_signature'].includes(String(l.status)) && !leaseIds.has(l.id))));
    const renterIds = new Set(rs.map((r: any) => r.id));
    const mine = (x: any) => !locationId || (x?.leaseId ? leaseIds.has(x.leaseId) : x?.renterId ? renterIds.has(x.renterId) : false);
    const out = rentalsHome({
      todayIso: today, nowIso: now.toISOString(), tenant, timeZone, allLeases: leases,
      booths: bs, leases: ls, renters: rs, invoices: invoices.filter(mine), ledger: ledger.filter(mine),
      documents: documents.filter(mine), grievances: grievances.filter((x: any) => !locationId || renterIds.has(x.renterId)),
      threads: threads.filter((t: any) => !locationId || renterIds.has(String(t.renterId || t.id))),
      tickets: tickets.filter((t: any) => (t.boothId ? boothIds.has(t.boothId) : here(t))), leaves: leaves.filter(mine),
      applications: applications.filter((a: any) => (a.boothId ? boothIds.has(a.boothId) : here(a))),
      reservations: reservations.filter((r: any) => boothIds.has(r.boothId)),
      interruptions: interruptions.filter((i: any) => !locationId || !Array.isArray(i.affectedBoothIds) || !i.affectedBoothIds.length || i.affectedBoothIds.some((id: string) => boothIds.has(id))),
    });
    return j({ ok: true, ...out, businessName: String(tenant.name || tenant.businessName || '') });
  } catch {
    return j({ ok: false, error: 'The Rentals home didn’t load. Try again in a moment.' }, 500);
  }
}
