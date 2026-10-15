// src/app/api/pay/clarity/route.ts — "What my time is worth" (lib/pay-clarity-server). Always the signed-in person's own:
// nobody — not a manager, not the owner — can read or change someone else's goal, costs or comparisons here.
//   POST { tenantId, action: 'mine', range: '4w'|'3m'|'1y' } · { tenantId, action: 'save', goalMonthly?, costs?, plans? }
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requestActor } from '@/lib/request-actor';
import { myClarity, savePrivate } from '@/lib/pay-clarity-server';
export const dynamic = 'force-dynamic'; export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80);
  if (!tenantId) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const db = getAdminDb(); const who = await requestActor(db, req.headers.get('authorization'), tenantId);
  if (!who.ok) return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  const staffId = String(who.actor.staffId || ''); if (!staffId) return NextResponse.json({ ok: false, error: 'This is for people on the team.' }, { status: 403 });
  const m: any = (await db.doc(`tenants/${tenantId}/staff/${staffId}`).get()).data();
  if (!m) return NextResponse.json({ ok: false, error: 'Team member not found.' }, { status: 404 });
  if (m.isRenter === true || m.role === 'renter') return NextResponse.json({ ok: false, error: 'Renters keep their own takings, so there’s no pay to look at here.' }, { status: 400 });
  if (b.action === 'save') { const priv = await savePrivate(db, tenantId, staffId, b); return NextResponse.json({ ok: true, private: priv }); }
  return NextResponse.json(await myClarity(db, tenantId, staffId, String(b.range || '4w')), { headers: { 'Cache-Control': 'no-store' } });
}
