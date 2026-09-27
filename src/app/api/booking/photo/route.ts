// src/app/api/booking/photo/route.ts — a client's inspiration photo (already
// marked up in the browser) saved through the SERVER, so it never depends on
// Storage rules for signed-out visitors.
//   POST  save it: Storage first; if Storage refuses, a compressed copy is
//         kept in the database (tenants/{t}/bookingPhotos) so it's never lost
//   GET   ?t=&id=  serves a database-kept copy (the id is a long random code)
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { uploadClaimPhotoFromDataUrl } from '@/lib/claim-photo-upload';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{16,64}$/;

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId)) return NextResponse.json({ ok: false, error: 'Unknown business.' }, { status: 400 });
  const db = getAdminDb();
  if (!(await db.doc(`tenants/${tenantId}`).get()).exists) return NextResponse.json({ ok: false, error: 'Unknown business.' }, { status: 404 });
  const dataUrl = String(b.dataUrl || '');
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(dataUrl)) return NextResponse.json({ ok: false, error: 'That file isn’t a photo we can read — try a JPG or PNG.' }, { status: 400 });
  const day = new Date().toISOString().slice(0, 10);
  const up = await uploadClaimPhotoFromDataUrl(tenantId, day, dataUrl, 'booking-inspiration');
  if (up.url) return NextResponse.json({ ok: true, url: up.url });
  // Storage refused — keep it in the database instead (Firestore docs max ~1 MB).
  if (dataUrl.length <= 950_000) {
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 8)}`;
    await db.doc(`tenants/${tenantId}/bookingPhotos/${id}`).set({ id, dataUrl, createdAt: new Date().toISOString(), via: 'fallback' });
    return NextResponse.json({ ok: true, url: `${req.nextUrl.origin}/api/booking/photo?t=${encodeURIComponent(tenantId)}&id=${id}`, fallback: true });
  }
  return NextResponse.json({ ok: false, error: 'We couldn’t save that photo just now. You can still book — and bring the photo to your appointment.' }, { status: 502 });
}

export async function GET(req: NextRequest) {
  const t = String(req.nextUrl.searchParams.get('t') || ''), id = String(req.nextUrl.searchParams.get('id') || '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(t) || !ID.test(id)) return new NextResponse('Not found', { status: 404 });
  const d = ((await getAdminDb().doc(`tenants/${t}/bookingPhotos/${id}`).get()).data() as any) || null;
  const m = String(d?.dataUrl || '').match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!m) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(new Uint8Array(Buffer.from(m[2], 'base64')), { headers: { 'Content-Type': m[1], 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
}
