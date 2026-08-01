import { NextRequest, NextResponse } from 'next/server';

import {
  isStorefrontVisible, listingPriceCents, sellableStock, type SellableItem,
} from '@/lib/retail-orders';
import { discountedCents, resolveWholesaleAccess } from '@/lib/retail-wholesale';

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
  const [tenantSnap, itemSnap] = await Promise.all([
    db.collection('tenants').doc(tenantId).get(),
    db.collection(`tenants/${tenantId}/inventory`).doc(productId).get(),
  ]);
  if (!tenantSnap.exists) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
  if (!itemSnap.exists) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

  const tenant = tenantSnap.data() as any;
  const rs = tenant.retailSettings || {};
  const item = { id: itemSnap.id, ...itemSnap.data() } as SellableItem;

  if (!isStorefrontVisible(item)) {
    return NextResponse.json({ error: 'Product not available' }, { status: 404 });
  }

  const wsAccess = await resolveWholesaleAccess(db, tenantId, rs, wholesaleCode);
  if (wholesaleCode && !wsAccess.unlocked) {
    return NextResponse.json({ error: wsAccess.error || 'Invalid wholesale access code' }, { status: 403 });
  }
  const wholesaleUnlocked = wsAccess.unlocked;
  const wsDiscount = wsAccess.account?.extraDiscountPercent || 0;

  const available = Math.max(0, sellableStock(item));
  const specs = Array.isArray(item.specs)
    ? item.specs.filter((s: any) => s && s.label && s.value).slice(0, 40)
    : [];
  const documents = Array.isArray(item.documents)
    ? item.documents.filter((d: any) => d && d.name && /^https?:\/\//i.test(String(d.url || ''))).slice(0, 20)
    : [];

  return NextResponse.json({
    shop: {
      tenantId,
      name: tenant.businessName || tenant.name || 'Shop',
      wholesaleUnlocked,
      paused: rs.storePaused === true,
    },
    product: {
      id: item.id,
      name: item.name,
      category: item.category || 'General',
      sku: item.sku || '',
      description: item.onlineDescription || '',
      howToUse: (item.howToUse || '').trim(),
      specs,
      documents,
      imageUrls: Array.isArray(item.imageUrls) ? item.imageUrls.filter(Boolean).slice(0, 10) : [],
      priceCents: listingPriceCents(item, 'retail'),
      wholesalePriceCents: wholesaleUnlocked ? discountedCents(listingPriceCents(item, 'wholesale'), wsDiscount) : null,
      wholesaleMinQty: wholesaleUnlocked ? item.wholesaleMinQty ?? 0 : null,
      inStock: available > 0 || item.allowBackorder === true,
      qtyAvailable: item.allowBackorder === true ? MAX_SHOWN_QTY : Math.min(available, MAX_SHOWN_QTY),
      lowStock: available > 0 && available <= (item.lowStockThreshold ?? 0),
    },
  });
}
