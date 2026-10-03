// src/app/api/push/test/route.ts — "SEND ME A TEST". A notification for the signed-in person, pushed now, and the
// result in plain words — so nobody has to dig through the database to know whether their phone is set up.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin';
import { staffIdForLogin } from '@/lib/owner-staff';
import { pushNow } from '@/lib/push';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80);
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  let uid = ''; try { uid = (await getAdminAuth().verifyIdToken(bearer)).uid; } catch { return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 }); }
  const db = getAdminDb(); const staffId = tenantId ? await staffIdForLogin(db, tenantId, uid) : null;
  if (!staffId) return NextResponse.json({ ok: false, error: 'We couldn’t find your team profile.' }, { status: 403 });
  const staff: any = (await db.doc(`tenants/${tenantId}/staff/${staffId}`).get()).data() || {};
  if (!(staff.fcmTokens || []).length) return NextResponse.json({ ok: false, error: 'This phone isn’t registered yet — tap “Turn on notifications” first.' });
  const ref = db.collection(`tenants/${tenantId}/notifications`).doc();
  await ref.set({ id: ref.id, userId: staffId, type: 'test', message: `Test notification for ${staff.name || 'you'} — notifications are working.`, link: '/', createdAt: new Date().toISOString(), read: false });
  await pushNow(db, tenantId);
  const result = String(((await ref.get()).data() as any)?.pushResult || '');
  const lastErr: any = result ? null : (await db.doc('platformHealth/push_last_error').get()).data();
  return NextResponse.json({ ok: /^sent/.test(result), result: result || (lastErr ? `Not sent: ${lastErr.error}` : 'Not sent — no result recorded.') });
}
