import type { Metadata } from 'next';
import React from 'react';

import { listingPriceCents, sellableStock, isStorefrontVisible, type SellableItem } from '@/lib/retail-orders';
import { publicDescription } from '@/lib/product-public';
import { productJsonLd, seoDescription, seoTitle } from '@/lib/shop-seo';

// ─── /shop/[tenantId]/product/[productId]/layout.tsx ─────────────────────────
// The product page itself is a client component — it has a cart, a quantity
// stepper, live stock. That's the right shape for the page and the wrong shape
// for search engines, because a client component cannot export metadata.
//
// So the metadata lives here, in a server layout wrapped around it. Nothing
// about the page changes; it simply stops being anonymous. This is also why
// the structured data is rendered here rather than in the page: a crawler that
// doesn't run JavaScript still sees the price and the availability.
//
// Every read is best-effort. A shop must never fail to render because a title
// couldn't be looked up.

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-shop-seo';
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

async function load(tenantId: string, productId: string) {
  try {
    const db = getAdminDb();
    const [tSnap, pSnap] = await Promise.all([
      db.collection('tenants').doc(tenantId).get(),
      db.collection(`tenants/${tenantId}/inventory`).doc(productId).get(),
    ]);
    const tenant: any = tSnap.exists ? tSnap.data() : {};
    const item: any = pSnap.exists ? { id: pSnap.id, ...(pSnap.data() as any) } : null;
    return {
      shopName: String(tenant?.businessName || tenant?.name || '').trim(),
      item,
    };
  } catch {
    return { shopName: '', item: null };
  }
}

export async function generateMetadata(
  { params }: { params: Promise<{ tenantId: string; productId: string }> },
): Promise<Metadata> {
  const { tenantId, productId } = await params;
  const { shopName, item } = await load(tenantId, productId);
  if (!item) return { title: shopName || 'Shop' };

  const origin = process.env.NEXT_PUBLIC_APP_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL || '';
  const url = origin ? `${origin}/shop/${tenantId}/product/${productId}` : undefined;
  const images = Array.isArray(item.imageUrls) && item.imageUrls.length
    ? item.imageUrls
    : (item.imageUrl ? [item.imageUrl] : []);

  const input = {
    shopName,
    productName: String(item.name || ''),
    description: publicDescription(item),
    images,
    seoTitle: String(item.seoTitle || ''),
    seoDescription: String(item.seoDescription || ''),
    url,
  };
  const title = seoTitle(input);
  const description = seoDescription(input);

  // A product that isn't published must not be indexed — otherwise a search
  // result leads to a page that refuses to sell, which is worse than no
  // result at all.
  const indexable = isStorefrontVisible(item as SellableItem);

  return {
    title,
    description,
    ...(url ? { alternates: { canonical: url } } : {}),
    robots: indexable ? undefined : { index: false, follow: false },
    openGraph: {
      type: 'website',
      title,
      description,
      ...(url ? { url } : {}),
      ...(shopName ? { siteName: shopName } : {}),
      ...(images.length ? { images: images.slice(0, 4) } : {}),
    },
    twitter: {
      card: images.length ? 'summary_large_image' : 'summary',
      title,
      description,
      ...(images.length ? { images: images.slice(0, 1) } : {}),
    },
  };
}

export default async function ProductSeoLayout({
  children, params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenantId: string; productId: string }>;
}) {
  const { tenantId, productId } = await params;
  const { shopName, item } = await load(tenantId, productId);

  if (!item || !isStorefrontVisible(item as SellableItem)) return <>{children}</>;

  const origin = process.env.NEXT_PUBLIC_APP_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL || '';
  const images = Array.isArray(item.imageUrls) && item.imageUrls.length
    ? item.imageUrls
    : (item.imageUrl ? [item.imageUrl] : []);

  const ld = productJsonLd({
    shopName,
    productName: String(item.name || ''),
    description: publicDescription(item),
    images,
    priceCents: listingPriceCents(item as SellableItem),
    inStock: item.digital === true || item.preorder === true || sellableStock(item as SellableItem) > 0 || item.allowBackorder === true,
    sku: String(item.sku || ''),
    url: origin ? `${origin}/shop/${tenantId}/product/${productId}` : undefined,
    seoDescription: String(item.seoDescription || ''),
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }}
      />
      {children}
    </>
  );
}
