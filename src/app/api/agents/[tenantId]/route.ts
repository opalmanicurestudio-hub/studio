// src/app/api/agents/[tenantId]/route.ts — ONE BUSINESS FOR AI ASSISTANTS (lib/agent-feed): services, prices, team,
// policies, and how to find a time and book. Public and read-only (the same facts as the booking page), cached briefly,
// open to any site. A business can switch it off (Settings → Booking → Assistants).
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { linkOrigin } from '@/lib/app-origin';
import { businessFeed } from '@/lib/agent-feed';
import { agentErr } from '@/lib/agent-access';

export const dynamic = 'force-dynamic';
const H = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900' };
export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: { ...H, 'Access-Control-Allow-Methods': 'GET, OPTIONS' } }); }

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const db = getAdminDb(); const t0: any = /^[A-Za-z0-9_-]{2,80}$/.test(tenantId) ? (await db.doc(`tenants/${tenantId}`).get()).data() : null;
  if (!t0) return NextResponse.json(agentErr('business_not_found', 'We couldn’t find that business.'), { status: 404, headers: H });
  const r = await businessFeed(db, tenantId, linkOrigin(t0, req.nextUrl.origin));
  if (!r) return NextResponse.json(agentErr('business_not_found', 'We couldn’t find that business.'), { status: 404, headers: H });
  if (!r.feed) return NextResponse.json(agentErr('business_not_taking_agent_requests', 'This business doesn’t take requests from assistants. Please use its booking page.'), { status: 403, headers: H });
  return NextResponse.json(r.feed, { headers: H });
}
