// src/app/api/pay/stub/route.ts — one pay stub with every line (lib/pay-stub). { tenantId, from, staffId? }
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requestActor } from '@/lib/request-actor';
import { stubFor } from '@/lib/pay-stub';
import { periodOf } from '@/lib/pay-periods';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams; const tenantId = String(q.get('tenantId') || '').slice(0, 80); const from = String(q.get('from') || '');
  if (!tenantId || !/^\d{4}-\d{2}-\d{2}$/.test(from)) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const db = getAdminDb(); const who = await requestActor(db, req.headers.get('authorization'), tenantId);
  if (!who.ok) return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  const staffId = String(q.get('staffId') || who.actor.staffId);
  if (staffId !== who.actor.staffId && !who.actor.isManager) return NextResponse.json({ ok: false, error: 'You can only see your own pay.' }, { status: 403 });
  const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
  const p = periodOf(tenant, from); if (p.from !== from) return NextResponse.json({ ok: false, error: 'That isn’t the start of a pay period.' }, { status: 400 });
  if (from > new Date().toISOString().slice(0, 10)) return NextResponse.json({ ok: false, error: 'That period hasn’t started.' }, { status: 400 });
  const stub = await stubFor(db, tenantId, staffId, p);
  if (!stub) return NextResponse.json({ ok: false, error: 'Team member not found.' }, { status: 404 });
  return NextResponse.json({ ok: true, stub }, { headers: { 'Cache-Control': 'no-store' } });
}
