// src/app/api/push/register/route.ts — SAVE THIS PHONE so the right person's notifications reach it.
// Works for the staff portal and for the owner in the main app (their owner team profile — made if missing).
// Saved by the server, so database rules can never silently block it.
import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin';
import { staffIdForLogin } from '@/lib/owner-staff';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80); const token = String(b.token || '').slice(0, 4096);
  if (!tenantId || !token) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  let uid = ''; try { uid = (await getAdminAuth().verifyIdToken(bearer)).uid; } catch { return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 }); }
  const db = getAdminDb(); const staffId = await staffIdForLogin(db, tenantId, uid);
  if (!staffId) return NextResponse.json({ ok: false, error: 'We couldn’t find your team profile.' }, { status: 403 });
  const ref = db.doc(`tenants/${tenantId}/staff/${staffId}`);
  await ref.set({ fcmTokens: FieldValue.arrayUnion(token), pushRegisteredAt: new Date().toISOString() }, { merge: true });
  const s: any = (await ref.get()).data() || {};
  return NextResponse.json({ ok: true, staffId, staffName: s.name || s.firstName || null });
}
