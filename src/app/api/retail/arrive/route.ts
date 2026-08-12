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
  // Two new shapes on the same endpoint:
  //   onWay  — "I've left" (+ optional ETA). No stage change; the shop just
  //            gets a head start, which is the whole point of curbside.
  //   source — how the check-in happened. A scanned spot sign is worth more
  //            than a typed guess, and a phone deciding it is close enough is
  //            worth less than both; the board shows which so a person can
  //            judge rather than trust.
  const onWay = body.onWay === true;
  const etaMinutes = Number.isFinite(Number(body.etaMinutes))
    ? Math.max(0, Math.min(120, Math.round(Number(body.etaMinutes)))) : null;
  const rawSource = String(body.source || '').trim();
  const checkInSource: 'manual' | 'sign_qr' | 'geo_auto' =
    rawSource === 'sign_qr' ? 'sign_qr' : rawSource === 'geo_auto' ? 'geo_auto' : 'manual';
  const accuracyM = Number.isFinite(Number(body.distanceM))
    ? Math.max(0, Math.round(Number(body.distanceM))) : null;
  // Access, set by the person who needs it. Sent with any check-in or
  // on-my-way, so nobody has to explain themselves twice.
  const bringToVehicle = body.bringToVehicle === true ? true
    : body.bringToVehicle === false ? false : null;
  const accessNote = typeof body.accessNote === 'string'
    ? body.accessNote.trim().slice(0, 200) : null;
  const accessPatch = {
    ...(bringToVehicle !== null ? { bringToVehicle } : {}),
    ...(accessNote !== null ? { accessNote } : {}),
  };

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

  // ── "On my way" ──────────────────────────────────────────────────────────
  // Deliberately does NOT touch the stage: they aren't here yet, and an order
  // that says "arrived" when the car is ten minutes out sends someone walking
  // outside for nothing. It records the heads-up and lets the board show it.
  if (onWay) {
    const curbsideOnWay = {
      ...(order.curbside || {}),
      ...accessPatch,
      onWayAt: order.curbside?.onWayAt || now,
      ...(etaMinutes !== null ? { etaMinutes } : {}),
    };
    const b = db.batch();
    b.set(orderRef, { curbside: curbsideOnWay }, { merge: true });
    if (!order.curbside?.onWayAt) {
      const evRef = orderRef.collection('events').doc();
      b.set(evRef, {
        id: evRef.id,
        ...buildEvent('note', 'customer', order.customerName || 'Customer', {
          text: `On the way${etaMinutes !== null ? ` \u2014 about ${etaMinutes} min out` : ''}`,
        }),
      });
    }
    await b.commit();
    return NextResponse.json({ ok: true, onWay: true, stage: order.stage, etaMinutes });
  }

  const firstCheckIn = !order.curbside?.arrivedAt;
  const curbside = {
    ...(order.curbside || {}),
    ...accessPatch,
    arrivedAt: order.curbside?.arrivedAt || now,
    spotOrVehicle: spotOrVehicle || order.curbside?.spotOrVehicle || '',
    ...(firstCheckIn ? { checkInSource } : {}),
    ...(firstCheckIn && accuracyM !== null ? { arrivedAccuracyM: accuracyM } : {}),
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
        source: checkInSource,
        ...(accuracyM !== null ? { accuracyM } : {}),
      }),
    });
  }

  await batch.commit();
  return NextResponse.json({ ok: true, stage: onTime ? 'arrived' : order.stage, early: !onTime });
}
