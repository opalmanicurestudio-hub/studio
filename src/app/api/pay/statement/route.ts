// src/app/api/pay/statement/route.ts — a pay statement for one person and period (lib/pay-statement).
//   { tenantId, staffId?, from, to } — anyone may see their own; managers may see anyone's. Renters have no payroll.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requestActor } from '@/lib/request-actor';
import { statementFor } from '@/lib/pay-statement';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80);
  const from = String(b.from || ''), to = String(b.to || '');
  if (!tenantId || !Date.parse(from) || !Date.parse(to) || Date.parse(to) < Date.parse(from) || Date.parse(to) - Date.parse(from) > 93 * 86400000) return NextResponse.json({ ok: false, error: 'Choose a period of up to three months.' }, { status: 400 });
  const db = getAdminDb(); const who = await requestActor(db, req.headers.get('authorization'), tenantId);
  if (!who.ok) return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  const staffId = String(b.staffId || who.actor.staffId);
  if (staffId !== who.actor.staffId && !who.actor.isManager) return NextResponse.json({ ok: false, error: 'You can only see your own pay.' }, { status: 403 });
  const m: any = (await db.doc(`tenants/${tenantId}/staff/${staffId}`).get()).data();
  if (m?.isRenter === true || m?.role === 'renter') return NextResponse.json({ ok: false, error: 'Renters keep their own takings — there’s no pay statement.' }, { status: 400 });
  const st = await statementFor(db, tenantId, staffId, new Date(from).toISOString(), new Date(to).toISOString());
  if (!st) return NextResponse.json({ ok: false, error: 'Team member not found.' }, { status: 404 });
  const { line, ...rest } = st;
  return NextResponse.json({ ok: true, statement: { ...rest, hours: line.hours, overtimeHours: line.overtimeHours, weeks: line.weeks } });
}
