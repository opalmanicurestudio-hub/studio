// POST /api/appointments/delay-tell — the front desk confirms "Tell <client>" for a visit pushed back by a delay.
// Body: { tenantId, appointmentId, expectedStartAt? } (defaults to the expected start the delay check recorded),
// or { ..., skip: true } to dismiss without telling. Staff only; audited.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { tellClientDelay } from '@/lib/delay-tick';
import { logAuditAdmin } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''), appointmentId = String(b.appointmentId || '');
  if (!tenantId || !appointmentId) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error || 'Sign in to do that.' }, { status: auth.status || 401 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`; const ref = db.doc(`${T}/appointments/${appointmentId}`);
  const ap: any = ((await ref.get()).data() as any) || null;
  if (!ap) return NextResponse.json({ ok: false, error: 'That booking wasn’t found.' }, { status: 404 });
  const by = { uid: auth.actor.uid, name: auth.actor.name }; const at = new Date().toISOString();
  if (b.skip) { await ref.set({ delayToConfirm: false, delaySkipped: { at, by: by.name } }, { merge: true });
    await logAuditAdmin(db, tenantId, { action: 'appointment.delay_not_told', targetType: 'appointment', targetId: appointmentId, actor: { type: 'user', id: by.uid, name: by.name }, summary: `${ap.clientName || 'Client'}: chose not to message about the delay` }).catch(() => {});
    return NextResponse.json({ ok: true, via: 'none' }); }
  const expected = Date.parse(String(b.expectedStartAt || ap.expectedStartAt || '')) || 0; const start = Date.parse(String(ap.startTime || '')) || 0;
  if (!expected || expected <= start) return NextResponse.json({ ok: false, error: 'This visit isn’t expected to start late any more.' }, { status: 409 });
  const tenant: any = ((await db.doc(T).get()).data() as any) || {};
  const prov: any = ap.staffId ? (((await db.doc(`${T}/staff/${ap.staffId}`).get()).data() as any) || {}) : {};
  const r = await tellClientDelay(db, tenantId, tenant, { ...ap, id: appointmentId }, expected, prov?.name ? String(prov.name).split(' ')[0] : null, by, req.nextUrl.origin);
  await ref.set({ delayToConfirm: false, delayTold: { min: Math.round((expected - start) / 60000), at, via: r.via, by: by.name } }, { merge: true });
  return NextResponse.json({ ok: true, via: r.via, message: r.message });
}
