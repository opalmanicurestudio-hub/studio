// src/app/api/portal/business/route.ts — THE BUSINESS, AS A RENTER'S PORTAL SEES IT (lib/public-business renterBusiness,
// design board "Renters off the full record"). Renters signed in to the team portal can't read the business's record
// from the database (it holds the team's pay rules, margins, limits and roles), so their screens ask here.
//   GET ?tenantId → { ok, business }: the public view plus the few settings a renter's screens use. Anyone signed in to
//       this business's portal or app may ask (the team reads the full record itself, so this is never more than they see).
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requestActor } from '@/lib/request-actor';
import { renterBusiness } from '@/lib/public-business';
export const dynamic = 'force-dynamic';

const NONE = { 'Cache-Control': 'no-store' };

export async function GET(req: NextRequest) {
  const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId)) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400, headers: NONE });
  try {
    const db = getAdminDb(); const who = await requestActor(db, req.headers.get('authorization'), tenantId);
    if (!who.ok) return NextResponse.json({ ok: false, error: who.error }, { status: who.status, headers: NONE });
    const snap = await db.doc(`tenants/${tenantId}`).get();
    if (!snap.exists) return NextResponse.json({ ok: false, error: 'We couldn’t find that business.' }, { status: 404, headers: NONE });
    return NextResponse.json({ ok: true, business: renterBusiness(tenantId, snap.data()) }, { headers: NONE });
  } catch {
    return NextResponse.json({ ok: false, error: 'That didn’t load. Try again in a moment.' }, { status: 503, headers: NONE });
  }
}
