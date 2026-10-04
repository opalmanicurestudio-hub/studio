// src/app/api/funds/restocking/route.ts — the Restocking fund's picture for the Money page (managers).
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { restockingSummary } from '@/lib/restocking-fund';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80);
  const auth: any = tenantId ? await verifyStaffActor(req, tenantId) : null;
  if (!auth?.ok || !(auth.actor.isManager || auth.actor.isTenantOwner)) return NextResponse.json({ ok: false, error: 'Managers only.' }, { status: 403 });
  const db = getAdminDb(); const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
  return NextResponse.json({ ok: true, ...(await restockingSummary(db, tenantId, tenant, b.month ? String(b.month).slice(0, 7) : undefined)) });
}
