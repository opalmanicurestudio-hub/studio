import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

import { brandedEmail, emailButton, getEmailBrand } from '@/lib/email-shell';
import { verifyStaffActor } from '@/lib/staff-auth';

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
  // Money leaves only for a signed-in team member allowed to refund. The order's own token is not enough:
  // it is printed on the customer's QR code and tracking link.
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!auth.actor.caps?.includes('checkout.refund')) return NextResponse.json({ error: 'Refunds need someone allowed to refund payments.' }, { status: 403 });
  const actor = auth.actor;
  if (!tenant.stripeAccountId) {
    return NextResponse.json({ error: 'This shop has no connected Stripe account.' }, { status: 400 });
  }
  const piId = String(order.stripePaymentIntentId || '').trim();
  if (!piId) {
    return NextResponse.json({
      error: 'No Stripe payment is on file for this order (it may predate payment tracking, or was paid another way). Refund it in the Stripe dashboard, then tap "Mark done manually".',
    }, { status: 422 });
  }

  // Claim the pending amount in a transaction, so two taps (or a claim approved at the same moment) can't
  // double-send or erase each other. Each refund gets its own sequence number, which is also Stripe's
  // duplicate-protection key: a retry of THIS refund replays it, a later refund of the same amount is new.
  const oRef = orderSnap.ref;
  let cents = 0; let seq = 0;
  try {
    await db.runTransaction(async (tx: any) => {
      const cur = (await tx.get(oRef)).data() || {};
      const lock = cur.refundInFlight;
      if (lock && Date.parse(lock.at || '') > Date.now() - 2 * 60000) throw new Error('busy');
      cents = Number(cur.pendingRefundCents) || 0;
      if (cents <= 0) throw new Error('none');
      seq = (Number(cur.refundSeq) || 0) + 1;
      tx.update(oRef, { refundInFlight: { cents, seq, at: new Date().toISOString(), by: actor.uid } });
    });
  } catch (e: any) {
    if (e?.message === 'busy') return NextResponse.json({ error: 'A refund on this order is already being sent. Give it a moment.' }, { status: 409 });
    if (e?.message === 'none') return NextResponse.json({ error: 'No refund is pending on this order.' }, { status: 409 });
    return NextResponse.json({ error: 'Couldn’t start the refund. Try again.' }, { status: 500 });
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
        metadata: { tenantId, retailOrderId: orderId, source: 'clarityflow_board', seq: String(seq) },
      },
      {
        stripeAccount: tenant.stripeAccountId,
        idempotencyKey: `retail-refund-${orderId}-${seq}`,
      },
    );
    refundId = String(refund.id || '');
  } catch (e: any) {
    try { await oRef.update({ refundInFlight: null }); } catch { /* the lock expires on its own */ }
    const msg = e?.raw?.message || e?.message || 'Stripe refused the refund.';
    return NextResponse.json({ error: `Stripe: ${msg}` }, { status: 502 });
  }

  // ── Closure — same shape as the board's manual markRefundExecuted, in a transaction: only what was sent
  // comes off the pending amount, so anything queued meanwhile stays queued.
  const now = new Date().toISOString();
  const evRef = oRef.collection('events').doc();
  const txnRef = db.collection(`tenants/${tenantId}/transactions`).doc();
  await db.runTransaction(async (tx: any) => {
    const cur = (await tx.get(oRef)).data() || {};
    tx.update(oRef, {
      pendingRefundCents: Math.max(0, (Number(cur.pendingRefundCents) || 0) - cents),
      refundedCents: (Number(cur.refundedCents) || 0) + cents,
      refundSeq: seq, refundInFlight: null,
      lastStripeRefundId: refundId,
    });
    tx.set(evRef, {
      id: evRef.id, type: 'refund_issued', at: now,
      actorId: actor.uid, actorName: actor.name,
      meta: {
        amountCents: cents,
        scope: cents >= (Number(order.totalCents) || 0) ? 'full' : 'partial',
        refundId,
        text: `Refund sent through Stripe by ${actor.name} (${refundId})`,
      },
    });
    tx.set(txnRef, {
      id: txnRef.id, date: now,
      description: `Refund sent through Stripe — Order #${order.orderNumber} · ${refundId}`,
      clientOrVendor: order.customerName || 'Guest',
      type: 'expense', context: 'Business', category: 'Refund', taxBucket: 'refund',
      amount: cents / 100, paymentMethod: 'Card (Online)', hasReceipt: true,
      retailOrderId: orderId, tenantId,
    });
  });
  // Loyalty: a refund takes back the points those products earned (lib/loyalty-server).
  try { const { reverseSale } = await import('@/lib/loyalty-server'); await reverseSale(db, tenantId, { saleId: `order_${orderId}`, refundCents: cents, refundId, by: 'Refund' }); } catch { /* best effort */ }

  /* THE REFUND-TIMELINE EMAIL — the moment money moves, the customer knows,
   * with the number and the honest window. Fired here (not the webhook) so
   * dashboard refunds recorded via "Mark done manually" don't double-send;
   * best-effort — the refund succeeded regardless. */
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const RESEND_FROM = process.env.NOTIFY_FROM_EMAIL || process.env.RESEND_FROM;
  if (RESEND_API_KEY && RESEND_FROM && order.customerEmail) {
    try {
      const emailBrand = await getEmailBrand(db, tenantId);
      const num = `#${String(order.orderNumber).padStart(4, '0')}`;
      const first = String(order.customerName || '').trim().split(/\s+/)[0];
      const origin = req.nextUrl.origin;
      const link = `${origin}/shop/${tenantId}/order/${orderId}`;
      const html = brandedEmail(emailBrand, `
        <p style="font-size:14px;color:#0f172a;margin:0 0 8px">Hi ${first || 'there'},</p>
        <p style="font-size:15px;font-weight:800;color:#0f172a;margin:0">Your refund is on its way</p>
        <p style="font-size:28px;font-weight:900;color:#0f172a;margin:12px 0 0;font-variant-numeric:tabular-nums">$${(cents / 100).toFixed(2)}</p>
        <p style="font-size:13px;color:#334155;line-height:1.7;margin:12px 0 0">Your refund has just been sent to your original payment method. The funds have been released on our side, and banks typically show card refunds within <strong>5 to 10 business days</strong>.</p>
        <p style="font-size:11px;color:#64748b;margin:14px 0 0">Order ${num} \u00b7 refund reference ${refundId.slice(-8)}</p>
        ${emailButton(link, 'View my order', emailBrand)}
        <p style="font-size:13px;color:#334155;line-height:1.7;margin:16px 0 0">If you have any questions, please reply to this email.</p>
        <p style="font-size:13px;color:#334155;line-height:1.7;margin:12px 0 0">Kind regards,<br>${emailBrand.shopName}</p>`,
        { preheader: `$${(cents / 100).toFixed(2)} has been refunded on order ${num}. Please allow 5 to 10 business days.` });
      const { sendNotification } = await import('@/lib/notify');
      await sendNotification(db, {
        tenantId, channel: 'email', to: order.customerEmail,
        subject: `${emailBrand.shopName}: your $${(cents / 100).toFixed(2)} refund is on its way`,
        html, kind: 'refund_issued', recipientType: 'client',
        recipientId: orderId || null, recipientName: order.customerName || null,
      });
    } catch { /* the refund stands; the order page shows it regardless */ }
  }

  return NextResponse.json({
    ok: true, refundId, amountCents: cents,
    message: `$${(cents / 100).toFixed(2)} has been refunded through Stripe. It will appear with the customer's bank within 5 to 10 business days.`,
  });
}
