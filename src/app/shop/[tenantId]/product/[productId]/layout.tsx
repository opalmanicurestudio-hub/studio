import { jsonLd } from '@/lib/json-ld';
import type { Metadata } from 'next';
import React from 'react';

import { listingPriceCents, isStorefrontVisible, type SellableItem } from '@/lib/retail-orders';
import { choiceFor, shopOptionGroups, variantIdsOf } from '@/lib/variants';
import { publicDescription } from '@/lib/product-public';
import { seoDescription, seoTitle } from '@/lib/shop-seo';
import { faqJsonLd } from '@/lib/shop-seo';
import { breadcrumbLd, productGroupLd, productLd, seoOrigin, shopFactsOf } from '@/lib/shop-discovery';
import { cachedRating } from '@/lib/shop-public-server';
import { tenantTimeZone } from '@/lib/tenant-time';

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
    // A variant is sold inside its listing: its page isn't one of its own (lib/variants).
    let listing: any = null;
    if (item?.parentId && item.parentId !== item.id) {
      const ls = await db.collection(`tenants/${tenantId}/inventory`).doc(String(item.parentId)).get();
      const l: any = ls.exists ? { id: ls.id, ...(ls.data() as any) } : null;
      if (l && choiceFor(l, item.id)) listing = l;
    }
    // A listing's variants, for whether it's in stock and what it sells for.
    const variants = new Map<string, any>();
    if (item && !listing) {
      const ids = variantIdsOf(item);
      const snaps = ids.length ? await Promise.all(ids.map((id) => db.collection(`tenants/${tenantId}/inventory`).doc(id).get())) : [];
      for (const v of snaps) if (v.exists) variants.set(v.id, { id: v.id, ...(v.data() as any) });
    }
    return {
      shopName: String(tenant?.businessName || tenant?.name || '').trim(),
      tenant, db,
      item, listing, variants,
      // The shop's product-page FAQ — already written, already shown to
      // customers, just not machine-readable until now.
      faq: Array.isArray(tenant?.retailSettings?.pdpFaq) ? tenant.retailSettings.pdpFaq : [],
      showFaq: tenant?.retailSettings?.pdpShowFaq !== false,
    };
  } catch {
    return { shopName: '', tenant: null as any, db: null as any, item: null, listing: null, variants: new Map<string, any>(), faq: [], showFaq: false };
  }
}

export async function generateMetadata(
  { params }: { params: Promise<{ tenantId: string; productId: string }> },
): Promise<Metadata> {
  const { tenantId, productId } = await params;
  const { shopName, tenant, item, listing } = await load(tenantId, productId);
  if (!item) return { title: shopName || 'Shop' };

  const origin = seoOrigin(tenant);
  // A variant's own address is never indexed: its listing is the page (the shop opens it with the variant picked).
  if (listing) return { title: seoTitle({ shopName, productName: String(listing.name || ''), seoTitle: String(listing.seoTitle || '') }), robots: { index: false, follow: true }, ...(origin ? { alternates: { canonical: `${origin}/shop/${tenantId}/product/${listing.id}` } } : {}) };
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
  const { shopName, tenant, db, item, listing, variants, faq, showFaq } = await load(tenantId, productId);

  if (!item || listing || !isStorefrontVisible(item as SellableItem)) return <>{children}</>;
  const origin = seoOrigin(tenant);
  // No public address known (it's always set in production): no markup rather than relative links.
  if (!origin) return <>{children}</>;
  const url = `${origin}/shop/${tenantId}/product/${productId}`;
  const images = (Array.isArray(item.imageUrls) && item.imageUrls.length ? item.imageUrls : (item.imageUrl ? [item.imageUrl] : [])).filter((u: string) => /^https:\/\//.test(String(u)));
  const facts = shopFactsOf(tenantId, tenant);
  const zone = tenantTimeZone(tenant);
  // The rating the page shows, from the same reader (a rating in a result must match the one on the page), kept briefly.
  const rating = db ? await cachedRating(db, tenantId, productId, item).catch(() => null) : null;
  const common = { url, name: String(item.name || ''), description: String(item.seoDescription || '').trim() || publicDescription(item), images, zone, rating, brand: String(item.brand || '') };
  // A listing in variants is a product group, each variant at its own price and stock (what the feed gives Google);
  // a plain product is one product.
  const byId = new Map<string, any>([[String(item.id), item], ...[...variants.entries()]]);
  const vg: any = variantIdsOf(item).length ? shopOptionGroups(item, byId, { zone }).find((g: any) => g.variants) : null;
  const ld = (vg && productGroupLd(facts, item, byId, vg.choices, common)) || productLd(facts, item, { ...common, priceCents: listingPriceCents(item as SellableItem) });
  const crumbs = shopName ? breadcrumbLd([{ name: shopName, url: `${origin}/shop/${tenantId}` }, { name: 'Shop all', url: `${origin}/shop/${tenantId}/catalog` }, { name: String(item.name || 'Product'), url }]) : null;

  // Only marked up when the page actually SHOWS the questions — Google
  // requires the same Q&A to be visible, and marking up an invisible FAQ is
  // the kind of thing that gets rich results switched off site-wide.
  const faqLd = showFaq ? faqJsonLd(faq) : null;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(ld) }}
      />
      {crumbs && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(crumbs) }} />}
      {faqLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLd(faqLd) }}
        />
      )}
      {children}
    </>
  );
}
