// src/app/api/booking/photo/route.ts — a client's inspiration photo (already
// marked up in the browser) saved through the SERVER, so it never depends on
// Storage rules for signed-out visitors. Returns a permanent image link that
// travels with the booking. JPG/PNG/WebP, under 3 MB (checked by the helper).
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { uploadClaimPhotoFromDataUrl } from '@/lib/claim-photo-upload';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId)) return NextResponse.json({ ok: false, error: 'Unknown business.' }, { status: 400 });
  if (!(await getAdminDb().doc(`tenants/${tenantId}`).get()).exists) return NextResponse.json({ ok: false, error: 'Unknown business.' }, { status: 404 });
  const day = new Date().toISOString().slice(0, 10);
  const up = await uploadClaimPhotoFromDataUrl(tenantId, day, b.dataUrl, 'booking-inspiration');
  return up.url ? NextResponse.json({ ok: true, url: up.url }) : NextResponse.json({ ok: false, error: up.error || 'Couldn’t save that photo — try again.' }, { status: 400 });
}
