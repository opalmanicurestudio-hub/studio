// src/lib/staff-pay-client.ts — saving pay from the app (managers): rates go to tenants/{t}/staffPay/{staffId}, never onto
// the staff record everyone can read (lib/staff-pay).
import { doc, setDoc, deleteField, type Firestore } from 'firebase/firestore';
import { splitPay } from '@/lib/staff-pay';

export { splitPay };
/** Save the pay part of a record (fields missing or undefined are left alone; null clears one). */
export async function saveStaffPay(firestore: Firestore, tenantId: string, staffId: string, pay: Record<string, any>) {
  const { pay: p } = splitPay(pay); if (!Object.keys(p).length) return;
  const out: any = { staffId, updatedAt: new Date().toISOString() };
  for (const [k, v] of Object.entries(p)) { if (v === undefined) continue; out[k] = v === null ? deleteField() : (typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v); }
  // mergeFields: each field written replaces what was there whole (a per-service map with a service taken out loses it).
  await setDoc(doc(firestore, `tenants/${tenantId}/staffPay/${staffId}`), out, { mergeFields: Object.keys(out) });
}
