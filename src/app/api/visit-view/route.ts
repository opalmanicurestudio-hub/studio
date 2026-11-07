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
import { deviceTrusted, contactFresh } from '@/lib/client-verify';
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
  // Paying from the visit link: the desk asked this visit's own screen for a payment (api/client-screen visit_screen).
  // The page then follows that screen itself (its id is unguessable, and only this link learns it).
  let pay: any = null;
  if (a.payScreenId) {
    const sc: any = (await db.doc(`clientScreens/${String(a.payScreenId)}`).get().catch(() => null))?.data();
    if (sc && sc.tenantId === tenantId && sc.appointmentId === id) {
      const q = sc.request; const r = sc.response;
      // Open until it's paid, called off, or past its time (then the screen calls it off the next time it's looked at).
      const live = !q?.expiresAt || Date.parse(q.expiresAt) > Date.now();
      if (q?.kind === 'pay' && !q.answeredAt && live) pay = { screenId: String(a.payScreenId), open: true, requestId: String(q.id || ''), amount: Number(q.amount) || 0 };
      else if (r?.kind === 'pay' && r.paid && Date.now() - Date.parse(r.at || '') < 6 * 3600e3) pay = { screenId: String(a.payScreenId), paid: true, at: r.at };
    }
  }
  // "Ask for different photos" from the team: shown on the visit link until they send new ones (before the visit only).
  const { photosAskOpen } = await import('@/lib/inspo-photos');
  const photosAsk = photosAskOpen(a)
    ? { note: String(a.inspoReview.note || '').slice(0, 200) || null, by: String(a.inspoReview.by || '').trim().split(/\s+/)[0] || null } : null;
  // The team's marks on their photos (lib/markup/team): the photo, each layer of marks, the team's note, and what they
  // said back. Never a private team note. Not while they've been asked for different ones, nor once the visit is over.
  const { replyFor } = await import('@/lib/markup/team'); const { ENDED_VISIT } = await import('@/lib/forms-visit');
  const photosReply = !photosAsk && !ENDED_VISIT.includes(String(a.status || '')) ? replyFor(a) : null;
  // How the business works (a front desk, or the one person who sees clients), so the page words things to match.
  const { shapeFromDb, publicShape } = await import('@/lib/business-shape');
  const shape = publicShape(await shapeFromDb(db, tenantId, tenant));
  const full = { ...publicVisitCopy({ ...a, id, appointmentId: id, tenantId, checkInToken: token }), ...view, id, tenantId, aftercareUrl, pay, photosAsk, photosReply, shape };
  // keep the copies in step as a courtesy for anything else that still reads them
  if (miss || copy.stage !== view.stage || copy.status !== view.status) await Promise.all([db.doc(`appointmentCheckIns/${token}`).set(view, { merge: true }), db.doc(`tenants/${tenantId}/appointmentCheckIns/${token}`).set(view, { merge: true })]).catch(() => {});
  return NextResponse.json({ ok: true, view: full }, noStore);
}
