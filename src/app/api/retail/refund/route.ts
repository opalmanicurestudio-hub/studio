import { refundAllowed } from '@/lib/money-limits';
import { familyRefundableCents, followUpLabel, followUpsOf, isFollowUp, payingOrder, sameCustomer } from '@/lib/order-family';
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

import { brandedEmail, emailButton, getEmailBrand } from '@/lib/email-shell';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';

// ─── /api/retail/refund ───────────────────────────────────────────────────────
// POST { tenantId, orderId, qrToken }
//
// Executes the order's pending refund THROUGH Stripe instead of sending
// staff to the dashboard: refunds.create on the connected account against
// the order's stored payment intent, for exactly pendingRefundCents (the
// figure the returns desk or claims desk already computed and promised).
//
// AN ORDER MADE FROM ANOTHER ONE (a backorder, pre-order items sent later, a
// replacement: lib/order-family) has no payment of its own, because the
// customer paid on the order it came from. Its refund goes back to that
// order's card, and every refund across the family counts against what that
// card was charged, so a card is never asked for more than it paid. While any
// refund in the family is being sent, the paying order is held too, so two
// at once can't both count the same money. The refund is recorded on the
// order it's for; the paying order's history notes it.
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
// keyed to order+sequence (a racing duplicate returns the SAME refund
// instead of creating a second one). On any Stripe failure NOTHING is
// written — the amber banner keeps showing the debt and the manual
// dashboard path still works.

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

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
  const col = db.collection(`tenants/${tenantId}/retailOrders`);
  const [tenantSnap, orderSnap] = await Promise.all([
    db.collection('tenants').doc(tenantId).get(),
    col.doc(orderId).get(),
  ]);
  if (!tenantSnap.exists) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
  if (!orderSnap.exists) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  const tenant = tenantSnap.data() as any;
  const order = { ...(orderSnap.data() as any), id: orderId };

  if (String(order.qrToken || '') !== qrToken) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  // The order the card was charged on: this one, or for a follow-up the order it was made from, for the same customer.
  const follow = isFollowUp(order);
  const read = (r: any) => r.get();
  const payer0 = follow ? await payingOrder(read, col, order) : order;
  if (!payer0 || (follow && !sameCustomer(payer0, order))) {
    return NextResponse.json({
      error: 'This order was made from another one, and the card payment behind it can’t be found. Refund it in the Stripe dashboard, then tap "Mark done manually".',
    }, { status: 422 });
  }
  const payerId = String(payer0.id);
  const room0 = familyRefundableCents(payer0, await followUpsOf(read, col, payerId));

  // Money leaves only for a signed-in team member allowed to refund. The order's own token is not enough:
  // it is printed on the customer's QR code and tracking link.
  // One exception to the staff rule: the shop's own server, refunding a customer's self-serve cancellation under the
  // shop's "refund automatically below $X" policy. It proves itself with the server secret and is re-checked here.
  // A second: the shipping on an order that went in the same box as another of the customer's orders (lib/ship-together),
  // which the shop refunds automatically. Never more than that order's shipping.
  const internalKey = !!process.env.CRON_SECRET && req.headers.get('x-internal-key') === process.env.CRON_SECRET;
  const internal = internalKey && body.reason === 'customer_cancel';
  const together = internalKey && body.reason === 'ship_together';
  let actor: { uid: string; name: string };
  let limitFor: ((c: number) => ReturnType<typeof refundAllowed>) | null = null;
  if (together) {
    const pendingNow = Number(order.pendingRefundCents) || 0;
    if (!order.shippedWithOrderId || pendingNow <= 0 || pendingNow > Math.max(0, Number(order.shippingCents) || 0)) return NextResponse.json({ error: 'This refund needs the shop to send it.' }, { status: 403 });
    actor = { uid: 'system', name: 'Shipped together (automatic shipping refund)' };
  } else if (internal) {
    const autoBelow = Math.max(0, Number(tenant.retailSettings?.policies?.refundAutoBelowCents) || 0);
    const pendingNow = Number(order.pendingRefundCents) || 0;
    // A replacement for a lost parcel is the shop's to refund: the first parcel may still turn up.
    if (order.stage !== 'cancelled' || autoBelow <= 0 || pendingNow <= 0 || pendingNow > autoBelow || order.replacementFor === 'lost_in_transit') return NextResponse.json({ error: 'This refund needs the shop to send it.' }, { status: 403 });
    actor = { uid: 'customer', name: 'Customer cancellation (automatic)' };
  } else {
    const auth = await verifyStaffActor(req, tenantId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
    if (!auth.actor.caps?.includes('checkout.refund')) return NextResponse.json({ error: 'Refunds need someone allowed to refund payments.' }, { status: 403 });
    // The owner's limit for this person's role (lib/money-limits), checked against what would be sent now, and again
    // inside the claim below, against what really goes.
    const staffActor = auth.actor as any;
    limitFor = (c: number) => refundAllowed(tenant.retailSettings || {}, staffActor, c);
    const allowed = limitFor(Math.min(Number(order.pendingRefundCents) || 0, room0));
    if (!allowed.ok) return NextResponse.json({ error: allowed.message, limitCents: allowed.limit }, { status: 403 });
    actor = auth.actor;
  }
  if (!tenant.stripeAccountId) {
    return NextResponse.json({ error: 'This shop has no connected Stripe account.' }, { status: 400 });
  }
  const piId = String(payer0.stripePaymentIntentId || '').trim();
  if (!piId) {
    return NextResponse.json({
      error: follow
        ? 'No Stripe payment is on file for the order this one was made from (it may predate payment tracking, or was paid another way). Refund it in the Stripe dashboard, then tap "Mark done manually".'
        : 'No Stripe payment is on file for this order (it may predate payment tracking, or was paid another way). Refund it in the Stripe dashboard, then tap "Mark done manually".',
    }, { status: 422 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' as any });
  const oRef = col.doc(orderId);
  const pRef = col.doc(payerId);
  const held = (l: any) => !!l && Date.parse(l.at || '') > Date.now() - 2 * 60000;
  let cents = 0; let seq = 0; let overCard = 0; let refundId = '';
  const mine = (l: any) => !!l && l.forOrderId === orderId && Number(l.seq) === seq;

  // A REFUND THAT MAY HAVE GONE THROUGH WITHOUT BEING RECORDED: an earlier try claimed it under the next number and was
  // cut off before writing it to the order (its hold has lapsed, the number unused). Stripe is asked first. A refund it
  // made for this order and number is recorded as it is; when there is none, a new one goes out under a fresh number,
  // so it can never be mistaken for the one that didn't happen.
  let recordOnly = false; let floorSeq = 0;
  const lapsed = order.refundInFlight;
  if (lapsed && !held(lapsed) && Number(lapsed.seq) === (Number(order.refundSeq) || 0) + 1 && Number(lapsed.cents) > 0) {
    let found: any = null;
    try {
      const list: any = await stripe.refunds.list({ payment_intent: piId, limit: 100 } as any, { stripeAccount: tenant.stripeAccountId });
      found = (list?.data || []).find((r: any) => r?.metadata?.retailOrderId === orderId && String(r?.metadata?.seq || '') === String(lapsed.seq) && !['failed', 'canceled'].includes(String(r?.status || '')));
    } catch {
      return NextResponse.json({ error: 'Stripe couldn’t be checked for an earlier try at this refund. Try again in a moment.' }, { status: 502 });
    }
    if (found) { recordOnly = true; cents = Math.max(0, Math.round(Number(found.amount) || 0)); seq = Number(lapsed.seq); refundId = String(found.id || ''); }
    else floorSeq = Number(lapsed.seq);
  }

  if (!recordOnly) {
    // Claim the pending amount in a transaction, so two taps (or a claim approved at the same moment) can't
    // double-send or erase each other. Each refund gets its own sequence number, which is also Stripe's
    // duplicate-protection key: a retry of THIS refund replays it, a later refund of the same amount is new.
    // A follow-up's refund holds the paying order as well, and every refund in the family checks it.
    let limitHit: { message: string; limit: number } | null = null;
    try {
      await db.runTransaction(async (tx: any) => {
        const cur = (await tx.get(oRef)).data() || {};
        const payer = follow ? { ...((await tx.get(pRef)).data() || {}), id: payerId } : { ...cur, id: orderId };
        const family = (await followUpsOf((r: any) => tx.get(r), col, payerId)).map((f: any) => (f.id === orderId ? { ...cur, id: orderId } : f));
        if (held(cur.refundInFlight) || (follow && held(payer.refundInFlight))) throw new Error('busy');
        // Never more than the card can take back: anything paid by store credit or gift card is returned that way, and
        // whatever has already gone back to the card for any order in the family is spoken for.
        const pending = Number(cur.pendingRefundCents) || 0;
        cents = Math.min(pending, familyRefundableCents(payer, family));
        if (pending > 0 && cents <= 0) throw new Error('nocard');
        if (cents <= 0) throw new Error('none');
        const allowed = limitFor ? limitFor(cents) : { ok: true as const };
        if (!allowed.ok) { limitHit = { message: allowed.message, limit: allowed.limit }; throw new Error('limit'); }
        overCard = pending - cents;
        seq = Math.max((Number(cur.refundSeq) || 0) + 1, floorSeq + 1);
        const lock = { cents, seq, at: new Date().toISOString(), by: actor.uid };
        tx.update(oRef, { refundInFlight: lock });
        if (follow) tx.update(pRef, { refundInFlight: { ...lock, forOrderId: orderId } });
      });
    } catch (e: any) {
      if (e?.message === 'busy') return NextResponse.json({ error: follow ? 'A refund for this customer’s order is already being sent. Give it a moment.' : 'A refund on this order is already being sent. Give it a moment.' }, { status: 409 });
      if (e?.message === 'nocard') return NextResponse.json({ error: follow ? 'Everything paid by card on the original order has already gone back to it. If they paid part of it with a gift card or store credit, give that part back the same way.' : 'Everything paid by card is already refunded. Give the rest back as store credit.' }, { status: 409 });
      if (e?.message === 'none') return NextResponse.json({ error: 'No refund is pending on this order.' }, { status: 409 });
      if (e?.message === 'limit' && limitHit) return NextResponse.json({ error: (limitHit as any).message, limitCents: (limitHit as any).limit }, { status: 403 });
      return NextResponse.json({ error: 'Couldn’t start the refund. Try again.' }, { status: 500 });
    }

    // ── The refund itself ──────────────────────────────────────────────────────
    try {
      const refund = await stripe.refunds.create(
        {
          payment_intent: piId,
          amount: cents,
          reason: 'requested_by_customer',
          metadata: { tenantId, retailOrderId: orderId, source: 'clarityflow_board', seq: String(seq), ...(follow ? { paidOnOrderId: payerId } : {}) },
        },
        {
          stripeAccount: tenant.stripeAccountId,
          idempotencyKey: `retail-refund-${orderId}-${seq}`,
        },
      );
      refundId = String(refund.id || '');
    } catch (e: any) {
      try {
        await db.runTransaction(async (tx: any) => {
          const p = follow ? (await tx.get(pRef)).data() || {} : null;
          tx.update(oRef, { refundInFlight: null });
          if (p && mine(p.refundInFlight)) tx.update(pRef, { refundInFlight: null });
        });
      } catch { /* the locks expire on their own */ }
      const msg = e?.raw?.message || e?.message || 'Stripe refused the refund.';
      return NextResponse.json({ error: `Stripe: ${msg}` }, { status: 502 });
    }
  }

  // ── Closure — same shape as the board's manual markRefundExecuted, in a transaction: only what was sent
  // comes off the pending amount, so anything queued meanwhile stays queued. Tried a few times: the money has moved,
  // so it must be written down. A refund already written down under this number is left alone.
  const now = new Date().toISOString();
  const what = follow ? followUpLabel(order) : '';
  const evRef = oRef.collection('events').doc();
  const pEvRef = pRef.collection('events').doc();
  const txnRef = db.collection(`tenants/${tenantId}/transactions`).doc();
  let left = 0; let recorded = false; let already = false;
  for (let attempt = 0; attempt < 3 && !recorded; attempt++) {
    try {
      await db.runTransaction(async (tx: any) => {
        const cur = (await tx.get(oRef)).data() || {};
        const p = follow ? (await tx.get(pRef)).data() || {} : null;
        if ((Number(cur.refundSeq) || 0) >= seq) { already = true; return; }
        left = Math.max(0, (Number(cur.pendingRefundCents) || 0) - cents);
        tx.update(oRef, {
          pendingRefundCents: left,
          refundedCents: (Number(cur.refundedCents) || 0) + cents,
          refundSeq: seq, refundInFlight: null,
          lastStripeRefundId: refundId,
        });
        if (p && mine(p.refundInFlight)) tx.update(pRef, { refundInFlight: null });
        tx.set(evRef, {
          id: evRef.id, type: 'refund_issued', at: now,
          actorId: actor.uid, actorName: actor.name,
          meta: {
            amountCents: cents,
            scope: follow ? (cur.stage === 'cancelled' ? 'full' : 'partial') : cents >= (Number(order.totalCents) || 0) ? 'full' : 'partial',
            refundId,
            text: follow
              ? `Refund sent through Stripe by ${actor.name} to the card used on the original order (${refundId})`
              : `Refund sent through Stripe by ${actor.name} (${refundId})`,
            ...(follow ? { paidOnOrderId: payerId } : {}),
          },
        });
        if (follow) {
          tx.set(pEvRef, {
            id: pEvRef.id, type: 'note', at: now,
            actorId: actor.uid, actorName: actor.name,
            meta: { kind: 'follow_up_refund', followUpOrderId: orderId, amountCents: cents, refundId, text: `${money(cents)} refunded to this order’s card for ${what} (${refundId})` },
          });
        }
        tx.set(txnRef, {
          id: txnRef.id, date: now,
          description: `Refund sent through Stripe — Order #${order.orderNumber}${follow ? ` (${what.replace(/^the /, '')})` : ''} · ${refundId}`,
          clientOrVendor: order.customerName || 'Guest',
          type: 'expense', context: 'Business', category: 'Refund', taxBucket: 'refund',
          amount: cents / 100, paymentMethod: 'Card (Online)', hasReceipt: true,
          retailOrderId: orderId, ...(follow ? { paidOnOrderId: payerId } : {}), tenantId,
        });
      });
      recorded = true;
    } catch {
      if (attempt < 2) await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  if (!recorded) {
    return NextResponse.json({
      ok: true, recorded: false, refundId, amountCents: cents,
      message: `${money(cents)} has gone back through Stripe, but it couldn’t be saved on the order yet. Tap send again in two minutes to record it. It won’t be sent twice.`,
    });
  }
  if (already) return NextResponse.json({ ok: true, refundId, amountCents: cents, leftCents: Number(order.pendingRefundCents) || 0, overCardCents: 0, message: 'That refund was already recorded on the order.' });

  // Loyalty: a refund takes back the points those products earned (lib/loyalty-server), on the sale that earned them.
  try { const { reverseSale } = await import('@/lib/loyalty-server'); await reverseSale(db, tenantId, { saleId: `order_${payerId}`, refundCents: cents, refundId, by: 'Refund' }); } catch { /* best effort */ }

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
        <p style="font-size:11px;color:#64748b;margin:14px 0 0">Order ${num} · refund reference ${refundId.slice(-8)}</p>
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

  const sent = recordOnly
    ? `${money(cents)} had already gone back through Stripe, and it's recorded on the order now.`
    : follow
      ? `${money(cents)} has been refunded through Stripe to the card used on the original order. It will appear with the customer's bank within 5 to 10 business days.`
      : `${money(cents)} has been refunded through Stripe. It will appear with the customer's bank within 5 to 10 business days.`;
  return NextResponse.json({
    ok: true, refundId, amountCents: cents, leftCents: left, overCardCents: overCard,
    message: overCard > 0 ? `${sent} The other ${money(overCard)} is more than the card has left to refund. If they paid part of the order with a gift card or store credit, give that part back the same way.` : sent,
  });
}
