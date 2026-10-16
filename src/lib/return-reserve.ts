// src/lib/return-reserve.ts — UNITS ALREADY ON THEIR WAY BACK. An order line's qtyReturned only grows when an item
// is received, so a second return opened before the first arrives could ask for the same units again (and be
// refunded twice). These units count against what can still be returned.
export function reservedByOpenReturns(returns: any[], lineId: string): number {
  let n = 0;
  for (const r of returns || []) {
    if (['resolved', 'rejected', 'cancelled', 'canceled'].includes(String(r?.status || ''))) continue;
    for (const l of r?.lines || []) if (l?.lineId === lineId && !l?.disposition) n += Math.max(0, Math.floor(Number(l.qty) || 0));
  }
  return n;
}
