import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

// ─── /api/retail/refund ───────────────────────────────────────────────────────
// POST { tenantId, orderId, qrToken }
//
// Executes the order's pending refund THROUGH Stripe instead of sending
// staff to the dashboard: refunds.create on the connected account against
// the order's stored payment intent, for exactly pendingRefundCents (the
// figure the returns desk or claims desk already computed and promised).
//
// On success this route performs the same closure markRefundExecuted does
// on the board — pending zeroed, refundedCents accumulated, refund_issued
// event, Refund expense line — so the books look identical whichever path
// ran. The Connect webhook's charge.refunded handler independently credits
// back Stripe's fee portion, exactly as it does for dashboard refunds; it
// never touches refundedCents, so nothing double-counts.
//
// Two idempotency layers: the pending-refund check (a second tap finds
// pending=0 and refuses before Stripe), and a Stripe idempotency key
// keyed to order+amount (a racing duplicate returns the SAME refund
// instead of creating a second one). On any Stripe failure NOTHING is
// written — the amber banner keeps showing the debt and the manual
// dashboard path still works.

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-retail-refund';
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
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const tenantId = String(body.tenantId || '').trim();
  const orderId = String(body.orderId || '').trim();
  const qrToken = String(body.qrToken || '').trim();
  if (!tenantId || !orderId || !qrToken) {
    return NextResponse.json({ error: 'tenantId, orderId and qrToken are required' }, { status: 400 });
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Stripe is not configured on the server.' }, { status: 400 });
  }

  const db = getAdminDb();
  const [tenantSnap, orderSnap] = await Promise.all([
    db.collection('tenants').doc(tenantId).get(),
    db.collection(`tenants/${tenantId}/retailOrders`).doc(orderId).get(),
  ]);
  if (!tenantSnap.exists) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
  if (!orderSnap.exists) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  const tenant = tenantSnap.data() as any;
  const order = orderSnap.data() as any;

  if (String(order.qrToken || '') !== qrToken) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }
  if (!tenant.stripeAccountId) {
    return NextResponse.json({ error: 'This shop has no connected Stripe account.' }, { status: 400 });
  }

  const cents = Number(order.pendingRefundCents) || 0;
  if (cents <= 0) {
    return NextResponse.json({ error: 'No refund is pending on this order.' }, { status: 409 });
  }
  const piId = String(order.stripePaymentIntentId || '').trim();
  if (!piId) {
    return NextResponse.json({
      error: 'No Stripe payment is on file for this order (it may predate payment tracking, or was paid another way). Refund it in the Stripe dashboard, then tap "Mark done manually".',
    }, { status: 422 });
  }

  // ── The refund itself ──────────────────────────────────────────────────────
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' as any });
  let refundId = '';
  try {
    const refund = await stripe.refunds.create(
      {
        payment_intent: piId,
        amount: cents,
        reason: 'requested_by_customer',
        metadata: { tenantId, retailOrderId: orderId, source: 'clarityflow_board' },
      },
      {
        stripeAccount: tenant.stripeAccountId,
        idempotencyKey: `retail-refund-${orderId}-${cents}`,
      },
    );
    refundId = String(refund.id || '');
  } catch (e: any) {
    const msg = e?.raw?.message || e?.message || 'Stripe refused the refund.';
    return NextResponse.json({ error: `Stripe: ${msg}` }, { status: 502 });
  }

  // ── Closure — identical shape to the board's manual markRefundExecuted ────
  const now = new Date().toISOString();
  const oRef = orderSnap.ref;
  const evRef = oRef.collection('events').doc();
  const txnRef = db.collection(`tenants/${tenantId}/transactions`).doc();
  const batch = db.batch();
  batch.update(oRef, {
    pendingRefundCents: 0,
    refundedCents: (Number(order.refundedCents) || 0) + cents,
    lastStripeRefundId: refundId,
  });
  batch.set(evRef, {
    id: evRef.id, type: 'refund_issued', at: now,
    actorId: 'stripe', actorName: 'Stripe (auto)',
    meta: {
      amountCents: cents,
      scope: cents >= (Number(order.totalCents) || 0) ? 'full' : 'partial',
      refundId,
      text: `Refund executed through Stripe automatically (${refundId})`,
    },
  });
  batch.set(txnRef, {
    id: txnRef.id, date: now,
    description: `Refund executed (Stripe auto) — Order #${order.orderNumber} · ${refundId}`,
    clientOrVendor: order.customerName || 'Guest',
    type: 'expense', context: 'Business', category: 'Refund', taxBucket: 'refund',
    amount: cents / 100, paymentMethod: 'Card (Online)', hasReceipt: true,
    retailOrderId: orderId, tenantId,
  });
  await batch.commit();

  return NextResponse.json({
    ok: true, refundId, amountCents: cents,
    message: `$${(cents / 100).toFixed(2)} refunded through Stripe — the customer's bank shows it in 5–10 business days.`,
  });
}
