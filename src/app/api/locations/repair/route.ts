// src/app/api/locations/repair/route.ts — RESTORE THE MAIN LOCATION (owner, server-side).
// After a clean-up of "ghost" locations (old inventory storage areas that used to show as locations), a business can be
// left with no business location — every screen then waits on one, and adding one from the browser fails if the rules
// don't recognise the owner. This runs on the server, so nothing can block it:
//   1. proves ownership (tenants.userId == me, or users/{me}.tenantId == this business) and fills in a missing userId;
//   2. recreates `locations/primary` (name + time zone from the business) if no business location exists;
//   3. re-points anything still aimed at a deleted location to the main one, so nothing stays hidden.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';
import { DEFAULT_LOCATION_DOC_ID, isBusinessLocation } from '@/lib/location-kind';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const REFS = ['booths', 'renters', 'leases', 'bookings', 'appointments', 'tickets', 'rentLedger'];

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '');
  const tk = String(req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!tenantId || !tk) return NextResponse.json({ ok: false, error: 'Please sign in.' }, { status: 401 });
  let uid = ''; try { uid = (await getAdminAuth().verifyIdToken(tk)).uid; } catch { return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 }); }
  const db = getAdminDb(); const T = `tenants/${tenantId}`; const now = new Date().toISOString();
  const tRef = db.doc(T); const tenant: any = (await tRef.get()).data();
  if (!tenant) return NextResponse.json({ ok: false, error: 'Business not found.' }, { status: 404 });
  const userRec: any = (await db.doc(`users/${uid}`).get()).data() || {};
  const owner = tenant.userId === uid || (!tenant.userId && (userRec.tenantId === tenantId || (Array.isArray(userRec.tenantIds) && userRec.tenantIds.includes(tenantId))));
  if (!owner) return NextResponse.json({ ok: false, error: 'Only the business owner can do this.' }, { status: 403 });
  const done: string[] = [];
  if (!tenant.userId) { await tRef.set({ userId: uid, userIdRepairedAt: now, userIdRepairedFrom: 'users' }, { merge: true }); done.push('Your business now recognises you as its owner (userId was missing).'); }
  // 2) a business location must exist
  const all = (await db.collection(`${T}/locations`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
  let business = all.filter(isBusinessLocation);
  let mainId = business.find((l: any) => l.id === DEFAULT_LOCATION_DOC_ID)?.id || tenant.primaryLocationId && business.find((l: any) => l.id === tenant.primaryLocationId)?.id || business[0]?.id;
  if (!mainId) {
    const tz = String(tenant.timezone || tenant.timeZone || tenant.settings?.timezone || 'America/New_York');
    const loc: any = { tenantId, name: String(tenant.name || tenant.businessName || 'Main location'), timezone: tz, isActive: true, createdAt: now, updatedAt: now, restoredAt: now };
    if (tenant.address) loc.address = String(tenant.address);
    await db.doc(`${T}/locations/${DEFAULT_LOCATION_DOC_ID}`).set(loc, { merge: true });
    mainId = DEFAULT_LOCATION_DOC_ID; business = [{ id: mainId, ...loc }];
    done.push(`Main location restored: “${loc.name}” (${tz}).`);
  }
  if (tenant.primaryLocationId !== mainId) await tRef.set({ primaryLocationId: mainId }, { merge: true });
  // 3) re-point anything aimed at a location that no longer exists
  const valid = new Set<string>(all.map((l: any) => l.id).concat([mainId]));
  let moved = 0;
  for (const col of REFS) {
    let docs: any[] = [];
    try { docs = (await db.collection(`${T}/${col}`).where('locationId', '>', '').get()).docs; } catch { continue; }
    const stale = docs.filter((d: any) => { const l = (d.data() || {}).locationId; return typeof l === 'string' && l.trim() !== '' && !valid.has(l); });   // only records that HAVE a location
    for (let i = 0; i < stale.length; i += 400) { const batch = db.batch(); stale.slice(i, i + 400).forEach((d: any) => batch.set(d.ref, { locationId: mainId, locationRepairedAt: now }, { merge: true })); await batch.commit(); }
    moved += stale.length;
  }
  const staff = (await db.collection(`${T}/staff`).get()).docs;
  let staffFixed = 0;
  for (const d of staff) { const ids: string[] = Array.isArray((d.data() || {}).locationIds) ? d.data().locationIds : [];
    if (!ids.length) continue; const keep = ids.filter((x) => valid.has(x)); const next = keep.length ? keep : [mainId];
    if (next.length !== ids.length || next.some((x, i) => x !== ids[i])) { await d.ref.set({ locationIds: next }, { merge: true }); staffFixed++; } }
  if (moved) done.push(`${moved} record${moved === 1 ? '' : 's'} pointing at a deleted location now ${moved === 1 ? 'points' : 'point'} at the main location.`);
  if (staffFixed) done.push(`Location access updated for ${staffFixed} staff member${staffFixed === 1 ? '' : 's'}.`);
  if (!done.length) done.push('Everything already looks right — your main location exists and nothing points at a deleted one.');
  return NextResponse.json({ ok: true, mainLocationId: mainId, done });
}
