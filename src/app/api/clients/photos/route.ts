// src/app/api/clients/photos/route.ts — A PHOTO'S RECORD, ON THE CLIENT'S PAGE (board 18D). Signed-in team only.
//   opened { clientId, key, apptId? }          noted each time someone opens a photo's record (once in 10 minutes
//                                              for the same person), and who opened it lately is sent back
//   remove { clientId, key, apptId, kind }     a photo the client sent (inspiration, earlier inspiration, how it
//                                              looks now), when they ask for it to be removed: taken off the visit
//                                              with the team's marks and private notes on it, and every copy this
//                                              business keeps deleted. Managers only; it can't be undone.
// Kept in tenants/{t}/clientPhotoRecords (lib/private-records), which only the server reads. A booth renter sees only their own
// clients' visits. A copy another of the client's visits still uses is never deleted; a copy that couldn't be deleted
// (after a few tries) is listed on the photo's record (pendingDeletes), and tried again the next time any of the client's
// photo records is opened, at most every 15 minutes (the client is marked photoDeletesPending until none are left).
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { logAuditAdmin } from '@/lib/audit';
import { FieldValue } from 'firebase-admin/firestore';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const KEY = /^p[a-z0-9]{2,30}$/;
const KEEP_OPENED = 30;
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

/** Deletes a removed photo's copies kept here, unless another of the client's visits still uses one (then it's kept:
 *  'shared'). Each delete is tried a few times; when the client's visits can't all be checked, nothing is deleted yet
 *  and every copy is left to be tried again. */
async function clearCopies(db: any, T: string, tenantId: string, clientId: string, apptId: string, refs: string[], o: { tries?: number; scan?: string[] | null } = {}): Promise<{ done: string[]; failed: string[] }> {
  try {
    const P = await import('@/lib/inspo-photos');
    const tenant: any = (await db.doc(T).get()).data() || {}; const buckets = await P.ourBuckets(tenant);
    const theirs = o.scan !== undefined ? o.scan : await clientVisits(db, T, clientId);
    if (!theirs) return { done: refs.map(() => 'failed'), failed: refs };   // too many visits to be sure: later
    const shared = (r: string) => theirs.some((j: string) => j.includes(JSON.stringify(r).slice(1, -1)));
    const done: string[] = [];
    for (const r of refs) {
      if (shared(r)) { done.push('shared'); continue; }
      let out: string = 'failed';
      const tries = o.tries ?? 3;
      for (let i = 0; i < tries && out === 'failed'; i++) { out = await P.deleteOwnPhoto(db, r, tenantId, apptId, buckets); if (out === 'failed' && i < tries - 1) await new Promise((res) => setTimeout(res, 250 * (i + 1))); }
      done.push(out);
    }
    return { done, failed: refs.filter((_, i) => done[i] === 'failed') };
  } catch (e: any) { console.error('[clients/photos] copies', e?.message); return { done: refs.map(() => 'failed'), failed: refs }; }
}
/** Every one of the client's visits, as text (to find a copy another visit still uses); null when there are too many. */
async function clientVisits(db: any, T: string, clientId: string): Promise<string[] | null> {
  const snap = await db.collection(`${T}/appointments`).where('clientId', '==', clientId).limit(1000).get();
  return snap.docs.length >= 1000 ? null : snap.docs.map((d: any) => JSON.stringify(d.data() || {}));
}
const first = (n: any) => String(n || '').trim().split(/\s+/)[0] || '';

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''), clientId = String(b.clientId || ''), key = String(b.key || ''), action = String(b.action || '');
  const apptId = b.apptId ? String(b.apptId) : '';
  if (!ID.test(tenantId) || !ID.test(clientId) || !KEY.test(key) || (apptId && !ID.test(apptId))) return bad('That photo couldn’t be found.');
  const auth = await verifyStaffActor(req, tenantId); if (!auth.ok) return bad(auth.error, auth.status);
  const who: any = auth.actor; const db = getAdminDb(); const T = `tenants/${tenantId}`;
  if (!(await db.doc(`${T}/clients/${clientId}`).get()).exists) return bad('That client couldn’t be found.', 404);
  // The visit the photo is on: this client's, and (for a booth renter) one of theirs.
  const apptRef = apptId ? db.doc(`${T}/appointments/${apptId}`) : null;
  const appt: any = apptRef ? (await apptRef.get()).data() : null;
  if (apptId && (!appt || String(appt.clientId || '') !== clientId)) return bad('That photo isn’t on this client’s visits.', 404);
  if (who.isRenter && (!appt || appt.staffId !== who.uid)) return bad('That photo isn’t one of yours.', 403);
  const PR = await import('@/lib/private-records');
  const recRef = db.doc(PR.photoRecordPath(tenantId, clientId, key));
  // Any of the client's photo records still kept under the client (before they moved) are moved first, put together
  // with what's here, so nothing they hold (who opened them, copies left to delete) is missed.
  await PR.movePhotoRecordsOf(db, tenantId, clientId).catch((e: any) => console.error('[clients/photos] move records', e?.message));
  const nowIso = new Date().toISOString();
  const { photoKey } = await import('@/lib/markup/team');
  // The photo must be one of this visit's (or, without a visit, one brought over onto the client's page).
  const urlsOf = (a: any) => [...(Array.isArray(a?.inspirationPhotos) ? a.inspirationPhotos : []), a?.inspirationPhotoUrl, ...(Array.isArray(a?.inspirationPhotosEarlier) ? a.inspirationPhotosEarlier : []), a?.nowPhoto, ...(Array.isArray(a?.afterPhotoUrls) ? a.afterPhotoUrls : [])]
    .map((p: any) => String(typeof p === 'string' ? p : p?.url || '')).filter(Boolean);
  if (action === 'opened') {
    const client: any = apptId ? null : (await db.doc(`${T}/clients/${clientId}`).get()).data() || {};
    const urls = apptId ? urlsOf(appt) : (Array.isArray(client?.importedFiles) ? client.importedFiles : []).filter((f: any) => f?.kind === 'photo').map((f: any) => String(f?.url || ''));
    if (!urls.some((u: string) => photoKey(u) === key)) return bad('That photo couldn’t be found.', 404);
    // Copies of removed photos that couldn't be deleted before: tried again now, at most every 15 minutes (once each, no
    // waiting), and the mark only goes once every record has been looked at and nothing is left.
    const cl: any = client || (await db.doc(`${T}/clients/${clientId}`).get()).data() || {};
    if (cl.photoDeletesPending && !(Date.parse(String(cl.photoDeletesTriedAt || '')) > Date.now() - 15 * 60e3)) {
      try {
        await db.doc(`${T}/clients/${clientId}`).set({ photoDeletesTriedAt: nowIso }, { merge: true });
        const all = await db.collection(PR.PHOTO_RECORDS(tenantId)).where('clientId', '==', clientId).limit(500).get();
        // Longest untried first, so a copy that keeps failing never holds up the rest.
        const recs = all.docs.filter((d: any) => Array.isArray(d.data()?.pendingDeletes) && d.data().pendingDeletes.length)
          .sort((x: any, y: any) => String(x.data().pendingTriedAt || '').localeCompare(String(y.data().pendingTriedAt || '')));
        const scan = await clientVisits(db, T, clientId); let left = 0;
        for (const d of recs.slice(0, 5)) {
          const r: any = d.data(); const out = await clearCopies(db, T, tenantId, clientId, String(r.apptId || ''), r.pendingDeletes.map(String), { tries: 1, scan });
          await d.ref.set({ pendingDeletes: out.failed.length ? out.failed : FieldValue.delete(), pendingTriedAt: out.failed.length ? nowIso : FieldValue.delete() }, { merge: true }); if (out.failed.length) left++;
        }
        if (!left && recs.length <= 5 && all.docs.length < 500) await db.doc(`${T}/clients/${clientId}`).set({ photoDeletesPending: FieldValue.delete(), photoDeletesTriedAt: FieldValue.delete() }, { merge: true });
      } catch (e: any) { console.error('[clients/photos] retry', e?.message); }
    }
  }

  if (action === 'opened') {
    const opened = await db.runTransaction(async (tx: any) => {
      const cur: any = (await tx.get(recRef)).data() || {};
      const list: any[] = Array.isArray(cur.opened) ? cur.opened : [];
      const recent = list.find((x) => x?.uid && x.uid === who.uid && Date.parse(x.at) > Date.now() - 10 * 60e3);
      const next = recent ? list : [...list, { uid: who.uid || null, by: first(who.name) || 'Someone', at: nowIso }].slice(-KEEP_OPENED);
      if (!recent) tx.set(recRef, { key, clientId, ...(apptId ? { apptId } : {}), opened: next }, { merge: true });
      return next;
    });
    // Latest first, each person once.
    const seen = new Set<string>(); const lately = [...opened].reverse().filter((x: any) => { const k = String(x.uid || x.by); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 5).map((x: any) => ({ by: x.by, at: x.at }));
    return NextResponse.json({ ok: true, opened: lately });
  }

  if (action !== 'remove') return bad('Unknown action.');
  if (!(who.isManager || who.isTenantOwner)) return bad('Only a manager can remove a client’s photo.', 403);
  const kind = String(b.kind || '');
  if (!['inspiration', 'earlier', 'now'].includes(kind)) return bad('Only photos the client sent can be removed here.');
  if (!apptRef || !appt) return bad('That photo couldn’t be found.', 404);
  const same = (p: any) => photoKey(String(typeof p === 'string' ? p : p?.url || '')) === key;
  // Taken off the visit in one go; what it was is kept to delete its copies afterwards.
  const gone = await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(apptRef)).data() || {};
    const up: Record<string, any> = {}; let photo: any = null;
    if (kind === 'inspiration') {
      const list: any[] = Array.isArray(cur.inspirationPhotos) ? cur.inspirationPhotos : [];
      photo = list.find(same) || (cur.inspirationPhotoUrl && same(cur.inspirationPhotoUrl) ? { url: cur.inspirationPhotoUrl } : null);
      if (photo) {
        const left = list.filter((p) => !same(p));
        if (list.length) up.inspirationPhotos = left;
        if (cur.inspirationPhotoUrl && (same(cur.inspirationPhotoUrl) || !left.some((p) => p?.url === cur.inspirationPhotoUrl))) up.inspirationPhotoUrl = left[0]?.url || FieldValue.delete();
      }
    } else if (kind === 'earlier') {
      const list: any[] = Array.isArray(cur.inspirationPhotosEarlier) ? cur.inspirationPhotosEarlier : [];
      photo = list.find(same) || null; if (photo) up.inspirationPhotosEarlier = list.filter((p) => !same(p));
    } else if (cur.nowPhoto?.url && same(cur.nowPhoto.url)) { photo = cur.nowPhoto; up.nowPhoto = FieldValue.delete(); }
    if (!photo) return null;
    const reply = cur.inspoReply?.photos?.[key] || null;
    if (cur.inspoTeam?.[key]) up[`inspoTeam.${key}`] = FieldValue.delete();
    if (reply) up[`inspoReply.photos.${key}`] = FieldValue.delete();
    tx.update(apptRef, up);
    // The team's marks and private notes on it go with it. Every copy kept here is listed until it's deleted.
    tx.delete(db.doc(PR.marksPath(tenantId, apptId, key))); tx.delete(db.doc(PR.oldMarksPath(tenantId, apptId, key)));
    const refs = [photo.url, photo.original, reply?.base, reply?.mine, reply?.theirs].filter((x: any) => typeof x === 'string' && x);
    tx.set(recRef, { key, clientId, apptId, removedAt: nowIso, removedBy: { uid: who.uid || null, name: who.name || 'Team' }, opened: FieldValue.delete(), pendingDeletes: refs }, { merge: true });
    return { refs };
  });
  if (!gone) return bad('That photo isn’t on the visit any more.', 404);
  // Every copy this business keeps (the photo, the photo before its marks, the team's images sent back with it),
  // unless another of the client's visits still uses it (a copied or rebooked visit, say).
  const { done, failed } = await clearCopies(db, T, tenantId, clientId, apptId, gone.refs);
  await recRef.set({ pendingDeletes: failed.length ? failed : FieldValue.delete() }, { merge: true }).catch((e: any) => console.error('[clients/photos] pending', e));
  if (failed.length) await db.doc(`${T}/clients/${clientId}`).set({ photoDeletesPending: true }, { merge: true }).catch((e: any) => console.error('[clients/photos] pending flag', e));
  await logAuditAdmin(db, tenantId, { action: 'clients.photo_removed', targetType: 'client', targetId: clientId,
    summary: `${who.name || 'A manager'} removed a photo ${appt.clientName ? `${first(appt.clientName)} sent` : 'the client sent'} (${kind === 'now' ? 'how it looks now' : 'inspiration'}) from a visit`,
    actor: { type: 'user', id: who.uid || undefined, name: who.name || 'Team', role: who.role || 'staff', via: 'client page' } }).catch(() => {});
  return NextResponse.json({ ok: true, deleted: done.filter((x) => x === 'deleted').length, shared: done.filter((x) => x === 'shared').length, failed: failed.length });
}
