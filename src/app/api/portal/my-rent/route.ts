// src/app/api/portal/my-rent/route.ts — the signed-in person's own rent picture (lib/my-rent), for the portal's Rent tab.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requestActor } from '@/lib/request-actor';
import { myRent } from '@/lib/my-rent';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '').slice(0, 80);
  if (!tenantId) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const db = getAdminDb(); const who = await requestActor(db, req.headers.get('authorization'), tenantId);
  if (!who.ok) return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  return NextResponse.json({ ok: true, ...(await myRent(db, tenantId, who.actor.staffId)) }, { headers: { 'Cache-Control': 'no-store' } });
}
