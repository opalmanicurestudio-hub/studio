import { eventIdFor } from '@/lib/order-events';
import { getAdminDb } from '@/lib/firebase-admin';
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
    // In one step with the order as it is now, and only while it's still coming (not once it's handed over or canceled).
    const r: any = await db.runTransaction(async (tx: any) => {
      const o = ((await tx.get(orderRef)).data() || {}) as RetailOrder;
      if (!['paid', 'picking', 'packed', 'ready'].includes(o.stage)) return { refused: true, stage: o.stage };
      tx.set(orderRef, { curbside: { ...(o.curbside || {}), ...accessPatch, onWayAt: o.curbside?.onWayAt || now, ...(etaMinutes !== null ? { etaMinutes } : {}) } }, { merge: true });
      if (!o.curbside?.onWayAt) {
        const evRef = orderRef.collection('events').doc(eventIdFor('note', 'on_my_way'));
        tx.set(evRef, { id: evRef.id, ...buildEvent('note', 'customer', o.customerName || 'Customer', { text: `On the way${etaMinutes !== null ? ` \u2014 about ${etaMinutes} min out` : ''}` }) });
      }
      return { stage: o.stage };
    });
    if (r.refused) return NextResponse.json({ error: 'This order isn’t waiting for you any more.', stage: r.stage }, { status: 409 });
    return NextResponse.json({ ok: true, onWay: true, stage: r.stage, etaMinutes });
  }

  // In one step with the order as it is now: a check-in that lands as the order is handed over never puts it back to
  // arrived, and two taps are one arrival on its history (lib/order-events eventIdFor).
  const r: any = await db.runTransaction(async (tx: any) => {
    const cur = await tx.get(orderRef);
    const o = (cur.data() || {}) as RetailOrder;
    const firstCheckIn = !o.curbside?.arrivedAt;
    const curbside = {
      ...(o.curbside || {}),
      ...accessPatch,
      arrivedAt: o.curbside?.arrivedAt || now,
      spotOrVehicle: spotOrVehicle || o.curbside?.spotOrVehicle || '',
      ...(firstCheckIn ? { checkInSource } : {}),
      ...(firstCheckIn && accuracyM !== null ? { arrivedAccuracyM: accuracyM } : {}),
    };
    const onTime = o.stage === 'ready' && canAdvance(o, 'arrived').ok; // on the shelf: they're here for it
    if (onTime) tx.set(orderRef, { stage: 'arrived', curbside }, { merge: true });
    else if (['paid', 'picking', 'packed'].includes(o.stage)) tx.set(orderRef, { curbside }, { merge: true }); // early: no stage change
    else return { refused: o.stage === 'arrived' ? 'Already checked in' : 'This order cannot check in right now', status: o.stage === 'arrived' ? 200 : 409 };
    if (firstCheckIn || onTime) {
      const evRef = orderRef.collection('events').doc(eventIdFor('customer_arrived', onTime ? 'at_ready' : 'early'));
      tx.set(evRef, {
        id: evRef.id,
        ...buildEvent('customer_arrived', 'customer', o.customerName || 'Customer', {
          spotOrVehicle: curbside.spotOrVehicle,
          early: !onTime,
          source: checkInSource,
          ...(accuracyM !== null ? { accuracyM } : {}),
        }),
      });
    }
    return { onTime, stage: o.stage };
  });
  if (r.refused) return NextResponse.json({ error: r.refused }, { status: r.status });
  return NextResponse.json({ ok: true, stage: r.onTime ? 'arrived' : r.stage, early: !r.onTime });
}
