// src/app/shop/[tenantId]/llms.txt/route.ts — THE SHOP'S GUIDE FOR AI ASSISTANTS, in plain text: what it sells at what
// price, its bundles, how it ships, its return window, and the rules (lib/shop-discovery shopGuideText). Follows the
// business's switch for assistants (Settings, Booking, Assistants), like the booking guide.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { agentPolicy } from '@/lib/agent-access';
import { loadPublicShop } from '@/lib/shop-public-server';
import { seoOrigin, shopGuideText } from '@/lib/shop-discovery';

export const dynamic = 'force-dynamic';
const TXT = { 'Content-Type': 'text/plain; charset=utf-8' };
const NO = { ...TXT, 'Cache-Control': 'no-store' };

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  try {
    const db = getAdminDb(); const shop = await loadPublicShop(db, tenantId, (t) => agentPolicy(t).menu);
    if (!shop) return new NextResponse('Shop not found.\n', { status: 404, headers: NO });
    const origin = seoOrigin(shop.t, req.nextUrl.origin);
    if (shop.gated) return new NextResponse(`This business doesn't take requests from assistants. Please use its shop: ${origin}/shop/${tenantId}\n`, { headers: NO });
    const books = !(await db.collection(`tenants/${tenantId}/services`).limit(1).get()).empty;
    return new NextResponse(shopGuideText(shop.facts, origin, shop.products, shop.offers, books ? `${origin}/book/${tenantId}` : null), { headers: { ...TXT, 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1800' } });
  } catch (e: any) {
    console.error('[shop llms.txt] failed for', tenantId, e?.message);
    return new NextResponse('The guide is not available right now.\n', { status: 503, headers: NO });
  }
}
