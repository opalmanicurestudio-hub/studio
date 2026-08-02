import { NextRequest, NextResponse } from 'next/server';

import { TERMINAL_STAGES, buildOrderQrValue } from '@/lib/retail-orders';

// ─── /api/retail/order-status/route.ts ────────────────────────────────────────
// GET ?tenantId=...&orderId=...
//
// Public, unauthenticated — the unguessable Firestore orderId in the URL is
// the access secret (same model as e-commerce order-status links). The
// response is SANITIZED for that trust level: line items, stage, totals, and
// the pickup QR, but no email, no full street address (city/state only), and
// nothing internal (costs, staff, batches).
//
// Designed for polling: the storefront status page calls this every few
// seconds while the order is active. Reads are 2-4 docs per call.

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-retail-status';
  let app = getApps().find((a: any) => a.name === APP_NAME);
  if (!app) {
    app = initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    }, APP_NAME);
  }
  return getFirestore(app);
}

export async function GET(req: NextRequest) {
  const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '').trim();
  const orderId = String(req.nextUrl.searchParams.get('orderId') || '').trim();
  if (!tenantId || !orderId) {
    return NextResponse.json({ error: 'tenantId and orderId are required' }, { status: 400 });
  }

  const db = getAdminDb();
  const [orderSnap, tenantSnap] = await Promise.all([
    db.collection(`tenants/${tenantId}/retailOrders`).doc(orderId).get(),
    db.collection('tenants').doc(tenantId).get(),
  ]);
  if (!orderSnap.exists) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  const order = orderSnap.data() as any;
  const rs = (tenantSnap.exists ? (tenantSnap.data() as any).retailSettings : {}) || {};

  // Queue position — how many active orders entered the queue before this one.
  // Only meaningful while waiting to be picked; skipped otherwise to save reads.
  let queuePosition: number | null = null;
  if (order.stage === 'paid' && order.paidAt) {
    try {
      const ahead = await db.collection(`tenants/${tenantId}/retailOrders`)
        .where('stage', 'in', ['paid', 'picking'])
        .where('paidAt', '<', order.paidAt)
        .count().get();
      queuePosition = (ahead.data().count ?? 0) + 1;
    } catch {
      queuePosition = null; // missing index or count unsupported — degrade silently
    }
  }

  const isPickup = order.method === 'counter' || order.method === 'curbside';
  const active = !TERMINAL_STAGES.includes(order.stage);

  // Drive-thru: live lane position among checked-in orders, by arrival time.
  let lanePosition: number | null = null;
  if (order.method === 'curbside' && order.curbside?.arrivedAt && active) {
    try {
      const ahead = await db.collection(`tenants/${tenantId}/retailOrders`)
        .where('stage', '==', 'arrived')
        .where('curbside.arrivedAt', '<', order.curbside.arrivedAt)
        .count().get();
      lanePosition = (ahead.data().count ?? 0) + (order.stage === 'arrived' ? 1 : 0) || null;
      if (order.stage === 'arrived' && lanePosition === null) lanePosition = 1;
    } catch {
      lanePosition = null;
    }
  }

  // The pickup QR is available from the moment payment confirms, so the
  // customer already has it open when they walk up — no fumbling at the counter.
  const qrValue =
    isPickup && order.qrToken && active && order.stage !== 'placed'
      ? buildOrderQrValue(order.qrToken)
      : null;

  return NextResponse.json({
    order: {
      id: orderId,
      orderNumber: order.orderNumber,
      stage: order.stage,
      method: order.method,
      pickupAt: order.pickupAt || '',
      tipCents: order.tipCents || 0,
      priceTier: order.priceTier || 'retail',
      businessName: order.businessName || '',
      poNumber: order.poNumber || '',
      customerName: order.customerName || '',
      lines: (order.lines || []).map((l: any) => ({
        lineId: l.lineId,
        qtyReturned: l.qtyReturned || 0,
        name: l.name,
        qtyOrdered: l.qtyOrdered,
        qtyShorted: l.qtyShorted || 0,
        unitPriceCents: l.unitPriceCents,
        status: l.status,
      })),
      subtotalCents: order.subtotalCents || 0,
      taxCents: order.taxCents || 0,
      shippingCents: order.shippingCents || 0,
      refundedCents: order.refundedCents || 0,
      totalCents: order.totalCents || 0,
      timestamps: {
        placedAt: order.placedAt || null,
        paidAt: order.paidAt || null,
        packedAt: order.packedAt || null,
        readyAt: order.readyAt || null,
        completedAt: order.completedAt || null,
        cancelledAt: order.cancelledAt || null,
      },
      curbside: order.curbside
        ? { arrivedAt: order.curbside.arrivedAt || null, spotOrVehicle: order.curbside.spotOrVehicle || '' }
        : null,
      shipCity: order.shippingAddress ? `${order.shippingAddress.city}, ${order.shippingAddress.state}` : null,
      trackingNumber: order.trackingNumber || null,
      trackingUrl: order.trackingUrl || null,
      carrier: order.carrier || null,
    },
    queuePosition,
    lanePosition,
    curbsideExperience: {
      mode: rs.curbsideMode || 'freeform',
      spots: Array.isArray(rs.curbsideSpots) ? rs.curbsideSpots : [],
    },
    qrValue,
    active,
  });
}
