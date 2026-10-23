/**
 * retail-webhook.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * A shop order's card payment, confirmed (checkout.session.completed on the connected account: lib/connect-webhook,
 * the five-minute check and the order page's own check: lib/retail-payment-check). The order becomes paid in ONE
 * step (lib/order-paid): its number, the stock held, the store credit and gift card it used, and its lines in the
 * books, together, so nothing is half done and a retry can never do any of it twice. What follows the payment — the
 * receipt, loyalty points, the promo code's count, a low-stock alert — runs after, each once (finishPaidOrder), and
 * the five-minute check finishes any that didn't (the receipt's own marker stops it going twice).
 *
 * NOTE on oversell races: if two orders paid for the last unit simultaneously, we still reserve in full (stockReserved
 * may exceed totalStock). The shelf is the source of truth — the picker resolves it via the short-line partial
 * fulfilment flow. Payment confirmation is never blocked on stock.
 */

import StripeLib from 'stripe';
import { buildEvent, onlineSellable } from './retail-orders';
import { assessRisk, riskPolicy, type RiskResult } from './retail-risk';

import { getEmailBrand, brandedEmail, emailButton } from '@/lib/email-shell';
import { payOrder } from '@/lib/order-paid';
import { sendNotification } from '@/lib/notify';

/* ── QR token (HMAC-signed; raw ids are never scannable): lib/order-qr ────── */
export { makeQrToken, verifyQrToken } from '@/lib/order-qr';

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
  // Only money that has arrived pays an order. A page finished with a payment that takes days to clear (a bank
  // debit) says 'unpaid': the order waits, and Stripe's later notice (checkout.session.async_payment_succeeded) or the
  // five-minute check pays it then; a payment that fails closes it (handleRetailPaymentFailed).
  if (!['paid', 'no_payment_required'].includes(String(session?.payment_status || ''))) return;

  const orderRef = db.collection(`tenants/${tenantId}/retailOrders`).doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) {
    console.warn(`[connect-webhook] retail order ${orderId} not found for tenant ${tenantId}`);
    return;
  }
  const order = orderSnap.data();

  // Idempotency — Stripe retries events; only the first one does work (and the payment step checks again).
  if (order.stage !== 'placed') return;

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

  const now = new Date().toISOString();

  // ── Should this order wait for a person? (lib/retail-risk) Read before the payment step; written with 'paid'. ──
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

  // ── placed → paid, with everything that goes with it, in one step (lib/order-paid) ─────────────────────────
  // The order number is issued there and nowhere else. Checkout creates a draft with orderNumber null; money landing
  // is what turns it into a sale. Only the try that flips it to paid does anything, so when the payment webhook, the
  // payment cron and the customer's order page race, exactly one wins.
  const paid = await payOrder(db, tenantId, orderId, {
    via: 'card', session, chargeId, connAcct, clientId,
    risk: risk ? { level: risk.riskLevel, score: risk.riskScore, reasons: risk.reasons, hold: risk.hold } : null,
  }, now);
  if (!paid.won) return;
  console.log(`[connect-webhook] Retail order ${orderId} paid — stock reserved for tenant ${tenantId}`);
  if (risk?.hold) {
    try { const n = db.collection(`tenants/${tenantId}/notifications`).doc(); await n.set({ id: n.id, type: 'order_held', read: false, createdAt: now, link: `/retail-orders/problems?order=${orderId}`, message: `Order #${String(paid.orderNumber ?? '').padStart(4, '0')} is held for review: ${risk.reasons[0]}` }); } catch { /* the Problems list shows it */ }
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
  await finishPaidOrder(db, tenantId, orderId, session);
}

/**
 * WHAT FOLLOWS A PAYMENT, EACH ONCE: the gift card's wallet, loyalty points for the order's products, the promo
 * code's count, and the receipt. Run straight after the order is paid (whichever way), and again by the five-minute
 * check for any order whose follow-up didn't finish (afterPaidAt missing), so a request cut off after the payment
 * step can't leave a customer without their receipt. Each part is safe to run again: points and promo counts are
 * kept once per order by their own modules, and the receipt is claimed on the order before it's sent.
 */
export async function finishPaidOrder(db: any, tenantId: string, orderId: string, session?: any): Promise<void> {
  const orderRef = db.collection(`tenants/${tenantId}/retailOrders`).doc(orderId);
  const snap = await orderRef.get();
  if (!snap.exists) return;
  const order: any = { ...(snap.data() || {}), id: orderId };
  if (!order.paidAt || order.stage === 'placed' || order.afterPaidAt) return;
  let ok = true;
  // A gift card topped down: the customer's wallet shows it.
  if (Number(order.giftCardCents) > 0 && order.giftCardId && order.giftSpentAt) {
    try { const { syncClientGift, notifyGiftUse } = await import('@/lib/gift-cards'); const g = await db.doc(`tenants/${tenantId}/giftCards/${String(order.giftCardId)}`).get(); await syncClientGift(db, tenantId, g.data()?.recipientId);
      if (!order.giftUseNotifiedAt) { await orderRef.set({ giftUseNotifiedAt: new Date().toISOString() }, { merge: true }); void notifyGiftUse(db, tenantId, String(order.giftCardId), Number(order.giftCardCents) || 0).catch(() => {}); } }
    catch (e) { console.error('[retail-webhook] gift card wallet', e); }
  }
  // Loyalty (lib/loyalty): the order's products earn, once.
  try { const tSnap = await db.doc(`tenants/${tenantId}`).get(); const { earnForShopOrder } = await import('@/lib/loyalty-server'); await earnForShopOrder(db, tenantId, tSnap.data() || {}, orderId, order); } catch (e) { ok = false; console.error('[retail-webhook] loyalty', e); }
  // Its tax worked out with Stripe Tax at checkout (a gift card or store credit paid part, lib/stripe-tax-calc): recorded
  // with Stripe Tax now it's paid, once (the order is the record's reference), so the shop's Stripe Tax report counts it.
  if (order.taxMode === 'stripe_calc' && order.taxCalculationId && !order.taxTransactionId) {
    try {
      const t: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
      const acct = t.stripeAccountId || t.stripeConnectAccountId;
      if (acct && process.env.STRIPE_SECRET_KEY) {
        const stripe: any = new StripeLib(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-04-30.basil' as any });
        const { recordFullPriceTax } = await import('@/lib/stripe-tax-calc');
        const r: any = await recordFullPriceTax(stripe, acct, String(order.taxCalculationId), orderId);
        await orderRef.set({ taxTransactionId: r.id || 'recorded', taxRecordedAt: new Date().toISOString() }, { merge: true });
      } else ok = false;
    } catch (e: any) { ok = false; console.error('[retail-webhook] Stripe Tax record', String(e?.raw?.message || e?.message || e).slice(0, 200)); }
  }
  // A promo code on the order: one more use, counted once (lib/promo-codes-server).
  if (order?.promo?.discountId) { try { const { countPromoUse } = await import('@/lib/promo-codes-server'); await countPromoUse(db, tenantId, orderId); } catch (e) { ok = false; console.error('[retail-webhook] promo use', e); } }
  // The receipt the customer expects within seconds of paying, claimed on the order first so it goes once. A send that
  // fails gives the claim back, so the five-minute check tries again.
  const claimed = await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(orderRef)).data() || {};
    // A send cut off part way (its claim never given back) is tried again after ten minutes.
    if (cur.receiptSentAt || (cur.receiptSending && Date.now() - (Date.parse(String(cur.receiptSending)) || 0) < 10 * 60000)) return false;
    tx.set(orderRef, { receiptSending: new Date().toISOString() }, { merge: true });
    return true;
  }).catch(() => false);
  if (claimed) {
    let how: 'sent' | 'skipped' | 'failed' = 'failed';
    try { how = await sendOrderConfirmation(db, tenantId, orderId, order, session || null); }
    catch (e: any) { console.error('[connect-webhook] confirmation email failed:', e?.message); }
    await orderRef.set(how === 'failed' ? { receiptSending: null } : { receiptSentAt: new Date().toISOString(), ...(how === 'skipped' ? { receiptSkipped: true } : {}), receiptSending: null }, { merge: true }).catch(() => {});
    if (how === 'failed') ok = false;
  }
  if (ok) await orderRef.set({ afterPaidAt: new Date().toISOString() }, { merge: true }).catch(() => {});
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
): Promise<'sent' | 'skipped' | 'failed'> {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const RESEND_FROM = process.env.NOTIFY_FROM_EMAIL || process.env.RESEND_FROM;
  const to = String(order.customerEmail || '').trim();
  if (!RESEND_API_KEY || !RESEND_FROM || !to) return 'skipped';

  let origin = String(process.env.NEXT_PUBLIC_APP_URL || '').trim();
  try {
    if (session?.success_url) origin = new URL(String(session.success_url)).origin;
  } catch {
    // keep the env fallback
  }
  if (!origin) return 'skipped';

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
  const r = await sendNotification(db, {
    tenantId, channel: 'email', to,
    subject: `${shopName}: your order ${num} is confirmed`,
    html, kind: 'order_confirmation',
    recipientType: 'client', recipientId: orderId, recipientName: order.customerName || null,
  });
  if (!r.ok) {
    console.error('[connect-webhook] confirmation not sent:', r.status, r.error);
    // Turned off by the shop or held for quiet hours is the shop's choice, not a failure to try again.
    return String(r.status || '') === 'failed' ? 'failed' : 'skipped';
  }
  return 'sent';
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
  session: any,
  reason: 'checkout_expired' | 'payment_failed' = 'checkout_expired'
): Promise<void> {
  const orderId = session.metadata?.retailOrderId;
  if (!orderId) return;

  const orderRef = db.collection(`tenants/${tenantId}/retailOrders`).doc(orderId);
  const snap = await orderRef.get();
  if (!snap.exists || snap.data().stage !== 'placed') return;

  const now = new Date().toISOString();
  // Closed only while it's still unpaid, in one step: a payment that lands at the same moment (lib/order-paid) wins.
  const closed = await db.runTransaction(async (tx: any) => {
    const cur = await tx.get(orderRef);
    if (!cur.exists || (cur.data() || {}).stage !== 'placed') return false;
    tx.set(orderRef, { stage: 'cancelled', cancelledAt: now }, { merge: true });
    const evRef = orderRef.collection('events').doc();
    tx.set(evRef, { id: evRef.id, ...buildEvent('cancelled', 'system', 'Stripe', { reason }) });
    return true;
  });
  if (!closed) return;
  console.log(`[connect-webhook] Retail order ${orderId} ${reason === 'payment_failed' ? 'payment failed' : 'expired unpaid'} — auto-cancelled`);

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
