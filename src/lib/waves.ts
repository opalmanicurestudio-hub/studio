'use client';

import {
  type Firestore, collection, doc, getDocs, limit, orderBy, query, runTransaction, where,
} from 'firebase/firestore';
import { nanoid } from 'nanoid';

// ─── src/lib/waves.ts ─────────────────────────────────────────────────────────
// Wave picking: pick everything at once by product, then sort into orders at a
// bench. Picking time scales with SHELF VISITS, packing time scales with
// ORDERS — separating them lets each scale on its own, which is the whole
// reason fulfilment centres work this way.
//
// The rules that keep it honest:
//   • Wave membership is chosen strictly by when an order arrived. No
//     cherry-picking the small ones.
//   • A wave is FROZEN at build time. Orders that land afterwards go to the
//     next wave rather than silently changing a sheet someone is holding.
//   • Every order gets a TOTE NUMBER. Bulk-picking six oils is useless if you
//     cannot tell which oil belongs in which box, so the sort happens while
//     walking rather than as a second puzzle at the bench.
//   • Shipping labels are NOT part of this. Weights are not final until a box
//     is packed, and a label printed early is a label voided later.

export interface WaveOrder {
  orderId: string;
  orderNumber: number;
  tote: number;
  receivedAt: string;
  customerName: string;
  method: string;
  itemCount: number;
  packed?: boolean;
}

export interface Wave {
  id: string;
  tenantId: string;
  name: string;
  status: 'picking' | 'packing' | 'done' | 'cancelled';
  createdAt: string;
  createdBy: string;
  cutoffAt: string;
  orders: WaveOrder[];
  pickedProductIds?: string[];
}

export interface PickRow {
  productId: string;
  name: string;
  location: string;
  totalQty: number;
  totes: { tote: number; qty: number }[];
  picked?: boolean;
}

export interface Actor { id: string; name: string; }

export const waveCol = (fs: Firestore, tenantId: string) => collection(fs, `tenants/${tenantId}/waves`);

/** Orders eligible for a wave: paid, unclaimed, not already in one, before the cutoff. */
export function eligibleForWave(orders: any[], cutoffAt: string): any[] {
  return orders
    .filter((o) => o.stage === 'paid')
    .filter((o) => !o.batchId && !o.waveId)
    .filter((o) => o.holdUntilRestock !== true)
    .filter((o) => String(o.paidAt || o.placedAt || '') <= cutoffAt)
    // FIFO, always: the order things arrived is the order they are worked.
    .sort((a, b) => String(a.paidAt || a.placedAt || '').localeCompare(String(b.paidAt || b.placedAt || '')));
}

/**
 * Build a wave. Totes are numbered 1..n in arrival order, so tote 1 is always
 * the order that has waited longest — the number itself carries the priority.
 */
export async function buildWave(
  fs: Firestore,
  tenantId: string,
  candidates: any[],
  opts: { maxTotes: number; cutoffAt: string; name?: string },
  actor: Actor
): Promise<{ ok: boolean; message: string; waveId?: string }> {
  const chosen = eligibleForWave(candidates, opts.cutoffAt).slice(0, Math.max(1, opts.maxTotes));
  if (chosen.length === 0) {
    return { ok: false, message: 'No orders are waiting that were placed before the cutoff.' };
  }

  const waveId = `wave-${nanoid(8)}`;
  const now = new Date().toISOString();
  const orders: WaveOrder[] = chosen.map((o, i) => ({
    orderId: o.id,
    orderNumber: Number(o.orderNumber) || 0,
    tote: i + 1,
    receivedAt: String(o.paidAt || o.placedAt || now),
    customerName: String(o.customerName || 'Guest'),
    method: String(o.method || 'pickup'),
    itemCount: (o.lines || []).reduce(
      (a: number, l: any) => a + Math.max(0, (l.qtyOrdered || 0) - (l.qtyShorted || 0)), 0
    ),
  }));

  try {
    await runTransaction(fs, async (txn) => {
      // Reads first: confirm nothing was claimed while the manager was deciding.
      const snaps = await Promise.all(
        orders.map((w) => txn.get(doc(fs, `tenants/${tenantId}/retailOrders`, w.orderId)))
      );
      snaps.forEach((snap, i) => {
        const data = snap.data() as any;
        if (!snap.exists() || data?.stage !== 'paid' || data?.batchId || data?.waveId) {
          throw new Error(`Order #${String(orders[i].orderNumber).padStart(4, '0')} was taken while the wave was being built — try again.`);
        }
      });

      txn.set(doc(waveCol(fs, tenantId), waveId), JSON.parse(JSON.stringify({
        id: waveId,
        tenantId,
        name: opts.name || `Wave ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`,
        status: 'picking',
        createdAt: now,
        createdBy: actor.name,
        cutoffAt: opts.cutoffAt,
        orders,
        pickedProductIds: [],
      })));

      orders.forEach((w) => {
        txn.update(doc(fs, `tenants/${tenantId}/retailOrders`, w.orderId), {
          waveId, waveTote: w.tote,
        });
      });
    });

    return { ok: true, waveId, message: `${orders.length} orders in the wave — totes 1 to ${orders.length}.` };
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Could not build the wave.' };
  }
}

/**
 * The consolidated pick list: one row per product, with the tote numbers each
 * unit belongs to. Sorted by location so the sheet reads like a route through
 * the room rather than a shopping list.
 */
export function pickList(
  wave: Wave,
  ordersById: Map<string, any>,
  shelfFor: Map<string, string>
): PickRow[] {
  const rows = new Map<string, PickRow>();

  wave.orders.forEach((w) => {
    const order = ordersById.get(w.orderId);
    (order?.lines || []).forEach((l: any) => {
      const open = Math.max(0, (l.qtyOrdered || 0) - (l.qtyShorted || 0));
      if (open <= 0) return;
      const key = String(l.productId);
      const row = rows.get(key) || {
        productId: key,
        name: String(l.name || 'Item'),
        location: shelfFor.get(key) || '',
        totalQty: 0,
        totes: [],
      };
      row.totalQty += open;
      row.totes.push({ tote: w.tote, qty: open });
      rows.set(key, row);
    });
  });

  return [...rows.values()].sort((a, b) => {
    const al = a.location || 'zzz';
    const bl = b.location || 'zzz';
    return al.localeCompare(bl) || b.totalQty - a.totalQty || a.name.localeCompare(b.name);
  });
}

/** Totals for the wave header — what the walk actually costs. */
export function waveSummary(rows: PickRow[], wave: Wave) {
  const locations = new Set(rows.map((r) => r.location || 'unassigned'));
  return {
    orders: wave.orders.length,
    products: rows.length,
    units: rows.reduce((a, r) => a + r.totalQty, 0),
    stops: locations.size,
    packed: wave.orders.filter((o) => o.packed).length,
  };
}

/** Mark a product row picked — progress survives a dropped signal or a reload. */
export async function markRowPicked(
  fs: Firestore, tenantId: string, waveId: string, productId: string, picked: boolean
): Promise<void> {
  await runTransaction(fs, async (txn) => {
    const ref = doc(waveCol(fs, tenantId), waveId);
    const snap = await txn.get(ref);
    if (!snap.exists()) return;
    const current: string[] = (snap.data() as any).pickedProductIds || [];
    const next = picked
      ? [...new Set([...current, productId])]
      : current.filter((id) => id !== productId);
    txn.update(ref, { pickedProductIds: next });
  });
}

/** Wave moves to the bench once the shelves have been walked. */
export async function setWaveStatus(
  fs: Firestore, tenantId: string, waveId: string, status: Wave['status']
): Promise<void> {
  await runTransaction(fs, async (txn) => {
    const ref = doc(waveCol(fs, tenantId), waveId);
    const snap = await txn.get(ref);
    if (!snap.exists()) return;
    txn.update(ref, { status });
  });
}

/** Recent waves, newest first. */
export async function recentWaves(fs: Firestore, tenantId: string, max = 10): Promise<Wave[]> {
  const snap = await getDocs(query(waveCol(fs, tenantId), orderBy('createdAt', 'desc'), limit(max)));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Wave[];
}

/** Orders still open in a wave, in tote order — the packing queue. */
export function packQueue(wave: Wave, ordersById: Map<string, any>): WaveOrder[] {
  return wave.orders
    .filter((w) => {
      const o = ordersById.get(w.orderId);
      return !o || !['handed_off', 'shipped', 'completed', 'cancelled', 'refunded'].includes(String(o.stage));
    })
    .sort((a, b) => a.tote - b.tote);
}
