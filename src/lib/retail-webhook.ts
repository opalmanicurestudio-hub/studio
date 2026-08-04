/**
 * retail-webhook.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles the 'retail_order' branch of checkout.session.completed for the
 * EXISTING /api/stripe/connect-webhook route. Lives as its own module so the
 * webhook file only needs a 4-line insertion (see bottom of this file).
 *
 * Responsibilities (all idempotent — safe on Stripe event retries):
 *   1. placed → paid transition inside a Firestore transaction
 *   2. Reserve stock per line (stockReserved += qty on each inventory item)
 *   3. Generate the HMAC-signed pickup QR token
 *   4. Match-or-create the client by email (mirrors the deposit flow)
 *   5. Post the Retail income transaction (taxBucket 'revenue', with
 *      checkoutSessionId so the fee row can be matched to the sale)
 *   6. Append payment_confirmed + stock_reserved audit events
 *   7. Book the exact Stripe processing fee against the sale (see
 *      @/lib/stripe-fees) — not left to charge.succeeded, which fires before
 *      the sale row exists and may not be enabled on the endpoint at all
 *
 * NOTE on oversell races: if two orders paid for the last unit simultaneously,
 * we still reserve in full here (stockReserved may exceed totalStock). The
 * shelf is the source of truth — the picker resolves it via the shortLine
 * partial-fulfillment flow. Payment confirmation is never blocked on stock.
 */

import { createHmac, timingSafeEqual } from 'crypto';

import { buildEvent, buildOrderQrValue } from '@/lib/retail-orders';
import { recordStripeFeeForCharge } from '@/lib/stripe-fees';

/* ── QR token (HMAC-signed; raw ids are never scannable) ─────────────────── */

function qrSecret(): string {
  return process.env.RETAIL_QR_SECRET || process.env.STRIPE_SECRET_KEY || 'dev-secret';
}

export function makeQrToken(orderId: string): string {
  const sig = createHmac('sha256', qrSecret()).update(orderId).digest('hex').slice(0, 24);
  return `${orderId}.${sig}`;
}

/** Returns the orderId if the token is authentic, null otherwise. */
export function verifyQrToken(token: string): string | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const orderId = token.slice(0, dot);
  const given = token.slice(dot + 1);
  const expected = createHmac('sha256', qrSecret()).update(orderId).digest('hex').slice(0, 24);
  if (given.length !== expected.length) return null;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected)) ? orderId : null;
}

/* ── The webhook branch ──────────────────────────────────────────────────── */

export async function handleRetailOrderPaid(
  db: any,               // admin Firestore from getAdminDb()
  stripe: any,           // the stripe2 instance already in scope
  tenantId: string,
  connAcct: string,
  session: any,          // Stripe.Checkout.Session
  chargeId: string | null // already resolved at the top of the case block
): Promise<void> {
  const orderId = session.metadata?.retailOrderId;
  if (!orderId) {
    console.warn('[connect-webhook] retail_order session missing retailOrderId');
    return;
  }

  const orderRef = db.collection(`tenants/${tenantId}/retailOrders`).doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) {
    console.warn(`[connect-webhook] retail order ${orderId} not found for tenant ${tenantId}`);
    return;
  }
  const order = orderSnap.data();

  // Booking the Stripe fee is safe to attempt more than once (deterministic
  // doc id, and it short-circuits once the fee is linked to the sale), so a
  // retry on an already-paid order still gets a chance to fill in a fee that
  // an earlier attempt missed.
  const bookFee = async () => {
    if (!chargeId) return;
    try {
      await recordStripeFeeForCharge({
        db, stripe, tenantId, connAcct, charge: chargeId, checkoutSessionId: session.id,
      });
    } catch (e) {
      // A missing fee must never undo a paid order — the webhook retry and the
      // next status poll both get another shot at it.
      console.error(`[connect-webhook] Could not record Stripe fee for order ${orderId}`, e);
    }
  };

  // Idempotency — Stripe retries events; only the first one does the work.
  if (order.stage !== 'placed') {
    await bookFee();
    return;
  }

  // Sanity: what Stripe collected should match what we quoted at checkout.
  if (session.amount_total != null && session.amount_total !== order.totalCents) {
    console.warn(
      `[connect-webhook] retail order ${orderId} amount mismatch: ` +
      `session ${session.amount_total} vs order ${order.totalCents} — proceeding, flagging in events`
    );
  }

  const piId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id || null;

  // ── Match-or-create the client by email (mirrors the deposit flow) ──────
  const email = String(order.customerEmail || '').toLowerCase().trim();
  let clientId: string | null = null;
  if (email) {
    const match = await db.collection(`tenants/${tenantId}/clients`)
      .where('email', '==', email).limit(1).get();
    if (!match.empty) {
      clientId = match.docs[0].id;
    } else {
      const newClientRef = db.collection(`tenants/${tenantId}/clients`).doc();
      clientId = newClientRef.id;
      await newClientRef.set({
        id: clientId,
        name: order.customerName || 'Guest',
        email,
        phone: order.customerPhone || '',
        avatarUrl: `https://picsum.photos/seed/${clientId}/100`,
        lifetimeValue: 0,
        status: 'active',
        createdAt: new Date().toISOString(),
      });
    }
  }

  const qrToken = makeQrToken(orderId);
  const now = new Date().toISOString();

  // ── placed → paid + stock reservation, atomically ────────────────────────
  await db.runTransaction(async (txn: any) => {
    const freshSnap = await txn.get(orderRef);
    if (!freshSnap.exists || freshSnap.data().stage !== 'placed') return;
    const fresh = freshSnap.data();

    const itemRefs = (fresh.lines || []).map((l: any) =>
      db.collection(`tenants/${tenantId}/inventory`).doc(l.productId)
    );
    const itemSnaps = await Promise.all(itemRefs.map((r: any) => txn.get(r)));

    itemSnaps.forEach((snap: any, i: number) => {
      if (!snap.exists) {
        console.warn(`[connect-webhook] inventory item ${fresh.lines[i].productId} missing — reservation skipped`);
        return;
      }
      const current = snap.data().stockReserved ?? 0;
      txn.update(itemRefs[i], { stockReserved: current + fresh.lines[i].qtyOrdered });
    });

    txn.update(orderRef, {
      stage: 'paid',
      paidAt: now,
      qrToken,
      clientId: clientId || fresh.clientId || null,
      stripePaymentIntentId: piId,
      stripeCheckoutSessionId: session.id,
    });
  });

  // Re-read to confirm the transition actually happened (a racing retry may
  // have won); if we didn't flip it, skip the side effects too.
  const confirmed = await orderRef.get();
  if (confirmed.data()?.qrToken !== qrToken) return;

  // ── Audit events + income transaction (batched) ─────────────────────────
  const batch = db.batch();
  const eventsCol = orderRef.collection('events');

  const evPaid = eventsCol.doc();
  batch.set(evPaid, {
    id: evPaid.id,
    ...buildEvent('payment_confirmed', 'system', 'Stripe', {
      checkoutSessionId: String(session.id),
      amountCents: Number(session.amount_total ?? order.totalCents),
      amountMatched: session.amount_total == null || session.amount_total === order.totalCents,
    }),
  });

  const evReserved = eventsCol.doc();
  batch.set(evReserved, {
    id: evReserved.id,
    ...buildEvent('stock_reserved', 'system', 'Retail Engine', {
      lineCount: (order.lines || []).length,
      units: (order.lines || []).reduce((a: number, l: any) => a + l.qtyOrdered, 0),
      qr: buildOrderQrValue(qrToken),
    }),
  });

  const txnRef = db.collection(`tenants/${tenantId}/transactions`).doc();
  batch.set(txnRef, {
    id: txnRef.id,
    date: now,
    description: `${order.priceTier === 'wholesale' ? 'Wholesale Sale' : 'Online Retail Sale'} — Order #${String(order.orderNumber).padStart(4, '0')}${order.poNumber ? ` (PO ${order.poNumber})` : ''}`,
    clientOrVendor: order.customerName || 'Guest',
    clientId: clientId || null,
    type: 'income',
    context: 'Business',
    category: 'Retail',
    taxBucket: 'revenue',
    amount: (order.totalCents || 0) / 100,
    paymentMethod: 'Online Checkout',
    hasReceipt: false,
    retailOrderId: orderId,
    checkoutSessionId: session.id,
    stripeChargeId: chargeId,
    stripeConnectedAccountId: connAcct,
    tenantId,
  });

  await batch.commit();
  console.log(`[connect-webhook] Retail order ${orderId} paid — stock reserved for tenant ${tenantId}`);

  // ── Stripe processing fee ────────────────────────────────────────────────
  // Booked here rather than waiting on charge.succeeded: that event may not be
  // enabled on the endpoint, and even when it is, it arrives BEFORE this sale
  // row exists — so the fee could never link itself to the order. Running it
  // now means every completed order shows both its revenue and its true cost.
  // Idempotent (deterministic doc id), so the webhook doing it too is harmless.
  await bookFee();
}

/* ── Self-healing reconcile ──────────────────────────────────────────────────
 *
 * The webhook is the fast path, not the only path. When it does not arrive —
 * the endpoint is missing the event, a delivery failed, the secret rotated —
 * a customer who paid is left staring at an order stuck in 'placed' forever
 * while the studio never sees it. This asks Stripe directly what happened to
 * the session and finishes the job.
 *
 * Called from the storefront status poll, so it heals within seconds of the
 * customer returning from Stripe. Everything it calls is idempotent, so it
 * races the webhook safely — whichever wins, the work happens exactly once.
 */

const RECONCILE_COOLDOWN_MS = 8_000;
const lastReconcileAt = new Map<string, number>();

/**
 * Bring a 'placed' order in line with the truth at Stripe.
 * Returns true when something changed and the caller should re-read the order.
 */
export async function reconcileRetailOrderPayment(
  db: any,
  tenantId: string,
  orderId: string,
  order: any,
  stripeAccountId: string
): Promise<boolean> {
  if (order?.stage !== 'placed') return false;
  const sessionId = order?.stripeCheckoutSessionId;
  if (!sessionId || !stripeAccountId) return false;

  // Sessions live 24h; past that Stripe has expired it and the expiry webhook
  // (or the next poll) closes the order out. Nothing to chase indefinitely.
  const placedAt = Date.parse(order.placedAt || '');
  if (Number.isFinite(placedAt) && Date.now() - placedAt > 48 * 60 * 60_000) return false;

  // The status page polls every few seconds — don't call Stripe every time.
  const key = `${tenantId}/${orderId}`;
  const now = Date.now();
  if (now - (lastReconcileAt.get(key) || 0) < RECONCILE_COOLDOWN_MS) return false;
  if (lastReconcileAt.size > 500) {
    for (const [k, t] of lastReconcileAt) {
      if (now - t > RECONCILE_COOLDOWN_MS) lastReconcileAt.delete(k);
    }
  }
  lastReconcileAt.set(key, now);

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return false;

  try {
    const StripeMod = require('stripe');
    const Stripe = StripeMod.default || StripeMod;
    const stripe = new Stripe(secret, { apiVersion: '2025-04-30.basil' });

    const session = await stripe.checkout.sessions.retrieve(
      sessionId,
      { expand: ['payment_intent'] },
      { stripeAccount: stripeAccountId }
    );

    // Stripe's own metadata is missing on hand-created sessions from older
    // builds; make sure the handler can still find the order.
    session.metadata = { ...(session.metadata || {}), retailOrderId: orderId, tenantId, type: 'retail_order' };

    if (session.payment_status === 'paid') {
      let pi: any = session.payment_intent;
      if (typeof pi === 'string') {
        pi = await stripe.paymentIntents.retrieve(pi, {}, { stripeAccount: stripeAccountId });
      }
      const chargeId = typeof pi?.latest_charge === 'string'
        ? pi.latest_charge
        : pi?.latest_charge?.id || null;

      console.log(`[retail-reconcile] Order ${orderId} was paid but still 'placed' — completing it now`);
      await handleRetailOrderPaid(db, stripe, tenantId, stripeAccountId, session, chargeId);
      return true;
    }

    if (session.status === 'expired') {
      await handleRetailCheckoutExpired(db, tenantId, session);
      return true;
    }
  } catch (e) {
    // Never fail the customer's status page over this — it retries next poll.
    console.error(`[retail-reconcile] Could not reconcile order ${orderId}`, e);
  }
  return false;
}

/**
 * checkout.session.expired — the customer abandoned checkout (Stripe expires
 * sessions after 24h). The order sits harmlessly in 'placed' with no
 * reservations and no money; close it out so the board never shows it.
 * Idempotent: only acts on stage === 'placed'.
 */
export async function handleRetailCheckoutExpired(
  db: any,
  tenantId: string,
  session: any
): Promise<void> {
  const orderId = session.metadata?.retailOrderId;
  if (!orderId) return;

  const orderRef = db.collection(`tenants/${tenantId}/retailOrders`).doc(orderId);
  const snap = await orderRef.get();
  if (!snap.exists || snap.data().stage !== 'placed') return;

  const now = new Date().toISOString();
  const batch = db.batch();
  batch.set(orderRef, { stage: 'cancelled', cancelledAt: now }, { merge: true });
  const evRef = orderRef.collection('events').doc();
  batch.set(evRef, {
    id: evRef.id,
    ...buildEvent('cancelled', 'system', 'Stripe', { reason: 'checkout_expired' }),
  });
  await batch.commit();
  console.log(`[connect-webhook] Retail order ${orderId} expired unpaid — auto-cancelled`);
}

/* ─────────────────────────────────────────────────────────────────────────────
 * INSERTION INTO src/app/api/stripe/connect-webhook/route.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Add to the imports at the top of the file:
 *
 *      import { handleRetailOrderPaid, handleRetailCheckoutExpired } from '@/lib/retail-webhook';
 *
 * 2. Inside case 'checkout.session.completed', directly ABOVE the line
 *    `if (sessionType === 'deposit') {`, insert:
 *
 *      if (sessionType === 'retail_order') {
 *        await handleRetailOrderPaid(db, stripe2, tenant.id, connAcct, session, chargeId);
 *        break;
 *      }
 *
 * 3. Alongside the other top-level cases (e.g. directly above
 *    `case 'charge.succeeded': {`), insert this new case:
 *
 *      case 'checkout.session.expired': {
 *        const session = event.data.object as Stripe.Checkout.Session;
 *        if (session.metadata?.type === 'retail_order') {
 *          const tenant = await getTenant(connAcct);
 *          if (tenant) await handleRetailCheckoutExpired(db, tenant.id, session);
 *        }
 *        break;
 *      }
 *
 *    Then in the Stripe Dashboard, add `checkout.session.expired` to the
 *    connected-accounts webhook's enabled events.
 * ──────────────────────────────────────────────────────────────────────────── */
