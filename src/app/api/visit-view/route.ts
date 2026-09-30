// src/app/api/visit-view/route.ts — THE CLIENT'S VISIT, LIVE (T4). Public, tied to the visit by its link token.
// The visit link used to show its COPY (appointmentCheckIns/{token}), which 45 places wrote by hand — one missed write
// and the link showed the wrong stage. It now asks here: the visit itself, through the same safe projection the copies
// get (stage, label, payment status, flags, times, the public timeline) — nothing private. A missing timeline step
// (a screen that changed the status without logging it) is repaired once here too.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { visitProjection, missingStageEntry } from '@/lib/visit';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const token = String(req.nextUrl.searchParams.get('token') || '').slice(0, 120);
  if (!/^[A-Za-z0-9_-]{6,120}$/.test(token)) return NextResponse.json({ ok: false }, { status: 400 });
  const db = getAdminDb();
  const copy: any = (await db.doc(`appointmentCheckIns/${token}`).get()).data();
  const tenantId = String(copy?.tenantId || ''); const id = String(copy?.id || copy?.appointmentId || '');
  if (!tenantId || !id) return NextResponse.json({ ok: false }, { status: 404 });
  const ref = db.doc(`tenants/${tenantId}/appointments/${id}`); const a: any = (await ref.get()).data();
  if (!a || a.checkInToken !== token) return NextResponse.json({ ok: false }, { status: 404 });   // the token must be this visit's
  const tenant: any = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
  const miss = missingStageEntry(a, tenant);
  if (miss) { a.timeline = [...(Array.isArray(a.timeline) ? a.timeline : []), miss].slice(-60); await ref.set({ timeline: a.timeline }, { merge: true }).catch(() => {}); }
  const view = visitProjection(a, tenant);
  // keep the copies in step as a courtesy for anything else that still reads them
  if (miss || copy.stage !== view.stage || copy.status !== view.status) await Promise.all([db.doc(`appointmentCheckIns/${token}`).set(view, { merge: true }), db.doc(`tenants/${tenantId}/appointmentCheckIns/${token}`).set(view, { merge: true })]).catch(() => {});
  return NextResponse.json({ ok: true, view }, { headers: { 'Cache-Control': 'no-store' } });
}
