import type { Metadata } from 'next';
import React from 'react';

import { clip, seoDescription } from '@/lib/shop-seo';

// ─── /shop/[tenantId]/catalog/layout.tsx ─────────────────────────────────────
// The browse page is the one a search engine is most likely to send someone
// to for a broad query — "gel polish shop", not a specific bottle — and it was
// inheriting the same anonymous title as everything else.
//
// It also carries the breadcrumb markup for the shop. Breadcrumbs are what
// turn a search result's second line from a raw URL into "Opal Manicure
// Studio › Shop", which is both clearer to a person and a stronger signal
// about how the site is organised.

export const dynamic = 'force-dynamic';

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-catalog-seo';
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

async function loadShop(tenantId: string) {
  try {
    const db = getAdminDb();
    const snap = await db.collection('tenants').doc(tenantId).get();
    const t: any = snap.exists ? snap.data() : {};
    return {
      shopName: String(t?.businessName || t?.name || '').trim(),
      tagline: String(t?.retailSettings?.shopTagline || t?.tagline || '').trim(),
    };
  } catch {
    return { shopName: '', tagline: '' };
  }
}

export async function generateMetadata(
  { params }: { params: Promise<{ tenantId: string }> },
): Promise<Metadata> {
  const { tenantId } = await params;
  const { shopName, tagline } = await loadShop(tenantId);
  const origin = process.env.NEXT_PUBLIC_APP_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL || '';
  const url = origin ? `${origin}/shop/${tenantId}/catalog` : undefined;

  const shop = shopName || 'Shop';
  const title = clip(`Shop all \u00b7 ${shop}`, 60);
  const description = seoDescription({
    shopName: shop,
    description: tagline || `Browse everything ${shop} sells online \u2014 pick up in store or have it shipped.`,
  });

  return {
    title,
    description,
    ...(url ? { alternates: { canonical: url } } : {}),
    openGraph: {
      type: 'website',
      title,
      description,
      ...(url ? { url } : {}),
      ...(shopName ? { siteName: shopName } : {}),
    },
    twitter: { card: 'summary', title, description },
  };
}

export default async function CatalogSeoLayout({
  children, params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const { shopName } = await loadShop(tenantId);
  const origin = process.env.NEXT_PUBLIC_APP_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL || '';
  if (!shopName || !origin) return <>{children}</>;

  const ld = {
    '@context': 'https://schema.org/',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: shopName, item: `${origin}/shop/${tenantId}` },
      { '@type': 'ListItem', position: 2, name: 'Shop all', item: `${origin}/shop/${tenantId}/catalog` },
    ],
  };

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
