// src/app/api/school/sponsor-logo/route.ts — an APPROVED sponsor's logo for the
// school website's sponsor wall. Pending or hidden logos are never served.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

export async function GET(req: NextRequest) {
  const t = String(req.nextUrl.searchParams.get('t') || ''), id = String(req.nextUrl.searchParams.get('id') || '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(t) || !/^[A-Za-z0-9_-]{1,40}$/.test(id)) return new NextResponse('Not found', { status: 404 });
  const s = ((await getAdminDb().doc(`tenants/${t}/sponsors/${id}`).get()).data() as any) || null;
  const m = s?.status === 'approved' ? String(s.logo || '').match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/) : null;
  if (!m) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(new Uint8Array(Buffer.from(m[2], 'base64')), { headers: { 'Content-Type': m[1], 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
}
