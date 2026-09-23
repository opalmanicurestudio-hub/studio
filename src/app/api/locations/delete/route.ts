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
import { isBusinessLocation, looksAutoProvisioned, DEFAULT_LOCATION_DOC_ID } from '@/lib/location-kind';

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
  const mode = body.mode === 'delete' ? 'delete' : body.mode === 'duplicates' ? 'duplicates' : body.mode === 'cleanup' ? 'cleanup' : 'check';
  if (!tenantId || (!locationId && mode !== 'duplicates' && mode !== 'cleanup')) return NextResponse.json({ ok: false, error: 'tenantId and locationId are required.' }, { status: 400 });

  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!auth.actor.isManager && !auth.actor.isTenantOwner) return NextResponse.json({ ok: false, error: 'Only an owner or manager can delete a location.' }, { status: 403 });

  const db = getAdminDb();

  // ── Duplicates left by the old provisioner ──────────────────────────────
  // Before the default location got a fixed id, every refresh, second tab or
  // remount could mint another "<Studio> — Main Location" with a random id.
  // The fix stopped new ones; the old ones stayed. This finds them and, on
  // 'cleanup', removes only those that NOTHING references — keeping the one
  // in use (or the fixed 'primary' one), and never the last location.
  if (mode === 'duplicates' || mode === 'cleanup') {
    const t = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
    const docs = (await db.collection(`tenants/${tenantId}/locations`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }))
      .filter(isBusinessLocation);
    const auto = docs.filter((l: any) => looksAutoProvisioned(l, t.name));
    const rows: any[] = [];
    for (const l of auto) {
      const refs = await countRefs(db, tenantId, l.id);
      rows.push({ id: l.id, name: l.name, createdAt: l.createdAt || null, isPrimary: l.id === DEFAULT_LOCATION_DOC_ID, refs, used: refs.reduce((n: number, r: any) => n + r.count, 0) });
    }
    // Keep: 'primary' if it exists, else the most-used, else the oldest.
    const keep = rows.find((r) => r.isPrimary) || [...rows].sort((a, b) => (b.used - a.used) || String(a.createdAt).localeCompare(String(b.createdAt)))[0] || null;
    const nonAuto = docs.length - auto.length;
    const removable = rows.filter((r) => r.used === 0 && r.id !== keep?.id && !r.isPrimary);
    // Never leave zero business locations.
    const safeRemovable = (nonAuto + rows.length - removable.length) >= 1 ? removable : removable.slice(0, Math.max(0, removable.length - 1));
    if (mode === 'duplicates') {
      return NextResponse.json({ ok: true, keepId: keep?.id || null, duplicates: rows, removableIds: safeRemovable.map((r) => r.id), inUseDuplicates: rows.filter((r) => r.used > 0 && r.id !== keep?.id).map((r) => ({ id: r.id, name: r.name, refs: r.refs })) });
    }
    const batch = db.batch();
    for (const r of safeRemovable) batch.delete(db.doc(`tenants/${tenantId}/locations/${r.id}`));
    await batch.commit();
    try {
      const aRef = db.collection(`tenants/${tenantId}/auditLogs`).doc();
      await aRef.set({ id: aRef.id, at: new Date().toISOString(), action: 'location_duplicates_removed', summary: `${safeRemovable.length} unused auto-created duplicate location(s) removed by ${auth.actor.name || auth.actor.uid}`, actorUid: auth.actor.uid, ids: safeRemovable.map((r) => r.id) });
    } catch { /* audit is best-effort */ }
    return NextResponse.json({ ok: true, removed: safeRemovable.length });
  }

  const ref = db.doc(`tenants/${tenantId}/locations/${locationId}`);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ ok: false, error: 'That location no longer exists.' }, { status: 404 });
  if (!isBusinessLocation({ id: snap.id, ...(snap.data() as any) })) {
    return NextResponse.json({ ok: false, canDelete: false, error: 'That’s an inventory storage area, not a studio location — manage it on the Inventory page, where products that live there are accounted for.' }, { status: 409 });
  }

  const all = (await db.collection(`tenants/${tenantId}/locations`).get()).docs.filter((d: any) => isBusinessLocation({ id: d.id, ...(d.data() as any) }));
  const isLast = all.length <= 1;
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
