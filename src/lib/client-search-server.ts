// src/lib/client-search-server.ts — the background walk that keeps client searchKeys complete (cron/client-search).
import { FieldPath } from 'firebase-admin/firestore';
import { clientSearchKeys, sameKeys, SEARCH_V } from '@/lib/client-search';

const PAGE = 400;
const REST_MS = 20 * 3600 * 1000;

export async function walkClients(db: any, tenantId: string, now = Date.now(), maxPages = 5): Promise<{ read: number; fixed: number; finished: boolean }> {
  const stateRef = db.doc(`tenants/${tenantId}/system/clientSearch`);
  const st: any = (await stateRef.get()).data() || {};
  if (!st.cursor && st.cycleDoneAt && now - Date.parse(st.cycleDoneAt) < REST_MS && st.v === SEARCH_V) return { read: 0, fixed: 0, finished: true };
  let cursor: string | null = st.cursor || null; let read = 0; let fixed = 0; let finished = false;
  for (let p = 0; p < maxPages; p++) {
    let q: any = db.collection(`tenants/${tenantId}/clients`).orderBy(FieldPath.documentId()).limit(PAGE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get(); read += snap.size;
    const batch = db.batch(); let writes = 0;
    for (const d of snap.docs) {
      const c = d.data() || {}; const keys = clientSearchKeys(c);
      if (c.searchV === SEARCH_V && sameKeys(c.searchKeys, keys)) continue;
      batch.update(d.ref, { searchKeys: keys, searchV: SEARCH_V }); writes++;
    }
    if (writes) { await batch.commit(); fixed += writes; }
    cursor = snap.size ? snap.docs[snap.size - 1].id : cursor;
    if (snap.size < PAGE) { finished = true; break; }
  }
  await stateRef.set(finished ? { cursor: null, cycleDoneAt: new Date(now).toISOString(), v: SEARCH_V } : { cursor, v: SEARCH_V }, { merge: true });
  return { read, fixed, finished };
}


/**
 * One-time copy of every client's past redemptions into the business's redemption log (new ones are written there as
 * they happen). Walks clients a page at a time across runs and stops for good once done.
 */
export async function backfillRedemptionLog(db: any, tenantId: string, maxPages = 3): Promise<{ copied: number; done: boolean }> {
  const stateRef = db.doc(`tenants/${tenantId}/system/redemptionLog`);
  const st: any = (await stateRef.get()).data() || {};
  if (st.done) return { copied: 0, done: true };
  let cursor: string | null = st.cursor || null; let copied = 0; let done = false;
  for (let p = 0; p < maxPages; p++) {
    let q: any = db.collection(`tenants/${tenantId}/clients`).orderBy(FieldPath.documentId()).select().limit(200);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    for (let i = 0; i < snap.docs.length; i += 20) {
      const lists = await Promise.all(snap.docs.slice(i, i + 20).map((d: any) => d.ref.collection('redemptions').get().catch(() => ({ docs: [] }))));
      const batch = db.batch(); let n = 0;
      for (const l of lists) for (const r of l.docs) {
        const data = r.data() || {};
        batch.set(db.doc(`tenants/${tenantId}/redemptionLog/${r.id}`), { ...data, id: data.id || r.id, clientId: data.clientId || r.ref.parent.parent.id, at: data.redeemedAt || data.date || data.createdAt || null, clientPath: r.ref.path }, { merge: true });
        if (++n >= 450) { await batch.commit(); copied += n; n = 0; }
      }
      if (n) { await batch.commit(); copied += n; }
    }
    cursor = snap.size ? snap.docs[snap.size - 1].id : cursor;
    if (snap.size < 200) { done = true; break; }
  }
  await stateRef.set(done ? { done: true, cursor: null, doneAt: new Date().toISOString() } : { cursor }, { merge: true });
  return { copied, done };
}
