// src/app/api/drive-live/route.ts — DRIVE-THRU LIVE (lib/drive-live-server; the Drive-thru live page). Everyone on the
// team, signed in, can watch the lane: a manager's phone, a screen in the back, the owner at home. Nothing here moves a
// car; that's the lane screen's and the windows' (api/counter).
//   now { tenantId, locationId? } → { live }: every car in the lane now, those waiting to order, and curbside, orders
//        placed ahead and the counter underneath; with more than one location, the one asked for (or the whole business)
//   speed { tenantId, ch, range, locationId? } → { report, alert, sensors }: speed of service (lib/speed, lib/speed-server)
//        for the drive-thru, the counter, curbside or pickups ahead, over today, 7 days or 30; when a car waiting too long
//        buzzes the shift lead; and which sensors along the lane are set up
//   alert { tenantId, sec } → the long wait alert: 240, 300, or 0 for off (a manager)
//   goals { tenantId, menu?, pay?, service?, perHour? } → the scoreboard's goals (lib/scoreboard; a manager)
//   caught { tenantId, range, locationId? } → { report }: what the check before an order to go caught, by shift, over
//        today, 7 days or 30 (lib/bag-caught): wrong items, orders held for something missing, those let go with a PIN
//        (who okayed it for managers only), and labels or stickers with no code
import { NextRequest, NextResponse, after } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { liveNow } from '@/lib/drive-live-server';
import { bizLocationsOf, hereOf, zoneOf } from '@/lib/here-server';
import { speedFor } from '@/lib/speed-server';
import { longWaitOf, LONG_WAITS, SPEED_CHS, SPEED_RANGES, type SpeedCh, type SpeedRange } from '@/lib/speed';
import { boardNow, forgetBoard } from '@/lib/scoreboard-server';
import { cleanGoals, goalsOf } from '@/lib/scoreboard';
import { targetsOf } from '@/lib/counter-orders';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  try {
    const b: any = await req.json().catch(() => ({}));
    const tenantId = String(b.tenantId || ''); if (!ID.test(tenantId)) return bad('Which business?');
    const action = String(b.action || 'now');
    if (!['now', 'speed', 'alert', 'goals', 'caught'].includes(action)) return bad('Unknown action.');
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
    if (action === 'goals') {
      // (A manager sets the scoreboard's goals; the lane total is the drive-thru target, set on the Menu page.)
      if (!isManager(g.actor)) return bad('Only a manager changes the goals.', 403);
      const c = cleanGoals(b); if ('error' in c) return bad(c.error);
      if (Object.keys(c).length) await db.doc(`tenants/${tenantId}`).set({ driveThru: { goals: c } }, { merge: true });
      forgetBoard(tenantId);
      const fresh: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
      return NextResponse.json({ ok: true, goals: goalsOf(fresh, targetsOf(fresh)['drive-thru']) });
    }
    if (action === 'caught') {
      const range = (SPEED_RANGES.some((x) => x.id === b.range) ? b.range : 'today') as SpeedRange;
      const { caughtFor } = await import('@/lib/bag-caught-server');
      const report = await caughtFor(db, tenantId, tenant, here, range, zoneOf(tenant, place), isManager(g.actor));
      return NextResponse.json({ ok: true, report, manager: isManager(g.actor), scanOn: tenant?.bagCheck?.off !== true });
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
      return NextResponse.json({ ok: true, report, timeZone: tz, alert: { sec: longWaitOf(tenant), canChange: isManager(g.actor) }, sensors, lanes: lanesOf(tenant), goals: goalsOf(tenant, targetsOf(tenant)['drive-thru']) });
    }
    // (A location in another time zone: its own clock, for when orders placed ahead are due.)
    const tzHere = zoneOf(tenant, place);
    const [live, board] = await Promise.all([
      liveNow(db, tenantId, tenant, here, { locationName: place?.name || null, timeZone: tzHere }),
      // The scoreboard over the lane (lib/scoreboard): never holds the lane up if it can't be read.
      boardNow(db, tenantId, tenant, here, tzHere, { several: places.length > 1, later: typeof after === 'function' ? (work) => after(work) : undefined }).catch((e: any) => { console.error('[drive-live] board', e?.message); return null; }),
    ]);
    // (The clock as it answers, not as it was read: the page times every car from it.)
    return NextResponse.json({ ok: true, live: { ...live, now: new Date().toISOString() }, board, places: places.length > 1 ? places.map((l) => ({ id: l.id, name: l.name })) : [] });
  } catch (e: any) {
    console.error('[drive-live]', e?.message);
    return bad('The lane didn’t load. Trying again.', 500);
  }
}
