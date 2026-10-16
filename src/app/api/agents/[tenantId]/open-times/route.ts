// src/app/api/agents/[tenantId]/open-times/route.ts — REAL OPEN TIMES FOR AN ASSISTANT (lib/agent-feed): the booking
// page's own engine and rules (minimum notice, how far ahead, buffers, resources), for one service, with one provider or
// anyone qualified, over up to 14 days. Public and read-only; never says who else is booked.
//   GET ?service=<id>&provider=<id|any>&from=YYYY-MM-DD&days=1-14&addOns=<id,id>
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { agentOpenTimes } from '@/lib/agent-feed';
import { agentErr, agentPolicy } from '@/lib/agent-access';

export const dynamic = 'force-dynamic';
const H = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' };
export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: { ...H, 'Access-Control-Allow-Methods': 'GET, OPTIONS' } }); }

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params; const q = req.nextUrl.searchParams;
  const serviceId = String(q.get('service') || '').slice(0, 80);
  if (!/^[A-Za-z0-9_-]{2,80}$/.test(tenantId)) return NextResponse.json(agentErr('business_not_found', 'We couldn’t find that business.'), { status: 404, headers: H });
  if (!serviceId) return NextResponse.json(agentErr('bad_request', 'Say which service: ?service=<id> (the ids are in the business feed).'), { status: 400, headers: H });
  const db = getAdminDb(); const t: any = (await db.doc(`tenants/${tenantId}`).get()).data();
  if (!t) return NextResponse.json(agentErr('business_not_found', 'We couldn’t find that business.'), { status: 404, headers: H });
  if (!agentPolicy(t).openTimes) return NextResponse.json(agentErr('business_not_taking_agent_requests', 'This business doesn’t share open times with assistants. Please use its booking page.'), { status: 403, headers: H });
  const r: any = await agentOpenTimes(db, tenantId, { serviceId, providerId: q.get('provider'), from: q.get('from'), days: Number(q.get('days')) || 7, addOnIds: String(q.get('addOns') || '').split(',').map((x) => x.trim()).filter(Boolean) });
  if (r.status === 404) return NextResponse.json(r.kind === 'provider' ? agentErr('provider_not_found', 'That person doesn’t do this service here. Use provider=any, or a provider id from the feed.') : agentErr('service_not_found', 'That service isn’t on the menu. The ids are in the business feed.'), { status: 404, headers: H });
  return NextResponse.json({ ok: true, code: 'ok', message: r.times.length ? `${r.times.length} open time${r.times.length === 1 ? '' : 's'} from ${r.from}, times in ${r.tz}.` : `No open times in the ${r.days} days from ${r.from}. Try later dates or provider=any.`, ...r, status: undefined }, { headers: H });
}
