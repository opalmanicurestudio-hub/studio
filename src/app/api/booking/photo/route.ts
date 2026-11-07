// src/app/api/booking/photo/route.ts — a client's inspiration photo (already
// marked up in the browser) saved through the SERVER, so it never depends on
// Storage rules for signed-out visitors. A photo answering a question on a form
// (private: true) is kept private instead: no link anyone can open, only the
// team, through /api/files/view (lib/private-storage), five minutes at a time. Each business takes at most
// FORM_PHOTOS_AN_HOUR of those, and each sender FORM_PHOTOS_EACH (counted in tenants/{t}/uploadCounts, which say when
// they can be cleared: expiresAt).
//   POST  save it: Storage first; if Storage refuses, a compressed copy is
//         kept in the database (tenants/{t}/bookingPhotos) so it's never lost
//   GET   ?t=&id=  serves a database-kept copy (the id is a long random code)
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { uploadClaimPhotoFromDataUrl } from '@/lib/claim-photo-upload';
import { FieldValue } from 'firebase-admin/firestore';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{16,64}$/;
const FORM_PHOTOS_AN_HOUR = 400, FORM_PHOTOS_EACH = 40;
/** A short hash of a sender's address, so the count never keeps the address itself. */
const hashOf = (v: string) => { let h = 0x811c9dc5; for (let i = 0; i < v.length; i++) { h ^= v.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); };

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId)) return NextResponse.json({ ok: false, error: 'Unknown business.' }, { status: 400 });
  const db = getAdminDb();
  if (!(await db.doc(`tenants/${tenantId}`).get()).exists) return NextResponse.json({ ok: false, error: 'Unknown business.' }, { status: 404 });
  const dataUrl = String(b.dataUrl || '');
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(dataUrl)) return NextResponse.json({ ok: false, error: 'That file isn’t a photo we can read — try a JPG or PNG.' }, { status: 400 });
  const day = new Date().toISOString().slice(0, 10);
  if (b.private === true) {
    // Anyone with a form open can send one, so each business takes at most so many an hour (a form has a handful), and
    // each sender a smaller share of that (by a hash of their address, never the address itself). Only saved photos count.
    // (Inspiration photos before their marks are counted on their own, so they never use up what forms need.)
    const hour = new Date().toISOString().slice(0, 13); const what = b.kind === 'original' ? 'originals' : 'form-photos';
    const ip = String(req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '').split(',')[0].trim();
    const counts = [db.doc(`tenants/${tenantId}/uploadCounts/${what}-${hour}`), ...(ip ? [db.doc(`tenants/${tenantId}/uploadCounts/${what}-${hour}-${hashOf(ip)}`)] : [])];
    const n = await Promise.all(counts.map((r) => r.get().then((d: any) => Number((d.data() || {}).n) || 0).catch(() => 0)));
    if (n[0] >= FORM_PHOTOS_AN_HOUR || (n[1] ?? 0) >= FORM_PHOTOS_EACH) return NextResponse.json({ ok: false, error: 'Too many photos are being sent just now. Please try again in a little while.' }, { status: 429 });
    try {
      const { savePrivateImage } = await import('@/lib/private-storage');
      // A form's photo, or an inspiration photo before its marks (lib/markup: only the team ever opens it).
      const folder = b.kind === 'original' ? 'inspiration-originals' : 'form-photos';
      const path = `tenants/${tenantId}/completions/${folder}/${day}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}.jpg`;
      const saved = await savePrivateImage(tenantId, path, dataUrl, 2_500_000);
      // Counted once saved; each count says when it can be cleared.
      const expiresAt = new Date(Date.now() + 2 * 3600e3);
      await Promise.all(counts.map((r) => r.set({ n: FieldValue.increment(1), hour, expiresAt }, { merge: true }).catch(() => {})));
      return NextResponse.json({ ok: true, url: saved.ref, private: true });
    } catch (e: any) {
      console.error('[booking/photo] private', e?.message);
      return NextResponse.json({ ok: false, error: /too (small|large)|couldn’t be read/.test(String(e?.message || '')) ? String(e.message) : 'That photo didn’t save just now. Try again.' }, { status: 502 });
    }
  }
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
