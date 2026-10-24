// src/app/api/agents/[tenantId]/shop/route.ts — ONE SHOP FOR AI ASSISTANTS (lib/shop-discovery shopAgentJson):
// products with live prices and stock (each variant's own), bundles, policies and where to buy. Public and read-only
// (the same facts as the shop pages), cached briefly, open to any site. Follows the business's switch for assistants.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { agentErr, agentPolicy } from '@/lib/agent-access';
import { loadPublicShop } from '@/lib/shop-public-server';
import { seoOrigin, shopAgentJson } from '@/lib/shop-discovery';

export const dynamic = 'force-dynamic';
const CORS = { 'Access-Control-Allow-Origin': '*' };
const NO = { ...CORS, 'Cache-Control': 'no-store' };
export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET, OPTIONS' } }); }

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  try {
    const shop = await loadPublicShop(getAdminDb(), tenantId, (t) => agentPolicy(t).menu);
    if (!shop) return NextResponse.json(agentErr('business_not_found', 'We couldn’t find that shop.'), { status: 404, headers: NO });
    const origin = seoOrigin(shop.t, req.nextUrl.origin);
    if (shop.gated) return NextResponse.json(agentErr('business_not_taking_agent_requests', `This business doesn’t take requests from assistants. Please use its shop: ${origin}/shop/${tenantId}`), { status: 403, headers: NO });
    return NextResponse.json(shopAgentJson(shop.facts, origin, shop.products, shop.offers), { headers: { ...CORS, 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900' } });
  } catch (e: any) {
    console.error('[agents shop] failed for', tenantId, e?.message);
    return NextResponse.json(agentErr('bad_request', 'The shop is not available right now. Try again shortly.'), { status: 503, headers: NO });
  }
}
