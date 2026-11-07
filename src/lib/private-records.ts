// src/lib/private-records.ts — WHERE PRIVATE RECORDS ARE KEPT, SERVER ONLY. A client's answers to a form that a long
// visit record moved beside the visit (health answers among them), the team's marks and private notes on a client's
// photo, and a photo's record (who opened it, what's left to delete) are kept in collections the database rules keep
// from every browser (firestore.rules lists them among the server-only collections), so they're only ever read through
// the server, by its own rules (health answers only for people who may see health notes, and so on).
// They were kept under the visit or the client before, where any signed-in team member could read them: those are
// moved here as they're read (readMoved), and the rest by the daily job (moveOldPrivateRecords).
const safe = (v: any) => String(v ?? '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);

/** A form's answers kept beside a visit. */
export const answersPath = (t: string, apptId: string, formId: string) => `tenants/${t}/visitFormAnswers/${safe(apptId)}__${safe(formId)}`;
export const oldAnswersPath = (t: string, apptId: string, formId: string) => `tenants/${t}/appointments/${apptId}/formAnswers/${safe(formId)}`;
/** The team's marks and private notes on one of a client's photos (lib/markup/team). */
export const marksPath = (t: string, apptId: string, key: string) => `tenants/${t}/visitPhotoMarks/${safe(apptId)}__${safe(key)}`;
export const oldMarksPath = (t: string, apptId: string, key: string) => `tenants/${t}/appointments/${apptId}/inspoMarks/${safe(key)}`;
/** A photo's record on the client's page (api/clients/photos). */
export const photoRecordPath = (t: string, clientId: string, key: string) => `tenants/${t}/clientPhotoRecords/${safe(clientId)}__${safe(key)}`;
export const PHOTO_RECORDS = (t: string) => `tenants/${t}/clientPhotoRecords`;

/** Two copies of a photo's record (the older one moved onto one already here): who opened it, and every copy still to
 *  delete, are kept from both; the removal (if any) stays. */
export function mergedPhotoRecord(here: any, older: any): any {
  // Each opening once (the same record moved twice adds nothing), oldest first, the latest 30 kept.
  const seen = new Set<string>();
  const opened = [...(Array.isArray(older?.opened) ? older.opened : []), ...(Array.isArray(here?.opened) ? here.opened : [])]
    .filter((o: any) => { const k = `${o?.uid || ''}|${o?.at || ''}|${o?.by || ''}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a: any, b: any) => String(a?.at || '').localeCompare(String(b?.at || ''))).slice(-30);
  const pending = [...new Set([...(Array.isArray(here?.pendingDeletes) ? here.pendingDeletes : []), ...(Array.isArray(older?.pendingDeletes) ? older.pendingDeletes : [])].map(String))];
  return { ...older, ...here, opened, ...(pending.length ? { pendingDeletes: pending } : {}), ...(here?.removedAt || older?.removedAt ? { removedAt: here?.removedAt || older.removedAt, removedBy: here?.removedBy || older.removedBy } : {}) };
}

/** Moves one older record to where it's kept now, without ever overwriting a newer one: copied only if nothing's there
 *  yet (made, not written over), else (a photo's record) put together with what's there; the older copy then goes. */
async function moveOne(db: any, fromRef: any, data: any, to: string, photoRecord: boolean): Promise<void> {
  const toRef = db.doc(to);
  if (photoRecord) {
    await db.runTransaction(async (tx: any) => { const cur = await tx.get(toRef); tx.set(toRef, cur.exists ? mergedPhotoRecord(cur.data(), data) : data); });
  } else {
    try { await toRef.create(data); }
    catch (e: any) { if (!(await toRef.get()).exists) throw e; }   // a newer copy is already there: it stays
  }
  await fromRef.delete();
}

/** A record from where it's kept now, or (an older one) from where it was, moved here as it's read. A newer copy is
 *  never overwritten (if one is made meanwhile, it's the one read). */
export async function readMoved(db: any, now: string, old: string): Promise<any | null> {
  const here: any = (await db.doc(now).get()).data() || null;
  if (here) return here;
  const oldRef = db.doc(old); const before: any = (await oldRef.get()).data() || null;   // a read that fails is an error, never nothing
  if (!before) return null;
  try { await moveOne(db, oldRef, before, now, false); } catch (e: any) { console.error('[private-records] move', old, e?.message); }
  return ((await db.doc(now).get().catch(() => null))?.data?.()) || before;
}

/** A client's photo records still kept under the client: moved now (before they're looked through). */
export async function movePhotoRecordsOf(db: any, t: string, clientId: string): Promise<void> {
  const snap = await db.collection(`tenants/${t}/clients/${clientId}/photoRecords`).limit(200).get();
  for (const d of snap.docs) { try { await moveOne(db, d.ref, { ...(d.data() || {}), clientId }, photoRecordPath(t, clientId, d.id), true); } catch (e: any) { console.error('[private-records] photo record', d.ref.path, e?.message); } }
}

/** The daily job: older records still under a visit or a client are moved to where they're kept now. A page at a time,
 *  each starting after the last (so one that can't be moved never holds up the rest), at most `max` of each kind a
 *  run; the next run carries on. */
export async function moveOldPrivateRecords(db: any, max = 300): Promise<{ moved: number; skipped: number; left: boolean }> {
  let moved = 0, skipped = 0; let left = false;
  const kinds: { group: string; parent: string; to: (seg: string[]) => string; photo?: boolean }[] = [
    { group: 'formAnswers', parent: 'appointments', to: (s) => answersPath(s[1], s[3], s[5]) },
    { group: 'inspoMarks', parent: 'appointments', to: (s) => marksPath(s[1], s[3], s[5]) },
    { group: 'photoRecords', parent: 'clients', to: (s) => photoRecordPath(s[1], s[3], s[5]), photo: true },
  ];
  for (const k of kinds) {
    try {
      // `max` counts what's moved; ones that can't be moved are passed over (up to three times as many are looked at).
      let after: any = null; let seen = 0; let movedHere = 0;
      while (movedHere < max && seen < max * 3) {
        const want = Math.min(100, max - movedHere);
        let q = db.collectionGroup(k.group).limit(want); if (after) q = q.startAfter(after);
        const snap = await q.get(); if (!snap.docs.length) { after = null; break; }
        for (const d of snap.docs) {
          seen++; after = d;
          const seg = String(d.ref.path).split('/');
          if (seg.length !== 6 || seg[0] !== 'tenants' || seg[2] !== k.parent) { skipped++; continue; }
          try { await moveOne(db, d.ref, { ...(d.data() || {}), ...(k.photo ? { clientId: seg[3] } : {}) }, k.to(seg), !!k.photo); moved++; movedHere++; }
          catch (e: any) { skipped++; console.error('[private-records] move', d.ref.path, e?.message); }
        }
        if (snap.docs.length < want) { after = null; break; }
      }
      if (after) left = true;   // stopped with more to look at
    } catch (e: any) { console.error('[private-records] list', k.group, e?.message); }
  }
  return { moved, skipped, left };
}
