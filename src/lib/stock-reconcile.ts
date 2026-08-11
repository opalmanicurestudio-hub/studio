import { getAdminDb } from '@/lib/firebase-admin';
import { buildEntry } from '@/lib/stock-ledger';

// ─── src/lib/stock-reconcile.ts ──────────────────────────────────────────────
// THE SELF-HEAL for leaked reservations.
//
// stockReserved is a promise: units held for orders that are paid but not yet
// out the door. It only stays honest if EVERY path decrements it perfectly —
// and paths fail. A crash mid-fulfilment, an order that ends in a way nobody
// anticipated, a hand-edited document. When a hold leaks, those units look
// unavailable to everyone, forever, with no error and no symptom except a
// count that "looks wrong". It is the worst class of inventory bug precisely
// because nothing announces it.
//
// So rather than trusting the running total, this recomputes it from the
// source of truth — the orders that actually exist right now — and writes the
// difference. Truth is derived, not accumulated.
//
// Deliberate boundaries:
//   · Only orders in stages that genuinely hold stock count (paid → ready).
//     Shipped and completed orders released theirs; cancelled never had it.
//   · Digital and pre-order lines are skipped — neither reserves shelf stock.
//   · A correction only writes when it CHANGES something, so a healthy shop
//     produces no noise, night after night.
//   · Every correction lands on the ledger as a 'released' or 'reserved'
//     movement with reason "Nightly reservation check", so a leak leaves a
//     visible record instead of silently resolving.

const HOLDING_STAGES = ['paid', 'picking', 'packed', 'ready'];

export interface ReconcileResult {
  productsChecked: number;
  corrected: number;
  unitsFreed: number;
  unitsHeld: number;
}

export async function reconcileReservations(
  db: any,
  tenantId: string,
  opts?: { dryRun?: boolean },
): Promise<ReconcileResult> {
  const result: ReconcileResult = { productsChecked: 0, corrected: 0, unitsFreed: 0, unitsHeld: 0 };

  // 1. What SHOULD be held, straight from the orders that exist.
  const expected = new Map<string, number>();
  const ordersSnap = await db.collection(`tenants/${tenantId}/retailOrders`)
    .where('stage', 'in', HOLDING_STAGES)
    .limit(1000)
    .get();

  for (const doc of ordersSnap.docs) {
    const order = doc.data() as any;
    for (const line of (order.lines || [])) {
      if (line.digital === true || line.preorder === true) continue;
      if (['refunded', 'cancelled'].includes(String(line.status))) continue;
      const owed = Math.max(0, (Number(line.qtyOrdered) || 0) - (Number(line.qtyShorted) || 0));
      if (owed <= 0) continue;
      expected.set(line.productId, (expected.get(line.productId) || 0) + owed);
    }
  }

  // 2. Compare against every item currently claiming a hold, PLUS every item
  //    an order expects — an item can be wrong in either direction.
  const heldSnap = await db.collection(`tenants/${tenantId}/inventory`)
    .where('stockReserved', '>', 0)
    .limit(1000)
    .get();

  const ids = new Set<string>([...expected.keys(), ...heldSnap.docs.map((d: any) => d.id)]);
  const heldById = new Map<string, any>(heldSnap.docs.map((d: any) => [d.id, d.data()]));

  for (const productId of ids) {
    result.productsChecked += 1;
    const want = expected.get(productId) || 0;

    let item = heldById.get(productId);
    if (!item) {
      const snap = await db.doc(`tenants/${tenantId}/inventory/${productId}`).get();
      if (!snap.exists) continue;
      item = snap.data();
    }
    const have = Math.max(0, Math.floor(Number(item.stockReserved) || 0));
    if (have === want) continue;

    const delta = want - have;
    if (delta < 0) result.unitsFreed += Math.abs(delta);
    else result.unitsHeld += delta;
    result.corrected += 1;
    if (opts?.dryRun) continue;

    try {
      const batch = db.batch();
      batch.set(db.doc(`tenants/${tenantId}/inventory/${productId}`), { stockReserved: want }, { merge: true });
      batch.set(db.collection(`tenants/${tenantId}/stockCorrections`).doc(), buildEntry({
        productId,
        type: delta < 0 ? 'released' : 'reserved',
        field: 'stockReserved',
        delta,
        unit: item.unit || 'units',
        reason: delta < 0
          ? `Nightly reservation check \u2014 ${Math.abs(delta)} unit(s) were held with no live order`
          : `Nightly reservation check \u2014 ${delta} unit(s) owed to live orders were not held`,
        actorId: 'system',
        actorName: 'Nightly check',
        balanceAfter: want,
      }));
      await batch.commit();
    } catch (e: any) {
      console.error('[stock-reconcile] could not correct', productId, e?.message);
    }
  }

  return result;
}

/** Every tenant that has retail inventory worth checking. */
export async function reconcileAllTenants(db?: any): Promise<Record<string, ReconcileResult>> {
  const fs = db || getAdminDb();
  const out: Record<string, ReconcileResult> = {};
  const tenantsSnap = await fs.collection('tenants').limit(500).get();
  for (const t of tenantsSnap.docs) {
    try {
      const r = await reconcileReservations(fs, t.id);
      if (r.corrected > 0) out[t.id] = r;
    } catch (e: any) {
      console.error('[stock-reconcile] tenant failed, continuing', t.id, e?.message);
    }
  }
  return out;
}
