// src/lib/weight-check.ts — THE WEIGHT CHECK AT PACKING (pure). A box's weight on the scale says whether what's in it is
// right, the way shipping lines weigh every parcel before its label goes on: weighed against what its items and the box
// itself should weigh, a box that's off by more than a little (2 oz, or a tenth of what it should weigh) is held for
// someone to open it and look before its label is bought, and that look is kept on the order. It only works when every
// product in the box has its weight saved; without them, the box's weight is worked out instead and there's nothing
// to check. A shop can ask for every box to be weighed before its label (Setup, `weighEveryBox`).

export const weighEveryBox = (rs: any): boolean => rs?.weighEveryBox === true;

/** Going in the box: not a download, not refunded, not sent later (backordered). */
export const inTheBox = (l: any): boolean => !!l && l.digital !== true && !['refunded', 'backordered'].includes(String(l.status));

/** What the items going out weigh, from each product's saved weight (a color's own, else its listing's); `known` only
 *  when every one of them has one. */
export function itemsWeight(lines: any[], inventory: any[]): { oz: number; known: boolean; missing: string[] } {
  const byId = new Map((inventory || []).map((i: any) => [String(i.id), i]));
  let oz = 0; const missing: string[] = [];
  for (const l of lines || []) {
    if (!inTheBox(l)) continue;
    const n = Math.max(0, (Number(l.qtyOrdered) || 0) - (Number(l.qtyShorted) || 0)); if (!n) continue;
    const it: any = byId.get(String(l.productId));
    const w = Number(it?.weightOz) > 0 ? Number(it.weightOz) : Number(byId.get(String(it?.parentId ?? ''))?.weightOz);
    if (w > 0) oz += w * n; else missing.push(String(l.name || 'An item'));
  }
  return { oz, known: missing.length === 0, missing };
}

/** How far a box may be from what it should weigh: 2 oz, or a tenth of that weight when that's more. */
export const weightTolerance = (expectedOz: number): number => Math.max(2, Math.round(Math.max(0, expectedOz) * 0.1));

/** How much a weighed box is off from what it should weigh, when that's more than the tolerance (+ heavier, − lighter);
 *  null when it's within it. */
export function weightOff(weighedOz: number, expectedOz: number): number | null {
  if (!(weighedOz > 0) || !(expectedOz > 0)) return null;
  const d = Math.round(weighedOz - expectedOz);
  return Math.abs(d) > weightTolerance(expectedOz) ? d : null;
}

/** "1 lb 2 oz", "12 oz". */
export const ozWords = (oz: number): string => { const n = Math.max(0, Math.round(oz)); const lb = Math.floor(n / 16); return lb ? `${lb} lb${n % 16 ? ` ${n % 16} oz` : ''}` : `${n} oz`; };
