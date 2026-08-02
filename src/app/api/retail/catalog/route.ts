import { NextRequest, NextResponse } from 'next/server';

import { isStorefrontVisible, listingPriceCents, sellableStock, type SellableItem } from '@/lib/retail-orders';
import { sanitizeShopConfig } from '@/lib/shop-sections';
import { discountedCents, resolveWholesaleAccess } from '@/lib/retail-wholesale';

// ─── /api/retail/catalog/route.ts ─────────────────────────────────────────────
// GET ?tenantId=...&wholesaleCode=...
//
// Public, unauthenticated. Serves the storefront its catalog through the
// Admin SDK so no Firestore security-rule changes are needed for the public
// shop. Never exposes costPerUnit, batches, supplier, or raw stock counts —
// only what a shopper may see.
//
// Wholesale prices are ONLY included when a valid wholesaleCode is supplied;
// otherwise the response is identical to what an anonymous shopper gets.

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-retail-catalog';
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

const MAX_SHOWN_QTY = 99; // never reveal exact large stock counts

export async function GET(req: NextRequest) {
  try {
  const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '').trim();
  const wholesaleCode = String(req.nextUrl.searchParams.get('wholesaleCode') || '').trim();

  if (!tenantId) return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });

  const db = getAdminDb();
  const tenantSnap = await db.collection('tenants').doc(tenantId).get();
  if (!tenantSnap.exists) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
  const tenant = tenantSnap.data() as any;
  const rs = tenant.retailSettings || {};

  const wsAccess = await resolveWholesaleAccess(db, tenantId, rs, wholesaleCode);
  if (wholesaleCode && !wsAccess.unlocked) {
    return NextResponse.json({ error: wsAccess.error || 'Invalid wholesale access code' }, { status: 403 });
  }
  const wholesaleUnlocked = wsAccess.unlocked;
  const wsDiscount = wsAccess.account?.extraDiscountPercent || 0;
  const wholesaleOffered = String(rs.wholesaleAccessCode || '').trim().length > 0 || rs.wholesaleOffered !== false;

  const invSnap = await db.collection(`tenants/${tenantId}/inventory`)
    .where('type', '==', 'retail').get();

  const products = invSnap.docs
    .map((d: any) => ({ id: d.id, ...d.data() } as SellableItem))
    .filter((item: SellableItem) => isStorefrontVisible(item))
    .flatMap((item: SellableItem) => {
      // One malformed inventory doc must never take the whole shop down:
      // anything that throws here is skipped (and logged), not fatal.
      try {
        const available = Math.max(0, sellableStock(item) || 0);
        return [{
        id: item.id,
        name: String(item.name || '').trim() || 'Item',
        category: String(item.category || '') || 'General',
        description: String(item.onlineDescription || ''),
        imageUrls: Array.isArray(item.imageUrls) ? item.imageUrls.filter(Boolean) : [],
        priceCents: listingPriceCents(item, 'retail'),
        wholesalePriceCents: wholesaleUnlocked ? discountedCents(listingPriceCents(item, 'wholesale'), wsDiscount) : null,
        wholesaleMinQty: wholesaleUnlocked ? item.wholesaleMinQty ?? 0 : null,
        inStock: available > 0 || item.allowBackorder === true,
        qtyAvailable: item.allowBackorder === true ? MAX_SHOWN_QTY : Math.min(available, MAX_SHOWN_QTY),
        lowStock: available > 0 && available <= (item.lowStockThreshold ?? 0),
        }];
      } catch (e: any) {
        console.error('[retail-catalog] skipped malformed item', item?.id, e?.message);
        return [];
      }
    })
    .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));

  return NextResponse.json({
    shop: {
      tenantId,
      name: tenant.businessName || tenant.name || 'Shop',
      logoUrl: tenant.logoUrl || null,
      tagline: String(rs.shopTagline || '').trim() || 'Shop',
      announcement: String(rs.shopAnnouncement || '').trim(),
      layout: ['grid', 'list', 'showcase'].includes(rs.shopLayout) ? rs.shopLayout : 'grid',
      paused: rs.storePaused === true,
      pausedMessage: String(rs.storePausedMessage || '').trim(),
      cartHoldMinutes: Math.max(0, Math.floor(Number(rs.cartHoldMinutes) || 0)),
      pageConfig: sanitizeShopConfig(rs.shopPageConfig),
      wholesaleOffered,
      wholesaleUnlocked,
      wholesaleBusiness: wsAccess.account?.businessName || '',
      taxRatePercent: Number(rs.taxRatePercent) || 0,
      wholesaleTaxExempt: rs.wholesaleTaxExempt === true,
      flatShippingDollars: Number(rs.flatShippingDollars) || 0,
      freeShippingOverDollars: Number(rs.freeShippingOverDollars) || 0,
      shippingOffered: rs.shippingOffered !== false,
      curbsideOffered: rs.curbsideOffered !== false,
      curbsideMode: rs.curbsideMode || 'freeform',
      curbsideSpots: Array.isArray(rs.curbsideSpots) ? rs.curbsideSpots : [],
    },
    products,
  });
  } catch (e: any) {
    console.error('[retail-catalog] fatal:', e?.message);
    return NextResponse.json(
      { error: `Shop data error: ${String(e?.message || 'unknown').slice(0, 160)}` },
      { status: 500 }
    );
  }
}
