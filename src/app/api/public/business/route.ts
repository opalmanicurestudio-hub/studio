// src/app/api/public/business/route.ts — A BUSINESS AS ANYONE MAY SEE IT (lib/public-business). The booking page, the
// client portal, the walk-in screen, job applications and guest links load the business from here rather than reading
// its whole record from the database: the server reads the live record and hands back only the public details.
// Kept 15 seconds here and at the edge (and served while it's fetched again for 15 more), so a saved setting, or a
// business that's closed, shows within about half a minute. The owner's own preview of the booking page (Settings,
// Booking page) asks for it fresh, so a saved change shows there at once; a fresh read is shared for 2 seconds, so
// asking for it fresh over and over still reads the record at most once every 2 seconds.
//   GET /api/public/business?business=<tenantId>[&fresh=<anything>]
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { publicBusiness, type PublicBusiness } from '@/lib/public-business';
export const dynamic = 'force-dynamic';

const KEEP_MS = 15000, FRESH_MS = 2000;
const H = { 'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=15' };
const NONE = { 'Cache-Control': 'no-store' };
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const kept = new Map<string, { at: number; v: PublicBusiness | null }>();
const reading = new Map<string, Promise<PublicBusiness | null>>();

async function load(tenantId: string, fresh = false): Promise<PublicBusiness | null> {
  const hit = kept.get(tenantId); if (hit && Date.now() - hit.at < (fresh ? FRESH_MS : KEEP_MS)) return hit.v;
  // (A read already under way is moments old, fresh enough for anyone.)
  const busy = reading.get(tenantId); if (busy) return busy;
  const started = Date.now();
  const p: Promise<PublicBusiness | null> = (async () => {
    const snap = await getAdminDb().doc(`tenants/${tenantId}`).get();
    const v = snap.exists ? publicBusiness(tenantId, snap.data()) : null;
    // (Never over a newer answer.)
    // (Not found isn't kept either: a business just set up shows at once.)
    const cur = kept.get(tenantId); if (!v) kept.delete(tenantId); else if (!cur || cur.at <= started) kept.set(tenantId, { at: started, v });
    if (kept.size > 2000) kept.delete(kept.keys().next().value as string);
    return v;
  })().finally(() => { if (reading.get(tenantId) === p) reading.delete(tenantId); });
  reading.set(tenantId, p);
  return p;
}

export async function GET(req: NextRequest) {
  const tenantId = String(req.nextUrl.searchParams.get('business') || '');
  if (!ID.test(tenantId)) return NextResponse.json({ ok: false, error: 'Which business?' }, { status: 400 });
  try {
    const fresh = req.nextUrl.searchParams.has('fresh');
    const business = await load(tenantId, fresh);
    // (Not found isn't kept at the edge: a business just set up shows at once.)
    if (!business) return NextResponse.json({ ok: false, error: 'We couldn’t find this business.' }, { status: 404, headers: NONE });
    return NextResponse.json({ ok: true, business }, { headers: fresh ? NONE : H });
  } catch (e: any) {
    console.error('[public-business]', tenantId, String(e?.message || e).slice(0, 160));
    return NextResponse.json({ ok: false, error: 'This page couldn’t load. Try again in a moment.' }, { status: 503 });
  }
}
