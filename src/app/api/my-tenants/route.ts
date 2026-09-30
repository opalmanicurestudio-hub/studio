// src/app/api/my-tenants/route.ts — WHICH BUSINESSES ARE MINE (signed-in user, verified ID token).
// The browser used to ask Firestore for "tenants where userId == me" — but the rules (correctly) forbid listing
// businesses, so that query was always refused, and the app fell back to whatever business id the browser had stored,
// treating the user as its owner without checking. This answers the question on the server instead.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const tk = String(req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!tk) return NextResponse.json({ ok: false }, { status: 401 });
  let uid = '';
  try { const { getAuth } = await import('firebase-admin/auth'); const { getApps } = await import('firebase-admin/app'); getAdminDb();
    const app: any = getApps().find((a: any) => a.name === 'admin') || getApps()[0]; uid = (await getAuth(app).verifyIdToken(tk)).uid; } catch { return NextResponse.json({ ok: false }, { status: 401 }); }
  const db = getAdminDb();
  const owned = (await db.collection('tenants').where('userId', '==', uid).get()).docs.map((d: any) => d.id);
  const sd: any = (await db.doc(`staffDirectory/${uid}`).get()).data() || null;
  return NextResponse.json({ ok: true, owned, staff: sd?.tenantId ? { tenantId: String(sd.tenantId), role: sd.role || 'staff' } : null }, { headers: { 'Cache-Control': 'no-store' } });
}
