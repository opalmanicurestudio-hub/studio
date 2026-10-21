// src/lib/label-doubt.ts — A LABEL THAT MAY NO LONGER WORK. Pure, so the server and the browser share one answer.
// Until it's sorted, the label can't be marked shipped (lib/retail-fulfill, ShipSheet), go on a USPS form
// (api/retail/close-day), or stay on an order kept at its old address (api/retail/address). Three ways it happens:
//   voiding    — a void of it is under way, or Shippo never answered (lib/label-sweep writes `labelVoiding` first)
//   partial    — some of its boxes were voided and the rest not yet
//   unfinished — the morning check handed a void that didn't finish to the team, and nobody has decided yet
// Each has a way out: voiding it again settles the first two; the third also clears when someone keeps the label.

export type LabelDoubt = 'voiding' | 'partial' | 'unfinished';

export function labelDoubt(o: any): LabelDoubt | null {
  const txn = String(o?.shippoTransactionId || '');
  if (!txn) return null;
  if (String(o?.labelVoiding?.txn || '') === txn) return 'voiding';
  if (Array.isArray(o?.labelVoidIds) && o.labelVoidIds.length > 0) return 'partial';
  if (o?.labelUnscannedOpen === true && o?.labelUnscanned?.why === 'void_unfinished') return 'unfinished';
  return null;
}

export const labelInDoubt = (o: any): boolean => labelDoubt(o) !== null;

/** The order whose label this one carries: an order shipped in another order's box has a copy, not its own label. */
export function labelHolderId(o: any): string {
  if (o?.shippoTransactionId) return '';
  return String(o?.labelFromOrderId || o?.shippedWithOrderId || '');
}
