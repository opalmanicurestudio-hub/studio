// src/app/api/retail/return-credit/route.ts — settle a checked-in return with store credit (lib/return-credit). The
// server works out how much and who it's for; the returns desk only says which return. Anyone on the team except
// renters, who run their own business.
// POST { tenantId, returnId }
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { resolveCreditReturn } from '@/lib/return-credit';
import { verifyStaffActor } from '@/lib/staff-auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({} as any));
  const tenantId = String(b.tenantId || '').trim(); const returnId = String(b.returnId || '').trim();
  if (!tenantId || !returnId) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const a: any = auth.actor;
  if (a.isRenter) return NextResponse.json({ ok: false, error: 'Returns are settled by the shop’s team.' }, { status: 403 });
  try {
    const r = await resolveCreditReturn(getAdminDb(), tenantId, returnId, { uid: String(a.uid), name: String(a.name || 'A team member'), isManager: a.isManager === true });
    return NextResponse.json(r.ok ? r : { ...r, error: r.message }, { status: r.ok ? 200 : r.status || 400 });
  } catch {
    return NextResponse.json({ ok: false, error: 'The store credit couldn’t be issued just now. Nothing was added, so try again.' }, { status: 500 });
  }
}
