'use client';

import {
  Firestore, collection, doc, runTransaction,
} from 'firebase/firestore';
import { nanoid } from 'nanoid';
import { buildEntry } from '@/lib/stock-ledger';

// ─── src/lib/formulas.ts ──────────────────────────────────────────────────────
// The maker's module: a Formula is a recipe — components in, finished items
// out. Producing a batch depletes each component through the FIFO batches
// (so ingredient costs are TRUE purchase costs, not guesses), adds labor if
// set, and creates a batch of the output item whose cost-per-unit is
// computed. Handmade products get honest margins everywhere downstream —
// retail, online, and reports — with zero extra bookkeeping.

export interface FormulaComponent {
  itemId: string;
  name: string;
  qty: number;           // per ONE production run
  unit: string;
}

export interface Formula {
  id: string;
  name: string;
  outputItemId: string;
  outputName: string;
  yieldQty: number;      // finished units per ONE production run
  components: FormulaComponent[];
  laborCostDollars?: number; // per run
  notes?: string;
  createdAt: string;
  lastProducedAt?: string;
}

export interface Actor { id: string; name: string; }

export const formulaCol = (fs: Firestore, t: string) => collection(fs, `tenants/${t}/formulas`);

/** Estimate current cost of one run from live FIFO batches (preview only). */
export function estimateRunCost(formula: Formula, inventory: any[]): { totalDollars: number; perUnitDollars: number; shortages: string[] } {
  let total = formula.laborCostDollars || 0;
  const shortages: string[] = [];
  for (const c of formula.components) {
    const item = inventory.find((i) => i.id === c.itemId);
    if (!item) { shortages.push(`${c.name} (missing)`); continue; }
    if ((Number(item.totalStock) || 0) < c.qty) shortages.push(`${c.name} (${item.totalStock || 0}/${c.qty})`);
    let remaining = c.qty;
    const batches = [...(item.batches || [])]
      .sort((a: any, b: any) => String(a.receivedDate || '').localeCompare(String(b.receivedDate || '')));
    for (const b of batches) {
      if (remaining <= 0) break;
      const take = Math.min(Number(b.stock) || 0, remaining);
      total += take * (Number(b.costPerUnit) || 0);
      remaining -= take;
    }
    if (remaining > 0) total += remaining * (Number(item.costPerUnit) || 0);
  }
  const units = Math.max(1, formula.yieldQty);
  return { totalDollars: total, perUnitDollars: total / units, shortages };
}

/**
 * Produce `runs` batches of the formula. Transaction: verify + FIFO-deplete
 * every component, then add one new batch on the output item at the computed
 * cost per unit. Ledger entries on both sides, so "where did the jojoba go"
 * and "why does this batch cost $3.12/unit" both have answers.
 */
export async function produce(
  fs: Firestore, tenantId: string, formula: Formula, runs: number, actor: Actor
): Promise<{ ok: boolean; message: string; unitCost?: number }> {
  if (runs <= 0) return { ok: false, message: 'Runs must be positive.' };
  try {
    return await runTransaction(fs, async (txn) => {
      // Reads first: output item + every component.
      const outRef = doc(fs, `tenants/${tenantId}/inventory`, formula.outputItemId);
      const outSnap = await txn.get(outRef);
      if (!outSnap.exists()) return { ok: false, message: 'Output item not found.' };
      const componentSnaps: { c: FormulaComponent; ref: any; item: any }[] = [];
      for (const c of formula.components) {
        const ref = doc(fs, `tenants/${tenantId}/inventory`, c.itemId);
        const snap = await txn.get(ref);
        if (!snap.exists()) return { ok: false, message: `Component ${c.name} not found.` };
        componentSnaps.push({ c, ref, item: snap.data() });
      }

      // Verify sufficiency for ALL before touching ANY.
      for (const { c, item } of componentSnaps) {
        const need = c.qty * runs;
        if ((Number(item.totalStock) || 0) < need) {
          return { ok: false, message: `Not enough ${c.name}: need ${need}, have ${item.totalStock || 0}.` };
        }
      }

      const now = new Date().toISOString();
      let totalCost = (formula.laborCostDollars || 0) * runs;

      for (const { c, ref, item } of componentSnaps) {
        let remaining = c.qty * runs;
        const batches = [...(item.batches || [])]
          .sort((a: any, b: any) => String(a.receivedDate || '').localeCompare(String(b.receivedDate || '')));
        const nextBatches = batches.map((b: any) => {
          if (remaining <= 0) return b;
          const take = Math.min(Number(b.stock) || 0, remaining);
          remaining -= take;
          totalCost += take * (Number(b.costPerUnit) || 0);
          return { ...b, stock: (Number(b.stock) || 0) - take };
        }).filter((b: any) => (Number(b.stock) || 0) > 0);
        if (remaining > 0) totalCost += remaining * (Number(item.costPerUnit) || 0);

        txn.update(ref, JSON.parse(JSON.stringify({
          batches: nextBatches,
          totalStock: Math.max(0, (Number(item.totalStock) || 0) - c.qty * runs),
        })));
        txn.set(doc(collection(fs, `tenants/${tenantId}/stockCorrections`)), buildEntry({
          productId: c.itemId,
          type: 'used',
          delta: -(c.qty * runs),
          unit: c.unit || 'units',
          reason: `Production: ${formula.name}`,
          actorId: actor.id,
          actorName: actor.name,
          ref: { kind: 'formula', id: formula.id },
          balanceAfter: Math.max(0, (Number(item.totalStock) || 0) - c.qty * runs),
        }));
      }

      const outUnits = formula.yieldQty * runs;
      const unitCost = totalCost / Math.max(1, outUnits);
      const outItem = outSnap.data() as any;
      const newBatch = {
        id: `batch-${nanoid(8)}`, stock: outUnits,
        costPerUnit: Math.round(unitCost * 100) / 100,
        receivedDate: now,
      };
      txn.update(outRef, JSON.parse(JSON.stringify({
        batches: [...(outItem.batches || []), newBatch],
        totalStock: (Number(outItem.totalStock) || 0) + outUnits,
        costPerUnit: Math.round(unitCost * 100) / 100,
      })));
      txn.set(doc(collection(fs, `tenants/${tenantId}/stockCorrections`)), buildEntry({
        productId: formula.outputItemId,
        type: 'received',
        delta: outUnits,
        unit: outItem.unit || 'units',
        reason: `Produced via ${formula.name} ($${unitCost.toFixed(2)}/unit)`,
        actorId: actor.id,
        actorName: actor.name,
        ref: { kind: 'formula', id: formula.id },
        balanceAfter: (Number(outItem.totalStock) || 0) + outUnits,
      }));
      txn.set(doc(formulaCol(fs, tenantId), formula.id), { lastProducedAt: now }, { merge: true });

      return {
        ok: true, unitCost,
        message: `${outUnits} × ${formula.outputName} produced at $${unitCost.toFixed(2)}/unit`,
      };
    });
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Production failed.' };
  }
}
