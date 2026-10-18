// src/app/api/retail/renter-credit/route.ts — KEEP RENTERS' SHOP CREDITS IN STEP WITH AN ORDER. Called after an order
// is handed over or shipped, and after a return is checked in. For each line sold for a renter, the credit on their
// rent account (one per line, `rs-{orderId}-{lineId}`) is set to their share of what reached the customer and wasn't
// returned (lib/renter-sales). If a credit already came off their rent and is now too big, the difference is flagged
// for the owner rather than taken back silently. Staff only. POST { tenantId, orderId }
import { NextRequest, NextResponse } from 'next/server';
import { verifyStaffActor } from '@/lib/staff-auth';
import { getAdminDb } from '@/lib/firebase-admin';
import { syncRenterCreditsForOrder } from '@/lib/renter-sales-server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({} as any));
  const tenantId = String(b.tenantId || '').trim(); const orderId = String(b.orderId || '').trim();
  if (!tenantId || !orderId) return NextResponse.json({ error: 'Missing details.' }, { status: 400 });
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const changed = await syncRenterCreditsForOrder(getAdminDb(), tenantId, orderId, auth.actor.name);
  return NextResponse.json({ ok: true, changed });
}
