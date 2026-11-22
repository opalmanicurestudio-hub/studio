// src/app/api/counter/lane-entry/route.ts — THE LANE ENTRY SENSOR'S LINK (lib/lane-entry-server). A sensor at the
// drive-thru's lane entry calls it each time a car passes: a vehicle loop or a driveway sensor through a smart relay, or
// a camera with line crossing. Sensors at the speaker, the pickup window and the exit call their own links here too.
// Most can only call a plain link, so it answers a GET as well as a POST:
//   GET|POST /api/counter/lane-entry?t={tenantId}&k={key}   → { ok, counted } (the same car seen twice in a moment: once)
// The key is the one shown once on the Menu page for that lane; it does nothing else anywhere. A key that isn't one gets
// the same answer as a business that isn't one, so the link gives nothing away.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { sensorCar } from '@/lib/lane-entry-server';

export const dynamic = 'force-dynamic';

// How often one address (or one link) may call, a minute: far more than any sensor at a lane entry, so a script calling
// it over and over is turned away before anything is read. (Kept on each server, so it costs no database read.)
const PER_MIN = 60, seen = new Map<string, { m: number; n: number }>();
function tooMany(id: string): boolean {
  const m = Math.floor(Date.now() / 60000); const x = seen.get(id);
  if (!x || x.m !== m) { if (seen.size > 5000) seen.clear(); seen.set(id, { m, n: 1 }); return false; }
  return ++x.n > PER_MIN;
}
const ipOf = (req: NextRequest) => String(req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown').split(',')[0].trim().slice(0, 64);

async function count(req: NextRequest, tenantId: string, key: string) {
  if (tooMany(`ip:${ipOf(req)}`) || tooMany(`k:${key.slice(0, 16)}`)) return NextResponse.json({ ok: false, error: 'Too many calls. Try again in a minute.' }, { status: 429 });
  try {
    const r = await sensorCar(getAdminDb(), tenantId, key);
    if (!r.ok) return NextResponse.json({ ok: false, error: 'That link isn’t set up. Make a new one on the Menu page.' }, { status: 404 });
    // (`point`: a sensor further along the lane, lib/lane-entry SENSOR_POINTS.)
    return NextResponse.json({ ok: true, lane: r.lane, counted: r.counted, ...(r.point ? { point: r.point } : {}) });
  } catch {
    return NextResponse.json({ ok: false, error: 'That didn’t count. The sensor can try again.' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  return count(req, String(q.get('t') || ''), String(q.get('k') || ''));
}

export async function POST(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const b: any = await req.json().catch(() => ({}));
  return count(req, String(b?.tenantId || q.get('t') || ''), String(b?.key || q.get('k') || ''));
}
