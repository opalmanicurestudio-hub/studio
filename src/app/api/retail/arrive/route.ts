import { NextRequest, NextResponse } from 'next/server';

import { buildEvent, canAdvance, type RetailOrder } from '@/lib/retail-orders';

// ─── /api/retail/arrive/route.ts ──────────────────────────────────────────────
// POST { tenantId, orderId, qrToken, spotOrVehicle? }
//
// Curbside "I'm here" check-in from the order-status page. qrToken acts as
// proof-of-possession (only someone viewing the status page has it), so a
// guessed orderId alone can't check an order in.
//
// TWO ARRIVAL SCENARIOS, both handled:
//   • On time (stage === 'ready')    → advance to 'arrived'; the fulfillment
//     board's Arrived lane lights up.
//   • EARLY (still paid/picking/packed) → the customer drove over faster than
//     the pick. We can't legally advance the stage, but we record the arrival
//     on the order (curbside.arrivedAt + event). The fulfillment board shows
//     a "customer waiting" flag, and when staff marks the order ready it
//     auto-advances straight to 'arrived' — the customer never checks in twice.
//
// Idempotent: repeat taps update the vehicle description, nothing else.

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-retail-arrive';
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

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const tenantId = String(body.tenantId || '').trim();
  const orderId = String(body.orderId || '').trim();
  const qrToken = String(body.qrToken || '').trim();
  const spotOrVehicle = String(body.spotOrVehicle || '').trim().slice(0, 120);

  if (!tenantId || !orderId || !qrToken) {
    return NextResponse.json({ error: 'tenantId, orderId, and qrToken are required' }, { status: 400 });
  }

  const db = getAdminDb();
  const orderRef = db.collection(`tenants/${tenantId}/retailOrders`).doc(orderId);
  const snap = await orderRef.get();
  if (!snap.exists) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  const order = snap.data() as RetailOrder & { qrToken?: string };

  if (order.qrToken !== qrToken) {
    return NextResponse.json({ error: 'Not authorized for this order' }, { status: 403 });
  }
  if (order.method !== 'curbside') {
    return NextResponse.json({ error: 'This order is not a curbside order' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const firstCheckIn = !order.curbside?.arrivedAt;
  const curbside = {
    arrivedAt: order.curbside?.arrivedAt || now,
    spotOrVehicle: spotOrVehicle || order.curbside?.spotOrVehicle || '',
  };

  const batch = db.batch();
  const onTime = canAdvance(order, 'arrived').ok; // true only when stage === 'ready'

  if (onTime) {
    batch.set(orderRef, { stage: 'arrived', curbside }, { merge: true });
  } else if (['paid', 'picking', 'packed'].includes(order.stage)) {
    batch.set(orderRef, { curbside }, { merge: true }); // early — no stage change
  } else {
    return NextResponse.json(
      { error: order.stage === 'arrived' ? 'Already checked in' : 'This order cannot check in right now' },
      { status: order.stage === 'arrived' ? 200 : 409 }
    );
  }

  if (firstCheckIn || onTime) {
    const evRef = orderRef.collection('events').doc();
    batch.set(evRef, {
      id: evRef.id,
      ...buildEvent('customer_arrived', 'customer', order.customerName || 'Customer', {
        spotOrVehicle: curbside.spotOrVehicle,
        early: !onTime,
      }),
    });
  }

  await batch.commit();
  return NextResponse.json({ ok: true, stage: onTime ? 'arrived' : order.stage, early: !onTime });
}
