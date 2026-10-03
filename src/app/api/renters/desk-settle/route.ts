// src/app/api/renters/desk-settle/route.ts — SETTLE WHAT THE DESK COLLECTED FOR A RENTER (owners & managers).
//   { tenantId, renterId, how: 'paid' | 'rent' }
//   paid → you've paid it out (cash / transfer); the entries are marked settled.
//   rent → a 'desk_offset' credit that comes off their next rent invoice (like leave / abatement credits).
// Either way the renter sees it in their Books ("taken off rent" / "paid").
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80); const renterId = String(b.renterId || '').slice(0, 120);
  const how = b.how === 'rent' ? 'rent' : b.how === 'paid' ? 'paid' : '';
  const auth: any = tenantId ? await verifyStaffActor(req, tenantId) : null;
  if (!auth?.ok || (!auth.actor?.isManager && !auth.actor?.isTenantOwner)) return NextResponse.json({ ok: false, error: 'Only owners and managers can settle this.' }, { status: 403 });
  if (!renterId || !how) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`; const now = new Date().toISOString();
  const owed = (await db.collection(`${T}/rentLedger`).where('renterId', '==', renterId).get()).docs.filter((d) => { const v: any = d.data(); return v.type === 'desk_collected' && v.status === 'owed'; });
  const cents = owed.reduce((n, d) => n + (Number((d.data() as any).amountCents) || 0), 0);
  if (!cents) return NextResponse.json({ ok: false, error: 'Nothing is owed to this renter.' }, { status: 409 });
  const batch = db.batch(); const by = auth.actor.name || 'Owner';
  let offsetId: string | null = null;
  if (how === 'rent') { const ref = db.collection(`${T}/rentLedger`).doc(); offsetId = ref.id;
    batch.set(ref, { id: ref.id, renterId, type: 'desk_offset', status: 'paid', amountCents: -cents, date: now, createdAt: now, note: 'Front-desk collections taken off your rent', createdBy: by }); }
  for (const d of owed) batch.set(d.ref, { status: 'settled', settledHow: how, settledAt: now, settledBy: by, ...(offsetId ? { offsetId } : {}) }, { merge: true });
  await batch.commit();
  return NextResponse.json({ ok: true, cents, how });
}
