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
 *      checkoutSessionId so the existing charge.succeeded handler backfills
 *      the exact Stripe fee automatically)
 *   6. Append payment_confirmed + stock_reserved audit events
 *
 * NOTE on oversell races: if two orders paid for the last unit simultaneously,
 * we still reserve in full here (stockReserved may exceed totalStock). The
 * shelf is the source of truth — the picker resolves it via the shortLine
 * partial-fulfillment flow. Payment confirmation is never blocked on stock.
 */

import { createHmac, timingSafeEqual } from 'crypto';

import { buildEvent, buildOrderQrValue } from '@/lib/retail-orders';

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

  // Idempotency — Stripe retries events; only the first one does work.
  if (order.stage !== 'placed') return;

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

  // Confirmation email — the receipt the customer expects within seconds of
  // paying. Best-effort by design: a mail failure must never roll back a
  // completed payment, so it runs after the commit and swallows its errors.
  try {
    await sendOrderConfirmation(db, tenantId, orderId, order, session);
  } catch (e: any) {
    console.error('[connect-webhook] confirmation email failed:', e?.message);
  }
}

/**
 * Order confirmation email (Resend). Pickup/curbside orders get the live
 * order-page link that carries their QR; shipping orders get the same link,
 * which fills with tracking the moment a label is bought.
 */
async function sendOrderConfirmation(
  db: any,
  tenantId: string,
  orderId: string,
  order: any,
  session: any
): Promise<void> {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const RESEND_FROM = process.env.RESEND_FROM;
  const to = String(order.customerEmail || '').trim();
  if (!RESEND_API_KEY || !RESEND_FROM || !to) return;

  let origin = String(process.env.NEXT_PUBLIC_APP_URL || '').trim();
  try {
    if (session?.success_url) origin = new URL(String(session.success_url)).origin;
  } catch {
    // keep the env fallback
  }
  if (!origin) return;

  let shopName = 'Your order';
  try {
    const tSnap = await db.collection('tenants').doc(tenantId).get();
    if (tSnap.exists) {
      const t = tSnap.data() || {};
      shopName = String(t.businessName || t.name || shopName);
    }
  } catch {
    // name is cosmetic
  }

  const num = `#${String(order.orderNumber ?? '').padStart(4, '0')}`;
  const money = (c: number) => `$${((Number(c) || 0) / 100).toFixed(2)}`;
  const rows = (order.lines || []).map((l: any) => {
    const opts = l.optionsLabel ? ` <span style="color:#64748b">(${String(l.optionsLabel)})</span>` : '';
    return `<tr>
      <td style="padding:6px 0;font-size:13px;color:#0f172a">${l.qtyOrdered}× ${String(l.name || 'Item')}${opts}</td>
      <td style="padding:6px 0;font-size:13px;color:#0f172a;text-align:right">${money((l.unitPriceCents || 0) * (l.qtyOrdered || 0))}</td>
    </tr>`;
  }).join('');

  const method = String(order.method || 'pickup');
  const nextStep = method === 'ship'
    ? 'We\u2019ll email tracking as soon as your package ships.'
    : method === 'curbside'
      ? 'We\u2019ll text or email when it\u2019s ready \u2014 tap the link below when you arrive and we\u2019ll bring it out.'
      : 'We\u2019ll let you know the moment it\u2019s ready for pickup \u2014 your QR code is on the order page.';
  const pickupNote = order.pickupAt && order.pickupAt !== 'ASAP'
    ? `<p style="font-size:13px;color:#0f172a">Requested time: <strong>${String(order.pickupAt)}</strong></p>`
    : '';

  const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;padding:8px">
    <p style="font-size:16px;color:#0f172a"><strong>Thanks${order.customerName ? `, ${String(order.customerName).split(' ')[0]}` : ''}!</strong> Your order ${num} is confirmed.</p>
    <p style="font-size:13px;color:#64748b">${nextStep}</p>
    ${pickupNote}
    <table style="width:100%;border-collapse:collapse;margin:16px 0;border-top:2px solid #e2e8f0;border-bottom:2px solid #e2e8f0">
      ${rows}
    </table>
    <table style="width:100%;border-collapse:collapse">
      <tr><td style="font-size:13px;color:#64748b">Subtotal</td><td style="font-size:13px;text-align:right;color:#0f172a">${money(order.subtotalCents)}</td></tr>
      ${(order.shippingCents || 0) > 0 ? `<tr><td style="font-size:13px;color:#64748b">Shipping</td><td style="font-size:13px;text-align:right;color:#0f172a">${money(order.shippingCents)}</td></tr>` : ''}
      ${(order.tipCents || 0) > 0 ? `<tr><td style="font-size:13px;color:#64748b">Tip</td><td style="font-size:13px;text-align:right;color:#0f172a">${money(order.tipCents)}</td></tr>` : ''}
      <tr><td style="font-size:14px;font-weight:700;color:#0f172a;padding-top:6px">Total paid</td><td style="font-size:14px;font-weight:700;text-align:right;color:#0f172a;padding-top:6px">${money(session?.amount_total ?? order.totalCents)}</td></tr>
    </table>
    <p style="text-align:center;margin:24px 0">
      <a href="${origin}/shop/${tenantId}/order/${orderId}" style="background:#111827;color:#ffffff;padding:14px 30px;border-radius:12px;text-decoration:none;font-weight:700;font-size:13px">View my order</a>
    </p>
    <p style="font-size:11px;color:#94a3b8;text-align:center">${shopName}</p>
  </div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [to],
      subject: `${shopName} \u2014 order ${num} confirmed`,
      html,
    }),
  });
  if (!res.ok) {
    console.error('[connect-webhook] Resend rejected confirmation:', (await res.text()).slice(0, 160));
  }
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
