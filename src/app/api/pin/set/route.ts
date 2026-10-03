// src/app/api/pin/set/route.ts — SET A TEAM MEMBER'S PIN (owners & managers). { tenantId, staffId, pin, checkOnly? }
// Uniqueness is checked here, privately — no screen ever sees anyone else's PIN.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { setStaffPin } from '@/lib/pin';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80);
  const auth: any = tenantId ? await verifyStaffActor(req, tenantId) : null;
  if (!auth?.ok) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  if (!auth.actor?.isManager && !auth.actor?.isTenantOwner) return NextResponse.json({ ok: false, error: 'Only owners and managers can set PINs.' }, { status: 403 });
  const r = await setStaffPin(getAdminDb(), tenantId, String(b.staffId || '').slice(0, 120), String(b.pin || ''), { checkOnly: b.checkOnly === true });
  return NextResponse.json(r, { status: r.ok ? 200 : 409 });
}
