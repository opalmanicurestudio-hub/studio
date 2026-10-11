// src/app/api/refund-payouts/route.ts — the desk's side of cash refunds (lib/refund-payouts). Front desk, managers and
// the owner only. Actions: create · windows · choose · note · printed · resend · till · counted · return_till · missed ·
// handover · sent · cancel.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requestActor } from '@/lib/request-actor';
import { staffAct } from '@/lib/refund-payouts';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80);
  if (!tenantId) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const db = getAdminDb(); const who = await requestActor(db, req.headers.get('authorization'), tenantId);
  if (!who.ok) return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  const a: any = who.actor;
  if (!(a.isManager || a.isOwner || ['front_desk', 'owner', 'admin', 'manager'].includes(String(a.role)))) return NextResponse.json({ ok: false, error: 'The front desk or a manager handles refunds.' }, { status: 403 });
  const r: any = await staffAct(db, tenantId, a, b);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
