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

import { onlineSellable } from './retail-orders';
import { assessRisk, riskPolicy, type RiskResult } from './retail-risk';
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
    - Math.max(0, Number((order as any).storeCreditRequestedCents) || 0)
    - Math.max(0, Number((order as any).giftCardCents) || 0);
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

  // ── Should this order wait for a person? (lib/retail-risk) Read before the transaction; written with 'paid'. ──
  let risk: RiskResult | null = null;
  try {
    const rsNow = ((await db.collection('tenants').doc(tenantId).get()).data() as any)?.retailSettings || {};
    const pol = riskPolicy(rsNow);
    if (pol.mode === 'auto' && order.digitalOnly !== true) {
      let charge: any = null;
      if (chargeId && stripe) { try { charge = await stripe.charges.retrieve(chargeId, {}, connAcct ? { stripeAccount: connAcct } : undefined); } catch { /* judged without it */ } }
      let prior = 0;
      if (email) { try { const p = await db.collection(`tenants/${tenantId}/retailOrders`).where('customerEmail', '==', order.customerEmail).limit(10).get(); prior = p.docs.filter((d: any) => d.id !== orderId && ['shipped', 'handed_off', 'completed'].includes((d.data() as any).stage)).length; } catch { /* treated as new */ } }
      risk = assessRisk(order, charge, prior, pol);
    }
  } catch { risk = null; }

  // ── draft → paid: mint the number, reserve stock, all atomically ─────────
  // The order number is issued HERE and nowhere else. Checkout creates a draft
  // with orderNumber null; money landing is what turns it into a sale. Because
  // the mint lives inside the same transaction that flips the stage, a webhook
  // retry finds stage !== 'placed' and returns before touching the counter —
  // so a redelivered event can never burn a second number, and the sequence
  // stays gapless and in payment order.
  const counterRef = db.collection(`tenants/${tenantId}/counters`).doc('retailOrders');
  let assignedNumber: number | null = null;

  // Did THIS call flip the order to paid? Set only by the attempt that commits (a retried attempt resets it), so
  // when the payment webhook, the payment cron and the customer's order page race, exactly one runs the side effects.
  let won = false;
  await db.runTransaction(async (txn: any) => {
    won = false;
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

    // Two lines can be the same shelf item (one product, different options): add up, don't overwrite.
    const addedReserved = new Map<string, number>(); const addedPreorder = new Map<string, number>();
    itemSnaps.forEach((snap: any, i: number) => {
      if (!snap.exists) {
        console.warn(`[connect-webhook] inventory item ${fresh.lines[i].productId} missing — reservation skipped`);
        return;
      }
      const pid = String(fresh.lines[i].productId);
      const current = (snap.data().stockReserved ?? 0) + (addedReserved.get(pid) || 0);
      if (fresh.lines[i].digital === true) return;
      // Pre-orders consume RUN SLOTS, not shelf stock (reserving stock that
      // doesn't exist yet would understate what everyone else can buy). The
      // slot is claimed HERE, inside the paid transaction, so two people
      // paying at once can't both take the last one.
      if (fresh.lines[i].preorder === true) {
        const d = snap.data() as any;
        const sold = Math.max(0, Math.floor(Number(d.preorderSold) || 0)) + (addedPreorder.get(pid) || 0);
        txn.update(itemRefs[i], { preorderSold: sold + fresh.lines[i].qtyOrdered });
        addedPreorder.set(pid, (addedPreorder.get(pid) || 0) + fresh.lines[i].qtyOrdered);
        return;
      }
      txn.update(itemRefs[i], { stockReserved: current + fresh.lines[i].qtyOrdered });
      addedReserved.set(pid, (addedReserved.get(pid) || 0) + fresh.lines[i].qtyOrdered);
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
      ...(sessionTotalCents != null ? { chargedCents: sessionTotalCents } : {}),
      qrToken,
      clientId: clientId || fresh.clientId || null,
      stripePaymentIntentId: piId,
      stripeCheckoutSessionId: session.id,
      ...(risk ? { riskCheck: { at: now, level: risk.riskLevel, score: risk.riskScore, reasons: risk.reasons } } : {}),
      ...(risk?.hold ? { holdForReview: true, holdAuto: true, holdReason: risk.reasons.join(' · '), heldAt: now, heldBy: 'Automatic check' } : {}),
    });
    won = true;
  });
  if (!won) return;
  if (risk?.hold) {
    try { const n = db.collection(`tenants/${tenantId}/notifications`).doc(); await n.set({ id: n.id, type: 'order_held', read: false, createdAt: now, link: `/retail-orders/problems?order=${orderId}`, message: `Order #${String(assignedNumber ?? '').padStart(4, '0')} is held for review: ${risk.reasons[0]}` }); } catch { /* the Problems list shows it */ }
  }
  // Running low online? Tell the team the moment an order takes an item down to its alert level, once per drop.
  try {
    const qtyBy = new Map<string, number>();
    for (const l of (order.lines || [])) if (l.digital !== true && l.productId) qtyBy.set(String(l.productId), (qtyBy.get(String(l.productId)) || 0) + (Number(l.qtyOrdered) || 0));
    for (const [pid, q] of qtyBy) {
      const it: any = (await db.collection(`tenants/${tenantId}/inventory`).doc(pid).get()).data(); if (!it) continue;
      const at = Math.max(0, Math.floor(Number(it.lowStockThreshold) || 0)); if (at <= 0) continue;
      const after = onlineSellable(it); const before = after + q;
      if (after <= at && before > at) {
        const n = db.collection(`tenants/${tenantId}/notifications`).doc();
        await n.set({ id: n.id, type: 'low_stock', read: false, createdAt: now, link: `/inventory/product/${pid}`, message: after <= 0 ? `${it.name} just sold out online.` : `${it.name} is running low online: ${after} left.` });
      }
    }
  } catch { /* the inventory screen shows it too */ }
  const confirmed = await orderRef.get();

  // Everything below (income transaction description, confirmation email) read
  // the PRE-transaction snapshot, whose orderNumber is still null on a draft.
  // Re-point them at the freshly numbered document.
  order = { ...order, ...(confirmed.data() || {}) };

  // Loyalty (lib/loyalty): the order's products earn, once.
  try { const tSnap = await db.doc(`tenants/${tenantId}`).get(); const { earnForShopOrder } = await import('@/lib/loyalty-server'); await earnForShopOrder(db, tenantId, tSnap.data() || {}, orderId, order); } catch (e) { console.error('[retail-webhook] loyalty', e); }
  // A promo code on the order: one more use, counted once (lib/promo-codes-server).
  if ((order as any)?.promo?.discountId) { try { const { countPromoUse } = await import('@/lib/promo-codes-server'); await countPromoUse(db, tenantId, orderId); } catch (e) { console.error('[retail-webhook] promo use', e); } }

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
  // ── A gift card on the order: spend what was set aside for it (the discount was given on the payment page).
  const giftCents = Math.max(0, Number((order as any).giftCardCents) || 0);
  if (giftCents > 0 && (order as any).giftCardId && !(order as any).giftSpentAt) {
    try { const { spendGiftCard, notifyGiftUse } = await import('@/lib/gift-cards');
      const { nonCardRecordRef } = await import('@/lib/non-card-back');
      // Written down where only the server writes, in the same step as the spend (lib/non-card-back): what a refund or
      // cancellation gives back. A spend already written down for the order isn't made again.
      const r: any = await spendGiftCard(db, tenantId, { id: String((order as any).giftCardId), cents: giftCents, holdId: `retail_${orderId}`, by: 'Online shop', transactionRef: session.id, record: nonCardRecordRef(db, tenantId, orderId) });
      if (!r.already) {
        const ev = orderRef.collection('events').doc();
        await ev.set({ id: ev.id, type: 'note', at: new Date().toISOString(), actorId: 'system', actorName: 'Gift card',
          meta: { text: r.ok ? `Gift card ${(order as any).giftCardCode} — $${(giftCents / 100).toFixed(2)} redeemed` : `Gift card ${(order as any).giftCardCode} couldn’t be charged ($${(giftCents / 100).toFixed(2)}): ${r.error} — needs a look` } });
      }
      await orderRef.set(r.ok ? { giftSpentAt: new Date().toISOString() } : { giftShortfallCents: giftCents }, { merge: true });
      if (r.ok && !r.already) void notifyGiftUse(db, tenantId, String((order as any).giftCardId), giftCents).catch(() => {});
    } catch (e: any) { console.error('[retail-webhook] gift card spend failed:', e?.message); }
  }
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
      // The shortfall is recorded every time (0 when the credit was all there): it marks the credit as really taken,
      // so a cancellation or refund gives back exactly what was spent (lib/non-card-back).
      consumeBatch.set(orderRef, { creditShortfallCents: remaining }, { merge: true });
      // And where only the server writes (lib/non-card-back): what a refund or cancellation gives back.
      consumeBatch.set(db.doc(`tenants/${tenantId}/private/nonCardPaid/orders/${orderId}`), { creditCents: consumed, at: new Date().toISOString() }, { merge: true });
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
  const RESEND_FROM = process.env.NOTIFY_FROM_EMAIL || process.env.RESEND_FROM;
  const to = String(order.customerEmail || '').trim();
  if (!RESEND_API_KEY || !RESEND_FROM || !to) return;

  let origin = String(process.env.NEXT_PUBLIC_APP_URL || '').trim();
  try {
    if (session?.success_url) origin = new URL(String(session.success_url)).origin;
  } catch {
    // keep the env fallback
  }
  if (!origin) return;

  let shopName = 'Our team';
  let emailBrand = { shopName: 'Your shop', brandColor: '#16171a' };
  let shopSettings: any = {};
  try {
    const tSnap = await db.collection('tenants').doc(tenantId).get();
    if (tSnap.exists) {
      const t = tSnap.data() || {};
      shopSettings = t.retailSettings || {};
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
  const escapeHtml = (v: string) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c]);
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
  // The ship-by and arrival dates they were shown at checkout (lib/ship-promise), when the shop shows dates.
  const { busyLineFor, customerDates, dayLabel, arrivalLabel, scheduleFrom } = await import('./ship-promise');
  const dates = method === 'ship' ? customerDates(order) : null;
  // A busy period's line for an order placed during it, in the shop's own words (lib/ship-promise busyLineFor).
  const busyLine = dates ? busyLineFor(order.promise, scheduleFrom(shopSettings), 'email', dates.timeZone) : '';
  const nextStep = method === 'ship'
    ? dates
      ? 'We will let you know as soon as it ships, with tracking. If anything changes, your order page says so first.'
      : 'We will email you your tracking details as soon as your order ships.'
    : method === 'curbside'
      ? 'We will send you a text or email as soon as your order is ready. When you arrive, please tap the link below and we will bring it out to you.'
      : 'We will let you know as soon as your order is ready for pickup. Your QR code is on your order page.';
  const datesBlock = dates
    ? `<table style="width:100%;border-collapse:collapse;margin:14px 0;background:#f5f5f7;border-radius:12px">
      <tr><td style="padding:12px 14px 4px;font-size:14px;font-weight:700;color:#16171a">Ships by</td><td style="padding:12px 14px 4px;font-size:14px;font-weight:700;color:#16171a;text-align:right">${dayLabel(dates.shipBy, dates.timeZone)}</td></tr>
      ${dates.arriveFrom ? `<tr><td style="padding:4px 14px 12px;font-size:14px;color:#16171a">Arrives</td><td style="padding:4px 14px 12px;font-size:14px;color:#16171a;text-align:right">${arrivalLabel(dates, dates.timeZone)}</td></tr>` : '<tr><td colspan="2" style="padding:0 0 8px"></td></tr>'}
    </table>`
    : '';
  const pickupNote = order.pickupAt && order.pickupAt !== 'ASAP'
    ? `<p style="font-size:13px;color:#0f172a">Your requested pickup time: <strong>${String(order.pickupAt)}</strong></p>`
    : '';

  const emailBody = `
    <p style="font-size:14px;color:#0f172a;margin:0 0 8px">Hi ${order.customerName ? String(order.customerName).split(' ')[0] : 'there'},</p>
    <p style="font-size:14px;color:#0f172a;margin:0 0 8px">Thank you for your order. Your order ${num} is confirmed.</p>
    ${datesBlock}
    ${busyLine ? `<p style="font-size:13px;color:#0f172a;margin:0 0 8px">${escapeHtml(busyLine)}</p>` : ''}
    <p style="font-size:13px;color:#64748b">${nextStep}</p>
    ${pickupNote}
    <table style="width:100%;border-collapse:collapse;margin:16px 0;border-top:2px solid #e2e8f0;border-bottom:2px solid #e2e8f0">
      ${rows}
    </table>
    <table style="width:100%;border-collapse:collapse">
      <tr><td style="font-size:13px;color:#64748b">Subtotal</td><td style="font-size:13px;text-align:right;color:#0f172a">${money(order.subtotalCents)}</td></tr>
      ${(order.promo?.cents || 0) > 0 ? `<tr><td style="font-size:13px;color:#1f7a4d">${escapeHtml(String(order.promo.label || order.promo.code || 'Promo code'))}</td><td style="font-size:13px;text-align:right;color:#1f7a4d">\u2212${money(order.promo.cents)}</td></tr>` : ''}
      ${order.promo?.freeShipping ? `<tr><td style="font-size:13px;color:#1f7a4d">${escapeHtml(String(order.promo.code || 'Promo code'))}: free shipping</td><td style="font-size:13px;text-align:right;color:#1f7a4d">${(order.promo.shippingSavedCents || 0) > 0 ? `\u2212${money(order.promo.shippingSavedCents)}` : ''}</td></tr>` : ''}
      ${(order.shippingCents || 0) > 0 ? `<tr><td style="font-size:13px;color:#64748b">Shipping</td><td style="font-size:13px;text-align:right;color:#0f172a">${money(order.shippingCents)}</td></tr>` : ''}
      ${(order.taxCents || 0) > 0 ? `<tr><td style="font-size:13px;color:#64748b">Sales tax</td><td style="font-size:13px;text-align:right;color:#0f172a">${money(order.taxCents)}</td></tr>` : ''}
      ${(order.tipCents || 0) > 0 ? `<tr><td style="font-size:13px;color:#64748b">Tip</td><td style="font-size:13px;text-align:right;color:#0f172a">${money(order.tipCents)}</td></tr>` : ''}
      ${creditCents > 0 ? `<tr><td style="font-size:13px;color:#64748b">Order total</td><td style="font-size:13px;text-align:right;color:#0f172a">${money(order.totalCents)}</td></tr>
      <tr><td style="font-size:13px;color:#0f766e;font-weight:700">Store credit applied</td><td style="font-size:13px;text-align:right;color:#0f766e;font-weight:700">\u2212${money(creditCents)}</td></tr>` : ''}
      <tr><td style="font-size:14px;font-weight:700;color:#0f172a;padding-top:6px">${creditCents > 0 ? 'Charged to card' : 'Total paid'}</td><td style="font-size:14px;font-weight:700;text-align:right;color:#0f172a;padding-top:6px">${money(chargedCents)}</td></tr>
      ${fullCredit ? `<tr><td colspan="2" style="font-size:12px;color:#0f766e;padding-top:2px">This order was paid in full with store credit. Nothing was charged to a card.</td></tr>` : ''}
    </table>
    ${(order.lines || []).some((l: any) => l.digital === true && l.digitalUrl)
      ? `<div style="border:2px solid #e2e8f0;border-radius:12px;padding:14px;margin:16px 0">
           <p style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#64748b;margin:0 0 8px">Available now</p>
           ${(order.lines || []).filter((l: any) => l.digital === true && l.digitalUrl).map((l: any) =>
             `<p style="font-size:13px;color:#0f172a;margin:0 0 6px"><a href="${l.digitalUrl}" style="color:#0f172a;font-weight:700">${l.name}</a></p>`).join('')}
           <p style="font-size:11px;color:#94a3b8;margin:8px 0 0">These links are also available on your order page whenever you need them.</p>
         </div>`
      : ''}
    ${emailButton(`${origin}/shop/${tenantId}/order/${orderId}`, 'View my order', emailBrand)}
    <p style="font-size:14px;color:#334155;line-height:1.6;margin:16px 0 0">If you have any questions, please reply to this email.</p>
    <p style="font-size:14px;color:#334155;line-height:1.6;margin:16px 0 0">Kind regards,<br>${shopName}</p>`;
  const html = brandedEmail(emailBrand, emailBody, { preheader: `Your order ${num} is confirmed${dates ? `. It ships by ${dayLabel(dates.shipBy, dates.timeZone)}` : ''}` });

  // Through the mailroom: the confirmation is the one retail email a customer
  // will go looking for, so it has to be findable in the delivery log.
  const { sendNotification } = await import('./notify');
  const r = await sendNotification(db, {
    tenantId, channel: 'email', to,
    subject: `${shopName}: your order ${num} is confirmed`,
    html, kind: 'order_confirmation',
    recipientType: 'client', recipientId: orderId, recipientName: order.customerName || null,
  });
  if (!r.ok) {
    console.error('[connect-webhook] confirmation not sent:', r.status, r.error);
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
    const RESEND_FROM = process.env.NOTIFY_FROM_EMAIL || process.env.RESEND_FROM;
    const to = String(order?.customerEmail || '').trim();
    if (!RESEND_API_KEY || !RESEND_FROM || !to) return;

    let origin = String(process.env.NEXT_PUBLIC_APP_URL || '').trim();
    try {
      if (session?.success_url) origin = new URL(String(session.success_url)).origin;
    } catch {
      // keep the env fallback
    }
    if (!origin) return;

    let shopName = 'our shop';
    let emailBrand = { shopName: 'our shop', brandColor: '#16171a' };
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
      <p style="font-size:14px;color:#334155;line-height:1.6">Your cart at <strong>${shopName}</strong> has been saved for you. Your checkout session expired before payment was completed, so nothing was charged.</p>
      <table style="border-collapse:collapse;margin:14px 0">${rows}</table>
      ${order?.subtotalCents ? `<p style="font-size:13px;color:#64748b">Subtotal ${money(order.subtotalCents)}</p>` : ''}
      ${emailButton(`${origin}/shop/${tenantId}/checkout`, 'Finish my order', emailBrand)}
      <p style="font-size:12px;color:#94a3b8;line-height:1.6">Please note that items are not reserved, and popular items may sell out. If you have already placed this order or have changed your mind, you may disregard this email. We will not contact you about it again.</p>
      <p style="font-size:14px;color:#334155;line-height:1.6;margin:16px 0 0">Kind regards,<br>${shopName.charAt(0).toUpperCase()}${shopName.slice(1)}</p>`;
    const html = brandedEmail(emailBrand, recoveryBody, { preheader: 'Your cart has been saved. Nothing was charged.' });

    const { sendNotification } = await import('./notify');
    const r = await sendNotification(db, {
      tenantId, channel: 'email', to,
      subject: `Your cart at ${shopName} has been saved`,
      html, kind: 'cart_recovery',
      recipientType: 'client', recipientId: order?.id || null, recipientName: order?.customerName || null,
    });
    console.log(`[connect-webhook] Cart recovery email ${r.ok ? 'sent' : r.status} for expired order to ${to}`);
    // Remembered on the order, so an order finished within a few days counts in Opportunities → Results (recovered).
    const oid = String(session?.metadata?.retailOrderId || order?.id || '');
    if (r.ok && oid) await db.collection(`tenants/${tenantId}/retailOrders`).doc(oid).set({ cartRecovery: { sentAt: new Date().toISOString() } }, { merge: true }).catch(() => {});
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
  const RESEND_FROM = process.env.NOTIFY_FROM_EMAIL || process.env.RESEND_FROM;
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
    <p style="font-size:14px;color:#0f172a;margin:0 0 8px">Hi ${first || 'there'},</p>
    <p style="font-size:14px;color:#0f172a;margin:0 0 8px">Store credit has been added to your account.</p>
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
    ${args.expiresAt ? `<p style="font-size:12px;color:#64748b;margin:0 0 12px">This credit is valid through <strong>${fmtDay(args.expiresAt)}</strong>.</p>` : ''}
    ${historyRows ? `<p style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#64748b;margin:14px 0 4px">Recent activity</p>
    <table style="width:100%;border-collapse:collapse;border-top:2px solid #e2e8f0;border-bottom:2px solid #e2e8f0">${historyRows}</table>` : ''}
    <p style="font-size:13px;color:#64748b;margin:14px 0 0">To use your credit, select \u201cApply my store credit\u201d at checkout using this email address, and it will be deducted from your total. You may use as much or as little as you like, and any remaining balance will stay on your account.</p>
    ${origin ? emailButton(`${origin}/shop/${tenantId}/catalog`, 'Browse the shop', emailBrand) : ''}
    <p style="font-size:14px;color:#334155;line-height:1.6;margin:16px 0 0">Kind regards,<br>${emailBrand.shopName}</p>`;

  const html = brandedEmail(emailBrand, emailBody, { preheader: `${money(args.grantedCents)} in store credit has been added. Your balance is ${money(args.balanceCents)}.` });

  const { sendNotification } = await import('./notify');
  const r = await sendNotification(db, {
    tenantId, channel: 'email', to,
    subject: `${emailBrand.shopName}: ${money(args.grantedCents)} in store credit has been added to your account`,
    html, kind: 'store_credit_granted',
    recipientType: 'client', recipientName: args.toName || null,
  });
  if (!r.ok) {
    console.error('[credit-email] not sent:', r.status, r.error);
    return false;
  }
  return true;
}
