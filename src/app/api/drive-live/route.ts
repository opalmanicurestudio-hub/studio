// src/app/api/drive-live/route.ts — DRIVE-THRU LIVE (lib/drive-live-server; the Drive-thru live page). Everyone on the
// team, signed in, can watch the lane: a manager's phone, a screen in the back, the owner at home. Nothing here moves a
// car; that's the lane screen's and the windows' (api/counter).
//   now { tenantId, locationId? } → { live }: every car in the lane now, those waiting to order, and curbside, orders
//        placed ahead and the counter underneath; with more than one location, the one asked for (or the whole business)
//   speed { tenantId, ch, range, locationId? } → { report, alert, sensors }: speed of service (lib/speed, lib/speed-server)
//        for the drive-thru, the counter, curbside or pickups ahead, over today, 7 days or 30; when a car waiting too long
//        buzzes the shift lead; and which sensors along the lane are set up
//   alert { tenantId, sec } → the long wait alert: 240, 300, or 0 for off (a manager)
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { liveNow } from '@/lib/drive-live-server';
import { bizLocationsOf, hereOf, zoneOf } from '@/lib/here-server';
import { speedFor } from '@/lib/speed-server';
import { longWaitOf, LONG_WAITS, SPEED_CHS, SPEED_RANGES, type SpeedCh, type SpeedRange } from '@/lib/speed';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  try {
    const b: any = await req.json().catch(() => ({}));
    const tenantId = String(b.tenantId || ''); if (!ID.test(tenantId)) return bad('Which business?');
    const action = String(b.action || 'now');
    if (!['now', 'speed', 'alert'].includes(action)) return bad('Unknown action.');
    const g: any = await requireRole(req, tenantId, 'staff'); if (g.deny) return g.deny;
    // (Renters run their own business here, not the drive-thru.)
    if (g.actor?.isRenter) return bad('This is for the business’s team.', 403);
    const db = getAdminDb();
    const tenant: any = g.tenant && Object.keys(g.tenant).length ? g.tenant : (await db.doc(`tenants/${tenantId}`).get()).data() || {};
    const here = await hereOf(db, tenantId, b.locationId);
    const places = await bizLocationsOf(db, tenantId);
    const place = here ? places.find((l) => l.id === here) || null : null;
    const isManager = (a: any) => !!a && (a.isTenantOwner === true || a.isManager === true || ['owner', 'admin', 'manager'].includes(String(a.role || '').toLowerCase()));
    if (action === 'alert') {
      // (A manager chooses when the shift lead hears about a car waiting too long.)
      if (!isManager(g.actor)) return bad('Only a manager changes this.', 403);
      const sec = Number(b.sec); if (!LONG_WAITS.some((x) => x.sec === sec)) return bad('4:00, 5:00, or off.');
      await db.doc(`tenants/${tenantId}`).set({ driveThru: { longWaitSec: sec } }, { merge: true });
      return NextResponse.json({ ok: true, alert: { sec } });
    }
    if (action === 'speed') {
      const ch = (SPEED_CHS.some((x) => x.id === b.ch) ? b.ch : 'drive') as SpeedCh;
      const range = (SPEED_RANGES.some((x) => x.id === b.range) ? b.range : '7') as SpeedRange;
      const tz = zoneOf(tenant, place);
      const report = await speedFor(db, tenantId, tenant, here, ch, range, tz);
      // Which sensors along the lane are set up, and when each last saw a car (never their links: the Menu page).
      const { sensorsView, pointsView } = await import('@/lib/lane-entry-server');
      const { lanesOf } = await import('@/lib/drive-lanes');
      const pl = places.length > 1 ? places.map((l) => ({ id: l.id, name: l.name })) : [];
      const [entry, points] = await Promise.all([sensorsView(db, tenantId, tenant, pl), pointsView(db, tenantId, lanesOf(tenant) === 2, pl)]);
      const mine = (x: any) => places.length < 2 || !here || x.locationId === here;
      const sensors = [...entry.filter((x: any) => mine(x) && (x.lane === 1 || lanesOf(tenant) === 2)).map((x: any) => ({ point: 'entry', lane: x.lane, on: x.on, lastAt: x.lastAt })), ...points.filter(mine).map((x: any) => ({ point: x.point, lane: x.lane, on: x.on, lastAt: x.lastAt }))];
      return NextResponse.json({ ok: true, report, timeZone: tz, alert: { sec: longWaitOf(tenant), canChange: isManager(g.actor) }, sensors, lanes: lanesOf(tenant) });
    }
    // (A location in another time zone: its own clock, for when orders placed ahead are due.)
    const live = await liveNow(db, tenantId, tenant, here, { locationName: place?.name || null, timeZone: zoneOf(tenant, place) });
    // (The clock as it answers, not as it was read: the page times every car from it.)
    return NextResponse.json({ ok: true, live: { ...live, now: new Date().toISOString() }, places: places.length > 1 ? places.map((l) => ({ id: l.id, name: l.name })) : [] });
  } catch (e: any) {
    console.error('[drive-live]', e?.message);
    return bad('The lane didn’t load. Trying again.', 500);
  }
}
