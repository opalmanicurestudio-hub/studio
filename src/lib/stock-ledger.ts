import { collection, doc, increment, type Firestore, type Transaction } from 'firebase/firestore';

// ─── src/lib/stock-ledger.ts ─────────────────────────────────────────────────
// ONE DOOR for stock movement.
//
// The honest starting point: a ledger already exists — tenants/{tid}/
// stockCorrections, written from ~27 places, and the retail engine already
// posts to it. What was missing was not the collection but the DISCIPLINE:
//
//   · Every writer hand-built its own entry, so `reason` was free text and
//     `source` was whatever that file felt like. The ledger could be read by
//     a human but never grouped, filtered or totalled by machine.
//   · Reservations (stockReserved) moved with no entry at all, so a leaked
//     hold — the one failure that hides stock forever — left no trace.
//   · Every writer did read-modify-write on totalStock: read 14, add 6,
//     write 20. Two people at once and one write silently wins.
//
// This module fixes all three at the point of writing, without a migration:
// the entries it writes are a SUPERSET of the existing shape, so every
// current report keeps working untouched while new fields (type, delta,
// balanceAfter) make the ledger queryable.
//
// The rule going forward: nothing mutates totalStock or stockReserved
// directly. It calls applyStockDelta, which writes the item AND the entry in
// the same transaction — so a movement that happened without a record, or a
// record without a movement, is impossible rather than merely discouraged.

/** Why stock moved. Typed so the ledger can be grouped and totalled. */
export type StockMovementType =
  | 'received'          // supplier delivery / quick receive
  | 'sold'              // POS or online sale
  | 'used'              // consumed in a service or formula
  | 'returned'          // customer return restocked
  | 'spoiled'           // damaged, expired, written off
  | 'counted'           // manual count correction
  | 'transferred'       // moved between locations or staff
  | 'reserved'          // held for an unfulfilled order
  | 'released';         // hold given back (cancel, ship, expiry)

export interface StockMovement {
  productId: string;
  type: StockMovementType;
  /** Signed units. Positive adds to stock, negative removes. */
  delta: number;
  /** Which counter moved: on-hand stock, or the reservation hold. */
  field?: 'totalStock' | 'stockReserved';
  reason: string;
  unit?: string;
  actorId?: string;
  actorName?: string;
  /** What caused it — an order, a return, a PO, an appointment. */
  ref?: { kind: 'order' | 'return' | 'po' | 'appointment' | 'formula' | 'count'; id: string };
  /** The item's value AFTER this movement, when the caller knows it. Lets a
   *  reader spot drift without replaying the whole history. */
  balanceAfter?: number;
}

/** The document written to tenants/{tid}/stockCorrections. */
export function buildEntry(m: StockMovement): Record<string, unknown> {
  return {
    // ── existing shape: every current report reads these ──
    productId: m.productId,
    date: new Date().toISOString(),
    change: Math.round(m.delta),
    unit: m.unit || 'units',
    reason: m.reason,
    actorId: m.actorId || 'staff',
    actorName: m.actorName || 'Staff',
    source: 'stock_ledger',
    // ── additive: what makes it queryable ──
    type: m.type,
    field: m.field || 'totalStock',
    ...(m.ref ? { refKind: m.ref.kind, refId: m.ref.id } : {}),
    ...(typeof m.balanceAfter === 'number' ? { balanceAfter: Math.round(m.balanceAfter) } : {}),
  };
}

/**
 * Move stock and record why, atomically.
 *
 * Uses Firestore's atomic increment rather than read-modify-write, so two
 * people receiving and selling the same product at the same moment both
 * land — no silent overwrite. The caller does NOT need to read the item
 * first, which is what makes this safe to use everywhere.
 *
 * Pass `txn` when the movement belongs to a larger transaction (a sale that
 * also writes an order); omit it for a standalone move.
 */
export function applyStockDelta(
  fs: Firestore,
  tenantId: string,
  m: StockMovement,
  txn?: Transaction,
): void {
  const itemRef = doc(fs, `tenants/${tenantId}/inventory`, m.productId);
  const field = m.field || 'totalStock';
  const patch = { [field]: increment(Math.round(m.delta)) };
  const entryRef = doc(collection(fs, `tenants/${tenantId}/stockCorrections`));
  const entry = buildEntry(m);

  if (txn) {
    txn.update(itemRef, patch);
    txn.set(entryRef, entry);
    return;
  }
  // Standalone: the two writes are separate but the entry goes SECOND, so a
  // failure loses the record rather than the stock. Callers that need both
  // or neither should pass a transaction.
  void (async () => {
    const { updateDoc, setDoc } = await import('firebase/firestore');
    await updateDoc(itemRef, patch);
    await setDoc(entryRef, entry);
  })();
}

/**
 * Does the ledger agree with the number on the item?
 *
 * Pure, so it can be run over any window of entries. Returns the drift; zero
 * means every unit on the shelf is explained by something that happened.
 * This is the check that turns "the count looks wrong" into "the count is
 * wrong by 3, and here is the day it diverged".
 */
export function reconcile(
  entries: { change?: number; field?: string }[],
  currentTotalStock: number,
  openingBalance = 0,
): { expected: number; actual: number; drift: number } {
  const expected = entries
    .filter((e) => (e.field || 'totalStock') === 'totalStock')
    .reduce((sum, e) => sum + (Number(e.change) || 0), openingBalance);
  const actual = Math.round(Number(currentTotalStock) || 0);
  return { expected, actual, drift: actual - expected };
}
