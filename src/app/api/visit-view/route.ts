// src/app/api/visit-view/route.ts — THE CLIENT'S VISIT, LIVE (T4). Public, tied to the visit by its link token.
// The visit link used to show its COPY (appointmentCheckIns/{token}), which 45 places wrote by hand — one missed write
// and the link showed the wrong stage. It now asks here: the visit itself, through the same safe projection the copies
// get (stage, label, payment status, flags, times, the public timeline) — nothing private. A missing timeline step
// (a screen that changed the status without logging it) is repaired once here too.
// A link someone reported as "Not you?" says only that it's off. And a client whose contact details haven't been
// confirmed or used in a year (the number may now belong to someone else) sees just the business and the date until
// this phone confirms a code (lib/client-verify): no service, no provider, nothing private.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { visitProjection, missingStageEntry } from '@/lib/visit';
import { FieldValue } from 'firebase-admin/firestore';
import { scrubVisitPatch } from '@/lib/public-visit-copy';
import { deviceTrusted } from '@/lib/client-verify';
export const dynamic = 'force-dynamic';

const YEAR = 365 * 864e5;
const recent = (v: any, now: number) => { const t = typeof v?.toDate === 'function' ? v.toDate().getTime() : Date.parse(String(v || '')); return Number.isFinite(t) && now - t < YEAR; };
/** Has this client confirmed or used their contact details (or visited) in the last 12 months? */
async function contactFresh(db: any, tenantId: string, clientId: string, now = Date.now()): Promise<boolean> {
  const c: any = (await db.doc(`tenants/${tenantId}/clients/${clientId}`).get()).data();
  if (!c) return true;   // nothing on record to protect
  if ([c.phoneVerifiedAt, c.emailVerifiedAt, c.linkLastUsedAt, c.createdAt, c.lastAppointment].some((v) => recent(v, now))) return true;
  const visits = (await db.collection(`tenants/${tenantId}/appointments`).where('clientId', '==', clientId).limit(200).get()).docs;
  return visits.some((d: any) => { const x: any = d.data() || {}; return String(x.status || '') === 'completed' && recent(x.completedAt || x.endTime || x.startTime, now); });
}

export async function GET(req: NextRequest) {
  const token = String(req.nextUrl.searchParams.get('token') || '').slice(0, 120);
  if (!/^[A-Za-z0-9_-]{6,120}$/.test(token)) return NextResponse.json({ ok: false }, { status: 400 });
  const db = getAdminDb();
  const copy: any = (await db.doc(`appointmentCheckIns/${token}`).get()).data();
  const tenantId = String(copy?.tenantId || ''); const id = String(copy?.id || copy?.appointmentId || '');
  if (!tenantId || !id) return NextResponse.json({ ok: false }, { status: 404 });
  const ref = db.doc(`tenants/${tenantId}/appointments/${id}`); const a: any = (await ref.get()).data();
  if (!a || a.checkInToken !== token) return NextResponse.json({ ok: false }, { status: 404 });   // the token must be this visit's
  // Older copies held the whole appointment (form answers, notes, contact details). Clean both as they're viewed.
  const scrub = scrubVisitPatch(copy, () => FieldValue.delete());
  if (scrub) {
    const scoped: any = (await db.doc(`tenants/${tenantId}/appointmentCheckIns/${token}`).get().catch(() => null))?.data();
    const scopedScrub = scoped ? scrubVisitPatch(scoped, () => FieldValue.delete()) : null;
    await Promise.all([
      db.doc(`appointmentCheckIns/${token}`).update(scrub),
      scopedScrub ? db.doc(`tenants/${tenantId}/appointmentCheckIns/${token}`).update(scopedScrub) : null,
    ]).catch((e) => console.error('[visit-view] scrub', e));
  }
  const tenant: any = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
  const noStore = { headers: { 'Cache-Control': 'no-store' } };
  // "Not you?" turned this link off: say so, and nothing else.
  if (a.linkRevokedAt) return NextResponse.json({ ok: true, revoked: true, businessName: tenant.name || tenant.businessName || null, businessPhone: tenant.phone || tenant.twilioPhoneNumber || null }, noStore);
  // A contact that hasn't been confirmed or used in 12 months, on a phone that hasn't confirmed a code: the minimum.
  if (a.clientId) {
    const device = String(req.nextUrl.searchParams.get('device') || '').slice(0, 120);
    const fresh = await contactFresh(db, tenantId, String(a.clientId)).catch(() => true);
    if (!fresh && !(await deviceTrusted(db, tenantId, String(a.clientId), device))) {
      const businessName = tenant.name || tenant.businessName || null;
      return NextResponse.json({ ok: true, verifyFirst: true, view: { id, tenantId, startTime: a.startTime || null, endTime: a.endTime || null, verifyFirst: true, businessName } }, noStore);
    }
  }
  const miss = missingStageEntry(a, tenant);
  if (miss) { a.timeline = [...(Array.isArray(a.timeline) ? a.timeline : []), miss].slice(-60); await ref.set({ timeline: a.timeline }, { merge: true }).catch(() => {}); }
  const view = visitProjection(a, tenant);
  // What the visit page needs, from the server through the whitelist (the public copy is no longer readable from a browser).
  const { publicVisitCopy } = await import('@/lib/public-visit-copy');
  // The aftercare page (lib/aftercare), once one has been sent for this visit: the visit page links to it instead of old text.
  let aftercareUrl: string | null = null; if (a.aftercareDocId) { const { aftercarePath } = await import('@/lib/visit-feedback'); aftercareUrl = aftercarePath(tenantId, id); }
  const full = { ...publicVisitCopy({ ...a, id, appointmentId: id, tenantId, checkInToken: token }), ...view, id, tenantId, aftercareUrl };
  // keep the copies in step as a courtesy for anything else that still reads them
  if (miss || copy.stage !== view.stage || copy.status !== view.status) await Promise.all([db.doc(`appointmentCheckIns/${token}`).set(view, { merge: true }), db.doc(`tenants/${tenantId}/appointmentCheckIns/${token}`).set(view, { merge: true })]).catch(() => {});
  return NextResponse.json({ ok: true, view: full }, noStore);
}
