import type { Metadata } from 'next';
import React from 'react';

import { sanitizeTheme, themeToCss } from '@/lib/shop-theme';
import { seoDescription } from '@/lib/shop-seo';
import { jsonLd } from '@/lib/json-ld';
import { seoOrigin, shopFactsOf, shopJsonLd, type ShopFacts } from '@/lib/shop-discovery';
import { brandOf, type ShopBrand } from '@/lib/shop-site';
import { ShopFooter, ShopSiteProvider, type ShopSite } from '@/components/shop/ShopChrome';

// ─── /shop/[tenantId]/layout.tsx ──────────────────────────────────────────────
// Every customer-facing page sits inside this, so a shop's brand is applied
// once, server-side, before anything renders — no flash of our colours before
// theirs arrive, and no per-page theming code to keep in sync.
//
// Theme values become CSS custom properties on a wrapper element. Components
// opt in with `bg-[var(--shop-card)]`-style classes, which means an untouched
// page keeps working exactly as it does today and can be migrated one block
// at a time rather than in one risky sweep.

export const dynamic = 'force-dynamic';

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-shop-theme';
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
    if (!snap.exists) return { theme: sanitizeTheme(null), shopName: '', tagline: '', logoUrl: '', facts: null as ShopFacts | null, origin: seoOrigin(null), brand: brandOf(null), announcement: '', address: '' };
    const data = snap.data() as any;
    const rs = data?.retailSettings || {};
    // The footer needs the shop's name and this read already has it — one
    // Firestore read serves both, instead of a second fetch per page view.
    return {
      theme: sanitizeTheme(rs.shopTheme),
      shopName: String(data?.businessName || data?.name || '').trim(),
      tagline: String(rs.shopTagline || rs.shopBlurb || data?.tagline || '').trim(),
      logoUrl: String(rs.logoUrl || data?.logoUrl || '').trim(),
      // What search engines may know about the shop as a business (lib/shop-discovery), from this same read.
      facts: shopFactsOf(tenantId, data),
      // The shop's own domain when it has one, the same address customers' links use.
      origin: seoOrigin(data),
      brand: brandOf(data) as ShopBrand,
      announcement: String(rs.shopAnnouncement || '').trim().slice(0, 300),
      address: data?.address && typeof data.address === 'object' ? [data.address.street || data.address.line1, data.address.city, data.address.state || data.address.region].filter(Boolean).join(', ') : '',
    };
  } catch {
    // A theme is decoration; never let it stop a shop from selling.
    return { theme: sanitizeTheme(null), shopName: '', tagline: '', logoUrl: '', facts: null as ShopFacts | null, origin: seoOrigin(null), brand: brandOf(null), announcement: '', address: '' };
  }
}

export async function generateMetadata(
  { params }: { params: Promise<{ tenantId: string }> },
): Promise<Metadata> {
  const { tenantId } = await params;
  const { shopName, tagline, origin, brand } = await loadShop(tenantId);
  const logoUrl = brand.logoUrl;
  // The browser-tab icon: the shop's own small icon, else its logo.
  const icon = brand.iconUrl || brand.logoUrl;
  const url = origin ? `${origin}/shop/${tenantId}` : undefined;
  const title = shopName || 'Shop';
  const description = seoDescription({ shopName: title, description: tagline });
  return {
    title: { default: title, template: `%s` },
    description,
    ...(url ? { alternates: { canonical: url } } : {}),
    openGraph: {
      type: 'website',
      title,
      description,
      ...(url ? { url } : {}),
      siteName: title,
      ...(logoUrl ? { images: [logoUrl] } : {}),
    },
    twitter: { card: logoUrl ? 'summary_large_image' : 'summary', title, description },
    ...(icon ? { icons: { icon, apple: icon } } : {}),
  };
}

export default async function ShopLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const { theme, shopName, tagline, facts, origin, brand, announcement, address } = await loadShop(tenantId);
  const dark = theme.surface.replace('#', '').length >= 6 && (parseInt(theme.surface.slice(1, 3), 16) * 0.299 + parseInt(theme.surface.slice(3, 5), 16) * 0.587 + parseInt(theme.surface.slice(5, 7), 16) * 0.114) < 128;
  const site: ShopSite = { tenantId, name: shopName || 'Shop', tagline, announcement, brand, layout: theme.site, dark, address };
  const ld = facts && origin && shopName ? shopJsonLd(facts, origin) : [];

  return (
    <div
      data-shop-theme
      style={{ ...(Object.fromEntries(
        themeToCss(theme)
          .split(';')
          .map((pair) => pair.split(/:(.+)/))
          .filter((kv) => kv.length >= 2)
          .map(([k, v]) => [k.trim(), v.trim()])
      ) as React.CSSProperties) }}
      className="cf-shop min-h-dvh flex flex-col"
    >
      {ld.map((x, i) => <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(x) }} />)}
      <ShopSiteProvider value={site}>
        <div className="flex-1">{children}</div>
        <ShopFooter />
      </ShopSiteProvider>
    </div>
  );
}
