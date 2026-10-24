// src/app/shop/[tenantId]/feed.xml/route.ts — THE SHOP'S PRODUCT FEED for Google Merchant Center (free listings on
// Google Shopping and Search) and any shopping service that reads the same format. Public, the same facts as the shop
// pages; one item per variant at the price and stock its page shows (lib/shop-discovery). The owner can switch it off
// (Setup, Search and assistants); a shop with payments not connected, or pickup only, has none.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { loadPublicShop } from '@/lib/shop-public-server';
import { feedItems, feedProblem, merchantFeedXml, seoOrigin, shopFactsOf } from '@/lib/shop-discovery';

export const dynamic = 'force-dynamic';
const XML = { 'Content-Type': 'application/xml; charset=utf-8' };
const none = (why: string, status = 404) => new NextResponse(`<?xml version="1.0" encoding="UTF-8"?>\n<error>${why}</error>\n`, { status, headers: { ...XML, 'Cache-Control': 'no-store' } });

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  try {
    // The owner's switch and the shop's state are checked before the catalog is read.
    const shop = await loadPublicShop(getAdminDb(), tenantId, (t) => !feedProblem(shopFactsOf(tenantId, t)));
    if (!shop || shop.gated) return none('No product feed for this shop.');
    const origin = seoOrigin(shop.t, req.nextUrl.origin);
    return new NextResponse(merchantFeedXml(shop.facts, origin, feedItems(shop.facts, origin, shop.products, shop.byId, shop.zone)), { headers: { ...XML, 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600' } });
  } catch (e: any) {
    console.error('[feed.xml] failed for', tenantId, e?.message);
    return none('The feed is not available right now.', 503);
  }
}
