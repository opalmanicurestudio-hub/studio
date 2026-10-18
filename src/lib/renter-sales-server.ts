// src/lib/renter-sales-server.ts — BRING ONE ORDER'S RENTER CREDITS UP TO DATE (server). Used by
// /api/retail/renter-credit after a handover, shipment or return, and by the nightly job to catch anything missed.
import { FINAL_STAGES, creditChange, renterShareCents } from './renter-sales';

export async function syncRenterCreditsForOrder(db: any, tenantId: string, orderId: string, byName: string): Promise<number> {
  const oSnap = await db.doc(`tenants/${tenantId}/retailOrders/${orderId}`).get();
  if (!oSnap.exists) return 0;
  const o: any = oSnap.data() || {};
  if (o.isTest) return 0;
  const final = FINAL_STAGES.includes(String(o.stage));
  const num = `#${String(o.orderNumber ?? '').padStart(4, '0')}`;
  const now = new Date().toISOString();
  let changed = 0;
  for (const l of (o.lines || [])) {
    if (!l?.soldFor?.renterId) continue;
    const desired = final ? renterShareCents(l) : 0;
    const ref = db.doc(`tenants/${tenantId}/rentLedger/rs-${orderId}-${l.lineId}`);
    const r = await db.runTransaction(async (tx: any) => {
      const cur = await tx.get(ref); const ex = cur.exists ? cur.data() : null;
      const c = creditChange(desired, ex); if (!c) return null;
      const units = Math.max(0, (Number(l.qtyOrdered) || 0) - (Number(l.qtyShorted) || 0) - (Number(l.qtyReturned) || 0));
      tx.set(ref, {
        id: ref.id, renterId: l.soldFor.renterId, type: 'retail_sale_credit', status: c.status, amountCents: c.amountCents, appliedCents: c.appliedCents,
        note: `Online sale ${num}: ${units} × ${l.name}, after the shop’s ${Number(l.soldFor.shopCutPct) || 0}%`,
        retailOrderId: orderId, lineId: l.lineId, date: ex?.date || now, createdAt: ex?.createdAt || now, updatedAt: now, createdBy: byName,
        ...(c.clawbackCents ? { clawbackCents: c.clawbackCents } : {}),
      }, { merge: true });
      return c;
    });
    if (!r) continue;
    changed++;
    if (r.clawbackCents > 0) {
      const n = db.collection(`tenants/${tenantId}/notifications`).doc();
      await n.set({ id: n.id, type: 'renter_clawback', read: false, createdAt: now, link: '/rent', message: `${l.soldFor.renterName || 'A renter'} was already credited for ${l.name} on order ${num}, which came back. $${(r.clawbackCents / 100).toFixed(2)} to settle with them.` });
    }
  }
  return changed;
}
