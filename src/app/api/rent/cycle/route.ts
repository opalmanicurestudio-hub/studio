// src/app/api/rent/cycle/route.ts — "Run rent cycle" (managers): catch-up invoices for every active lease, and the old
// ledger charges folded into invoices. Safe to run any time; it never creates a second invoice for the same due date.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { runRentCycle, migrateLedger } from '@/lib/rent-cycle';
import { todayIn, tenantTimeZone } from '@/lib/tenant-time';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80);
  const auth: any = tenantId ? await verifyStaffActor(req, tenantId) : null;
  if (!auth?.ok || !(auth.actor.isManager || auth.actor.isTenantOwner)) return NextResponse.json({ ok: false, error: 'Managers only.' }, { status: 403 });
  const db = getAdminDb(); const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {}; const today = todayIn(tenantTimeZone(tenant));
  const migrated = await migrateLedger(db, tenantId, today); const r = await runRentCycle(db, tenantId, today, auth.actor.name || 'owner');
  return NextResponse.json({ ok: true, ...r, migrated });
}
