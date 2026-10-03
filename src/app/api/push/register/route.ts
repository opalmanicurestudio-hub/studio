// src/app/api/push/register/route.ts — SAVE THIS PHONE so the right person's notifications reach it.
// Works for both ways people sign in: the staff portal (uid "portal:<business>:<staff profile>") and the owner in the
// main app (their account; we use their staff profile with the owner role — that's who owner notifications go to).
// Saved by the server, so database rules can never silently block it.
import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80); const token = String(b.token || '').slice(0, 4096);
  if (!tenantId || !token) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  let uid = ''; try { uid = (await getAdminAuth().verifyIdToken(bearer)).uid; } catch { return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 }); }
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  let staffId = '';
  const portal = `portal:${tenantId}:`;
  if (uid.startsWith(portal)) staffId = uid.slice(portal.length);
  else if ((await db.doc(`${T}/staff/${uid}`).get()).exists) staffId = uid;
  else {
    const tenant: any = (await db.doc(T).get()).data() || {};
    if (tenant.userId === uid || tenant.ownerId === uid) {
      const owners = await db.collection(`${T}/staff`).where('role', '==', 'owner').limit(1).get();
      if (!owners.empty) staffId = owners.docs[0].id;
      else return NextResponse.json({ ok: false, error: 'Add yourself as a team member with the Owner role first — notifications go to team members.' }, { status: 409 });
    }
  }
  if (!staffId || !(await db.doc(`${T}/staff/${staffId}`).get()).exists) return NextResponse.json({ ok: false, error: 'We couldn’t find your team profile.' }, { status: 403 });
  await db.doc(`${T}/staff/${staffId}`).set({ fcmTokens: FieldValue.arrayUnion(token), pushRegisteredAt: new Date().toISOString() }, { merge: true });
  const s: any = (await db.doc(`${T}/staff/${staffId}`).get()).data() || {};
  return NextResponse.json({ ok: true, staffName: s.name || s.firstName || null });
}
