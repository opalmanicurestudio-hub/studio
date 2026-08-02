import {
  resolveOptions, NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { nanoid } from 'nanoid';

import { discountedCents, resolveWholesaleAccess } from '@/lib/retail-wholesale';
import {
  FULFILLMENT_METHODS,
  PRICE_TIERS,
  buildEvent,
  buildOrderLine,
  checkWholesaleMinimums,
  isStorefrontVisible,
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
  items?: { productId?: string; qty?: number }[];
  method?: string;
  customer?: { name?: string; email?: string; phone?: string };
  shippingAddress?: ShippingAddress;
  priceTier?: string;
  wholesaleCode?: string;
  business?: { name?: string; poNumber?: string };
}

export async function POST(req: NextRequest) {
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
  for (const it of rawItems) {
    const id = String(it.productId || '').trim();
    const qty = Math.floor(Number(it.qty) || 0);
    if (!id || qty <= 0) {
      return NextResponse.json({ error: 'Each item needs a productId and positive qty' }, { status: 400 });
    }
    qtyByProduct.set(id, (qtyByProduct.get(id) ?? 0) + qty);
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
    const opts = resolveOptions(item.optionGroups, l.selections);
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
  const taxCents = Math.round(subtotalCents * (taxRatePercent / 100));

  let shippingCents = 0;
  if (method === 'ship') {
    const flat = Math.round((Number(rs.flatShippingDollars) || 0) * 100);
    const freeOver = Math.round((Number(rs.freeShippingOverDollars) || 0) * 100);
    shippingCents = freeOver > 0 && subtotalCents >= freeOver ? 0 : flat;
  }

  const totalCents = subtotalCents + taxCents + shippingCents;
  if (totalCents <= 0) return NextResponse.json({ error: 'Order total must be positive' }, { status: 400 });

  // ── Sequential order number ───────────────────────────────────────────────
  const counterRef = db.collection(`tenants/${tenantId}/counters`).doc('retailOrders');
  const orderNumber: number = await db.runTransaction(async (txn: any) => {
    const c = await txn.get(counterRef);
    const next = ((c.exists ? c.data().value : 0) || 0) + 1;
    txn.set(counterRef, { value: next }, { merge: true });
    return next;
  });

  // ── Create the order in 'placed' ──────────────────────────────────────────
  const orderRef = db.collection(`tenants/${tenantId}/retailOrders`).doc();
  const orderId = orderRef.id;
  const now = new Date().toISOString();

  const order = {
    id: orderId,
    tenantId,
    orderNumber,
    stage: 'placed',
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
    shippingCents,
    refundedCents: 0,
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

  const lineItems: any[] = lines.map((l) => ({
    quantity: l.qtyOrdered,
    price_data: {
      currency: 'usd',
      unit_amount: l.unitPriceCents,
      product_data: { name: l.name },
    },
  }));
  if (taxCents > 0) {
    lineItems.push({
      quantity: 1,
      price_data: { currency: 'usd', unit_amount: taxCents, product_data: { name: 'Sales Tax' } },
    });
  }
  if (shippingCents > 0) {
    lineItems.push({
      quantity: 1,
      price_data: { currency: 'usd', unit_amount: shippingCents, product_data: { name: 'Shipping' } },
    });
  }

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        line_items: lineItems,
        customer_email: customerEmail,
        metadata: { type: 'retail_order', retailOrderId: orderId, tenantId },
        payment_intent_data: {
          metadata: { type: 'retail_order', retailOrderId: orderId, tenantId },
        },
        success_url: `${origin}/shop/${tenantId}/order/${orderId}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/shop/${tenantId}?canceled=1`,
      },
      { stripeAccount: stripeAccountId }
    );

    await orderRef.set({ stripeCheckoutSessionId: session.id }, { merge: true });
    return NextResponse.json({ url: session.url, orderId, orderNumber });
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
