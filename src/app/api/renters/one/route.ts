// src/app/api/renters/one/route.ts — ONE RENTER, ON ONE PAGE. Reads what the renter's own page needs and works it out
// with lib/renter-summary: the one thing that needs doing, six numbers and the lease, money, papers and business cards.
//   GET ?tenantId&renterId → { summary, renter: { id, firstName, lastName, email, phone, status } }
// Guarded by requireCan('money.view'): it shows what they owe. The W-9 is only said to be on file or not; its number
// never leaves the server (lib/w9-store).
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireCan } from '@/lib/route-guard';
import { renterSummary } from '@/lib/renter-summary';
import { todayIn, tenantTimeZone } from '@/lib/tenant-time';
import { spacePayAccount } from '@/lib/space-stripe';
import { hasW9 } from '@/lib/w9-store';

export const dynamic = 'force-dynamic';
const j = (b: any, status = 200) => NextResponse.json(b, { status, headers: { 'Cache-Control': 'no-store' } });
const rows = (s: any) => s.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));

export async function GET(req: NextRequest) {
  const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '').trim().slice(0, 120);
  const renterId = String(req.nextUrl.searchParams.get('renterId') || '').trim().slice(0, 120);
  const g: any = await requireCan(req, tenantId, 'money.view'); if (g.deny) return g.deny;
  // Another renter's money and papers are for the business, never for a renter signed in on the team side.
  if (g.actor?.isRenter) return j({ ok: false, error: 'This is for the business only.' }, 403);
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(renterId)) return j({ ok: false, error: 'No renter given.' }, 400);
  try {
    const db = getAdminDb(); const T = `tenants/${tenantId}`;
    const rSnap = await db.doc(`${T}/renters/${renterId}`).get();
    if (!rSnap.exists) return j({ ok: false, error: 'That renter isn’t here any more.' }, 404);
    const renter: any = { id: rSnap.id, ...(rSnap.data() as any) };
    const tenant: any = ((await db.doc(T).get()).data() as any) || {};
    const by = (name: string) => db.collection(`${T}/${name}`).where('renterId', '==', renterId).get().then(rows);
    const [leases, invoices, ledger, documents, grievances, leaves, booths, tickets, providers] = await Promise.all([
      by('leases'), by('rentInvoices'), by('rentLedger'), by('renterDocuments'), by('renterGrievances'), by('renterLeaves'),
      db.collection(`${T}/booths`).get().then(rows),
      db.collection(`${T}/tickets`).where('status', 'in', ['open', 'in_progress']).get().then(rows),
      db.collection(`${T}/staff`).where('renterId', '==', renterId).get().then(rows),
    ]);
    const location: any = renter.locationId ? (((await db.doc(`${T}/locations/${renter.locationId}`).get()).data() as any) || null) : null;
    const timeZone = tenantTimeZone(tenant, location);
    const summary = renterSummary({
      todayIso: todayIn(timeZone), timeZone, tenant, renter, leases, booths, invoices, ledger, documents, grievances, leaves, tickets,
      w9OnFile: hasW9(renter), businessAccount: spacePayAccount(tenant), provider: providers.find((p: any) => p.isRenter) || null,
    });
    return j({ ok: true, summary, renter: { id: renter.id, firstName: renter.firstName || '', lastName: renter.lastName || '', email: renter.email || '', phone: renter.phone || '', status: renter.status || '' } });
  } catch {
    return j({ ok: false, error: 'This renter didn’t load. Try again in a moment.' }, 500);
  }
}
