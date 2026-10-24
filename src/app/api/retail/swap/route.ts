// src/app/api/retail/swap/route.ts — SWAPS. Staff: { action: 'offer', tenantId, orderId, lineId, productId, ask? }
// offers a replacement (applied straight away for customers who chose swaps, asked first for everyone else);
// { action: 'refund', … lineId } refunds instead. Customer: { action: 'decide', tenantId, orderId, qrToken, accept }
// answers from their order page.
import { NextRequest, NextResponse } from 'next/server';
import { queueAndSend } from '@/lib/order-outbox';
import { verifyStaffActor } from '@/lib/staff-auth';
import { decideSwap, offerSwap, refundInstead } from '@/lib/retail-swap-server';

export const dynamic = 'force-dynamic';

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-retail-swap';
  let app = getApps().find((a: any) => a.name === APP_NAME);
  if (!app) app = initializeApp({ credential: cert({ projectId: process.env.FIREBASE_ADMIN_PROJECT_ID, clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL, privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n') }) }, APP_NAME);
  return getFirestore(app);
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({} as any));
  const tenantId = String(b.tenantId || '').trim(); const orderId = String(b.orderId || '').trim(); const action = String(b.action || '');
  if (!tenantId || !orderId) return NextResponse.json({ error: 'Missing details.' }, { status: 400 });
  const db = getAdminDb();
  const origin = String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '') || req.nextUrl.origin;
  if (action === 'decide') {
    const snap = await db.doc(`tenants/${tenantId}/retailOrders/${orderId}`).get();
    if (!snap.exists || String((snap.data() as any).qrToken || '') !== String(b.qrToken || '')) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    const r = await decideSwap(db, tenantId, orderId, b.accept === true, 'page', origin);
    return NextResponse.json(r, { status: r.ok ? 200 : 409 });
  }
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const actor = { id: auth.actor.uid, name: auth.actor.name };
  const lineId = String(b.lineId || '');
  if (action === 'offer') {
    const r = await offerSwap(db, tenantId, orderId, lineId, String(b.productId || ''), actor, origin, b.ask === true);
    return NextResponse.json(r, { status: r.ok ? 200 : 409 });
  }
  if (action === 'refund') {
    const r = await refundInstead(db, tenantId, orderId, lineId, actor, String(b.reason || 'Not on the shelf').slice(0, 120));
    // The customer is told, from the queue that tries again if it doesn't go (lib/order-outbox).
    if (r.ok) await queueAndSend(db, tenantId, 'order_short', { orderId, lineId }, { base: origin, auth: req.headers.get('authorization') || '' }).catch(() => 'none');
    return NextResponse.json(r, { status: r.ok ? 200 : 409 });
  }
  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}
