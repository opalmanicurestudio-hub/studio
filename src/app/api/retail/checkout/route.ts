import { NextRequest, NextResponse } from 'next/server';

import {
  addressMessage, addressPolicy, policySnapshot, shouldBlock,
  stripeCustomText, validateAddress,
} from '@/lib/address-validation';
import Stripe from 'stripe';
import { nanoid } from 'nanoid';
import { makeQrToken, sendOrderConfirmation } from '@/lib/retail-webhook';
import { isDigitalOnlyOrder } from '@/lib/retail-orders';
import { resolveVariantProductId } from '@/lib/retail-orders';
import { shipPromiseAt } from '@/lib/retail-orders';
import { preorderAckSnapshot } from '@/lib/preorder-terms';
import { finalSaleFor } from '@/lib/return-eligibility';
import { tenantTimeZone } from '@/lib/tenant-time';
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
  applyStoreCredit?: boolean;
  storeCreditCapCents?: number; // customer-set spend limit; omitted = use all
  // The customer's tick on the pre-order terms. Optional in the type because
  // most carts have no pre-order; REQUIRED at runtime the moment one does.
  preorderAck?: boolean;
  // These three were always sent by the storefront and always read here, but
  // were missing from the interface — so every read of them was a type error
  // hidden inside the repo-wide noise. Declaring them changes no behaviour.
  tipCents?: number;
  pickupAt?: string;
  shippingQuote?: { amountCents?: number; service?: string; exp?: number; token?: string };
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

  /* THE DOOR, FOR PEOPLE WHO EARNED IT. A customer flagged 'banned' (fraud,
   * chargebacks, staff abuse — staff decide, with notes) cannot place online
   * orders. The refusal is deliberately neutral: no reason is disclosed, so
   * the flag's notes stay an internal record and the message gives an angry
   * person nothing to argue with. 'watch' flags never block — they only
   * inform staff surfaces. A flag-read failure fails OPEN: protection must
   * never take the shop's checkout down. */
  try {
    const flagSnap = await getAdminDb()
      .collection(`tenants/${tenantId}/customerFlags`)
      .where('email', '==', customerEmail).limit(1).get();
    if (!flagSnap.empty && String((flagSnap.docs[0].data() as any).level) === 'banned') {
      return NextResponse.json(
        { error: 'We can\u2019t take this order online. Please contact the shop directly.' },
        { status: 403 },
      );
    }
  } catch { /* fail open */ }
  const priceTier = (body.priceTier || 'retail') as PriceTier;
  if (!PRICE_TIERS.includes(priceTier)) {
    return NextResponse.json({ error: 'priceTier must be retail or wholesale' }, { status: 400 });
  }
  // The ship-address requirement is checked AFTER the lines are resolved:
  // a cart of nothing-but-digital goods has no parcel, so demanding an
  // address would block a sale that needs no postage.
  const shipAddressOk = (() => {
    const a = body.shippingAddress;
    return !!(a?.name && a?.line1 && a?.city && a?.state && a?.postalCode && a?.country);
  })();

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
    let item = { id: snap.id, ...snap.data() } as SellableItem;

    // ── VARIANTS. When the chosen option IS a product (15ml vs 30ml), the
    // sale belongs to THAT item: its stock is what must be available, its
    // shelf is what gets decremented, its SKU is what the picker scans. The
    // parent supplies the name and the photos and nothing else. Resolving it
    // HERE means every check below — stock, reservation, pre-order, digital —
    // applies to the thing actually being sold.
    const variantId = resolveVariantProductId(item.optionGroups, selectionsByProduct.get(productIds[i]));
    if (variantId && variantId !== item.id) {
      const vSnap = await db.collection(`tenants/${tenantId}/inventory`).doc(variantId).get();
      if (!vSnap.exists) {
        return NextResponse.json({ error: `${item.name || 'That option'} is no longer available` }, { status: 409 });
      }
      const variant = { id: vSnap.id, ...vSnap.data() } as SellableItem;
      // Keep the parent's shop identity, take the variant's physical one —
      // the customer bought "Gel #127 · 30ml", not a differently-named item.
      item = {
        ...variant,
        name: `${item.name}${variant.name && variant.name !== item.name ? ` \u00b7 ${variant.name}` : ''}`,
        optionGroups: item.optionGroups,
        showOnline: item.showOnline,
        status: item.status,
        type: item.type,
      } as SellableItem;
    }

    if (!isStorefrontVisible(item)) {
      return NextResponse.json({ error: `${item.name || 'An item'} is no longer available` }, { status: 409 });
    }
    // Pre-order items are SOLD before stock exists — that's the point. The
    // promise they carry is what makes it legitimate, and it's enforced by
    // the clock below rather than by pretending the shelf is full.
    if (item.digital !== true && item.preorder !== true && sellableStock(item) < qty && item.allowBackorder !== true) {
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
    // WHETHER IT CAN COME BACK, DECIDED NOW AND WRITTEN DOWN. Evaluated
    // against the item AS IT IS AT PURCHASE and stamped onto the line, so a
    // shop marking something final sale next spring cannot retroactively
    // change what this customer was told today. Same reason policySnapshot
    // and preorderAck carry their text rather than a pointer to it. Absent
    // stamp = returns normally, which is every order written before this.
    // Note this runs AFTER the variant has been resolved above, so a 30ml
    // that is final sale is caught even when its parent is not.
    const finalSale = finalSaleFor(item as any);
    if (finalSale) Object.assign(line, finalSale);
    lines.push(line);
  }

  // ── PRE-ORDER DISCLOSURE ─────────────────────────────────────────────────
  // The storefront shows the ship-by promise and asks the customer to tick
  // it. This re-checks it server-side for the same reason every other rule
  // here is re-checked: a page that merely displays a term is not a term. If
  // a cart reaches this route with a pre-ordered line and no acknowledgement
  // — an old tab, a stale bundle, anything scripted — the sale does not
  // proceed. Refusing costs one round trip; taking money for an undisclosed
  // pre-order costs the FTC's own remedy.
  const preorderLines = lines.filter((l: any) => l.preorder === true);
  if (preorderLines.length > 0 && body.preorderAck !== true) {
    return NextResponse.json({
      error: 'This order includes a pre-ordered item. Please review the ship-by date and tick the box to continue.',
      needsPreorderAck: true,
    }, { status: 422 });
  }

  // Nothing physical? Then no address, no postage, no pickup slot — and the
  // fulfilment floor never sees this order at all.
  const digitalOnly = isDigitalOnlyOrder(lines);
  if (method === 'ship' && !digitalOnly && !shipAddressOk) {
    return NextResponse.json({ error: 'Complete shippingAddress is required for ship orders' }, { status: 400 });
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
  if (method === 'ship' && !digitalOnly) {
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

  // The shop's own clock. Every date this order carries — the ship-by
  // promise, the wording the customer agreed to, and the moment the order
  // starts counting as late — is read against it. Without this the engine
  // uses the server's zone, which on Vercel is UTC: a shop in Eastern
  // promising "March 3" was judged late from 7pm on March 2.
  const shopZone = tenantTimeZone(tenant);

  // One promise, computed once, used by both the stored date and the stored
  // agreement — so the order can never carry a ship-by date that disagrees
  // with the wording the customer ticked. shipPromiseAt now applies the
  // deadline rule itself (end of the promised day, in the shop's zone), so
  // there is no second calculation here to drift from it.
  const preorderItems = preorderLines.map((l: any) => ({
    name: String(l.name || 'Item'),
    etaAt: l.preorderEtaAt || null,
    qty: Number(l.qtyOrdered) || 1,
  }));
  const promiseAt = shipPromiseAt(lines as any, now, now, shopZone);
  const preorderAck = preorderLines.length > 0
    ? preorderAckSnapshot({ items: preorderItems, promiseAt, agreedAt: now, timeZone: shopZone })
    : null;

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
    storeCreditRequestedCents: 0,
    tipCents,
    pickupAt,
    totalCents,
    customerName,
    customerEmail,
    ...(digitalOnly ? { digitalOnly: true } : {}),
    // The FTC promise, fixed at purchase: the latest pre-order date on the
    // order, or 30 days. Stored so a later settings change can never quietly
    // move a date the customer was already given.
    ...(promiseAt && !digitalOnly ? { shipPromiseAt: promiseAt } : {}),
    ...(preorderLines.length > 0 ? { hasPreorder: true } : {}),
    // The agreement itself, in the customer's own words as they were shown
    // them. Carried as TEXT, not a version pointer: a pointer sends whoever
    // reads this later to a file that has since been edited, which is the
    // exact failure this is here to prevent. Same shape as policySnapshot,
    // so anything that already reads one can read the other.
    ...(preorderAck ? { preorderAck } : {}),
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
      ...(preorderAck ? { preorderAgreedAt: preorderAck.agreedAt, shipPromiseAt: String(preorderAck.promiseAt || '') } : {}),
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
        // Stripe's general-goods code is wrong for a download: many states
        // tax digital products differently, or not at all. txcd_10501000 is
        // Stripe's "digital goods — downloadable" code, so their engine
        // applies the right rule per state instead of taxing a PDF like a
        // bottle of polish.
        product_data: {
          name: l.name,
          ...(withTaxCodes ? { tax_code: l.digital === true ? 'txcd_10501000' : 'txcd_99999999' } : {}),
        },
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

  // ── Store credit (speculative): the box says "apply mine IF I have any".
  // The server checks — nothing about balances ever leaves except as the
  // discount the OWNER sees on their own payment page, so there is no
  // balance-probe endpoint to abuse. The credit docs are NOT touched here:
  // consumption happens in the paid webhook, so an abandoned session leaves
  // every credit intact. Cap keeps a 50¢ card charge — full-credit
  // zero-charge orders are a later round, said plainly.
  let creditCoupon: string | null = null;
  let creditAppliedCents = 0;
  if (body.applyStoreCredit === true && customerEmail) {
    try {
      const credSnap = await db.collection(`tenants/${tenantId}/depositCredits`)
        .where('clientEmail', '==', customerEmail)
        .where('status', '==', 'available')
        .limit(25).get();
      const rawAvailable = credSnap.docs.reduce((a: number, d: any) => {
        const c = d.data();
        return a + Math.max(0, (Number(c.amountCents) || 0) - (Number(c.usedCents) || 0));
      }, 0);
      // Partial redemption: the customer may cap how much of their credit
      // this order spends. The cap only ever LOWERS what applies — the server
      // still enforces the real balance, so no amount typed on the page can
      // spend credit that isn't there.
      const capRaw = Number(body.storeCreditCapCents);
      const cap = Number.isFinite(capRaw) && capRaw > 0 ? Math.floor(capRaw) : null;
      const available = cap !== null ? Math.min(rawAvailable, cap) : rawAvailable;
      const chargeable = subtotalCents + (stripeTax ? 0 : taxCents) + shippingCents + tipCents;

      // ── FULL-CREDIT, ZERO-CHARGE PATH ────────────────────────────────────
      // When credit covers the ENTIRE total, Stripe has nothing to collect —
      // its 50¢ minimum made full redemption impossible. So we skip Stripe
      // entirely: one atomic transaction re-verifies the credit, mints the
      // order number, reserves stock, burns the credits FIFO, and flips the
      // order straight to paid — the same work the webhook does after a card
      // payment, but atomic here because no third party sits in the middle.
      // Only on flat/no-tax tenants: with Stripe Tax the true total isn't
      // known until session time, and guessing tax on a money path is how
      // books start lying. If a racing checkout shrank the credit, the
      // transaction reports it and we fall through to the normal card path.
      // No income/deposit entry is written: no cash moved today — the cash
      // story lives with the original credit issuance; the credit docs and
      // the order's event trail carry the redemption.
      if (!stripeTax && chargeable > 0 && available >= chargeable) {
        const zeroChargeOk = await db.runTransaction(async (txn: any) => {
          const counterRef = db.collection(`tenants/${tenantId}/counters`).doc('retailOrders');
          const credRefs = credSnap.docs.map((d: any) => d.ref);
          const [freshOrder, counterSnap, ...credFresh] = await Promise.all([
            txn.get(orderRef), txn.get(counterRef), ...credRefs.map((r: any) => txn.get(r)),
          ]);
          if (!freshOrder.exists) return false;
          const creditDocs = credFresh
            .map((c: any, i: number) => ({ ref: credRefs[i], ...(c.exists ? c.data() : {}) }))
            .filter((c: any) => c.status === 'available')
            .sort((a: any, b: any) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
          const liveAvailable = creditDocs.reduce((a: number, c: any) =>
            a + Math.max(0, (Number(c.amountCents) || 0) - (Number(c.usedCents) || 0)), 0);
          if (liveAvailable < chargeable) return false; // racing spend — card path takes over

          const itemRefs = lines.map((l: any) => db.collection(`tenants/${tenantId}/inventory`).doc(l.productId));
          const itemSnaps = await Promise.all(itemRefs.map((r: any) => txn.get(r)));

          const assignedNumber = ((counterSnap.exists ? counterSnap.data().value : 0) || 0) + 1;
          txn.set(counterRef, { value: assignedNumber }, { merge: true });
          itemSnaps.forEach((snap: any, i: number) => {
            if (!snap.exists) return;
            if (lines[i].digital === true) return;
            txn.update(itemRefs[i], { stockReserved: (snap.data().stockReserved ?? 0) + lines[i].qtyOrdered });
          });

          let remaining = chargeable;
          for (const c of creditDocs) {
            if (remaining <= 0) break;
            const avail = Math.max(0, (Number(c.amountCents) || 0) - (Number(c.usedCents) || 0));
            if (avail <= 0) continue;
            const take = Math.min(avail, remaining);
            remaining -= take;
            txn.set(c.ref, {
              usedCents: (Number(c.usedCents) || 0) + take,
              status: take >= avail ? 'used' : 'available',
              lastUsedAt: new Date().toISOString(),
              lastUsedOnRetailOrderId: orderId,
            }, { merge: true });
          }

          const qrToken = makeQrToken(orderId);
          txn.update(orderRef, {
            // A digital-only order paid entirely with credit never touches
            // Stripe, so the webhook that normally completes digital orders
            // never runs. Finish it HERE or it parks on the board as work
            // nobody can do.
            stage: digitalOnly ? 'completed' : 'paid',
            paidAt: new Date().toISOString(),
            ...(digitalOnly ? { completedAt: new Date().toISOString() } : {}),
            isDraft: false,
            orderNumber: assignedNumber, qrToken,
            storeCreditRequestedCents: chargeable,
            paidVia: 'store_credit',
          });
          const evRef = orderRef.collection('events').doc();
          txn.set(evRef, {
            id: evRef.id, type: 'paid', at: new Date().toISOString(),
            actorId: 'system', actorName: 'Store credit',
            meta: { text: `Paid in full with store credit \u2014 $${(chargeable / 100).toFixed(2)} redeemed, nothing charged` },
          });
          return true;
        });

        if (zeroChargeOk) {
          const paidSnap = await orderRef.get();
          const paidOrder = { id: orderId, ...(paidSnap.data() || {}) };
          try {
            await sendOrderConfirmation(db, tenantId, orderId, paidOrder, null);
          } catch (e: any) {
            console.error('[checkout] zero-charge receipt failed (order is paid):', e?.message);
          }
          const origin = process.env.NEXT_PUBLIC_APP_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL || '';
          return NextResponse.json({
            url: `${origin}/shop/${tenantId}/order/${orderId}?paid=credit`,
            orderId, orderNumber: (paidOrder as any).orderNumber ?? null, isDraft: false, zeroCharge: true,
          });
        }
      }

      creditAppliedCents = Math.max(0, Math.min(available, chargeable - 50));
      if (creditAppliedCents > 0) {
        const coupon = await stripe.coupons.create(
          { amount_off: creditAppliedCents, currency: 'usd', duration: 'once', name: 'Store credit' },
          { stripeAccount: stripeAccountId }
        );
        creditCoupon = coupon.id;
        await orderRef.set({ storeCreditRequestedCents: creditAppliedCents }, { merge: true });
      }
    } catch {
      // Any failure here means the customer simply pays full price and every
      // credit survives untouched — the safe direction.
      creditCoupon = null;
      creditAppliedCents = 0;
    }
  }

  try {
    let session: any;
    try {
      session = await stripe.checkout.sessions.create(
        { ...sessionParams(lineItems, stripeTax), ...(creditCoupon ? { discounts: [{ coupon: creditCoupon }] } : {}) },
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
        { ...sessionParams(buildLineItems(false, fbTaxCents), false), ...(creditCoupon ? { discounts: [{ coupon: creditCoupon }] } : {}) },
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
