// src/app/(booking)/book/[tenantId]/llms.txt/route.ts — THE GUIDE FOR AI ASSISTANTS for one business, in plain text
// (lib/agent-feed guideText): what it offers, its policies, and how to find a time and book.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { linkOrigin } from '@/lib/app-origin';
import { businessFeed, guideText } from '@/lib/agent-feed';

export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params; const db = getAdminDb();
  const t0: any = /^[A-Za-z0-9_-]{2,80}$/.test(tenantId) ? (await db.doc(`tenants/${tenantId}`).get()).data() : null;
  const r = t0 ? await businessFeed(db, tenantId, linkOrigin(t0, req.nextUrl.origin)) : null;
  const H = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1800' };
  if (!r) return new NextResponse('Business not found.\n', { status: 404, headers: H });
  if (!r.feed) return new NextResponse(`This business doesn't take requests from assistants. Please use its booking page: ${linkOrigin(t0, req.nextUrl.origin)}/book/${tenantId}\n`, { status: 200, headers: H });
  return new NextResponse(guideText(r.feed), { headers: H });
}
