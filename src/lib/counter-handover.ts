// src/lib/counter-handover.ts — A CAR HANDED OVER, in one step (server; api/counter 'move' to gone, and the exit
// sensor: lib/lane-entry-server). The car leaves the lane (with when, and who or what handed it over), its order is done
// (or canceled, if nothing was ever sent), and whatever the kitchen hadn't marked served is now; an order placed ahead
// going with it, the same. Inside the caller's transaction, after every read.

export function handOverInTx(tx: any, db: any, T: string, x: {
  carRef: any; car: any; order: any | null; tix: any[]; aheadRef: any | null; aheadTix: any[]; by: string; nowIso: string;
  /** The car's spot when it's parked instead (forward); not used for a handover. */
  extra?: Record<string, unknown>;
}): void {
  const { carRef, car, order, tix, aheadRef, aheadTix, by, nowIso } = x;
  tx.set(carRef, { stage: 'gone', stageAt: { ...(car.stageAt || {}), gone: nowIso }, goneAt: nowIso, handedBy: by, ...(!order || order.status === 'building' ? { left: true } : {}), ...(x.extra || {}) }, { merge: true });
  if (order) {
    // (A number left for a ready text that never went goes with it: lib/ready-text.)
    tx.set(db.doc(`${T}/counterOrders/${car.orderId}`), { status: order.status === 'building' ? 'cancelled' : 'done', doneAt: nowIso, ...(order.readyText?.to ? { readyText: { to: null, pendingSince: null } } : {}) }, { merge: true });
    // Handed over: whatever the kitchen hadn't marked served is now.
    for (const d of tix) { const t: any = d.data() || {}; if (t.status !== 'delivered' && t.status !== 'cancelled') tx.set(d.ref, { status: 'delivered', deliveredAt: nowIso, deliveredBy: { name: by, via: 'lane' } }, { merge: true }); }
  }
  // …and the order placed ahead with it, the same.
  if (aheadRef) {
    tx.set(aheadRef, { status: 'done', doneAt: nowIso }, { merge: true });
    for (const d of aheadTix) { const t: any = d.data() || {}; if (t.status !== 'delivered' && t.status !== 'cancelled') tx.set(d.ref, { status: 'delivered', deliveredAt: nowIso, deliveredBy: { name: by, via: 'lane' } }, { merge: true }); }
  }
}
