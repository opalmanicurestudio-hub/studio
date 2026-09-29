// src/app/api/callbacks/details/route.ts — THE CALLER ADDS DETAILS BEFORE WE CALL BACK (public, key-gated).
// Opened from the link in their call-back confirmation. Shows only who's getting back to them and what it's
// about — never staff notes. They can add a few lines (up to 5 times); staff see it on the call-back.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

async function load(tenantId: string, id: string, k: string) {
  if (!tenantId || !id || !k || k.length < 16) return null;
  const db = getAdminDb(); const ref = db.doc(`tenants/${tenantId}/callBackDrafts/${id}`);
  const d: any = (await ref.get()).data();
  if (!d || d.detailsToken !== k) return null;
  return { db, ref, d };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const tenantId = String(sp.get('tenantId') || ''), id = String(sp.get('id') || ''), k = String(sp.get('k') || '');
  const x = await load(tenantId, id, k);
  if (!x) return NextResponse.json({ ok: false, error: 'This link isn’t valid any more.' }, { status: 404 });
  const t: any = ((await x.db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
  const d = x.d;
  return NextResponse.json({ ok: true, business: t.name || 'the business', first: String(d.callerName || '').split(' ')[0] || null,
    owner: d.ownerName ? String(d.ownerName).split(' ')[0] : null, about: d.reason && d.reason !== 'other' ? String(d.reasonLabel || '').toLowerCase() : null,
    open: d.status !== 'resolved', added: Array.isArray(d.callerAdded) ? d.callerAdded.length : 0,
    accent: t.bookingPageSettings?.cfPageConfig?.accentColor || t.brandColor || null, logoUrl: t.logoUrl || null });
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const x = await load(String(b.tenantId || ''), String(b.id || ''), String(b.k || ''));
  if (!x) return NextResponse.json({ ok: false, error: 'This link isn’t valid any more.' }, { status: 404 });
  if (x.d.status === 'resolved') return NextResponse.json({ ok: false, error: 'We’ve already got back to you about this — if you need anything else, please call us.' }, { status: 409 });
  const text = String(b.text || '').trim().slice(0, 1000);
  if (text.length < 2) return NextResponse.json({ ok: false, error: 'Write a little about what you need.' }, { status: 400 });
  const list = Array.isArray(x.d.callerAdded) ? x.d.callerAdded : [];
  if (list.length >= 5) return NextResponse.json({ ok: false, error: 'You’ve added the most we can take here — we’ll be in touch soon.' }, { status: 429 });
  const nowIso = new Date().toISOString();
  await x.ref.set({ callerAdded: [...list, { at: nowIso, text }], callerAddedAt: nowIso, updatedAt: nowIso }, { merge: true });
  return NextResponse.json({ ok: true });
}
