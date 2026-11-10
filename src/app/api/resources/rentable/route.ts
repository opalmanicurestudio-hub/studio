// src/app/api/resources/rentable/route.ts — RENT OUT A ROOM, SAUNA, COURT OR PIECE OF EQUIPMENT (managers).
// A resource marked rentable is mirrored into the booth-rental engine as a rental "space" (one per unit of capacity),
// so public hourly / day booking, the signed agreement, kiosk check-in, check-out with grace and overstay charges, the
// saved card and the ledger all work exactly as they do for booths — no provider involved. Each one is open ('vacant')
// so the booking page lists it, out of service when the resource is, at the resource's location. { resourceId }
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
export const dynamic = 'force-dynamic';

/** A mirrored space's status. Open ('vacant') when it's rented out, so the booking page and route offer it; out of
 *  service while the resource is ('maintenance', marked as the resource's, with what it was before); off the list
 *  ('inactive') when it isn't rented out or the unit is retired. A lease on it (occupied, or shared) is never undone, and
 *  out of service set on the space itself (a repair ticket) is left for the repair to clear. */
function spaceStatusFor(cur: any, o: { enabled: boolean; outOfService: boolean }): Record<string, any> {
  const was = String(cur?.status || '');
  const leased = was === 'occupied' || was === 'partial';
  const ours = cur?.serviceFrom === 'resource';
  if (o.outOfService) {
    if (was === 'maintenance') return {};               // already out of service
    return { status: 'maintenance', serviceFrom: 'resource', statusBeforeService: was || null };
  }
  if (was === 'maintenance') {
    if (!ours) return {};                                   // a repair on the space itself: the repair clears it
    const back = String(cur?.statusBeforeService || '');
    if (back === 'occupied' || back === 'partial') return { status: back, serviceFrom: null, statusBeforeService: null };
    if (back === 'inactive' && cur?.offFrom !== 'resource') return { status: 'inactive', serviceFrom: null, statusBeforeService: null };   // off the list by hand
    return { status: o.enabled ? 'vacant' : 'inactive', serviceFrom: null, statusBeforeService: null, offFrom: o.enabled ? null : 'resource' };
  }
  if (leased) return {};
  // Taken off the list by hand on the Spaces page: left off until it's put back there.
  if (was === 'inactive' && cur?.offFrom !== 'resource') return {};
  return o.enabled ? { status: 'vacant', offFrom: null } : { status: 'inactive', offFrom: 'resource' };
}
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
    const cur: any = (await db.doc(`${T}/booths/${id}`).get()).data() || null;
    const st = spaceStatusFor(cur, { enabled, outOfService: !!r.isOutOfService });
    const minMinutes = Math.max(0, n(rental.minMinutes) || 60);
    batch.set(db.doc(`${T}/booths/${id}`), { id, name, kind: 'space', mirrorOf: resourceId, resourceType: r.type || 'room', isActive: enabled && !r.isOutOfService, dayUseEnabled: enabled, ...st,
      ...(r.locationId ? { locationId: String(r.locationId) } : {}),
      pricingOptions: [...(n(rental.hourlyCents) > 0 ? [{ frequency: 'hourly', amountCents: Math.round(n(rental.hourlyCents)) }] : []), ...(n(rental.dailyCents) > 0 ? [{ frequency: 'daily', amountCents: Math.round(n(rental.dailyCents)) }] : [])],
      rental: { graceMinutes: Math.max(0, n(rental.graceMinutes) || 10), blockMinutes: Math.max(5, n(rental.blockMinutes) || 15), minMinutes },
      // The shortest booking and the rates where every booking route reads them (hours; cents).
      dayUseMinHours: Math.round((minMinutes / 60) * 100) / 100,
      dayUseHourlyCents: Math.round(n(rental.hourlyCents)) || null, dayUseDailyCents: Math.round(n(rental.dailyCents)) || null,
      amenities: Array.isArray(r.amenities) ? r.amenities : [], description: r.description || null, updatedAt: now, ...(cur ? {} : { createdAt: now }) }, { merge: true });
  }
  // units beyond today's capacity (capacity was reduced) are retired
  const stale = (await db.collection(`${T}/booths`).where('mirrorOf', '==', resourceId).get()).docs.filter((d: any) => !ids.includes(d.id));
  for (const d of stale) batch.set(d.ref, { isActive: false, dayUseEnabled: false, retiredAt: now, ...spaceStatusFor(d.data(), { enabled: false, outOfService: false }) }, { merge: true });
  await batch.commit();
  return NextResponse.json({ ok: true, spaces: ids, enabled });
}
