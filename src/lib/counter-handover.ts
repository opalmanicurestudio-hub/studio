// src/lib/counter-handover.ts — A CAR HANDED OVER, in one step (server; api/counter 'move' to gone, and the exit
// sensor: lib/lane-entry-server). The car leaves the lane (with when, and who or what handed it over), its order is done
// (or canceled, if nothing was ever sent), and whatever the kitchen hadn't marked served is now; an order placed ahead
// going with it, the same. Inside the caller's transaction, after every read. An order that goes with bags whose labels
// weren't all scanned (the exit sensor saw it leave, or the business doesn't scan: lib/food-bags) says so, with who or
// what let it go, so a scan check that was passed by is never silent.
import { bagsOf } from '@/lib/food-bags';

/** Bags with a code to scan, not all scanned and not let go by a manager: who or what handed it over anyway. */
function unscanned(o: any, by: string, at: string): Record<string, unknown> {
  const b = bagsOf(o);
  return b && b.coded && !b.skipped && b.scanned.length < b.count ? { bags: { unscanned: { by: String(by || '').slice(0, 60), at, left: b.count - b.scanned.length } } } : {};
}

export function handOverInTx(tx: any, db: any, T: string, x: {
  carRef: any; car: any; order: any | null; tix: any[]; aheadRef: any | null; aheadTix: any[]; by: string; nowIso: string;
  /** The order placed ahead going with it, as read (for its bags). */
  aheadOrder?: any | null;
  /** The car's spot when it's parked instead (forward); not used for a handover. */
  extra?: Record<string, unknown>;
}): void {
  const { carRef, car, order, tix, aheadRef, aheadTix, by, nowIso } = x;
  tx.set(carRef, { stage: 'gone', stageAt: { ...(car.stageAt || {}), gone: nowIso }, goneAt: nowIso, handedBy: by, ...(!order || order.status === 'building' ? { left: true } : {}), ...(x.extra || {}) }, { merge: true });
  if (order) {
    // (A number left for a ready text that never went goes with it: lib/ready-text.)
    tx.set(db.doc(`${T}/counterOrders/${car.orderId}`), { status: order.status === 'building' ? 'cancelled' : 'done', doneAt: nowIso, ...(order.readyText?.to ? { readyText: { to: null, pendingSince: null } } : {}), ...unscanned(order, by, nowIso) }, { merge: true });
    // Handed over: whatever the kitchen hadn't marked served is now.
    for (const d of tix) { const t: any = d.data() || {}; if (t.status !== 'delivered' && t.status !== 'cancelled') tx.set(d.ref, { status: 'delivered', deliveredAt: nowIso, deliveredBy: { name: by, via: 'lane' } }, { merge: true }); }
  }
  // …and the order placed ahead with it, the same.
  if (aheadRef) {
    tx.set(aheadRef, { status: 'done', doneAt: nowIso, ...(x.aheadOrder ? unscanned(x.aheadOrder, by, nowIso) : {}) }, { merge: true });
    for (const d of aheadTix) { const t: any = d.data() || {}; if (t.status !== 'delivered' && t.status !== 'cancelled') tx.set(d.ref, { status: 'delivered', deliveredAt: nowIso, deliveredBy: { name: by, via: 'lane' } }, { merge: true }); }
  }
}
