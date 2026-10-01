// src/app/api/locations/create/route.ts — THE ONLY WAY TO OPEN A NEW BUSINESS LOCATION.
//   allowance { tenantId }          → what this business may do (1 included; more need a subscription; HQ grants)
//   create    { tenantId, name, … } → owner/manager only; re-checks the limit at the moment of creation, creates the
//                                     location, then updates the ClarityFlow subscription so the extra one is billed.
// Browsers can't create business locations directly (firestore.rules allows them only inventory storage areas).
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { locationAllowance } from '@/lib/location-allowance';
export const dynamic = 'force-dynamic';

const str = (v: any, n: number) => String(v ?? '').trim().slice(0, n);

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = str(b.tenantId, 80);
  if (!tenantId) return NextResponse.json({ ok: false, error: 'Missing business.' }, { status: 400 });
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth?.ok) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  const db = getAdminDb();
  if (b.action === 'allowance') return NextResponse.json({ ok: true, allowance: await locationAllowance(db, tenantId) });
  if (b.action !== 'create') return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  if (!auth.actor?.isManager && !auth.actor?.isTenantOwner) return NextResponse.json({ ok: false, error: 'Only the owner or a manager can add a location.' }, { status: 403 });
  const name = str(b.name, 80); if (!name) return NextResponse.json({ ok: false, error: 'Give the location a name.' }, { status: 400 });
  const allow = await locationAllowance(db, tenantId);
  if (!allow.canAdd) return NextResponse.json({ ok: false, needsSubscription: true, error: allow.reason, allowance: allow }, { status: 402 });
  const now = new Date().toISOString();
  const loc: any = { tenantId, name, timezone: str(b.timezone, 60) || 'America/New_York', isActive: true, createdAt: now, updatedAt: now, createdBy: auth.actor?.name || null };
  if (b.address) loc.address = str(b.address, 300);
  if (b.addressParts && typeof b.addressParts === 'object') loc.addressParts = b.addressParts;
  if (b.coordinates && Number.isFinite(Number(b.coordinates.lat)) && Number.isFinite(Number(b.coordinates.lng))) loc.coordinates = { lat: Number(b.coordinates.lat), lng: Number(b.coordinates.lng) };
  for (const k of ['geoFenceRadiusMeters', 'geoFenceBreakRadiusMeters']) if (Number.isFinite(Number(b[k])) && Number(b[k]) > 0) loc[k] = Math.round(Number(b[k]));
  const ref = db.collection(`tenants/${tenantId}/locations`).doc(); await ref.set(loc);
  let billing: string | null = null;
  if (allow.extraMonthly) {   // subscribed + beyond the included/granted ones → add it to the subscription (prorated)
    try { const { syncSubscription } = await import('@/lib/billing'); const r: any = await syncSubscription(tenantId); billing = r?.changed ? `Your subscription now includes this location (+$${allow.extraMonthly}/month, prorated).` : null; }
    catch (e: any) { console.error('[locations/create] billing sync', e?.message); billing = 'Location added — we’ll update your subscription shortly.'; }
  }
  return NextResponse.json({ ok: true, id: ref.id, billing });
}
