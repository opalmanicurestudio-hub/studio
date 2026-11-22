// src/app/api/drive-live/route.ts — DRIVE-THRU LIVE (lib/drive-live-server; the Drive-thru live page). Everyone on the
// team, signed in, can watch the lane: a manager's phone, a screen in the back, the owner at home. Nothing here moves a
// car; that's the lane screen's and the windows' (api/counter).
//   now { tenantId, locationId? } → { live }: every car in the lane now, those waiting to order, and curbside, orders
//        placed ahead and the counter underneath; with more than one location, the one asked for (or the whole business)
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { liveNow } from '@/lib/drive-live-server';
import { bizLocationsOf, hereOf, zoneOf } from '@/lib/here-server';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  try {
    const b: any = await req.json().catch(() => ({}));
    const tenantId = String(b.tenantId || ''); if (!ID.test(tenantId)) return bad('Which business?');
    if (String(b.action || 'now') !== 'now') return bad('Unknown action.');
    const g: any = await requireRole(req, tenantId, 'staff'); if (g.deny) return g.deny;
    // (Renters run their own business here, not the drive-thru.)
    if (g.actor?.isRenter) return bad('This is for the business’s team.', 403);
    const db = getAdminDb();
    const tenant: any = g.tenant && Object.keys(g.tenant).length ? g.tenant : (await db.doc(`tenants/${tenantId}`).get()).data() || {};
    const here = await hereOf(db, tenantId, b.locationId);
    const places = await bizLocationsOf(db, tenantId);
    const place = here ? places.find((l) => l.id === here) || null : null;
    // (A location in another time zone: its own clock, for when orders placed ahead are due.)
    const live = await liveNow(db, tenantId, tenant, here, { locationName: place?.name || null, timeZone: zoneOf(tenant, place) });
    // (The clock as it answers, not as it was read: the page times every car from it.)
    return NextResponse.json({ ok: true, live: { ...live, now: new Date().toISOString() }, places: places.length > 1 ? places.map((l) => ({ id: l.id, name: l.name })) : [] });
  } catch (e: any) {
    console.error('[drive-live]', e?.message);
    return bad('The lane didn’t load. Trying again.', 500);
  }
}
