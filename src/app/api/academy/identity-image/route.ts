// src/app/api/academy/identity-image/route.ts — a school's logo, seal or
// signature image. The signature needs its secret key (see school-identity.ts).
import { NextRequest, NextResponse } from 'next/server';
import { identityImage } from '@/lib/school-identity';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const img = await identityImage(String(q.get('t') || ''), String(q.get('k') || ''), q.get('key'));
  if (!img) return new NextResponse('Not found', { status: 404 });
  // Versioned links (?v=) change whenever the image does, so caching is safe.
  return new NextResponse(new Uint8Array(img.bytes), { headers: { 'Content-Type': img.type, 'Cache-Control': q.get('k') === 'signature' ? 'private, max-age=3600' : 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' } });
}
