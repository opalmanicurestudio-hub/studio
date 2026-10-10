// src/app/api/pay/home/route.ts — the Pay tab: this period so far (day by day) and the paid stubs before it (lib/pay-stub).
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requestActor } from '@/lib/request-actor';
import { payHome } from '@/lib/pay-stub';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '').slice(0, 80);
  if (!tenantId) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const db = getAdminDb(); const who = await requestActor(db, req.headers.get('authorization'), tenantId);
  if (!who.ok) return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  const staffId = String(req.nextUrl.searchParams.get('staffId') || who.actor.staffId);
  if (staffId !== who.actor.staffId && !who.actor.isManager) return NextResponse.json({ ok: false, error: 'You can only see your own pay.' }, { status: 403 });
  const m: any = (await db.doc(`tenants/${tenantId}/staff/${staffId}`).get()).data();
  if (!m) return NextResponse.json({ ok: false, error: 'Team member not found.' }, { status: 404 });
  if (m.isRenter === true || m.role === 'renter') return NextResponse.json({ ok: false, error: 'Renters keep their own takings — there’s no pay stub.' }, { status: 400 });
  return NextResponse.json({ ok: true, ...(await payHome(db, tenantId, staffId)) }, { headers: { 'Cache-Control': 'no-store' } });
}
