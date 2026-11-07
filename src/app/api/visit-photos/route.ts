// src/app/api/visit-photos/route.ts — THE TEAM'S MARKS ON A CLIENT'S INSPIRATION PHOTOS (board 17C). Signed-in team
// only. From the appointment's "Before the visit":
//   bytes { key, which: 'original' | 'photo' }   the photo itself, from this app (it's drawn on in the browser)
//   load  { key }                                 the team's marks on it so far (their layer and private notes)
//   save  { key, base, markup, note }             kept for the team; the client sees nothing yet
//   send  { key, base, markup, note, images }     kept, and shown on the client's visit link (lib/markup/team): the
//                                                 photo without marks and each layer of marks over it, made in the
//                                                 browser and saved under the visit first (api/upload/appointment-photos)
// Private team notes are kept here, beside the visit, and never go to the visit link. Saving and sending are for
// managers, people who may manage any booking, and the visit's own provider (a solo provider is all three); a booth
// renter sees only their own clients' photos. The client is told by text or email when marks are sent, at most once
// every 30 minutes (the time is set aside before the message goes, so two quick sends tell them once), and only before
// the visit.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { logAuditAdmin } from '@/lib/audit';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const KEY = /^p[a-z0-9]{2,30}$/;
const TELL_GAP_MS = 30 * 60e3;
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
const first = (n: any) => String(n || '').trim().split(/\s+/)[0] || '';
const ms = (v: any) => { const t = v?.toDate ? v.toDate().getTime() : Date.parse(String(v || '')); return Number.isFinite(t) ? t : 0; };

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''), apptId = String(b.apptId || ''), action = String(b.action || ''), key = String(b.key || '');
  if (!ID.test(tenantId) || !ID.test(apptId)) return bad('That visit couldn’t be found.');
  if (!KEY.test(key)) return bad('That photo couldn’t be found.');
  const auth = await verifyStaffActor(req, tenantId); if (!auth.ok) return bad(auth.error, auth.status);
  const who: any = auth.actor; const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const ref = db.doc(`${T}/appointments/${apptId}`);
  const appt: any = (await ref.get()).data();
  if (!appt) return bad('That visit couldn’t be found.', 404);
  // A booth renter runs their own business here: only their own clients' photos.
  if (who.isRenter && appt.staffId !== who.uid) return bad('That visit isn’t one of yours.', 403);
  const { photoKey, keepTeamMarkup, teamLine } = await import('@/lib/markup/team');
  // Only one of the photos the client has sent for this visit now (a newer set leaves earlier ones behind).
  const photos: any[] = (Array.isArray(appt.inspirationPhotos) && appt.inspirationPhotos.length ? appt.inspirationPhotos : appt.inspirationPhotoUrl ? [{ url: appt.inspirationPhotoUrl }] : []).filter((p: any) => p?.url);
  const photo = photos.find((p) => photoKey(String(p.url)) === key);
  if (!photo) return bad('That photo isn’t on this visit any more. The client may have sent new ones.', 404);
  const markRef = db.doc(`${T}/appointments/${apptId}/inspoMarks/${key}`);

  if (action === 'bytes') {
    const P = await import('@/lib/inspo-photos');
    const tenant: any = (await db.doc(T).get()).data() || {};
    const src = b.which === 'original' ? photo.original : photo.url;
    if (!src) return bad('That photo isn’t here.', 404);
    const got = await P.photoBytes(db, String(src), tenantId, await P.ourBuckets(tenant));
    if (!got) return bad('That photo can’t be opened here.', 404);
    return new NextResponse(new Uint8Array(got.buf), { headers: { 'Content-Type': got.type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  }

  if (action === 'load') {
    const kept: any = (await markRef.get().catch(() => null))?.data?.() || null;
    return NextResponse.json({ ok: true, mark: kept ? { markup: kept.markup || null, note: String(kept.note || ''), base: kept.base === 'photo' ? 'photo' : 'original', by: kept.by || null, at: kept.at || null, sentAt: kept.sentAt || null } : null });
  }

  if (action !== 'save' && action !== 'send') return bad('Unknown action.');
  const manager = !!(who.isManager || who.isTenantOwner);
  const mayAct = manager || (Array.isArray(who.caps) && who.caps.includes('bookings.manage')) || (!!who.uid && appt.staffId === who.uid);
  if (!mayAct) return bad('Ask a manager, or the person doing this visit, to do this.', 403);
  const { ENDED_VISIT } = await import('@/lib/forms-visit');
  if (ENDED_VISIT.includes(String(appt.status || ''))) return bad('This visit isn’t going ahead, so there’s nothing to change here.', 409);
  const base = b.base === 'photo' ? 'photo' : 'original';
  if (base === 'original' && !photo.original) return bad('The photo before its marks isn’t here. Open it again to mark up the photo as it was sent.', 409);
  const markup = b.markup == null || b.markup === '' ? null : keepTeamMarkup(b.markup);
  if (b.markup && !markup) return bad('Those marks couldn’t be kept. Try removing a few.');
  const note = String(b.note || '').trim().slice(0, 300);
  const nowIso = new Date().toISOString(); const by = String(who.name || 'Team');
  const actor = { type: 'user', uid: who.uid || null, name: by, role: who.role || 'staff', via: 'appointment' } as any;
  const parsed = (() => { try { return markup ? JSON.parse(markup) : null; } catch { return null; } })();
  const kinds = Array.isArray(parsed?.marks) ? parsed.marks : [];
  const summary = { by: first(by) || 'Team', byUid: who.uid || null, at: nowIso, line: teamLine(markup, note), privateCount: kinds.filter((m: any) => m?.layer === 'private').length };

  if (action === 'save') {
    await markRef.set({ key, base, markup, note, by, byUid: who.uid || null, at: nowIso }, { merge: true });
    await ref.update({ [`inspoTeam.${key}`]: { ...summary, sentAt: (appt.inspoTeam?.[key]?.sentAt) || null } });
    return NextResponse.json({ ok: true });
  }

  // Send: the client sees the team's marks on their visit link. Not while they've been asked for different photos.
  const P = await import('@/lib/inspo-photos');
  if (P.photosAskOpen(appt)) return bad(`${first(appt.clientName) || 'The client'} was asked for different photos. Their new ones will show here.`, 409);
  const tenant: any = (await db.doc(T).get()).data() || {};
  const buckets = await P.ourBuckets(tenant);
  const im = b.images || {};
  const baseUrl = P.ownVisitPhoto(im.base, tenantId, apptId, buckets); const theirs = P.ownVisitPhoto(im.theirs, tenantId, apptId, buckets);
  const mine = base === 'original' && im.mine ? P.ownVisitPhoto(im.mine, tenantId, apptId, buckets) : null;
  if (!baseUrl || !theirs || (base === 'original' && im.mine && !mine)) return bad('The marked-up photo didn’t upload properly. Please try again.');
  const w = Math.round(Number(im.w)), h = Math.round(Number(im.h));
  if (!(w > 0 && w <= 4000 && h > 0 && h <= 4000)) return bad('The marked-up photo didn’t upload properly. Please try again.');
  const keys = new Set(photos.map((p) => photoKey(String(p.url))));
  // The team's copy first (marks and private notes), so the client never sees marks the team hasn't kept.
  await markRef.set({ key, base, markup, note, by, byUid: who.uid || null, at: nowIso }, { merge: true });
  let tellNow = false; let toldBefore: string | null = null;
  await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(ref)).data() || {};
    const was = cur.inspoReply && typeof cur.inspoReply === 'object' ? cur.inspoReply : {};
    // Photos the client no longer has are left behind; this one is the newest.
    const kept = Object.fromEntries(Object.entries(was.photos || {}).filter(([k]) => keys.has(k) && k !== key));
    tellNow = ms(cur.startTime) > Date.now() && !(ms(was.toldAt) > Date.now() - TELL_GAP_MS); toldBefore = was.toldAt || null;
    tx.update(ref, {
      inspoReply: { by: first(by) || 'Team', byUid: who.uid || null, at: nowIso, photos: { ...kept, [key]: { base: baseUrl, mine, theirs, w, h, note, line: summary.line, at: nowIso } }, answer: was.answer || null, toldAt: tellNow ? nowIso : was.toldAt || null },
      [`inspoTeam.${key}`]: { ...summary, sentAt: nowIso },
      // Sending marks is looking at the photos.
      ...(cur.inspoReview?.status === 'again' ? {} : { inspoReview: { status: 'ok', by, byUid: who.uid || null, at: nowIso } }),
    });
  });
  await markRef.set({ sentAt: nowIso }, { merge: true }).catch((e: any) => console.error('[visit-photos] sentAt', e));
  let told: 'sent' | 'off' | 'no_contact' | 'failed' | 'later' = 'later';
  if (tellNow) {
    const { tellPhotosMarked } = await import('@/lib/forms-remind');
    try { told = await tellPhotosMarked(db, tenantId, { ...appt, id: apptId }, tenant, first(by) || null); } catch (e) { console.error('[visit-photos] tell', e); told = 'failed'; }
    // Not told: the time set aside goes back (unless someone has sent since), so the next send can tell them.
    if (told !== 'sent') await db.runTransaction(async (tx: any) => { const cur: any = (await tx.get(ref)).data() || {}; if (cur.inspoReply?.toldAt === nowIso) tx.update(ref, { 'inspoReply.toldAt': toldBefore }); })
      .catch((e: any) => console.error('[visit-photos] toldAt back', e));
  }
  await logAuditAdmin(db, tenantId, { action: 'appointment.photos_marked', targetType: 'appointment', targetId: apptId, summary: `${by} sent marks on ${first(appt.clientName) || 'the client'}’s inspiration photo`, actor }).catch(() => {});
  return NextResponse.json({ ok: true, told });
}
