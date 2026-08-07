import { NextRequest, NextResponse } from 'next/server';

import {
  addressMessage, addressPolicy, policySnapshot, shouldBlock,
  stripeCustomText, validateAddress,
} from '@/lib/address-validation';
import Stripe from 'stripe';
import { nanoid } from 'nanoid';
import { verifyQuote } from '@/lib/shipping-quote';

import { discountedCents, resolveWholesaleAccess } from '@/lib/retail-wholesale';
import {
  FULFILLMENT_METHODS,
  PRICE_TIERS,
  buildEvent,
  buildOrderLine,
  checkWholesaleMinimums,
  isStorefrontVisible,
  resolveOptions,
  sellableStock,
  type FulfillmentMethod,
  type OrderLine,
  type PriceTier,
  type SellableItem,
  type ShippingAddress,
} from '@/lib/retail-orders';

// ─── /api/retail/checkout/route.ts ────────────────────────────────────────────
// POST — validates the cart against live inventory, prices it SERVER-SIDE from
// msrp (client-sent prices are never trusted), creates the retailOrder in
// stage 'placed', and returns a Stripe Checkout Session URL on the tenant's
// connected account. The connect-webhook 'retail_order' branch flips the
// order to 'paid' and reserves stock when payment lands.
//
// Body: {
//   tenantId:  string,
//   items:     { productId: string; qty: number }[],
//   method:    'counter' | 'curbside' | 'ship',
//   customer:  { name: string; email: string; phone?: string },
//   shippingAddress?: ShippingAddress,  // required when method === 'ship'
//   priceTier?: 'retail' | 'wholesale', // default 'retail'
//   wholesaleCode?: string,             // required when priceTier === 'wholesale'
//   business?: { name?: string; poNumber?: string }  // B2B fields
// }
//
// Optional tenant settings read from tenants/{id}.retailSettings:
//   { taxRatePercent?: number; flatShippingDollars?: number;
//     freeShippingOverDollars?: number;
//     wholesaleAccessCode?: string;     // enables the wholesale tier
//     wholesaleTaxExempt?: boolean }    // resale-certificate buyers
// All default to 0 / off when absent.

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-retail-checkout';
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

interface CheckoutBody {
  tenantId?: string;
  items?: { productId?: string; qty?: number; selections?: Record<string, string> }[];
  method?: string;
  customer?: { name?: string; email?: string; phone?: string };
  shippingAddress?: ShippingAddress;
  priceTier?: string;
  wholesaleCode?: string;
  business?: { name?: string; poNumber?: string };
}

export async function POST(req: NextRequest) {
  /*
   * Whole-handler armor: anything that escapes below (a Firestore write, the
   * throttle count query, a missing admin credential, a bad option payload)
   * would otherwise become a bare HTTP 500 with no body — which reaches the
   * shopper as "Checkout failed (HTTP 500)" and tells nobody anything. Every
   * failure now returns its real reason, so the toast IS the diagnosis.
   */
  try {
    return await handleCheckout(req);
  } catch (err: any) {
    const detail = String(err?.raw?.message || err?.message || 'Unknown error').slice(0, 220);
    console.error('[retail-checkout] unhandled failure:', detail, err?.stack?.split('\n')[1] || '');
    return NextResponse.json({ error: `Checkout could not start: ${detail}` }, { status: 500 });
  }
}

async function handleCheckout(req: NextRequest) {
  let body: CheckoutBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const tenantId = String(body.tenantId || '').trim();
  const method = String(body.method || '') as FulfillmentMethod;
  const rawItems = Array.isArray(body.items) ? body.items : [];
  const customerName = String(body.customer?.name || '').trim();
  const customerEmail = String(body.customer?.email || '').trim().toLowerCase();

  if (!tenantId) return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
  if (!FULFILLMENT_METHODS.includes(method) || method === 'in_store') {
    return NextResponse.json({ error: 'method must be counter, curbside, or ship' }, { status: 400 });
  }
  if (rawItems.length === 0) return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });
  if (!customerName || !customerEmail) {
    return NextResponse.json({ error: 'customer name and email are required' }, { status: 400 });
  }
  const priceTier = (body.priceTier || 'retail') as PriceTier;
  if (!PRICE_TIERS.includes(priceTier)) {
    return NextResponse.json({ error: 'priceTier must be retail or wholesale' }, { status: 400 });
  }
  if (method === 'ship') {
    const a = body.shippingAddress;
    if (!a?.name || !a?.line1 || !a?.city || !a?.state || !a?.postalCode || !a?.country) {
      return NextResponse.json({ error: 'Complete shippingAddress is required for ship orders' }, { status: 400 });
    }
  }

  // Merge duplicate cart rows for the same product
  const qtyByProduct = new Map<string, number>();
  // Chosen options travel with the cart line; the server re-prices them from
  // the item document, so what the client sends is a selection, never a price.
  const selectionsByProduct = new Map<string, Record<string, string>>();
  for (const it of rawItems) {
    const id = String(it.productId || '').trim();
    const qty = Math.floor(Number(it.qty) || 0);
    if (!id || qty <= 0) {
      return NextResponse.json({ error: 'Each item needs a productId and positive qty' }, { status: 400 });
    }
    qtyByProduct.set(id, (qtyByProduct.get(id) ?? 0) + qty);
    if (it.selections && typeof it.selections === 'object' && !selectionsByProduct.has(id)) {
      selectionsByProduct.set(id, it.selections as Record<string, string>);
    }
  }

  const db = getAdminDb();

  // ── Tenant + connected account ────────────────────────────────────────────
  const tenantSnap = await db.collection('tenants').doc(tenantId).get();
  if (!tenantSnap.exists) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  const tenant = tenantSnap.data() as any;
  const stripeAccountId: string | undefined = tenant.stripeAccountId;
  if (!stripeAccountId) {
    return NextResponse.json({ error: 'This shop is not accepting online payments yet' }, { status: 400 });
  }

  const rsEarly = tenant.retailSettings || {};
  if (rsEarly.storePaused === true) {
    return NextResponse.json(
      { error: String(rsEarly.storePausedMessage || '').trim() || 'The shop is briefly paused for restocking — please try again soon.' },
      { status: 423 }
    );
  }

  // ── Order throttling: protect the kitchen/bench from drowning. Over the
  //    15-minute cap, customers get an honest "at capacity" instead of a
  //    promise nobody can keep.
  const throttle = Math.max(0, Math.floor(Number(rsEarly.throttlePer15) || 0));
  if (throttle > 0) {
    const windowStart = new Date(Date.now() - 15 * 60_000).toISOString();
    const recent = await db.collection(`tenants/${tenantId}/retailOrders`)
      .where('placedAt', '>', windowStart).count().get();
    if ((recent.data().count ?? 0) >= throttle) {
      return NextResponse.json(
        { error: 'The shop is at capacity right now \u2014 please try again in a few minutes.' },
        { status: 429 }
      );
    }
  }

  // ── Wholesale gate: per-account codes first, legacy house code fallback ──
  let wsAccount: { id: string; businessName: string; email: string; extraDiscountPercent: number } | null = null;
  let wsDiscount = 0;
  if (priceTier === 'wholesale') {
    const wsAccess = await resolveWholesaleAccess(db, tenantId, rsEarly, String(body.wholesaleCode || ''));
    if (!wsAccess.unlocked) {
      return NextResponse.json({ error: wsAccess.error || 'Invalid wholesale access code' }, { status: 403 });
    }
    wsAccount = wsAccess.account || null;
    wsDiscount = wsAccount?.extraDiscountPercent || 0;
  }

  // ── Load & validate every item against live inventory ────────────────────
  const productIds = [...qtyByProduct.keys()];
  const itemSnaps = await Promise.all(
    productIds.map((id) => db.collection(`tenants/${tenantId}/inventory`).doc(id).get())
  );

  const lines: OrderLine[] = [];
  for (let i = 0; i < productIds.length; i++) {
    const snap = itemSnaps[i];
    const qty = qtyByProduct.get(productIds[i])!;
    if (!snap.exists) {
      return NextResponse.json({ error: `Item ${productIds[i]} is no longer available` }, { status: 409 });
    }
    const item = { id: snap.id, ...snap.data() } as SellableItem;

    if (!isStorefrontVisible(item)) {
      return NextResponse.json({ error: `${item.name || 'An item'} is no longer available` }, { status: 409 });
    }
    if (sellableStock(item) < qty && item.allowBackorder !== true) {
      return NextResponse.json(
        { error: `Only ${Math.max(0, sellableStock(item))} of ${item.name} left`, productId: item.id },
        { status: 409 }
      );
    }
    const opts = resolveOptions(item.optionGroups, selectionsByProduct.get(productIds[i]));
    const line = buildOrderLine(item, qty, `line-${nanoid(8)}`, priceTier, opts);
    if (priceTier === 'wholesale' && wsDiscount > 0) {
      line.unitPriceCents = discountedCents(line.unitPriceCents, wsDiscount);
    }
    lines.push(line);
  }

  if (priceTier === 'wholesale') {
    const entries = productIds.map((id, i) => ({
      item: { id: itemSnaps[i].id, ...itemSnaps[i].data() } as SellableItem,
      qty: qtyByProduct.get(id)!,
    }));
    const minCheck = checkWholesaleMinimums(entries);
    if (!minCheck.ok) return NextResponse.json({ error: minCheck.reason }, { status: 400 });
  }

  // ── Server-side pricing ───────────────────────────────────────────────────
  const subtotalCents = lines.reduce((a, l) => a + l.unitPriceCents * l.qtyOrdered, 0);

  const rs = tenant.retailSettings || {};
  const taxExempt = priceTier === 'wholesale' && rs.wholesaleTaxExempt === true;
  const taxRatePercent = taxExempt ? 0 : Number(rs.taxRatePercent) || 0;
  // A single flat rate is exactly right for a pickup order — the sale happens
  // at the shop, so the shop's own rate applies. It is exactly wrong for a
  // parcel crossing state lines, where the destination sets the rate. So
  // Stripe Tax (opt-in per tenant, registrations live in THEIR dashboard)
  // takes over only for shipped orders; pickup and tax-exempt wholesale keep
  // the flat path untouched. In stripe mode the draft carries taxCents 0 —
  // Stripe computes the real figure at payment and the webhook writes it back.
  const stripeTax = rs.stripeTaxEnabled === true && method === 'ship' && !taxExempt;
  const taxCents = stripeTax ? 0 : Math.round(subtotalCents * (taxRatePercent / 100));

  let shippingCents = 0;
  let shippingService = '';
  if (method === 'ship') {
    const flat = Math.round((Number(rs.flatShippingDollars) || 0) * 100);
    const freeOver = Math.round((Number(rs.freeShippingOverDollars) || 0) * 100);
    shippingCents = freeOver > 0 && subtotalCents >= freeOver ? 0 : flat;
    shippingService = 'Standard shipping';

    // A customer-chosen carrier rate is honoured only when it carries our own
    // signature: the browser picks the service, it never sets the price. An
    // expired or forged quote silently falls back to the flat rate rather
    // than failing the sale.
    const q = body.shippingQuote;
    if (q && typeof q === 'object') {
      const amount = Math.max(0, Math.floor(Number(q.amountCents) || 0));
      const service = String(q.service || '').slice(0, 60);
      const exp = Number(q.exp) || 0;
      if (verifyQuote(tenantId, amount, service, exp, String(q.token || ''))) {
        const freeQualified = freeOver > 0 && subtotalCents >= freeOver;
        shippingCents = freeQualified ? 0 : amount;
        shippingService = service;
      }
    }
  }

  const tipCents = Math.min(
    Math.max(0, Math.floor(Number(body.tipCents) || 0)),
    Math.max(subtotalCents, 50_000)
  );
  const pickupAt = String(body.pickupAt || '').slice(0, 40);
  const totalCents = subtotalCents + taxCents + shippingCents + tipCents;
  if (totalCents <= 0) return NextResponse.json({ error: 'Order total must be positive' }, { status: 400 });

  // ── Check the address, and snapshot the policy ────────────────────────────
  // Both happen before the draft is written so the order carries them from the
  // moment it exists. Validation is soft by default: only an address the
  // carriers say does not exist can stop a sale, and only when the shop has
  // asked for that. A validator wrong about a new build costs a whole order,
  // which is worse than a rare redelivery.
  const addrPolicy = addressPolicy(rs);
  const addressCheck = method === 'ship'
    ? await validateAddress({
        address: body.shippingAddress,
        apiKey: String(rs.shippoApiKey || process.env.SHIPPO_API_KEY || '').trim(),
        policy: addrPolicy,
      })
    : null;

  if (addressCheck && shouldBlock(addressCheck, addrPolicy)) {
    return NextResponse.json({
      error: addressMessage(addressCheck),
      addressCheck,
    }, { status: 422 });
  }

  // The dispute narrative asserts this policy was shown at checkout. Snapshot
  // the exact wording so that claim is provable, and so editing the policy
  // later cannot rewrite what a past customer agreed to.
  const policy = policySnapshot(rs);

  // ── Create the order as a DRAFT ───────────────────────────────────────────
  // No order number is issued here. A cart that never pays is not a sale, and
  // burning #0042 on an abandoned cart leaves a permanent hole in the sequence
  // — awkward for the customer who asks "what happened to 42?", worse for
  // reconciliation, and it inflates every count derived from retailOrders.
  // The number is minted by the webhook at the moment money actually lands,
  // so the sequence reflects real sales with no gaps, in payment order.
  // Until then this doc exists only to hold the priced cart for Stripe.
  const orderRef = db.collection(`tenants/${tenantId}/retailOrders`).doc();
  const orderId = orderRef.id;
  const now = new Date().toISOString();

  const order = {
    id: orderId,
    tenantId,
    orderNumber: null,
    isDraft: true,
    stage: 'placed',
    policySnapshot: policy,
    ...(addressCheck ? { addressCheck } : {}),
    method,
    priceTier,
    wholesaleAccountId: wsAccount?.id || null,
    businessName: priceTier === 'wholesale'
      ? (String(body.business?.name || '').trim() || wsAccount?.businessName || '')
      : '',
    poNumber: priceTier === 'wholesale' ? String(body.business?.poNumber || '').trim() : '',
    lines,
    subtotalCents,
    taxCents,
    taxMode: stripeTax ? 'stripe' : 'flat',
    shippingCents,
    shippingService,
    refundedCents: 0,
    tipCents,
    pickupAt,
    totalCents,
    customerName,
    customerEmail,
    customerPhone: body.customer?.phone || '',
    shippingAddress: method === 'ship' ? body.shippingAddress : null,
    curbside: null,
    placedAt: now,
  };

  if (wsAccount) {
    db.collection(`tenants/${tenantId}/wholesaleAccounts`).doc(wsAccount.id)
      .set({ lastUsedAt: now }, { merge: true }).catch(() => {});
  }

  const evRef = orderRef.collection('events').doc();
  const batch = db.batch();
  batch.set(orderRef, JSON.parse(JSON.stringify(order)));
  batch.set(evRef, {
    id: evRef.id,
    ...buildEvent('placed', 'customer', customerName, {
      method,
      priceTier,
      units: lines.reduce((a, l) => a + l.qtyOrdered, 0),
      totalCents,
    }),
  });
  await batch.commit();

  // ── Stripe Checkout Session on the connected account ─────────────────────
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2025-04-30.basil' as any });
  const origin = req.headers.get('origin') || req.nextUrl.origin;

  // In stripe-tax mode every line declares what it IS, so the right rule
  // applies per line: goods are taxed as tangible goods, shipping follows
  // each state's own shipping rule (some tax it, some don't), and a tip is
  // never taxed — taxing a gratuity would be charging the customer tax on
  // their own generosity. Prices stay tax-exclusive so the sticker price the
  // shop set is the price the customer saw.
  const buildLineItems = (withTaxCodes: boolean, flatTaxCents: number): any[] => {
    const items: any[] = lines.map((l) => ({
      quantity: l.qtyOrdered,
      price_data: {
        currency: 'usd',
        unit_amount: l.unitPriceCents,
        product_data: { name: l.name, ...(withTaxCodes ? { tax_code: 'txcd_99999999' } : {}) },
        ...(withTaxCodes ? { tax_behavior: 'exclusive' } : {}),
      },
    }));
    if (flatTaxCents > 0) {
      items.push({
        quantity: 1,
        price_data: { currency: 'usd', unit_amount: flatTaxCents, product_data: { name: 'Sales Tax' } },
      });
    }
    if (shippingCents > 0) {
      items.push({
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: shippingCents,
          product_data: { name: shippingService || 'Shipping', ...(withTaxCodes ? { tax_code: 'txcd_92010001' } : {}) },
          ...(withTaxCodes ? { tax_behavior: 'exclusive' } : {}),
        },
      });
    }
    if (tipCents > 0) {
      items.push({
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: tipCents,
          product_data: { name: 'Tip \u2764\ufe0f', ...(withTaxCodes ? { tax_code: 'txcd_00000000' } : {}) },
          ...(withTaxCodes ? { tax_behavior: 'exclusive' } : {}),
        },
      });
    }
    return items;
  };
  const lineItems: any[] = buildLineItems(stripeTax, taxCents);

  const sessionParams = (items: any[], withAutoTax: boolean): any => ({
    mode: 'payment',
    line_items: items,
    // Stripe Tax needs an address to pick a jurisdiction; enabling it makes
    // Stripe's own page require a billing address, which is what the rate is
    // computed against. On a direct charge the CONNECTED account's tax
    // registrations and origin address apply — each tenant's own setup.
    ...(withAutoTax ? { automatic_tax: { enabled: true } } : {}),
    customer_email: customerEmail,
    metadata: { type: 'retail_order', retailOrderId: orderId, tenantId },
    payment_intent_data: {
      metadata: { type: 'retail_order', retailOrderId: orderId, tenantId },
    },
    // Abandoned carts shouldn't haunt the board for a day. 30 minutes is
    // Stripe's minimum session lifetime and matches the cart hold, so the
    // expired-session webhook closes unpaid orders while the shopper is
    // still in the same session of their life.
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    // Shown on Stripe's own checkout page, above the pay button. This is
    // what makes "the policy is shown at checkout" true rather than a claim.
    custom_text: { submit: { message: stripeCustomText(policy.text) } },
    success_url: `${origin}/shop/${tenantId}/order/${orderId}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/shop/${tenantId}?canceled=1`,
  });

  try {
    let session: any;
    try {
      session = await stripe.checkout.sessions.create(
        sessionParams(lineItems, stripeTax),
        { stripeAccount: stripeAccountId }
      );
    } catch (taxErr: any) {
      // The classic misconfiguration: a tenant flips the Stripe Tax toggle
      // before finishing registrations or the origin address in their Stripe
      // dashboard, and every shipped checkout would die at the pay button. A
      // customer holding out a card must never be the one who discovers that.
      // Fall back ONCE to the tenant's flat rate — loudly stamped on the
      // order as 'flat_fallback' so the gap is visible in the books instead
      // of silently swallowed — and only then let a second failure surface.
      if (!stripeTax) throw taxErr;
      console.error(
        `[checkout] Stripe Tax session failed for tenant ${tenantId} — falling back to flat rate:`,
        String(taxErr?.raw?.message || taxErr?.message || taxErr)
      );
      const fbTaxCents = Math.round(subtotalCents * ((Number(rs.taxRatePercent) || 0) / 100));
      await orderRef.set({
        taxMode: 'flat_fallback',
        taxCents: fbTaxCents,
        totalCents: subtotalCents + fbTaxCents + shippingCents + tipCents,
      }, { merge: true });
      session = await stripe.checkout.sessions.create(
        sessionParams(buildLineItems(false, fbTaxCents), false),
        { stripeAccount: stripeAccountId }
      );
    }

    await orderRef.set({ stripeCheckoutSessionId: session.id }, { merge: true });
    return NextResponse.json({
      url: session.url, orderId, orderNumber: null, isDraft: true,
      // Soft verdicts travel back so the storefront can mention a correction
      // without ever having stood between the customer and paying.
      ...(addressCheck && addressCheck.verdict !== 'skipped' ? { addressCheck } : {}),
    });
  } catch (err: any) {
    const detail = String(err?.raw?.message || err?.message || 'Unknown Stripe error').slice(0, 220);
    console.error('[retail-checkout] Stripe session creation failed:', detail, err?.raw?.param || '');
    // Leave the order in 'placed' — it never got a session, never reserves
    // stock, and is harmless; a cleanup job can archive stale placed orders.
    // Surface the REAL cause so failures are self-diagnosing instead of a
    // generic shrug — this message appears in the customer's error toast.
    return NextResponse.json({ error: `Checkout could not start: ${detail}` }, { status: 502 });
  }
}
