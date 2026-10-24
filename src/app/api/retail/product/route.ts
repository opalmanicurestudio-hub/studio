import { getRetailSecrets } from '@/lib/retail-secrets';
import { NextRequest, NextResponse } from 'next/server';
import { ensureCodeIndex } from '@/lib/code-index';

import {
  isStorefrontVisible, listingPriceCents, type SellableItem,
} from '@/lib/retail-orders';
import { choiceFor, listingBuyable, listingStock, shopOptionGroups, variantIdsOf } from '@/lib/variants';
import { publicFields } from '@/lib/product-public';
import { preorderState } from '@/lib/retail-orders';
import { discountedCents, resolveWholesaleAccess } from '@/lib/retail-wholesale';
import { leadOf, publicSchedule } from '@/lib/ship-promise';
import { tenantTimeZone } from '@/lib/tenant-time';

// ─── /api/retail/product/route.ts ─────────────────────────────────────────────
// GET ?tenantId=...&productId=...&wholesaleCode=...
//
// The product page's data source: everything a shopper may see about one item
// — full gallery, description, how-to-use, spec rows, and downloadable
// documents (MSDS/SDS, guides, certificates). Same trust rules as the
// catalog: costs/batches/suppliers never leave the server, wholesale pricing
// only appears with a valid code, stock counts are clamped.

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-retail-product';
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

const MAX_SHOWN_QTY = 99;

export async function GET(req: NextRequest) {
  const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '').trim();
  const productId = String(req.nextUrl.searchParams.get('productId') || '').trim();
  const wholesaleCode = String(req.nextUrl.searchParams.get('wholesaleCode') || '').trim();

  if (!tenantId || !productId) {
    return NextResponse.json({ error: 'tenantId and productId are required' }, { status: 400 });
  }

  const db = getAdminDb();
  // Each variant points at its listing (variants saved before that are pointed the first time anything asks), so a
  // variant's old link opens its listing.
  await ensureCodeIndex(db, tenantId).catch(() => {});
  const [tenantSnap, itemSnap] = await Promise.all([
    db.collection('tenants').doc(tenantId).get(),
    db.collection(`tenants/${tenantId}/inventory`).doc(productId).get(),
  ]);
  if (!tenantSnap.exists) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
  if (!itemSnap.exists) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

  const tenant = tenantSnap.data() as any;
  const rs = tenant.retailSettings || {};
  const item = { id: itemSnap.id, ...itemSnap.data() } as SellableItem;
  // Inventory and Shop Settings write different field names for the same
  // things; publicFields() merges them so a product detailed on either screen
  // shows up complete online.
  const pub = publicFields(item);

  // A variant is sold inside its listing: its link opens the listing with it picked (lib/variants).
  const parentId = String((item as any).parentId || '');
  if (parentId && parentId !== item.id) {
    const ps = await db.collection(`tenants/${tenantId}/inventory`).doc(parentId).get();
    const parent: any = ps.exists ? { id: ps.id, ...ps.data() } : null;
    const ch = parent ? choiceFor(parent, item.id) : null;
    if (parent && ch) {
      return NextResponse.json({ error: 'Product not available', ...(isStorefrontVisible(parent) ? { listing: { id: parent.id, group: ch.group.id, choice: ch.choice.id } } : {}) }, { status: 404 });
    }
  }
  if (!isStorefrontVisible(item)) {
    return NextResponse.json({ error: 'Product not available' }, { status: 404 });
  }
  // Its variants, which hold its stock and may have prices of their own.
  const vids = variantIdsOf(item);
  const vsnaps = vids.length ? await Promise.all(vids.map((id) => db.collection(`tenants/${tenantId}/inventory`).doc(id).get())) : [];
  const byId = new Map<string, any>(vsnaps.filter((x: any) => x.exists).map((x: any) => [String(x.id), { id: x.id, ...x.data() }]));

  const wsAccess = await resolveWholesaleAccess(db, tenantId, wholesaleCode ? { ...rs, wholesaleAccessCode: (await getRetailSecrets(db, tenantId)).wholesaleAccessCode } : rs, wholesaleCode);
  if (wholesaleCode && !wsAccess.unlocked) {
    return NextResponse.json({ error: wsAccess.error || 'Invalid wholesale access code' }, { status: 403 });
  }
  const wholesaleUnlocked = wsAccess.unlocked;
  const wsDiscount = wsAccess.account?.extraDiscountPercent || 0;

  const available = listingStock(item, byId);
  // Pre-order runs close at the end of their day on the shop's clock, not the server's.
  const shopZone = tenantTimeZone(tenant);
  const pre = preorderState(item as any, shopZone);
  // publicSpecs() also surfaces the inventory size/unit as a Size row, so an
  // item detailed only in Inventory still has real specs on its page.
  const specs = pub.specs.filter((s) => s.label && s.value).slice(0, 40);
  const documents = Array.isArray(item.documents)
    ? item.documents.filter((d: any) => d && d.name && /^https?:\/\//i.test(String(d.url || ''))).slice(0, 20)
    : [];

  return NextResponse.json({
    shop: {
      tenantId,
      name: tenant.businessName || tenant.name || 'Shop',
      wholesaleUnlocked,
      paused: rs.storePaused === true,
      // What the shop actually does, so the page can stop advertising pickup
      // at a ship-only shop. Absent settings mean "offered" — a shop that has
      // never touched these keeps today's behaviour.
      offersPickup: rs.pickupEnabled !== false,
      offersShipping: rs.shippingEnabled !== false,
      // Ship-by and arrival dates are worked out on the page, live, from the shop's schedule (lib/ship-promise),
      // only once the shop shows dates.
      timeZone: shopZone,
      shipSchedule: publicSchedule(rs),
      // The server's clock, so a device set wrong can't move a cutoff or the countdown.
      serverNow: new Date().toISOString(),
      // Product page layout: every block on by default, so an untouched shop
      // looks exactly as it does now and customising is purely additive.
      page: {
        showTrust: rs.pdpShowTrust !== false,
        showFaq: rs.pdpShowFaq !== false,
        showRelated: rs.pdpShowRelated !== false,
        showVideo: rs.pdpShowVideo !== false,
        showStickyBar: rs.pdpShowStickyBar !== false,
        faq: Array.isArray(rs.pdpFaq)
          ? rs.pdpFaq
              .filter((f: any) => f && String(f.q || '').trim() && String(f.a || '').trim())
              .slice(0, 6)
              .map((f: any) => ({ q: String(f.q).slice(0, 120), a: String(f.a).slice(0, 600) }))
          : [],
      },
    },
    product: {
      id: item.id,
      name: item.name,
      category: item.category || 'General',
      sku: item.sku || '',
      description: pub.description,
      howToUse: pub.howToUse.trim(),
      specs,
      documents,
      imageUrls: pub.images.slice(0, 10),
      // Each variant with the price it sells for and whether it can be bought (the other choices with what they add).
      optionGroups: shopOptionGroups(item, byId, { wholesale: wholesaleUnlocked, discountPct: wsDiscount, zone: shopZone, maxShown: MAX_SHOWN_QTY }),
      videoUrl: pub.videoUrl,
      priceCents: listingPriceCents(item, 'retail'),
      wholesalePriceCents: wholesaleUnlocked ? discountedCents(listingPriceCents(item, 'wholesale'), wsDiscount) : null,
      wholesaleMinQty: wholesaleUnlocked ? item.wholesaleMinQty ?? 0 : null,
      digital: item.digital === true,
      preorder: pre,
      leadDays: item.digital === true ? null : leadOf(item.leadDays),
      // A digital item can never be out of stock — the storefront must not
      // grey out a course because a stock number nobody maintains hit zero.
      inStock: vids.length ? listingBuyable(item, byId, shopZone) : item.digital === true
        || (item.preorder === true ? pre.open : false)
        || available > 0 || item.allowBackorder === true,
      qtyAvailable: item.allowBackorder === true ? MAX_SHOWN_QTY : Math.min(available, MAX_SHOWN_QTY),
      lowStock: available > 0 && available <= (item.lowStockThreshold ?? 0),
    },
  });
}
