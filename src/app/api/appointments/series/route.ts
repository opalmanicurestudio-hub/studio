// src/app/api/appointments/series/route.ts — REPEAT SERIES, AFTER THE DESK CANCELS A VISIT. Staff only.
//   after_cancel { moveDeposit, cancelLater } — mark the next visit as holding the moved deposit
//   (the desk kept the deposit as credit), and/or cancel every later visit in the series.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { markDepositMoved, cancelLaterVisits, seriesMoveDepositOn, laterSeriesVisits } from '@/lib/series';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''), appointmentId = String(b.appointmentId || '');
  if (!tenantId || !appointmentId) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error || 'Sign in to do that.' }, { status: auth.status || 401 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const a: any = (await db.doc(`${T}/appointments/${appointmentId}`).get()).data();
  if (!a) return NextResponse.json({ ok: false, error: 'That appointment wasn’t found.' }, { status: 404 });
  if (!a.seriesId) return NextResponse.json({ ok: true, notSeries: true });
  const appt = { ...a, id: appointmentId };
  if (b.action === 'later') return NextResponse.json({ ok: true, later: (await laterSeriesVisits(db, tenantId, appt)).length });
  if (b.action !== 'after_cancel') return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  if (a.status !== 'cancelled') return NextResponse.json({ ok: false, error: 'Cancel this visit first.' }, { status: 409 });
  const tenant: any = ((await db.doc(T).get()).data() as any) || {};
  let depositMovedTo: string | null = null, laterCancelled = 0;
  if (b.moveDeposit === true && a.depositStatus === 'paid' && seriesMoveDepositOn(tenant)) depositMovedTo = await markDepositMoved(db, tenantId, appt, auth.actor.name);
  if (b.cancelLater === true) laterCancelled = await cancelLaterVisits(db, tenantId, appt, { id: auth.actor.uid, name: auth.actor.name, role: auth.actor.role });
  return NextResponse.json({ ok: true, depositMovedTo, laterCancelled });
}
