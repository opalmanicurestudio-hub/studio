import { NextRequest, NextResponse } from 'next/server';

import { isStorefrontVisible, listingPriceCents, sellableStock, type SellableItem } from '@/lib/retail-orders';

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
  const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '').trim();
  const wholesaleCode = String(req.nextUrl.searchParams.get('wholesaleCode') || '').trim();

  if (!tenantId) return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });

  const db = getAdminDb();
  const tenantSnap = await db.collection('tenants').doc(tenantId).get();
  if (!tenantSnap.exists) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
  const tenant = tenantSnap.data() as any;
  const rs = tenant.retailSettings || {};

  const expectedCode = String(rs.wholesaleAccessCode || '').trim();
  const wholesaleOffered = expectedCode.length > 0;
  const wholesaleUnlocked =
    wholesaleOffered && wholesaleCode.length > 0 &&
    wholesaleCode.toLowerCase() === expectedCode.toLowerCase();

  if (wholesaleCode && !wholesaleUnlocked) {
    return NextResponse.json({ error: 'Invalid wholesale access code' }, { status: 403 });
  }

  const invSnap = await db.collection(`tenants/${tenantId}/inventory`)
    .where('type', '==', 'retail').get();

  const products = invSnap.docs
    .map((d: any) => ({ id: d.id, ...d.data() } as SellableItem))
    .filter((item: SellableItem) => isStorefrontVisible(item))
    .map((item: SellableItem) => {
      const available = Math.max(0, sellableStock(item));
      return {
        id: item.id,
        name: item.name,
        category: item.category || 'General',
        description: item.onlineDescription || '',
        imageUrls: item.imageUrls || [],
        priceCents: listingPriceCents(item, 'retail'),
        wholesalePriceCents: wholesaleUnlocked ? listingPriceCents(item, 'wholesale') : null,
        wholesaleMinQty: wholesaleUnlocked ? item.wholesaleMinQty ?? 0 : null,
        inStock: available > 0 || item.allowBackorder === true,
        qtyAvailable: item.allowBackorder === true ? MAX_SHOWN_QTY : Math.min(available, MAX_SHOWN_QTY),
        lowStock: available > 0 && available <= (item.lowStockThreshold ?? 0),
      };
    })
    .sort((a: any, b: any) => a.name.localeCompare(b.name));

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
      wholesaleOffered,
      wholesaleUnlocked,
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
}
