import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { staffOrServer } from '@/lib/route-guard';
import { sendCarrierUpdate } from '@/lib/shipping-notify';

// ─── /api/retail/shipped-notify ──────────────────────────────────────────────
// "Your order is on its way" when staff type tracking from a label bought elsewhere. Labels bought in the app are
// announced by the carrier's first scan instead (shippo-webhook), so this only sends for orders without one. Uses the
// same message and the same once-only marker as the carrier's in-transit update, so a customer never gets both.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const b: any = await req.json().catch(() => ({}));
    const tenantId = String(b.tenantId || '').trim(); const orderId = String(b.orderId || '').trim();
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId) || !/^[A-Za-z0-9_-]{1,80}$/.test(orderId)) return NextResponse.json({ ok: false }, { status: 400 });
    if (!(await staffOrServer(req, tenantId))) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
    const db = getAdminDb();
    const ref = db.doc(`tenants/${tenantId}/retailOrders/${orderId}`);
    const [os, ts] = await Promise.all([ref.get(), db.doc(`tenants/${tenantId}`).get()]);
    const order: any = os.data(); if (!order || order.stage !== 'shipped' || !order.trackingNumber || order.shippoTransactionId) return NextResponse.json({ ok: true, sent: false });
    const r = await sendCarrierUpdate({ markerRef: ref.collection('events').doc('carrier-transit'), order, tenant: ts.data() || {}, origin: req.nextUrl.origin, tenantId, orderId, db,
      update: { status: 'TRANSIT' as any, carrier: String(order.carrier || ''), trackingNumber: String(order.trackingNumber), trackingUrl: order.trackingUrl || undefined } });
    return NextResponse.json({ ok: true, sent: (r as any)?.ok === true });
  } catch (e: any) {
    console.error('[shipped-notify]', e?.message);
    return NextResponse.json({ ok: true, sent: false });
  }
}
