// src/app/api/resources/rentable/route.ts — RENT OUT A ROOM, SAUNA, COURT OR PIECE OF EQUIPMENT (managers).
// A resource marked rentable is mirrored into the booth-rental engine as a rental "space" (one per unit of capacity),
// so public hourly / day booking, the signed agreement, kiosk check-in, check-out with grace and overstay charges, the
// saved card and the ledger all work exactly as they do for booths — no provider involved. { resourceId }
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
export const dynamic = 'force-dynamic';
const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80);
  const auth: any = tenantId ? await verifyStaffActor(req, tenantId) : null;
  if (!auth?.ok || !(auth.actor.isManager || auth.actor.isTenantOwner)) return NextResponse.json({ ok: false, error: 'Managers only.' }, { status: 403 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`; const resourceId = String(b.resourceId || '').slice(0, 120);
  const r: any = (await db.doc(`${T}/resources/${resourceId}`).get()).data(); if (!r) return NextResponse.json({ ok: false, error: 'Resource not found.' }, { status: 404 });
  const rental: any = r.rental || {}; const enabled = rental.enabled === true && (n(rental.hourlyCents) > 0 || n(rental.dailyCents) > 0);
  const units = Math.max(1, Math.min(20, Math.round(n(r.capacity) || 1))); const now = new Date().toISOString(); const batch = db.batch(); const ids: string[] = [];
  for (let u = 1; u <= units; u++) {
    const id = `space_${resourceId}_${u}`; ids.push(id); const name = units > 1 ? `${r.name} ${u}` : r.name;
    batch.set(db.doc(`${T}/booths/${id}`), { id, name, kind: 'space', mirrorOf: resourceId, resourceType: r.type || 'room', isActive: enabled && !r.isOutOfService, dayUseEnabled: enabled,
      pricingOptions: [...(n(rental.hourlyCents) > 0 ? [{ frequency: 'hourly', amountCents: Math.round(n(rental.hourlyCents)) }] : []), ...(n(rental.dailyCents) > 0 ? [{ frequency: 'daily', amountCents: Math.round(n(rental.dailyCents)) }] : [])],
      rental: { graceMinutes: Math.max(0, n(rental.graceMinutes) || 10), blockMinutes: Math.max(5, n(rental.blockMinutes) || 15), minMinutes: Math.max(0, n(rental.minMinutes) || 60) },
      amenities: Array.isArray(r.amenities) ? r.amenities : [], description: r.description || null, updatedAt: now, ...(await db.doc(`${T}/booths/${id}`).get()).exists ? {} : { createdAt: now } }, { merge: true });
  }
  // units beyond today's capacity (capacity was reduced) are retired
  const stale = (await db.collection(`${T}/booths`).where('mirrorOf', '==', resourceId).get()).docs.filter((d: any) => !ids.includes(d.id));
  for (const d of stale) batch.set(d.ref, { isActive: false, dayUseEnabled: false, retiredAt: now }, { merge: true });
  await batch.commit();
  return NextResponse.json({ ok: true, spaces: ids, enabled });
}
