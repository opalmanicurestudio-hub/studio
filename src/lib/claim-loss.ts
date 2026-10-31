// src/lib/claim-loss.ts — AN APPROVED REPORT IS A LOSS, RECORDED ON THE SERVER. A unit went out and didn't bring in what
// it was sold for, so approving a report (by a person in Problems, or by the shop's own rules) writes the inventory
// exception: its reason from the report's type, who is responsible following from that, and whether it's a claim to
// file with the carrier (Lost and recovered starts from that). What the goods cost comes from the product; one that
// can't be costed is recorded with costed: false and its price, flagged rather than guessed. A decline records nothing.
// One record per report (claim-<id>), however many times it's approved; a parcel already replaced from Needs you has
// its loss recorded once, on the replacement (lost-<order>). Used to be written from the browser on the old Claims page.
// An approval marks the report lossPending; this clears it, and the nightly run (sweepClaimLosses) records any whose
// record didn't get written straight after.
import { buildExceptionDoc } from './exception-doc';
import { deliveredAt } from './claim-view';

const units = (l: any) => Math.max(0, (Number(l?.qtyOrdered) || 0) - (Number(l?.qtyShorted) || 0));

export async function recordClaimLoss(db: any, tenantId: string, claimId: string): Promise<{ ok: boolean; created: boolean }> {
  const col = `tenants/${tenantId}/inventoryExceptions`;
  const claimRef = db.doc(`tenants/${tenantId}/retailClaims/${claimId}`);
  const cs = await claimRef.get();
  if (!cs.exists) return { ok: false, created: false };
  const c: any = { ...(cs.data() || {}), id: claimId };
  const settle = async () => { if (c.lossPending) await claimRef.update({ lossPending: false }); };
  if (!['resolved', 'auto_resolved'].includes(String(c.status))) { await settle(); return { ok: true, created: false }; }
  const ref = db.doc(`${col}/claim-${claimId}`);
  if ((await ref.get()).exists) { await settle(); return { ok: true, created: false }; }
  if (c.type === 'not_received' && (await db.doc(`${col}/lost-${c.orderId}`).get()).exists) { await settle(); return { ok: true, created: false }; }

  const os = c.orderId ? await db.doc(`tenants/${tenantId}/retailOrders/${c.orderId}`).get() : null;
  const o: any = os?.exists ? os.data() || {} : {};
  const lineId = String(c.lineId || String(claimId).split('__')[2] || '');
  const line = (Array.isArray(o.lines) ? o.lines : []).find((l: any) => l?.lineId === lineId) || null;
  const costOf = async (productId: string | null | undefined): Promise<number> => {
    if (!productId) return 0;
    const s = await db.doc(`tenants/${tenantId}/inventory/${productId}`).get().catch(() => null);
    return s?.exists ? Number((s.data() || {}).costPerUnit) || 0 : 0;
  };
  const dAt = deliveredAt(o);
  const delivered = !!dAt;
  const num = String(c.orderNumber ?? o.orderNumber ?? '').padStart(4, '0');

  // Only the units it settled: part of it already returned or refunded is counted with that, not again here.
  let qty = Math.max(1, Number(c.qtySettled ?? c.qty) || 1);
  let productId: string | null = null; let cost: number | null = null; let retail: number | null = null; let contents: string | null = null;
  if (line) {
    productId = line.productId || null;
    retail = Number(line.unitPriceCents) || null;
    cost = (await costOf(productId)) || null;
  } else if (c.type === 'not_received') {
    // The whole box: one record for what was in it, at what the goods cost (their price when a cost isn't set).
    const sent = (Array.isArray(o.lines) ? o.lines : []).filter((l: any) => l && l.digital !== true && units(l) > 0);
    const costs = await Promise.all(sent.map((l: any) => costOf(l.productId)));
    const n = sent.reduce((a: number, l: any) => a + units(l), 0);
    qty = 1;
    retail = sent.reduce((a: number, l: any) => a + (Number(l.unitPriceCents) || 0) * units(l), 0) || null;
    cost = sent.length && costs.every((x) => x > 0) ? sent.reduce((a: number, l: any, i: number) => a + costs[i] * units(l), 0) : null;
    contents = `Order #${num} contents (${n} item${n === 1 ? '' : 's'})`;
  }

  const docData = buildExceptionDoc({
    dedupeId: `claim-${claimId}`,
    // Damage in transit and a box that never came are the carrier's (or the insurer's) to make good, so they become
    // claims to file under Lost and recovered (lib/lost-recovered); an item missing from the box or the wrong one is ours.
    reason: c.type === 'missing' ? 'reported_missing' : c.type === 'damaged' ? 'carrier_damaged' : c.type === 'wrong_item' ? 'wrong_item_shipped' : delivered ? 'stolen_after_delivery' : 'carrier_lost',
    qty, productId, sku: c.lineSku || null,
    name: contents || c.lineName || `Order #${num} contents`,
    costPerUnitDollars: cost, retailPerUnitCents: retail,
    orderId: c.orderId || null, orderNumber: c.orderNumber ?? o.orderNumber ?? null, claimId,
    trackingNumber: o.trackingNumber || null, carrier: o.carrier || null,
    insuredCents: o.shipmentProtection ? Number(o.shipmentProtection.insuranceCents) || 0 : null,
    shippedAt: o.completedAt || o.shipmentProtection?.decidedAt || null,
    deliveredAt: dAt && dAt !== 'yes' ? dAt : null,
    responsibleParty: c.type === 'not_received' || c.type === 'damaged' ? 'carrier' : c.type === 'wrong_item' ? 'internal' : 'unknown',
    note: c.description || null,
    photoUrls: Array.isArray(c.photoUrls) ? c.photoUrls : [],
    recordedBy: c.status === 'auto_resolved' ? { id: 'auto', name: 'The shop’s claim rules' } : { id: String(c.decidedById || 'staff'), name: String(c.decidedBy || 'Problems') },
    source: 'claims_desk',
  }, tenantId);
  // Written only if it isn't there yet, and the report's pending mark cleared with it.
  const created = await db.runTransaction(async (tx: any) => {
    if ((await tx.get(ref)).exists) return false;
    tx.set(ref, JSON.parse(JSON.stringify(docData)));
    tx.update(claimRef, { lossPending: false });
    return true;
  });
  if (!created) await settle();
  return { ok: true, created };
}

/** Approved reports whose loss didn't get recorded straight after (a failed job): recorded now. Run once a night. */
export async function sweepClaimLosses(db: any, tenantId: string): Promise<number> {
  const snap = await db.collection(`tenants/${tenantId}/retailClaims`).where('lossPending', '==', true).limit(100).get();
  let n = 0;
  for (const d of snap.docs) {
    try { if ((await recordClaimLoss(db, tenantId, d.id)).created) n++; } catch (e: any) {
      console.error('[claim-loss] sweep', tenantId, d.id, String(e?.message || e).slice(0, 120));
      // One that keeps failing stops being tried after five nights (marked lossFailedAt), so it never crowds out others.
      const c: any = d.data() || {};
      const tries = (Number(c.lossTries) || 0) + 1;
      const at = new Date().toISOString();
      await d.ref?.update?.(tries >= 5 ? { lossPending: false, lossTries: tries, lossFailedAt: at } : { lossTries: tries }).catch(() => {});
      // Given up: the owner hears about it, so it can be recorded by hand under Lost and recovered.
      if (tries >= 5) {
        try {
          const owner = String(((await db.doc(`tenants/${tenantId}`).get()).data() || {}).userId || '');
          if (owner) { const ref = db.collection(`tenants/${tenantId}/notifications`).doc(); await ref.set({ id: ref.id, userId: owner, type: 'claim_loss_failed', title: 'A loss couldn’t be recorded', message: `The approved report on order #${String(c.orderNumber ?? '').padStart(4, '0')}${c.lineName ? ` (${c.lineName})` : ''} has no loss record. Add it under Lost and recovered.`, link: '/retail-orders/lost', createdAt: at, read: false }); }
        } catch { /* logged above */ }
      }
    }
  }
  return n;
}
