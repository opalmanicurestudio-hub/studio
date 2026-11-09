// src/lib/renter-service-costs.ts — WHAT EACH OF A RENTER'S SERVICES COSTS THEM TO DO (product, supplies).
// That's the renter's own business, so it lives in one private document the server alone reads
// (tenants/{t}/private/renterServiceCosts: { [serviceId]: dollars }), never on the service itself, which the public
// booking page reads. Costs saved on a service before this are moved over (the renter's menu loading moves theirs, and
// the nightly job moves the rest), and never over a newer cost.
import { FieldValue } from 'firebase-admin/firestore';

const costsRef = (db: any, tenantId: string) => db.doc(`tenants/${tenantId}/private/renterServiceCosts`);
const dollars = (v: any) => Math.max(0, Math.round((Number(v) || 0) * 100) / 100);

/** Saves one service's cost. Called before the service itself is saved, so a failed save never loses it. */
export async function saveServiceCost(db: any, tenantId: string, serviceId: string, cost: unknown): Promise<void> {
  await costsRef(db, tenantId).set({ [serviceId]: dollars(cost) }, { merge: true });
}

/** Moves costs still sitting on these service documents into the private record, then clears them from the service. */
export async function moveLegacyCosts(db: any, tenantId: string, svDocs: any[]): Promise<number> {
  const legacy = svDocs.filter((d: any) => (d.data() || {}).productCost !== undefined);
  if (!legacy.length) return 0;
  const ref = costsRef(db, tenantId);
  await db.runTransaction(async (tx: any) => {
    const saved: any = ((await tx.get(ref)).data() as any) || {};
    const add: Record<string, number> = {};
    for (const d of legacy) if (saved[d.id] === undefined) add[d.id] = dollars((d.data() || {}).productCost);
    if (Object.keys(add).length) tx.set(ref, add, { merge: true });
  });
  for (const d of legacy) await d.ref.update({ productCost: FieldValue.delete() }).catch(() => {});   // only once the private copy is saved; a service deleted meanwhile is fine
  return legacy.length;
}

/** Each service's cost for the renter's own menu (moving any old ones over first). */
export async function serviceCosts(db: any, tenantId: string, svDocs: any[]): Promise<Record<string, number>> {
  try { await moveLegacyCosts(db, tenantId, svDocs); } catch { /* moved next time; the old value still shows below */ }
  const saved: any = ((await costsRef(db, tenantId).get()).data() as any) || {};
  const out: Record<string, number> = {};
  for (const d of svDocs) out[d.id] = dollars(saved[d.id] ?? (d.data() || {}).productCost);
  return out;
}
