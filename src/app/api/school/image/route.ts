// src/app/api/school/image/route.ts — a photo on a school's website
// (tenants/{t}/schoolSite/img_{id}). Public: these are the school's own
// marketing photos. Links carry the photo id, which changes if it's replaced.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

export async function GET(req: NextRequest) {
  const t = String(req.nextUrl.searchParams.get('t') || ''), id = String(req.nextUrl.searchParams.get('id') || '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(t) || !/^[A-Za-z0-9_-]{1,40}$/.test(id)) return new NextResponse('Not found', { status: 404 });
  const d = ((await getAdminDb().doc(`tenants/${t}/schoolSite/img_${id}`).get()).data() as any) || null;
  const m = String(d?.dataUrl || '').match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
  if (!m) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(new Uint8Array(Buffer.from(m[2], 'base64')), { headers: { 'Content-Type': m[1], 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' } });
}
