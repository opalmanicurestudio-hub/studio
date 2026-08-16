'use client';

import {
  type Firestore, collection, doc, getDocs, limit, orderBy, query, runTransaction, where,
} from 'firebase/firestore';
import { nanoid } from 'nanoid';

import { buildEvent, codesMatch, parseProductQr } from '@/lib/retail-orders';

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
  scanned?: Record<string, number>;
  scannedByTote?: Record<string, Record<string, number>>;
  toteClaims?: Record<string, { staffId: string; staffName: string; at: string }>;
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

      const waveName = opts.name
        || `Wave ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;

      txn.set(doc(waveCol(fs, tenantId), waveId), JSON.parse(JSON.stringify({
        id: waveId,
        tenantId,
        name: waveName,
        status: 'picking',
        createdAt: now,
        createdBy: actor.name,
        cutoffAt: opts.cutoffAt,
        orders,
        pickedProductIds: [],
      })));

      orders.forEach((w) => {
        const oRef = doc(fs, `tenants/${tenantId}/retailOrders`, w.orderId);
        txn.update(oRef, { waveId, waveTote: w.tote });
        // AUDIT LINK. Without this an order's timeline jumps from
        // payment_confirmed straight to packed, and nothing on the ORDER says
        // how it reached a bench. The wave doc knew; the order did not. Same
        // buildEvent shape as every engine event, so the timeline renders it
        // with no special case, and meta carries enough to reconstruct the
        // wave from the order alone.
        txn.set(doc(collection(oRef, 'events')), JSON.parse(JSON.stringify({
          id: `ev-${nanoid(10)}`,
          ...buildEvent('note', actor.id, actor.name, {
            kind: 'wave_assigned',
            waveId,
            waveTote: w.tote,
            text: `Added to ${waveName} · tote ${w.tote}`,
          }),
        })));
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
    const scanned = { ...((snap.data() as any).scanned || {}) };
    const scannedByTote = { ...((snap.data() as any).scannedByTote || {}) };
    if (!picked) {
      delete scanned[productId];
      for (const k of Object.keys(scannedByTote)) {
        if (scannedByTote[k] && scannedByTote[k][productId] !== undefined) {
          const bucket = { ...scannedByTote[k] };
          delete bucket[productId];
          scannedByTote[k] = bucket;
        }
      }
    }
    txn.update(ref, { pickedProductIds: next, scanned, scannedByTote });
  });
}

// ─── Scan-to-tote: the PUT model ──────────────────────────────────────────────
// A pick is not one fact but two: WHICH ITEM and WHICH TOTE. The first version
// of this gate answered the second question with a global fill order (tote 1
// fills first) — right for one picker, wrong the moment two people share a
// wave, because the order the SYSTEM fills in is not the order two pairs of
// hands do. So the unit of truth is now a PUT: (tote, product), validated
// against what that tote still needs. Both scan orders express it:
//
//   tote-first  — scan a tote label once, then beep items into it; each beep
//                 is one unit for THAT tote. This claims the tote, so two
//                 pickers each own their bins and never collide.
//   item-first  — beep an item with no tote active and the screen answers
//                 "goes to tote N" and waits for the tote scan (or a tap on
//                 its chip) to confirm the drop. Put-verified, either order.
//
// The printed tote labels already carry the order QR, so the label in the bin
// IS the tote scan — no new paper. The pick sheet's per-row tote split is the
// same residual-needs math, so paper and screen can never disagree.

export interface TotePutHit {
  ok: true;
  tote: number;
  productId: string;
  name: string;
  putInTote: number;   // units of this product now in this tote
  toteNeed: number;    // units of this product this tote wants in total
  toteDone: boolean;   // this tote has everything it needs
  rowComplete: boolean; // this product is fully picked across all totes
}
export interface TotePutMiss {
  ok: false;
  reason: 'no_match' | 'not_needed_in_tote' | 'row_complete';
  message: string;
  /** For not_needed_in_tote: the totes that DO still need this item. */
  totesNeedingIt?: number[];
}

/** What each tote still needs, derived from the same rows the pick sheet
 *  prints — one source of residual truth for paper and screen. */
export function toteResiduals(
  rows: PickRow[],
  scannedByTote: Record<string, Record<string, number>>,
): Record<number, Record<string, number>> {
  const out: Record<number, Record<string, number>> = {};
  for (const r of rows) {
    for (const t of r.totes) {
      const have = Math.max(0, Number(scannedByTote[String(t.tote)]?.[r.productId]) || 0);
      const left = Math.max(0, t.qty - have);
      if (!out[t.tote]) out[t.tote] = {};
      out[t.tote][r.productId] = left;
    }
  }
  return out;
}

/** The lowest tote that still needs this product — the suggestion shown in
 *  item-first flow. Guidance, never law: any tote with residual need accepts. */
export function suggestTote(
  rows: PickRow[],
  scannedByTote: Record<string, Record<string, number>>,
  productId: string,
): number | null {
  const res = toteResiduals(rows, scannedByTote);
  const totes = Object.keys(res).map(Number).sort((a, b) => a - b);
  for (const t of totes) {
    if ((res[t][productId] || 0) > 0) return t;
  }
  return null;
}

/** Resolve a scanned value to a tote of THIS wave. Accepts the order QR the
 *  printed tote labels already carry, plus typed forms for a damaged label. */
export function parseToteScan(value: string, wave: Wave): number | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const m = raw.match(/^clarityflow:\/\/order\/(.+)$/i);
  if (m) {
    const hit = (wave.orders || []).find((o) => o.orderId === m[1]);
    return hit ? hit.tote : null;
  }
  const t = raw.match(/^(?:tote[:\s#-]*|t)(\d{1,3})$/i);
  if (t) {
    const n = Number(t[1]);
    return (wave.orders || []).some((o) => o.tote === n) ? n : null;
  }
  return null;
}

/** Resolve an item code against the wave's rows (barcode, SKU, product QR). */
export function matchWaveItem(
  rows: PickRow[],
  value: string,
  codesForProduct: Map<string, string[]>,
): PickRow | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const qrId = parseProductQr(raw);
  return rows.find((r) =>
    (qrId !== null && qrId === r.productId)
    || (codesForProduct.get(r.productId) || []).some((c) => codesMatch(c, raw))
  ) || null;
}

/** One put, validated: does THIS tote still need THIS item? */
export function wavePut(
  rows: PickRow[],
  scannedByTote: Record<string, Record<string, number>>,
  tote: number,
  itemValue: string,
  codesForProduct: Map<string, string[]>,
): TotePutHit | TotePutMiss {
  const row = matchWaveItem(rows, itemValue, codesForProduct);
  if (!row) {
    return { ok: false, reason: 'no_match', message: 'Not on this pick list — put it back.' };
  }

  const res = toteResiduals(rows, scannedByTote);
  const needHere = res[tote]?.[row.productId] || 0;

  if (needHere <= 0) {
    const elsewhere = Object.keys(res).map(Number).sort((a, b) => a - b)
      .filter((t) => (res[t][row.productId] || 0) > 0);
    if (elsewhere.length === 0) {
      return {
        ok: false, reason: 'row_complete',
        message: `${row.name} is fully picked — put the extra back.`,
      };
    }
    return {
      ok: false, reason: 'not_needed_in_tote',
      message: `Tote ${tote} doesn\u2019t need ${row.name} — tote${elsewhere.length > 1 ? 's' : ''} ${elsewhere.join(', ')} still ${elsewhere.length > 1 ? 'do' : 'does'}.`,
      totesNeedingIt: elsewhere,
    };
  }

  const toteRow = row.totes.find((t) => t.tote === tote)!;
  const inToteNow = Math.max(0, Number(scannedByTote[String(tote)]?.[row.productId]) || 0) + 1;

  const resAfter = { ...res, [tote]: { ...res[tote], [row.productId]: needHere - 1 } };
  const toteDone = Object.values(resAfter[tote]).every((n) => n <= 0);
  const rowLeft = row.totes.reduce((a, t) => a + Math.max(0, resAfter[t.tote][row.productId] || 0), 0);
  const rowComplete = rowLeft <= 0;

  return {
    ok: true,
    tote,
    productId: row.productId,
    name: row.name,
    putInTote: inToteNow,
    toteNeed: toteRow.qty,
    toteDone,
    rowComplete,
  };
}

/** Persist one put. Caps per (tote, product) inside the transaction so two
 *  guns racing on the same bin can never overcount; keeps the aggregate
 *  `scanned` in step; ticks the row when the aggregate reaches its total. */
export async function recordWavePut(
  fs: Firestore, tenantId: string, waveId: string,
  tote: number, productId: string, toteNeed: number, totalQty: number,
): Promise<void> {
  await runTransaction(fs, async (txn) => {
    const ref = doc(waveCol(fs, tenantId), waveId);
    const snap = await txn.get(ref);
    if (!snap.exists()) return;
    const data = snap.data() as any;
    const byTote = { ...(data.scannedByTote || {}) };
    const bucket = { ...(byTote[String(tote)] || {}) };
    const curTote = Math.max(0, Number(bucket[productId]) || 0);
    if (curTote >= toteNeed) return;
    bucket[productId] = curTote + 1;
    byTote[String(tote)] = bucket;

    const scanned = { ...(data.scanned || {}) };
    const agg = Math.min(totalQty, Math.max(0, Number(scanned[productId]) || 0) + 1);
    scanned[productId] = agg;

    const pickedProductIds: string[] = data.pickedProductIds || [];
    txn.update(ref, {
      scannedByTote: byTote,
      scanned,
      ...(agg >= totalQty && !pickedProductIds.includes(productId)
        ? { pickedProductIds: [...pickedProductIds, productId] }
        : {}),
    });
  });
}

/** Claim a tote (scan its label or tap its chip). Claiming your own tote
 *  again releases it. Someone else's claim refuses unless forced (leads) —
 *  ownership is a coordination hint with an override, not a lock that
 *  deadlocks when somebody goes to lunch. */
export async function claimTote(
  fs: Firestore, tenantId: string, waveId: string,
  tote: number, staff: { id: string; name: string }, force = false,
): Promise<{ ok: boolean; message?: string; released?: boolean }> {
  try {
    return await runTransaction(fs, async (txn) => {
      const ref = doc(waveCol(fs, tenantId), waveId);
      const snap = await txn.get(ref);
      if (!snap.exists()) return { ok: false, message: 'Wave not found.' };
      const claims = { ...((snap.data() as any).toteClaims || {}) };
      const key = String(tote);
      const cur = claims[key];
      if (cur && cur.staffId === staff.id) {
        delete claims[key];
        txn.update(ref, { toteClaims: claims });
        return { ok: true, released: true };
      }
      if (cur && cur.staffId !== staff.id && !force) {
        return { ok: false, message: `${cur.staffName} is filling tote ${tote}.` };
      }
      claims[key] = { staffId: staff.id, staffName: staff.name, at: new Date().toISOString() };
      txn.update(ref, { toteClaims: claims });
      return { ok: true };
    });
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Could not claim that tote.' };
  }
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
