// GET /api/public/staff?tenantId=…[&staffId=…] — the PUBLIC face of a business's team: first-name-level card only
// (name, photo, title, short bio). Public pages (the visit link, reviews) use this instead of reading staff records,
// which hold pay rates, phone numbers and emails and are now readable by the team only.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { limitPublic } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
const card = (id: string, s: any) => ({ id, name: String(s?.name || s?.displayName || '').slice(0, 80) || 'Team member', avatarUrl: s?.avatarUrl || s?.photoUrl || null, title: s?.title || s?.jobTitle || null, bio: typeof s?.bio === 'string' ? s.bio.slice(0, 400) : null });

export async function GET(req: NextRequest) {
  const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '').slice(0, 80); const staffId = String(req.nextUrl.searchParams.get('staffId') || '').slice(0, 120);
  if (!tenantId) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const limited = await limitPublic(req, 'public-staff', tenantId, { perHour: 600, perDay: 6000 }); if (limited) return limited;
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  if (staffId) { const d = await db.doc(`${T}/staff/${staffId}`).get(); if (!d.exists) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 }); return NextResponse.json({ ok: true, staff: card(d.id, d.data()) }, { headers: { 'Cache-Control': 'public, max-age=300' } }); }
  const snap = await db.collection(`${T}/staff`).get();
  const list = snap.docs.filter((d: any) => { const s: any = d.data() || {}; return s.active !== false && s.isActive !== false && !s.archived; }).map((d: any) => card(d.id, d.data()));
  return NextResponse.json({ ok: true, staff: list }, { headers: { 'Cache-Control': 'public, max-age=300' } });
}
