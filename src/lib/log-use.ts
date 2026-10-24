// src/lib/log-use.ts — LOGGING A USE BY HAND (a towel, a foil, product used outside a booked visit). The same stock step
// as checkout and the provider's hand-off (lib/usage moveStock): the open container is used first, a new one is opened
// only when it runs out, and a product counted by uses or by amount with no number set is refused with the reason
// instead of losing whole containers. Recorded on the stock history as the person signed in.
import { moveStock } from './usage';
import { buildEntry } from './stock-ledger';
import { unitLabel } from './product-cost';

export type LogUseResult = { ok: true; moved: number; shortfall: number; unit: string } | { ok: false; error: string };

export async function logUse(db: any, tenantId: string, productId: string, quantity: unknown, reason: string, actor: { id: string; name: string }): Promise<LogUseResult> {
  const q = typeof quantity === 'number' || (typeof quantity === 'string' && /^\d+(\.\d+)?$/.test(quantity)) ? Number(quantity) : NaN;
  if (!Number.isFinite(q) || q <= 0 || q > 100_000) return { ok: false, error: 'Type how much was used.' };
  const ref = db.doc(`tenants/${tenantId}/inventory/${productId}`);
  return db.runTransaction(async (tx: any) => {
    const s = await tx.get(ref); if (!s.exists) return { ok: false, error: 'That product isn’t there any more.' };
    const it: any = s.data() || {};
    if (String(it.type) === 'equipment') return { ok: false, error: 'Equipment isn’t used up, so its uses aren’t logged here.' };
    const r = moveStock(it, q);
    if (r.notCounted) return { ok: false, error: `It can’t be taken off yet: ${r.notCounted}. Set it on the product’s page.` };
    const unit = unitLabel(it) === 'each' ? String(it.unit || 'units') : unitLabel(it);
    tx.update(ref, r.patch);
    tx.set(db.collection(`tenants/${tenantId}/stockCorrections`).doc(), buildEntry({
      productId, type: 'used', delta: -q, unit, reason: `${String(reason || '').trim().slice(0, 200) || 'Used'}${r.shortfall ? ` (short by ${r.shortfall} ${unit})` : ''}`,
      actorId: actor.id, actorName: actor.name, ref: { kind: 'manual', id: productId },
    } as any));
    return { ok: true, moved: r.moved, shortfall: r.shortfall, unit };
  });
}
