// src/lib/spot-check.ts — SPOT CHECKS BY A SECOND PERSON (pure; the same on the server and every screen). While the shop
// spot-checks (Setup: 1 in 10, 1 in 25 or 1 in 50 orders), each order is picked at random as it's packed, and a picked
// order goes no further (onto the ready shelf, out for delivery, a label bought or shipped) until someone other than its
// packer has scanned every unit in it again. A wrong item found, or one missing, is a mistake kept on the order and
// counted for the person who packed it (How it's going). Distribution centers audit a share of packed orders this way.
// A manager's PIN can let one go without the check (a shop with one person on, say), kept on the order with their name.
// Off unless the shop turns it on: it needs a second person.

export const SPOT_CHOICES = [10, 25, 50] as const;

/** 1 in how many orders is spot-checked: 0 when the shop doesn't spot-check. */
export function spotEvery(rs: any): number {
  const n = Math.floor(Number(rs?.spotCheckEvery) || 0);
  return (SPOT_CHOICES as readonly number[]).includes(n) ? n : 0;
}

/** Picked for a spot check as it's packed: 1 in `every`, never a pop-up order (called at its table) or a download. */
export function pickForSpot(order: any, every: number, roll: number): boolean {
  if (!(every > 0) || order?.popupId) return false;
  const lines = Array.isArray(order?.lines) ? order.lines : [];
  if (!lines.some((l: any) => l && l.digital !== true)) return false;
  return roll < 1 / every;
}

/** Waiting for its spot check. */
export const spotDue = (order: any): boolean => order?.spotCheck?.due === true;

/** The units the check scans, line by line: what's going out (shorted and refunded units aren't in the bag). */
export function spotLines(order: any): { lineId: string; name: string; need: number; got: number; missing: number }[] {
  const sc = order?.spotCheck || {};
  return (Array.isArray(order?.lines) ? order.lines : [])
    .filter((l: any) => l && l.digital !== true && !['refunded', 'backordered'].includes(String(l.status)))
    .map((l: any) => {
      const id = String(l.lineId || '');
      const need = Math.max(0, (Number(l.qtyOrdered) || 0) - (Number(l.qtyShorted) || 0));
      return { lineId: id, name: `${l.name || 'Item'}${l.optionsLabel ? `, ${l.optionsLabel}` : ''}`, need, got: Math.min(need, Number(sc.counts?.[id]) || 0), missing: Number(sc.missing?.[id]) || 0 };
    })
    .filter((l: any) => l.need > 0);
}

/** Units still to scan in the check. */
export const spotLeft = (order: any): number => spotLines(order).reduce((a, l) => a + Math.max(0, l.need - l.got), 0);

/** The mistakes the check found: wrong or extra items taken out, and items that were missing. */
export function spotMistakes(order: any): { wrong: number; missing: number } {
  const sc = order?.spotCheck || {};
  const missing = Object.values(sc.missing || {}).reduce((a: number, n: any) => a + (Number(n) || 0), 0);
  return { wrong: Number(sc.wrong) || 0, missing };
}

/** The words a spot check's result is kept in, on the order's history and How it's going. */
export function spotWords(m: any): string {
  const found = [Number(m?.wrong) > 0 ? `${m.wrong} wrong or extra` : '', Number(m?.missing) > 0 ? `${m.missing} missing` : ''].filter(Boolean).join(' and ');
  if (m?.result === 'picked') return 'Picked for a spot check';
  if (m?.result === 'empty') return 'Spot check closed: nothing left in it to check';
  if (m?.result === 'skipped') return `Spot check skipped${m.approvedBy ? `, approved by ${String(m.approvedBy)}` : ''}`;
  if (m?.result === 'fixed') return `Spot check found ${found || 'a mistake'}, fixed before it went out`;
  return 'Spot check passed: every item right';
}
