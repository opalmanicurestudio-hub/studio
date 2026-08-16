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
 *   5. Post the sale to the ledger SPLIT BY BUCKET — merchandise + shipping
 *      as 'revenue' (with checkoutSessionId so the existing charge.succeeded
 *      handler backfills the exact Stripe fee onto exactly that one entry),
 *      collected sales tax as 'tax_collected' (a liability held for the
 *      state, never income), and the tip as 'gratuity'. One fused number
 *      would overstate revenue by the tax and the tip — money that was never
 *      the shop's to keep.
 *   6. Append payment_confirmed + stock_reserved audit events
 *
 * NOTE on oversell races: if two orders paid for the last unit simultaneously,
 * we still reserve in full here (stockReserved may exceed totalStock). The
 * shelf is the source of truth — the picker resolves it via the shortLine
 * partial-fulfillment flow. Payment confirmation is never blocked on stock.
 */

import { createHmac, timingSafeEqual } from 'crypto';

import { buildEvent, buildOrderQrValue } from '@/lib/retail-orders';
import { buildEntry } from '@/lib/stock-ledger';
import { getEmailBrand, brandedEmail, emailButton } from '@/lib/email-shell';

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
  let order = orderSnap.data();

  // Idempotency — Stripe retries events; only the first one does work.
  if (order.stage !== 'placed') return;

  // In stripe-tax mode the draft was written with taxCents 0 — Stripe only
  // learns the jurisdiction when the customer types an address — so the tax
  // exists nowhere but on the session until this handler writes it back.
  const clampCents = (v: any) => Math.max(0, Math.round(Number(v) || 0));
  const stripeTaxMode = order.taxMode === 'stripe';
  const sessionTaxCents = clampCents(session?.total_details?.amount_tax);
  const sessionTotalCents = session?.amount_total != null ? clampCents(session.amount_total) : null;

  // Sanity: what Stripe collected should match what we quoted at checkout.
  // In stripe-tax mode the quote deliberately excluded tax, so the honest
  // comparison adds Stripe's own tax figure back before crying mismatch —
  // and a store-credit discount LOWERS the collected amount on purpose, so
  // the expectation subtracts it too, or every credit order would cry wolf.
  const expectedTotal = (Number(order.totalCents) || 0)
    + (stripeTaxMode ? sessionTaxCents : 0)
    - Math.max(0, Number((order as any).storeCreditRequestedCents) || 0);
  if (sessionTotalCents != null && sessionTotalCents !== expectedTotal) {
    console.warn(
      `[connect-webhook] retail order ${orderId} amount mismatch: ` +
      `session ${sessionTotalCents} vs expected ${expectedTotal} — proceeding, flagging in events`
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

  // ── draft → paid: mint the number, reserve stock, all atomically ─────────
  // The order number is issued HERE and nowhere else. Checkout creates a draft
  // with orderNumber null; money landing is what turns it into a sale. Because
  // the mint lives inside the same transaction that flips the stage, a webhook
  // retry finds stage !== 'placed' and returns before touching the counter —
  // so a redelivered event can never burn a second number, and the sequence
  // stays gapless and in payment order.
  const counterRef = db.collection(`tenants/${tenantId}/counters`).doc('retailOrders');
  let assignedNumber: number | null = null;

  await db.runTransaction(async (txn: any) => {
    const freshSnap = await txn.get(orderRef);
    if (!freshSnap.exists || freshSnap.data().stage !== 'placed') return;
    const fresh = freshSnap.data();

    const itemRefs = (fresh.lines || []).map((l: any) =>
      db.collection(`tenants/${tenantId}/inventory`).doc(l.productId)
    );
    // Every read must precede every write in a Firestore transaction, so the
    // counter is read alongside the inventory docs rather than after them.
    const [counterSnap, itemSnaps] = await Promise.all([
      txn.get(counterRef),
      Promise.all(itemRefs.map((r: any) => txn.get(r))),
    ]);

    // A legacy order that already carries a number keeps it — this route has
    // to stay safe for anything created before drafts existed.
    assignedNumber = typeof fresh.orderNumber === 'number' && fresh.orderNumber > 0
      ? fresh.orderNumber
      : ((counterSnap.exists ? counterSnap.data().value : 0) || 0) + 1;
    txn.set(counterRef, { value: assignedNumber }, { merge: true });

    itemSnaps.forEach((snap: any, i: number) => {
      if (!snap.exists) {
        console.warn(`[connect-webhook] inventory item ${fresh.lines[i].productId} missing — reservation skipped`);
        return;
      }
      const current = snap.data().stockReserved ?? 0;
      if (fresh.lines[i].digital === true) return;
      // Pre-orders consume RUN SLOTS, not shelf stock (reserving stock that
      // doesn't exist yet would understate what everyone else can buy). The
      // slot is claimed HERE, inside the paid transaction, so two people
      // paying at once can't both take the last one.
      if (fresh.lines[i].preorder === true) {
        const d = snap.data() as any;
        const sold = Math.max(0, Math.floor(Number(d.preorderSold) || 0));
        txn.update(itemRefs[i], { preorderSold: sold + fresh.lines[i].qtyOrdered });
        return;
      }
      txn.update(itemRefs[i], { stockReserved: current + fresh.lines[i].qtyOrdered });
      // A hold that is never released hides stock from everyone forever, with
      // no symptom but a count that looks wrong. Recording both halves — the
      // hold here, the release at fulfilment — makes a leak findable.
      txn.set(orderRef.firestore.collection(`tenants/${tenantId}/stockCorrections`).doc(), buildEntry({
        productId: fresh.lines[i].productId,
        type: 'reserved',
        field: 'stockReserved',
        delta: fresh.lines[i].qtyOrdered,
        unit: (snap.data() as any).unit || 'units',
        reason: `Held for online order #${assignedNumber}`,
        actorId: 'system',
        actorName: 'Checkout',
        ref: { kind: 'order', id: orderId },
        balanceAfter: current + fresh.lines[i].qtyOrdered,
      }));
    });

    txn.update(orderRef, {
      orderNumber: assignedNumber,
      isDraft: false,
      // The customer's order page, the receipt email and every refund
      // calculation read these off the order — so the moment tax becomes
      // known it becomes part of the order, atomically with 'paid'.
      ...(fresh.taxMode === 'stripe' ? {
        taxCents: sessionTaxCents,
        ...(sessionTotalCents != null ? { totalCents: sessionTotalCents } : {}),
      } : {}),
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

  // Everything below (income transaction description, confirmation email) read
  // the PRE-transaction snapshot, whose orderNumber is still null on a draft.
  // Re-point them at the freshly numbered document.
  order = { ...order, ...(confirmed.data() || {}) };

  // ── DIGITAL-ONLY: nothing to pick, pack, or post. The receipt below IS the
  // delivery, so the order is finished the moment money lands — it must never
  // appear on the board as work nobody can do. Physical orders and mixed carts
  // are untouched: a mixed cart still has a parcel to fulfil.
  if ((order as any).digitalOnly === true && order.stage === 'paid') {
    try {
      const nowIso = new Date().toISOString();
      const dBatch = db.batch();
      dBatch.set(orderRef, { stage: 'completed', completedAt: nowIso }, { merge: true });
      const evD = orderRef.collection('events').doc();
      dBatch.set(evD, {
        id: evD.id, type: 'note', at: nowIso, actorId: 'system', actorName: 'Digital delivery',
        meta: { text: 'Digital order \u2014 delivered by email on payment, nothing to fulfil' },
      });
      await dBatch.commit();
      order = { ...order, stage: 'completed', completedAt: nowIso };
    } catch (e: any) {
      console.error('[retail-webhook] digital auto-complete failed (order is paid):', e?.message);
    }
  }

  // ── Store credit consumption. The checkout gave the discount UP FRONT on
  // the Stripe page; the credits burn only now, when money actually moved.
  // FIFO oldest-first, partial docs tracked via usedCents. A racing second
  // checkout can leave a shortfall — consumed < requested — which is
  // RECORDED on the order and flagged as an event instead of silently
  // eaten; a person settles the rare race, the books never lie.
  const requestedCredit = Math.max(0, Number((order as any).storeCreditRequestedCents) || 0);
  if (requestedCredit > 0) {
    try {
      const credSnap = await db.collection(`tenants/${tenantId}/depositCredits`)
        .where('clientEmail', '==', String(order.customerEmail || '').toLowerCase().trim())
        .where('status', '==', 'available')
        .limit(25).get();
      const docs = credSnap.docs
        .map((d: any) => ({ ref: d.ref, ...(d.data() || {}) }))
        .sort((a: any, b: any) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
      let remaining = requestedCredit;
      const consumeBatch = db.batch();
      for (const c of docs) {
        if (remaining <= 0) break;
        const avail = Math.max(0, (Number(c.amountCents) || 0) - (Number(c.usedCents) || 0));
        if (avail <= 0) continue;
        const take = Math.min(avail, remaining);
        remaining -= take;
        consumeBatch.set(c.ref, {
          usedCents: (Number(c.usedCents) || 0) + take,
          status: take >= avail ? 'used' : 'available',
          lastUsedAt: new Date().toISOString(),
          lastUsedOnRetailOrderId: orderId,
        }, { merge: true });
      }
      const consumed = requestedCredit - remaining;
      const evRef2 = orderRef.collection('events').doc();
      consumeBatch.set(evRef2, {
        id: evRef2.id, type: 'note', at: new Date().toISOString(),
        actorId: 'system', actorName: 'Store credit',
        meta: { text: remaining > 0
          ? `Store credit: $${(consumed / 100).toFixed(2)} of the $${(requestedCredit / 100).toFixed(2)} discount was still available \u2014 $${(remaining / 100).toFixed(2)} shortfall needs a look`
          : `Store credit applied \u2014 $${(consumed / 100).toFixed(2)} redeemed` },
      });
      if (remaining > 0) {
        consumeBatch.set(orderRef, { creditShortfallCents: remaining }, { merge: true });
      }
      await consumeBatch.commit();
    } catch (e: any) {
      console.error('[retail-webhook] store-credit consumption failed:', e?.message);
    }
  }

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

  // ── The ledger split ─────────────────────────────────────────────────────
  // order is the re-merged post-transaction snapshot, so in stripe-tax mode
  // taxCents/totalCents here are already the written-back real figures. Every
  // number is clamped and derived so junk cents on a legacy order degrade to
  // zero instead of a negative posting.
  const grossCents = clampCents(order.totalCents);
  const taxCollectedCents = clampCents(order.taxCents);
  const tipCollectedCents = clampCents(order.tipCents);
  const shippingCollectedCents = clampCents(order.shippingCents);
  const merchandiseCents = Math.max(
    0, grossCents - taxCollectedCents - tipCollectedCents - shippingCollectedCents
  );
  const orderLabel = `Order #${String(order.orderNumber).padStart(4, '0')}`;

  // Merchandise + shipping = the shop's actual revenue. This entry alone
  // carries checkoutSessionId, so the charge.succeeded fee backfill still
  // finds exactly one 'revenue' transaction to stamp the Stripe fee onto.
  const txnRef = db.collection(`tenants/${tenantId}/transactions`).doc();
  batch.set(txnRef, {
    id: txnRef.id,
    date: now,
    description: `${order.priceTier === 'wholesale' ? 'Wholesale Sale' : 'Online Retail Sale'} — ${orderLabel}${order.poNumber ? ` (PO ${order.poNumber})` : ''}`,
    clientOrVendor: order.customerName || 'Guest',
    clientId: clientId || null,
    type: 'income',
    context: 'Business',
    category: 'Retail',
    taxBucket: 'revenue',
    amount: (merchandiseCents + shippingCollectedCents) / 100,
    grossOrderTotal: grossCents / 100,
    merchandiseSubtotal: merchandiseCents / 100,
    shippingCollected: shippingCollectedCents / 100,
    paymentMethod: 'Online Checkout',
    hasReceipt: false,
    retailOrderId: orderId,
    checkoutSessionId: session.id,
    stripeChargeId: chargeId,
    stripeConnectedAccountId: connAcct,
    tenantId,
  });

  // Tax collected is the state's money passing through — 'tax_collected'
  // keeps it out of revenue so income is never overstated and the quarterly
  // remittance figure is one filtered column. A tax-exempt wholesale order
  // carries zero tax and posts nothing here.
  if (taxCollectedCents > 0) {
    const taxRef = db.collection(`tenants/${tenantId}/transactions`).doc();
    batch.set(taxRef, {
      id: taxRef.id,
      date: now,
      description: `Sales tax collected — ${orderLabel}`,
      clientOrVendor: order.customerName || 'Guest',
      clientId: clientId || null,
      type: 'income',
      context: 'Business',
      category: 'Tax Collected',
      taxBucket: 'tax_collected',
      amount: taxCollectedCents / 100,
      taxMode: order.taxMode || 'flat',
      paymentMethod: 'Online Checkout',
      hasReceipt: false,
      retailOrderId: orderId,
      stripeConnectedAccountId: connAcct,
      tenantId,
    });
  }

  if (tipCollectedCents > 0) {
    const tipRef = db.collection(`tenants/${tenantId}/transactions`).doc();
    batch.set(tipRef, {
      id: tipRef.id,
      date: now,
      description: `Tip — ${orderLabel}`,
      clientOrVendor: order.customerName || 'Guest',
      clientId: clientId || null,
      type: 'income',
      context: 'Business',
      category: 'Tips',
      taxBucket: 'gratuity',
      amount: tipCollectedCents / 100,
      paymentMethod: 'Online Checkout',
      hasReceipt: false,
      retailOrderId: orderId,
      stripeConnectedAccountId: connAcct,
      tenantId,
    });
  }

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
export async function sendOrderConfirmation(
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
  let emailBrand = { shopName: 'Your shop', brandColor: '#16171a' };
  try {
    const tSnap = await db.collection('tenants').doc(tenantId).get();
    if (tSnap.exists) {
      const t = tSnap.data() || {};
      shopName = String(t.businessName || t.name || shopName);
      emailBrand = {
        shopName,
        brandColor: (typeof t?.retailSettings?.shopTheme?.brand === 'string' && /^#[0-9a-fA-F]{6}$/.test(t.retailSettings.shopTheme.brand.trim()))
          ? t.retailSettings.shopTheme.brand.trim() : '#16171a',
      };
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

  const creditCents = Math.max(0, Number(order.storeCreditRequestedCents) || 0);
  const fullCredit = String(order.paidVia || '') === 'store_credit';
  const chargedCents = fullCredit
    ? 0
    : (session?.amount_total ?? Math.max(0, (Number(order.totalCents) || 0) - creditCents));

  const method = String(order.method || 'pickup');
  const nextStep = method === 'ship'
    ? 'We\u2019ll email tracking as soon as your package ships.'
    : method === 'curbside'
      ? 'We\u2019ll text or email when it\u2019s ready \u2014 tap the link below when you arrive and we\u2019ll bring it out.'
      : 'We\u2019ll let you know the moment it\u2019s ready for pickup \u2014 your QR code is on the order page.';
  const pickupNote = order.pickupAt && order.pickupAt !== 'ASAP'
    ? `<p style="font-size:13px;color:#0f172a">Requested time: <strong>${String(order.pickupAt)}</strong></p>`
    : '';

  const emailBody = `
    <p style="font-size:16px;color:#0f172a;margin:0 0 8px"><strong>Thanks${order.customerName ? `, ${String(order.customerName).split(' ')[0]}` : ''}!</strong> Your order ${num} is confirmed.</p>
    <p style="font-size:13px;color:#64748b">${nextStep}</p>
    ${pickupNote}
    <table style="width:100%;border-collapse:collapse;margin:16px 0;border-top:2px solid #e2e8f0;border-bottom:2px solid #e2e8f0">
      ${rows}
    </table>
    <table style="width:100%;border-collapse:collapse">
      <tr><td style="font-size:13px;color:#64748b">Subtotal</td><td style="font-size:13px;text-align:right;color:#0f172a">${money(order.subtotalCents)}</td></tr>
      ${(order.shippingCents || 0) > 0 ? `<tr><td style="font-size:13px;color:#64748b">Shipping</td><td style="font-size:13px;text-align:right;color:#0f172a">${money(order.shippingCents)}</td></tr>` : ''}
      ${(order.taxCents || 0) > 0 ? `<tr><td style="font-size:13px;color:#64748b">Sales tax</td><td style="font-size:13px;text-align:right;color:#0f172a">${money(order.taxCents)}</td></tr>` : ''}
      ${(order.tipCents || 0) > 0 ? `<tr><td style="font-size:13px;color:#64748b">Tip</td><td style="font-size:13px;text-align:right;color:#0f172a">${money(order.tipCents)}</td></tr>` : ''}
      ${creditCents > 0 ? `<tr><td style="font-size:13px;color:#64748b">Order total</td><td style="font-size:13px;text-align:right;color:#0f172a">${money(order.totalCents)}</td></tr>
      <tr><td style="font-size:13px;color:#0f766e;font-weight:700">Store credit applied</td><td style="font-size:13px;text-align:right;color:#0f766e;font-weight:700">\u2212${money(creditCents)}</td></tr>` : ''}
      <tr><td style="font-size:14px;font-weight:700;color:#0f172a;padding-top:6px">${creditCents > 0 ? 'Charged to card' : 'Total paid'}</td><td style="font-size:14px;font-weight:700;text-align:right;color:#0f172a;padding-top:6px">${money(chargedCents)}</td></tr>
      ${fullCredit ? `<tr><td colspan="2" style="font-size:12px;color:#0f766e;padding-top:2px">Paid in full with store credit \u2014 nothing was charged to a card.</td></tr>` : ''}
    </table>
    ${(order.lines || []).some((l: any) => l.digital === true && l.digitalUrl)
      ? `<div style="border:2px solid #e2e8f0;border-radius:12px;padding:14px;margin:16px 0">
           <p style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#64748b;margin:0 0 8px">Ready now</p>
           ${(order.lines || []).filter((l: any) => l.digital === true && l.digitalUrl).map((l: any) =>
             `<p style="font-size:13px;color:#0f172a;margin:0 0 6px"><a href="${l.digitalUrl}" style="color:#0f172a;font-weight:700">${l.name}</a></p>`).join('')}
           <p style="font-size:11px;color:#94a3b8;margin:8px 0 0">These links are also on your order page, any time you need them again.</p>
         </div>`
      : ''}
    ${emailButton(`${origin}/shop/${tenantId}/order/${orderId}`, 'View my order', emailBrand)}`;
  const html = brandedEmail(emailBrand, emailBody, { preheader: `Order ${num} confirmed` });

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

  // Recovery email — AFTER the commit, never inside it (transactions retry;
  // an email inside the body would apologise three times). Double-send is
  // impossible by construction: a webhook retry finds stage !== 'placed' and
  // exits above before reaching here. The failure direction is deliberate —
  // if the send dies, the customer just isn't emailed; the order is still
  // cleanly cancelled.
  await sendCartRecovery(db, tenantId, snap.data(), session);
}

/**
 * "Your cart is waiting" — the customer typed their details, saw the total,
 * and walked at the payment screen. Their cart still lives in their browser,
 * so one link puts them back exactly where they stood. One email, sent once,
 * only to an address the customer themselves entered minutes earlier; a shop
 * can switch it off with retailSettings.cartRecoveryEnabled = false.
 */
async function sendCartRecovery(
  db: any,
  tenantId: string,
  order: any,
  session: any
): Promise<void> {
  try {
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const RESEND_FROM = process.env.RESEND_FROM;
    const to = String(order?.customerEmail || '').trim();
    if (!RESEND_API_KEY || !RESEND_FROM || !to) return;

    let origin = String(process.env.NEXT_PUBLIC_APP_URL || '').trim();
    try {
      if (session?.success_url) origin = new URL(String(session.success_url)).origin;
    } catch {
      // keep the env fallback
    }
    if (!origin) return;

    let shopName = 'the shop';
    let emailBrand = { shopName: 'the shop', brandColor: '#16171a' };
    let enabled = true;
    try {
      const tSnap = await db.collection('tenants').doc(tenantId).get();
      if (tSnap.exists) {
        const t = tSnap.data() || {};
        shopName = String(t.businessName || t.name || shopName);
        emailBrand = {
          shopName,
          brandColor: (typeof t?.retailSettings?.shopTheme?.brand === 'string' && /^#[0-9a-fA-F]{6}$/.test(t.retailSettings.shopTheme.brand.trim()))
            ? t.retailSettings.shopTheme.brand.trim() : '#16171a',
        };
        enabled = (t.retailSettings || {}).cartRecoveryEnabled !== false;
      }
    } catch {
      // name is cosmetic; default stays enabled
    }
    if (!enabled) return;

    const lines = Array.isArray(order?.lines) ? order.lines : [];
    const firstName = String(order?.customerName || '').trim().split(/\s+/)[0] || 'there';
    const money = (c: any) => ((Math.max(0, Math.round(Number(c) || 0))) / 100)
      .toLocaleString('en-US', { style: 'currency', currency: 'USD' });

    const rows = lines.slice(0, 8).map((l: any) =>
      `<tr><td style="font-size:13px;color:#0f172a;padding:4px 0">${String(l.name || 'Item')}${Number(l.qtyOrdered) > 1 ? ` \u00d7 ${Number(l.qtyOrdered)}` : ''}</td></tr>`
    ).join('');

    const recoveryBody = `
      <p style="font-size:14px;color:#0f172a;font-weight:700;margin:0 0 8px">Hi ${firstName},</p>
      <p style="font-size:14px;color:#334155;line-height:1.6">Your cart at <strong>${shopName}</strong> is still saved — checkout timed out before payment went through, and nothing was charged.</p>
      <table style="border-collapse:collapse;margin:14px 0">${rows}</table>
      ${order?.subtotalCents ? `<p style="font-size:13px;color:#64748b">Subtotal ${money(order.subtotalCents)}</p>` : ''}
      ${emailButton(`${origin}/shop/${tenantId}/checkout`, 'Finish my order', emailBrand)}
      <p style="font-size:12px;color:#94a3b8;line-height:1.6">Stock isn't held forever, so popular items can sell out. If you already placed this order or changed your mind, just ignore this — you won't hear from us about it again.</p>`;
    const html = brandedEmail(emailBrand, recoveryBody, { preheader: 'Your cart is still saved — nothing was charged' });

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [to],
        subject: `Your cart at ${shopName} is still saved`,
        html,
      }),
    });
    console.log(`[connect-webhook] Cart recovery email sent for expired order to ${to}`);
  } catch (e: any) {
    console.warn('[connect-webhook] Cart recovery email failed (non-fatal):', e?.message || e);
  }
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


/**
 * "You've received store credit" — sent at ISSUANCE, not redemption. Shows
 * the amount granted, the live balance, and the recent history (grants and
 * spends), because a credit nobody knows about is a refund the customer
 * thinks they never got. Caller supplies balance and history so the same
 * renderer serves both credit systems.
 */
export async function sendStoreCreditEmail(
  db: any,
  tenantId: string,
  args: {
    toEmail: string;
    toName?: string;
    grantedCents: number;
    reason?: string;
    balanceCents: number;
    expiresAt?: string | null;
    history: { at: string; label: string; deltaCents: number }[];
  }
): Promise<boolean> {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const RESEND_FROM = process.env.RESEND_FROM;
  const to = String(args.toEmail || '').trim();
  if (!RESEND_API_KEY || !RESEND_FROM || !to) return false;

  const emailBrand = await getEmailBrand(db, tenantId);
  const money = (c: number) => `$${((Number(c) || 0) / 100).toFixed(2)}`;
  const first = String(args.toName || '').split(' ')[0];
  const origin = String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');

  const fmtDay = (iso: string) => {
    const t = Date.parse(String(iso || ''));
    if (!Number.isFinite(t)) return '';
    return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const historyRows = (args.history || []).slice(0, 10).map((h) => `<tr>
      <td style="padding:6px 0;font-size:12px;color:#64748b">${fmtDay(h.at)}</td>
      <td style="padding:6px 0 6px 10px;font-size:12px;color:#0f172a">${h.label}</td>
      <td style="padding:6px 0;font-size:12px;text-align:right;font-weight:700;color:${h.deltaCents >= 0 ? '#0f766e' : '#0f172a'}">${h.deltaCents >= 0 ? '+' : '\u2212'}${money(Math.abs(h.deltaCents))}</td>
    </tr>`).join('');

  const emailBody = `
    <p style="font-size:16px;color:#0f172a;margin:0 0 8px"><strong>${first ? `${first}, y` : 'Y'}ou've received store credit.</strong></p>
    <div style="border:2px solid #e2e8f0;border-radius:16px;padding:18px;margin:14px 0;text-align:center">
      <p style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#64748b;margin:0 0 4px">Added to your account</p>
      <p style="font-size:30px;font-weight:800;color:#0f766e;margin:0">${money(args.grantedCents)}</p>
      ${args.reason ? `<p style="font-size:12px;color:#64748b;margin:8px 0 0">${String(args.reason)}</p>` : ''}
    </div>
    <table style="width:100%;border-collapse:collapse;margin:0 0 4px">
      <tr>
        <td style="font-size:13px;font-weight:700;color:#0f172a;padding:8px 0">Your balance</td>
        <td style="font-size:16px;font-weight:800;text-align:right;color:#0f172a;padding:8px 0">${money(args.balanceCents)}</td>
      </tr>
    </table>
    ${args.expiresAt ? `<p style="font-size:12px;color:#64748b;margin:0 0 12px">This credit is good through <strong>${fmtDay(args.expiresAt)}</strong>.</p>` : ''}
    ${historyRows ? `<p style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#64748b;margin:14px 0 4px">Recent activity</p>
    <table style="width:100%;border-collapse:collapse;border-top:2px solid #e2e8f0;border-bottom:2px solid #e2e8f0">${historyRows}</table>` : ''}
    <p style="font-size:13px;color:#64748b;margin:14px 0 0">Spend it at checkout \u2014 tick \u201cApply my store credit\u201d under this email address and it comes straight off your total. Use as much or as little as you like; the rest stays on your account.</p>
    ${origin ? emailButton(`${origin}/shop/${tenantId}/catalog`, 'Browse the shop', emailBrand) : ''}`;

  const html = brandedEmail(emailBrand, emailBody, { preheader: `${money(args.grantedCents)} in store credit added \u2014 balance ${money(args.balanceCents)}` });

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [to],
      subject: `${emailBrand.shopName} \u2014 ${money(args.grantedCents)} store credit added`,
      html,
    }),
  });
  if (!res.ok) {
    console.error('[credit-email] Resend rejected:', (await res.text()).slice(0, 160));
    return false;
  }
  return true;
}
