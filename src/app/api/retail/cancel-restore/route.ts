// src/app/api/retail/cancel-restore/route.ts — after the team cancels an order, give back the gift card and store
// credit it used (lib/cancel-restore). Staff only; does nothing unless the order really is cancelled.
// POST { tenantId, orderId }
import { NextRequest, NextResponse } from 'next/server';
import { verifyStaffActor } from '@/lib/staff-auth';
import { getAdminDb } from '@/lib/firebase-admin';
import { restoreNonCardPayment } from '@/lib/cancel-restore';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({} as any));
  const tenantId = String(b.tenantId || '').trim(); const orderId = String(b.orderId || '').trim();
  if (!tenantId || !orderId) return NextResponse.json({ error: 'Missing details.' }, { status: 400 });
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const r = await restoreNonCardPayment(getAdminDb(), tenantId, orderId, auth.actor.name);
    return NextResponse.json({ ok: true, ...r });
  } catch {
    // Nothing went back: the nightly check tries again.
    return NextResponse.json({ error: 'The gift card or store credit couldn’t be given back just now. It will be tried again tonight.' }, { status: 503 });
  }
}
