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

/** UNITS A REPORTED PROBLEM COVERS. A report waiting for a decision holds its units, so they can't be returned for a
 *  refund at the same time; an approved one has settled them (qtyClaimed on the line; an approval from before that was
 *  kept counts from the report itself). "It never arrived" covers every unit on the order. A declined report covers
 *  nothing. */
export function claimedUnits(claims: any[], line: any): number {
  let waiting = 0; let decided = 0;
  const all = Math.max(0, Math.floor(Number(line?.qtyOrdered) || 0) - Math.floor(Number(line?.qtyShorted) || 0));
  for (const c of claims || []) {
    const st = String(c?.status || '');
    if (!['in_review', 'auto_resolved', 'resolved'].includes(st)) continue;
    const covers = !c?.lineId ? all : c.lineId === line?.lineId ? Math.max(1, Math.floor(Number(c.qty) || 1)) : 0;
    if (st === 'in_review') waiting += covers; else decided += covers;
  }
  return Math.max(Math.floor(Number(line?.qtyClaimed) || 0), decided) + waiting;
}
