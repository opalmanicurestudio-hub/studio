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

