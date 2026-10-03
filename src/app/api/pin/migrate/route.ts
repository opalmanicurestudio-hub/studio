// src/app/api/pin/migrate/route.ts — CONVERT THIS BUSINESS'S PINS (owners & managers; the Staff page runs it once).
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { migrateTenantPins } from '@/lib/pin';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80);
  const auth: any = tenantId ? await verifyStaffActor(req, tenantId) : null;
  if (!auth?.ok || (!auth.actor?.isManager && !auth.actor?.isTenantOwner)) return NextResponse.json({ ok: false, error: 'Only owners and managers.' }, { status: 403 });
  return NextResponse.json({ ok: true, ...(await migrateTenantPins(getAdminDb(), tenantId)) });
}
