// src/lib/stock-count.ts — COUNTING WHAT'S ON THE SHELF. Someone counts a product and types the number; the shelf is set
// to it, and the difference is recorded on the stock history with their name (a 'counted' movement), so a count never
// quietly rewrites the number. Fewer than recorded: the missing units come out of the batches the next sale would have
// taken (earliest expiry, then oldest). More than recorded: the extra units go in as a batch of their own, at the
// product's current cost, marked as found in a count. Units held for paid orders are never counted away: a count
// below what's held is refused, since those units are spoken for (the orders would have to be shorted first).
import { depleteBatchesFIFO } from './retail-orders';
import { buildEntry } from './stock-ledger';
import { variantIdsOf } from './variants';

export type CountResult = { ok: true; delta: number; totalStock: number } | { ok: false; error: string };

/** The item after a count (pure): its new total, its batches, and how far off the record was. The batches are brought
 *  to the count too, from what they hold (not from the total), since fulfilment and returns work the total out again
 *  from the batches: a count that left them disagreeing would be quietly undone by the next sale. */
export function applyCount(item: any, counted: number, now = new Date().toISOString(), id = `count-${Date.now().toString(36)}`): { totalStock: number; batches?: any[]; delta: number; changed: boolean } {
  const was = Math.max(0, Number(item?.totalStock) || 0);
  const n = Math.max(0, Math.floor(Number(counted) || 0));
  const delta = n - was;
  const batches = Array.isArray(item?.batches) ? item.batches : [];
  const held = batches.reduce((a: number, b: any) => a + Math.max(0, Number(b?.stock) || 0), 0);
  const gap = n - held;
  const found = (k: number) => ({ id, stock: k, costPerUnit: Number(item?.costPerUnit) || Number([...batches].sort((x: any, y: any) => String(y.receivedDate || '').localeCompare(String(x.receivedDate || '')))[0]?.costPerUnit) || 0, receivedDate: now, note: 'Found in a count' });
  if (gap < 0) {
    const { batches: left } = depleteBatchesFIFO(batches, -gap);
    return { totalStock: n, batches: JSON.parse(JSON.stringify(left)), delta, changed: true };
  }
  if (gap > 0) return { totalStock: n, batches: [...JSON.parse(JSON.stringify(batches)), found(gap)], delta, changed: true };
  return { totalStock: n, delta, changed: delta !== 0 };
}

/** Records a count on the server, in one step with the product, as the person who counted. */
export async function recordCount(db: any, tenantId: string, productId: string, counted: unknown, actor: { id: string; name: string }): Promise<CountResult> {
  const n = typeof counted === 'number' || (typeof counted === 'string' && /^\d+$/.test(counted)) ? Math.floor(Number(counted)) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return { ok: false, error: 'Type the number you counted.' };
  const ref = db.doc(`tenants/${tenantId}/inventory/${productId}`);
  return db.runTransaction(async (tx: any) => {
    const s = await tx.get(ref); if (!s.exists) return { ok: false, error: 'That product isn’t there any more.' };
    const item: any = s.data() || {};
    if (['equipment', 'overhead'].includes(String(item.type))) return { ok: false, error: 'Equipment isn’t counted here.' };
    if (variantIdsOf(item).length) return { ok: false, error: 'This one is counted by its variants. Count each variant instead.' };
    const held = Math.max(0, Number(item.stockReserved) || 0);
    if (n < held) return { ok: false, error: `${held} ${held === 1 ? 'is' : 'are'} held for paid orders, so the shelf can’t be fewer than that. Mark the missing ones on those orders first.` };
    const next = applyCount(item, n);
    // A count that matches is still a count: when, and by whom.
    tx.update(ref, JSON.parse(JSON.stringify({ totalStock: next.totalStock, ...(next.batches ? { batches: next.batches } : {}), lastCountedAt: new Date().toISOString(), lastCountedBy: actor.name })));
    // Products used by the dose keep their history in doses (uses, or ml): a count of whole containers is recorded that way.
    const per = item.costingMethod === 'uses' ? Number(item.estimatedUses) || 0 : item.costingMethod === 'size' ? Number(item.size) || 0 : 0;
    // A count that matches is still recorded for whole-unit products: it's where the history starts adding up from again.
    if (next.delta === 0 && per > 0) return { ok: true, delta: 0, totalStock: n };
    tx.set(db.collection(`tenants/${tenantId}/stockCorrections`).doc(), buildEntry({
      productId, type: 'counted', delta: per > 0 ? next.delta * per : next.delta, field: 'totalStock',
      unit: per > 0 ? (item.costingMethod === 'uses' ? (item.useUnit || 'uses') : (item.unit || 'ml')) : (item.unit || 'units'),
      reason: `Counted: ${n} on the shelf (was ${Math.max(0, Number(item.totalStock) || 0)})`,
      actorId: actor.id, actorName: actor.name, ref: { kind: 'count', id: productId }, ...(per > 0 ? {} : { balanceAfter: n }),
    }));
    return { ok: true, delta: next.delta, totalStock: n };
  });
}
