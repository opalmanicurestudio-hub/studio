// src/app/api/locations/delete/route.ts
//
// DELETE A LOCATION — ONLY WHEN IT'S SAFE.
//
// About twenty parts of the app store a locationId (booths, renters, leases,
// station bookings, appointments, maintenance, staff access, the rent ledger).
// Deleting a location any of them point at would leave records aimed at
// nothing — a lease tied to a place that no longer exists, reports that lose
// their location. So:
//
//   POST { tenantId, locationId, mode: 'check' }  → what references it
//   POST { tenantId, locationId, mode: 'delete' } → deletes ONLY if nothing
//        does, and it isn't the last location. Otherwise refuses with the
//        same list, and the page offers "Set inactive" instead.
//
// Owner / manager only.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';

export const dynamic = 'force-dynamic';

// Collection → plain-words label. Each is checked with where('locationId','==',id).
const REFS: [string, string, string][] = [
  ['booths', 'booth or station', 'booths or stations'],
  ['renters', 'renter', 'renters'],
  ['leases', 'lease', 'leases'],
  ['bookings', 'station booking', 'station bookings'],
  ['appointments', 'appointment', 'appointments'],
  ['tickets', 'maintenance ticket', 'maintenance tickets'],
  ['rentLedger', 'rent ledger entry', 'rent ledger entries'],
];

async function countRefs(db: any, tenantId: string, locationId: string) {
  const found: { key: string; label: string; count: number }[] = [];
  for (const [col, one, many] of REFS) {
    let n = 0;
    try {
      const q = db.collection(`tenants/${tenantId}/${col}`).where('locationId', '==', locationId);
      try { n = (await q.count().get()).data().count; }
      catch { n = (await q.limit(1000).get()).size; }
    } catch { n = 0; }
    if (n > 0) found.push({ key: col, label: n === 1 ? one : many, count: n });
  }
  // Staff access lists: locationIds array.
  try {
    const q = db.collection(`tenants/${tenantId}/staff`).where('locationIds', 'array-contains', locationId);
    const n = (await q.limit(500).get()).size;
    if (n > 0) found.push({ key: 'staff', label: n === 1 ? 'staff member with access' : 'staff members with access', count: n });
  } catch { /* no index / no field — nothing to report */ }
  return found;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const tenantId = String(body.tenantId || '').trim();
  const locationId = String(body.locationId || '').trim();
  const mode = body.mode === 'delete' ? 'delete' : 'check';
  if (!tenantId || !locationId) return NextResponse.json({ ok: false, error: 'tenantId and locationId are required.' }, { status: 400 });

  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!auth.actor.isManager && !auth.actor.isTenantOwner) return NextResponse.json({ ok: false, error: 'Only an owner or manager can delete a location.' }, { status: 403 });

  const db = getAdminDb();
  const ref = db.doc(`tenants/${tenantId}/locations/${locationId}`);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ ok: false, error: 'That location no longer exists.' }, { status: 404 });

  const all = await db.collection(`tenants/${tenantId}/locations`).get();
  const isLast = all.size <= 1;
  const refs = await countRefs(db, tenantId, locationId);
  const blocked = isLast || refs.length > 0;
  const reason = isLast
    ? 'This is your only location — the app needs at least one. Rename it instead.'
    : refs.length ? `Still in use: ${refs.map((r) => `${r.count} ${r.label}`).join(', ')}.` : null;

  if (mode === 'check' || blocked) {
    return NextResponse.json({ ok: mode === 'check', canDelete: !blocked, isLast, refs, reason, ...(mode === 'delete' ? { error: reason } : {}) }, { status: mode === 'delete' ? 409 : 200 });
  }

  await ref.delete();
  try {
    const aRef = db.collection(`tenants/${tenantId}/auditLogs`).doc();
    await aRef.set({ id: aRef.id, at: new Date().toISOString(), action: 'location_deleted', entityId: locationId,
      summary: `Location "${(snap.data() as any)?.name || locationId}" deleted by ${auth.actor.name || auth.actor.uid}`, actorUid: auth.actor.uid });
  } catch { /* audit is best-effort */ }
  return NextResponse.json({ ok: true, deleted: true });
}
