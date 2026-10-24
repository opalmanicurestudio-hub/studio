import type { Metadata } from 'next';
import React, { cache } from 'react';
import { getAdminDb } from '@/lib/firebase-admin';
import { jsonLd } from '@/lib/json-ld';
import { clip, seoDescription } from '@/lib/shop-seo';
import { breadcrumbLd, offerJsonLd, offerSaving, seoOrigin } from '@/lib/shop-discovery';
import { loadPublicShop } from '@/lib/shop-public-server';

// ─── /shop/[tenantId]/offer/[offerId]/layout.tsx ──────────────────────────────
// A kit, box or look has its own page (a client component, so it can't export metadata). This server layout gives it
// a title, a description and a share card, and the structured data for it: a set with a fixed total is a product at
// that price; a box or look is the list of what's in it (lib/shop-discovery). An offer that isn't live, whose
// products aren't all on sale, or that has no page of its own (bought-together picks), isn't indexed.

const load = cache(async (tenantId: string, offerId: string) => {
  try {
    const shop = await loadPublicShop(getAdminDb(), tenantId);
    if (!shop) return null;
    return { shop, offer: shop.offers.find((o: any) => String(o.id) === offerId) || null };
  } catch { return null; }
});

export async function generateMetadata({ params }: { params: Promise<{ tenantId: string; offerId: string }> }): Promise<Metadata> {
  const { tenantId, offerId } = await params;
  const r = await load(tenantId, offerId);
  const shopName = r?.shop.facts.name || 'Shop';
  if (!r?.offer) return { title: shopName, robots: { index: false, follow: true } };
  const o: any = r.offer;
  const origin = seoOrigin(r.shop.t);
  const url = origin ? `${origin}/shop/${tenantId}/offer/${offerId}` : undefined;
  const saving = offerSaving(o);
  const title = clip(`${o.name} · ${shopName}`, 60);
  const description = seoDescription({ shopName, description: String(o.blurb || '').trim() || `${o.name}${saving ? `: ${saving}` : ''}, from ${shopName}.` });
  return {
    title, description,
    ...(url ? { alternates: { canonical: url } } : {}),
    openGraph: { type: 'website', title, description, ...(url ? { url } : {}), siteName: shopName, ...(o.photoUrl ? { images: [o.photoUrl] } : {}) },
    twitter: { card: o.photoUrl ? 'summary_large_image' : 'summary', title, description },
  };
}

export default async function OfferSeoLayout({ children, params }: { children: React.ReactNode; params: Promise<{ tenantId: string; offerId: string }> }) {
  const { tenantId, offerId } = await params;
  const r = await load(tenantId, offerId);
  if (!r?.offer) return <>{children}</>;
  const origin = seoOrigin(r.shop.t);
  if (!origin) return <>{children}</>;
  const url = `${origin}/shop/${tenantId}/offer/${offerId}`;
  const ld = offerJsonLd(r.offer as any, r.shop.productMap, r.shop.facts, url, r.shop.byId);
  const crumbs = breadcrumbLd([{ name: r.shop.facts.name, url: `${origin}/shop/${tenantId}` }, { name: String((r.offer as any).name || 'Bundle'), url }]);
  return (
    <>
      {ld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(crumbs) }} />
      {children}
    </>
  );
}
