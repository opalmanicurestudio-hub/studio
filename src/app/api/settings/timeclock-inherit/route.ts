// src/app/api/settings/timeclock-inherit/route.ts — ONE-TIME HAND-OVER of the clock-in address (owner / manager).
// The Time clock tab used to hold a studio address, map pin and clock-in / break-end radius, while each location
// holds its own — and the clock already used the location's first, falling back to the tab's. Before the tab's copy
// is removed, every business location that's MISSING one of those inherits it here, so nobody's clock-in rule changes.
// Fills in only what's missing; recorded on the business (timeclockInheritedAt) so it runs once.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { isBusinessLocation } from '@/lib/location-kind';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80);
  const auth: any = tenantId ? await verifyStaffActor(req, tenantId) : null;
  if (!auth?.ok) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  if (!auth.actor?.isManager) return NextResponse.json({ ok: false, error: 'Owners and managers only.' }, { status: 403 });
  const db = getAdminDb(); const tRef = db.doc(`tenants/${tenantId}`); const t: any = (await tRef.get()).data() || {};
  if (t.timeclockInheritedAt) return NextResponse.json({ ok: true, already: true });
  const pin = t.studioLocation && Number.isFinite(Number(t.studioLocation.lat)) && Number.isFinite(Number(t.studioLocation.lng)) ? { lat: Number(t.studioLocation.lat), lng: Number(t.studioLocation.lng) } : null;
  const clock = Number(t.geoFenceRadiusMeters) > 0 ? Math.round(Number(t.geoFenceRadiusMeters)) : null;
  const brk = Number(t.geoFenceBreakRadiusMeters) > 0 ? Math.round(Number(t.geoFenceBreakRadiusMeters)) : null;
  const addr = String(t.studioAddress || '').trim() || null;
  const locs = (await db.collection(`tenants/${tenantId}/locations`).get()).docs.filter((d: any) => isBusinessLocation({ id: d.id, ...(d.data() || {}) }));
  const batch = db.batch(); const changed: string[] = [];
  for (const d of locs) {
    const l: any = d.data() || {}; const patch: any = {};
    const hasPin = l.coordinates && Number.isFinite(Number(l.coordinates.lat)) && Number.isFinite(Number(l.coordinates.lng));
    if (!hasPin && pin) patch.coordinates = pin;
    if (!String(l.address || '').trim() && addr && !hasPin) patch.address = addr;   // the address that goes with the inherited pin
    if (!(Number(l.geoFenceRadiusMeters) > 0) && clock) patch.geoFenceRadiusMeters = clock;
    if (!(Number(l.geoFenceBreakRadiusMeters) > 0) && brk) patch.geoFenceBreakRadiusMeters = brk;
    if (Object.keys(patch).length) { batch.set(d.ref, { ...patch, updatedAt: new Date().toISOString() }, { merge: true }); changed.push(`${l.name || d.id}: ${Object.keys(patch).join(', ')}`); }
  }
  batch.set(tRef, { timeclockInheritedAt: new Date().toISOString() }, { merge: true });
  await batch.commit();
  return NextResponse.json({ ok: true, changed });
}
