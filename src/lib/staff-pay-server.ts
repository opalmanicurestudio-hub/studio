// src/lib/staff-pay-server.ts — pay rates on the server (admin SDK): merge staffPay into staff records, save rates, and
// move old rates off the staff records (lib/staff-pay explains where pay lives). Server only.
import { mergePay, mergePayAll, splitPay } from '@/lib/staff-pay';

/** One person's record with pay (server). */
export async function staffWithPay(db: any, tenantId: string, staffId: string): Promise<any | null> {
  if (!staffId) return null;
  const [s, p] = await Promise.all([db.doc(`tenants/${tenantId}/staff/${staffId}`).get(), db.doc(`tenants/${tenantId}/staffPay/${staffId}`).get()]);
  if (!s.exists) return null; return mergePay({ id: s.id, ...(s.data() || {}) }, p.exists ? p.data() : null);
}
/** Add pay to staff records already loaded (server). */
export async function withPay<S = any>(db: any, tenantId: string, list: S[]): Promise<S[]> {
  const snap = await db.collection(`tenants/${tenantId}/staffPay`).get(); const by: Record<string, any> = {};
  for (const d of snap.docs) by[d.id] = d.data() || {};
  return mergePayAll(list, by);
}
/** Write someone's pay (server). Merges; a null value clears that field. */
export async function savePay(db: any, tenantId: string, staffId: string, pay: Record<string, any>, by?: string) {
  const { pay: clean } = splitPay(pay); if (!Object.keys(clean).length) return;
  const out: any = { ...clean, staffId, updatedAt: new Date().toISOString(), ...(by ? { updatedBy: by } : {}) };   // null = cleared on purpose
  await db.doc(`tenants/${tenantId}/staffPay/${staffId}`).set(out, { mergeFields: Object.keys(out) });   // each field replaced whole
}

/** Move rates off the readable staff records into staffPay (once per business; safe to run again). */
export async function movePayOff(db: any, tenantId: string): Promise<number> {
  const { FieldValue } = await import('firebase-admin/firestore');
  const staff = await db.collection(`tenants/${tenantId}/staff`).get(); let moved = 0;
  for (const d of staff.docs) {
    const { pay } = splitPay(d.data() || {}); if (!Object.keys(pay).length) continue;
    const ref = db.doc(`tenants/${tenantId}/staffPay/${d.id}`); const existing = (await ref.get()).data() || {};
    const fill: any = {}; for (const [k, v] of Object.entries(pay)) if (!(k in existing)) fill[k] = v;   // a newer value already moved wins
    await ref.set({ ...fill, staffId: d.id, movedAt: new Date().toISOString() }, { merge: true });
    const del: any = {}; for (const k of Object.keys(pay)) del[k] = FieldValue.delete();
    await d.ref.update(del); moved++;
  }
  await db.doc(`tenants/${tenantId}`).set({ payMovedAt: new Date().toISOString() }, { merge: true });
  return moved;
}
