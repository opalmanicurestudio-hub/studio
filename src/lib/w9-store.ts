// src/lib/w9-store.ts — WHERE A RENTER'S W-9 LIVES (server only).
//
// The sealed W-9 (lib/w9-record) is kept at tenants/{t}/renters/{r}/private/w9, which the Firestore rules close to
// every browser (firestore.rules: renters/{id}/private/{doc} → no reads, no writes). The renter document itself, which
// all staff can read, only says that one is on file and when. W-9s saved before this lived on the renter document as
// `w9`; the first time one is read it's moved into private (the owner's Spaces page reads every renter's W-9 status
// as it opens, so one visit there moves them all).
import { FieldValue } from 'firebase-admin/firestore';

const privatePath = (tenantId: string, renterId: string) => `tenants/${tenantId}/renters/${renterId}/private/w9`;

/** The stored W-9 (sealed: the number encrypted, its last 4, the rest as given), or null. One still on the renter
 *  document is moved into private as it's read. */
export async function readW9(db: any, tenantId: string, renterId: string): Promise<any | null> {
  const p = await db.doc(privatePath(tenantId, renterId)).get();
  if (p.exists && (p.data() as any)?.tinLast4) return p.data();
  const r = (await db.doc(`tenants/${tenantId}/renters/${renterId}`).get()).data() as any;
  if (!(r?.w9 && r.w9.tinLast4)) return null;
  try { await moveLegacy(db, tenantId, renterId); } catch { /* moved next time; the record still reads */ }
  return r.w9;
}

/** Move a W-9 still on the renter document into private, unless one is already there (a newer save wins: the move
 *  re-reads both inside one transaction, and does nothing if private already holds one). */
async function moveLegacy(db: any, tenantId: string, renterId: string): Promise<void> {
  const pRef = db.doc(privatePath(tenantId, renterId));
  const rRef = db.doc(`tenants/${tenantId}/renters/${renterId}`);
  await db.runTransaction(async (tx: any) => {
    const p = await tx.get(pRef); const r = await tx.get(rRef);
    if (p.exists && (p.data() as any)?.tinLast4) return;
    const w = (r.data() as any)?.w9;
    if (!(w && w.tinLast4)) return;
    tx.set(pRef, w);
    tx.set(rRef, { w9OnFile: true, w9CollectedAt: w.collectedAt || null, w9: FieldValue.delete() }, { merge: true });
  });
}

/** Keep a sealed W-9, in one go: the record goes to private, the renter document only says it's on file (and drops an
 *  older copy). Either both happen or neither does. */
export async function writeW9(db: any, tenantId: string, renterId: string, sealed: Record<string, any>): Promise<void> {
  const batch = db.batch();
  batch.set(db.doc(privatePath(tenantId, renterId)), sealed);
  batch.set(db.doc(`tenants/${tenantId}/renters/${renterId}`), { w9OnFile: true, w9CollectedAt: sealed.collectedAt || null, w9: FieldValue.delete() }, { merge: true });
  await batch.commit();
}

/** On file, as the renter document says (either way it was stored). */
export const hasW9 = (renter: any): boolean => renter?.w9OnFile === true || !!(renter?.w9 && renter.w9.tinLast4);
