// src/app/api/privacy/view-log/route.ts — WHO OPENED A CLIENT'S HEALTH OR CONSENT ANSWERS (staff only; enforced here).
//   POST { tenantId, clientId, what, appointmentId? } → records the view (only while health information mode is on).
//                                                      Who and when come from the sign-in, never from the request.
//   GET  ?tenantId=…&clientId=…                       → managers only: the last 50 views for that client.
// Stored in tenants/{t}/healthViewLog, written by the server only (lib/health-privacy logHealthView).
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { logHealthView, privacyOf } from '@/lib/health-privacy';
export const dynamic = 'force-dynamic';
const s = (v: any, n = 200) => String(v ?? '').trim().slice(0, n);

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = s(b.tenantId, 80);
  const auth: any = tenantId ? await verifyStaffActor(req, tenantId) : null;
  if (!auth?.ok) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  const clientId = s(b.clientId, 120); const what = s(b.what, 60);
  if (!clientId || !what) return NextResponse.json({ ok: false, error: 'Which client?' }, { status: 400 });
  if (!privacyOf(auth.tenant).healthMode) return NextResponse.json({ ok: true, logged: false });
  await logHealthView(getAdminDb(), tenantId, { clientId, uid: String(auth.actor.uid), name: auth.actor.name || null, what, appointmentId: s(b.appointmentId, 120) || null });
  return NextResponse.json({ ok: true, logged: true });
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams; const tenantId = s(q.get('tenantId'), 80); const clientId = s(q.get('clientId'), 120);
  const auth: any = tenantId ? await verifyStaffActor(req, tenantId) : null;
  if (!auth?.ok) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  if (!auth.actor.isManager) return NextResponse.json({ ok: false, error: 'Only a manager or the owner can see this.' }, { status: 403 });
  if (!clientId) return NextResponse.json({ ok: false, error: 'Which client?' }, { status: 400 });
  // Sorted here rather than in the query, so no extra index is needed.
  const rows = (await getAdminDb().collection(`tenants/${tenantId}/healthViewLog`).where('clientId', '==', clientId).limit(1000).get()).docs
    .map((d: any) => d.data() || {}).sort((x: any, y: any) => String(y.at || '').localeCompare(String(x.at || ''))).slice(0, 50)
    .map((r: any) => ({ id: r.id, name: r.name || 'A team member', what: r.what, at: r.at, appointmentId: r.appointmentId || null }));
  return NextResponse.json({ ok: true, rows });
}
