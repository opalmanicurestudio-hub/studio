// src/app/api/staff/move-pay/route.ts — move pay rates off the staff records the whole team can read, into staffPay
// (lib/staff-pay). Owner only. Safe to run more than once.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requestActor } from '@/lib/request-actor';
import { movePayOff } from '@/lib/staff-pay-server';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80);
  const db = getAdminDb(); const who = await requestActor(db, req.headers.get('authorization'), tenantId);
  if (!who.ok) return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  if (!who.actor.isOwner) return NextResponse.json({ ok: false, error: 'Only the owner can do this.' }, { status: 403 });
  const moved = await movePayOff(db, tenantId);
  return NextResponse.json({ ok: true, moved });
}
