'use client';

import {
  Firestore, collection, doc, runTransaction,
} from 'firebase/firestore';
import { nanoid } from 'nanoid';
import { buildEntry } from '@/lib/stock-ledger';

// ─── src/lib/inventory-allocation.ts ──────────────────────────────────────────
// Station & provider allotments. Every unit of an item lives in exactly one
// place: the BACK-STOCK POOL, a STATION (location), or a PROVIDER (staff).
// Allocations are stored ON the item doc as a map, so every move is a
// single-document transaction — no cross-doc race conditions:
//
//   item.allocations: {
//     [holderKey]: { type: 'location'|'staff', id, name, qty, par? }
//   }
//   holderKey = `${type}:${id}`   ·   par = target amount for one-tap restock
//
// Movements never change totalStock (the units still exist); USAGE does —
// markUsed depletes the holder's allotment AND totalStock AND the FIFO
// batches, posting a Usage ledger entry, so backbar consumption carries true
// cost. Every distribute / return / use writes an actor-stamped row to
// tenants/{tid}/stockMovements: the "where did six bottles go" ledger.
//
// The retail engine's sellableStock() subtracts allocatedQty(), so the online
// shop can never sell a unit that's physically sitting at a station.

export type HolderType = 'location' | 'staff';

export interface Holder {
  type: HolderType;
  id: string;
  name: string;
}

export interface Allocation extends Holder {
  qty: number;
  par?: number;
}

export interface Actor { id: string; name: string; }

export const holderKey = (h: Holder) => `${h.type}:${h.id}`;

export function itemAllocations(item: any): Record<string, Allocation> {
  const a = item?.allocations;
  return a && typeof a === 'object' ? a : {};
}

export function allocationList(item: any): Allocation[] {
  return Object.values(itemAllocations(item)).filter((x: any) => x && (x.qty > 0 || (x.par || 0) > 0));
}

export function allocatedQty(item: any): number {
  return Object.values(itemAllocations(item)).reduce((s: number, a: any) => s + (Number(a?.qty) || 0), 0);
}

/** Units still in the back-stock pool (before retail reservations). */
export function poolQty(item: any): number {
  return Math.max(0, (Number(item?.totalStock) || 0) - allocatedQty(item));
}

const invDoc = (fs: Firestore, t: string, id: string) => doc(fs, `tenants/${t}/inventory`, id);
const moveCol = (fs: Firestore, t: string) => collection(fs, `tenants/${t}/stockMovements`);

function logMove(
  txn: any, fs: Firestore, tenantId: string,
  productId: string, productName: string, qty: number,
  from: string, to: string, kind: 'distribute' | 'return' | 'use' | 'adjust',
  actor: Actor, note?: string
) {
  txn.set(doc(moveCol(fs, tenantId)), {
    id: `mv-${nanoid(10)}`, productId, productName, qty, from, to, kind,
    actorId: actor.id, actorName: actor.name,
    at: new Date().toISOString(), note: note || '',
  });
}

/* ════════════════════════════════════════════════════════════════════════════
 * DISTRIBUTE — pool → station/provider
 * ════════════════════════════════════════════════════════════════════════════ */

export async function distribute(
  fs: Firestore, tenantId: string, productId: string,
  holder: Holder, qty: number, actor: Actor
): Promise<{ ok: boolean; message: string }> {
  if (qty <= 0) return { ok: false, message: 'Quantity must be positive.' };
  try {
    return await runTransaction(fs, async (txn) => {
      const ref = invDoc(fs, tenantId, productId);
      const snap = await txn.get(ref);
      if (!snap.exists()) return { ok: false, message: 'Item not found.' };
      const item = snap.data() as any;

      const reserved = Number(item.stockReserved) || 0;
      const availablePool = poolQty(item) - reserved;
      if (qty > availablePool) {
        return {
          ok: false,
          message: `Only ${Math.max(0, availablePool)} in back stock${reserved > 0 ? ` (${reserved} reserved for online orders)` : ''}.`,
        };
      }

      const key = holderKey(holder);
      const allocations = { ...itemAllocations(item) };
      const cur = allocations[key];
      allocations[key] = {
        type: holder.type, id: holder.id, name: holder.name,
        qty: (cur?.qty || 0) + qty,
        ...(cur?.par != null ? { par: cur.par } : {}),
      };
      txn.update(ref, { allocations: JSON.parse(JSON.stringify(allocations)) });
      logMove(txn, fs, tenantId, productId, String(item.name || 'Item'), qty, 'stock', key, 'distribute', actor);
      return { ok: true, message: `${qty} × ${item.name} → ${holder.name}` };
    });
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Could not distribute.' };
  }
}

/* ════════════════════════════════════════════════════════════════════════════
 * RETURN — station/provider → pool
 * ════════════════════════════════════════════════════════════════════════════ */

export async function returnToStock(
  fs: Firestore, tenantId: string, productId: string,
  holder: Holder, qty: number, actor: Actor
): Promise<{ ok: boolean; message: string }> {
  if (qty <= 0) return { ok: false, message: 'Quantity must be positive.' };
  try {
    return await runTransaction(fs, async (txn) => {
      const ref = invDoc(fs, tenantId, productId);
      const snap = await txn.get(ref);
      if (!snap.exists()) return { ok: false, message: 'Item not found.' };
      const item = snap.data() as any;

      const key = holderKey(holder);
      const allocations = { ...itemAllocations(item) };
      const cur = allocations[key];
      if (!cur || cur.qty < qty) {
        return { ok: false, message: `${holder.name} only holds ${cur?.qty || 0}.` };
      }
      const nextQty = cur.qty - qty;
      if (nextQty === 0 && cur.par == null) delete allocations[key];
      else allocations[key] = { ...cur, qty: nextQty };

      txn.update(ref, { allocations: JSON.parse(JSON.stringify(allocations)) });
      logMove(txn, fs, tenantId, productId, String(item.name || 'Item'), qty, key, 'stock', 'return', actor);
      return { ok: true, message: `${qty} × ${item.name} back to stock` };
    });
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Could not return to stock.' };
  }
}

/* ════════════════════════════════════════════════════════════════════════════
 * USE — consumed at a station/by a provider (depletes FIFO + totalStock)
 * ════════════════════════════════════════════════════════════════════════════ */

export async function markUsed(
  fs: Firestore, tenantId: string, productId: string,
  holder: Holder, qty: number, actor: Actor, note?: string
): Promise<{ ok: boolean; message: string }> {
  if (qty <= 0) return { ok: false, message: 'Quantity must be positive.' };
  try {
    return await runTransaction(fs, async (txn) => {
      const ref = invDoc(fs, tenantId, productId);
      const snap = await txn.get(ref);
      if (!snap.exists()) return { ok: false, message: 'Item not found.' };
      const item = snap.data() as any;

      const key = holderKey(holder);
      const allocations = { ...itemAllocations(item) };
      const cur = allocations[key];
      if (!cur || cur.qty < qty) {
        return { ok: false, message: `${holder.name} only holds ${cur?.qty || 0}.` };
      }

      // FIFO-deplete the oldest batches so the cost story stays true.
      let remaining = qty;
      let costDollars = 0;
      const batches = [...(item.batches || [])]
        .sort((a: any, b: any) => String(a.receivedDate || '').localeCompare(String(b.receivedDate || '')));
      const nextBatches = batches.map((b: any) => {
        if (remaining <= 0) return b;
        const take = Math.min(Number(b.stock) || 0, remaining);
        remaining -= take;
        costDollars += take * (Number(b.costPerUnit) || 0);
        return { ...b, stock: (Number(b.stock) || 0) - take };
      }).filter((b: any) => (Number(b.stock) || 0) > 0);
      if (remaining > 0) costDollars += remaining * (Number(item.costPerUnit) || 0);

      const nextQty = cur.qty - qty;
      if (nextQty === 0 && cur.par == null) delete allocations[key];
      else allocations[key] = { ...cur, qty: nextQty };

      txn.update(ref, JSON.parse(JSON.stringify({
        allocations,
        batches: nextBatches,
        totalStock: Math.max(0, (Number(item.totalStock) || 0) - qty),
      })));
      txn.set(doc(collection(fs, `tenants/${tenantId}/stockCorrections`)), buildEntry({
        productId,
        type: 'used',
        delta: -qty,
        unit: item.unit || 'units',
        reason: `Used at ${holder.name}${note ? ` — ${note}` : ''}`,
        actorId: actor.id,
        actorName: actor.name,
        balanceAfter: Math.max(0, (Number(item.totalStock) || 0) - qty),
      }));
      logMove(txn, fs, tenantId, productId, String(item.name || 'Item'), qty, key, 'used', 'use', actor, note);
      return { ok: true, message: `${qty} × ${item.name} used at ${holder.name} (cost $${costDollars.toFixed(2)})` };
    });
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Could not record usage.' };
  }
}

/* ════════════════════════════════════════════════════════════════════════════
 * PAR — target level per holder, and one-tap restock math
 * ════════════════════════════════════════════════════════════════════════════ */

export async function setPar(
  fs: Firestore, tenantId: string, productId: string,
  holder: Holder, par: number
): Promise<{ ok: boolean; message: string }> {
  try {
    return await runTransaction(fs, async (txn) => {
      const ref = invDoc(fs, tenantId, productId);
      const snap = await txn.get(ref);
      if (!snap.exists()) return { ok: false, message: 'Item not found.' };
      const item = snap.data() as any;
      const key = holderKey(holder);
      const allocations = { ...itemAllocations(item) };
      const cur = allocations[key];
      const clean = Math.max(0, Math.floor(par) || 0);
      if (clean === 0 && (!cur || cur.qty === 0)) delete allocations[key];
      else allocations[key] = {
        type: holder.type, id: holder.id, name: holder.name,
        qty: cur?.qty || 0, par: clean,
      };
      txn.update(ref, { allocations: JSON.parse(JSON.stringify(allocations)) });
      return { ok: true, message: `Par for ${holder.name}: ${clean}` };
    });
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Could not set par.' };
  }
}

/** Items where this holder is below par: what "Restock to par" would move. */
export function parDeficits(items: any[], holder: Holder): { item: any; need: number; have: number; par: number }[] {
  const key = holderKey(holder);
  return items
    .map((item) => {
      const a = itemAllocations(item)[key];
      if (!a || !a.par) return null;
      const need = Math.max(0, a.par - (a.qty || 0));
      return need > 0 ? { item, need, have: a.qty || 0, par: a.par } : null;
    })
    .filter(Boolean) as { item: any; need: number; have: number; par: number }[];
}
