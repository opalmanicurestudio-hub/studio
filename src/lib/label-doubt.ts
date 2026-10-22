// src/lib/label-doubt.ts — A LABEL THAT MAY NO LONGER WORK. Pure, so the server and the browser share one answer.
// Until it's sorted, the label can't be marked shipped (lib/retail-fulfill, ShipSheet), go on a USPS form
// (api/retail/close-day), or stay on an order kept at its old address (api/retail/address). Four ways it happens:
//   voiding    — a void of it is under way, or Shippo never answered (lib/label-sweep writes `labelVoiding` first)
//   relabel    — one box's label was voided and the others' weren't, and which box is which is known (lib/label-boxes):
//                that box needs a new label, or to come off the order, before it goes out. Held back even once another
//                box is with the carrier, so a box never leaves on a voided label.
//   partial    — some of its boxes were voided and the rest not yet, on a label whose boxes can't be told apart
//   unfinished — the morning check handed a void that didn't finish to the team, and nobody has decided yet
// Each has a way out: voiding it again settles voiding and partial; a box gets a new label (or comes off) for relabel;
// the last also clears when someone keeps the label. Otherwise, once the carrier has scanned the box it's out of the
// shop whatever happened, so it isn't held back: the "being voided" warning (voidedLabelMoving) covers what's left to
// check about the money.
import { voidedSlots } from './label-boxes';

export type LabelDoubt = 'voiding' | 'relabel' | 'partial' | 'unfinished';

const SCANNED = ['TRANSIT', 'DELIVERED', 'RETURNED', 'FAILURE'];

/** The carrier's latest status on record for the order's main box. The shipping webhook keeps it as
 *  carrierTrail.carrierStatus (lib/shipping-notify deliveryEvidence); the other spellings are read too, so an older
 *  record still counts. */
export function trailStatus(o: any): string {
  return String(o?.carrierTrail?.carrierStatus || o?.carrierTrail?.status || o?.carrierStatus || '').toUpperCase();
}

export function labelDoubt(o: any): LabelDoubt | null {
  const txn = String(o?.shippoTransactionId || '');
  if (!txn) return null;
  const moving = !!o?.labelSeenMoving || SCANNED.includes(trailStatus(o))
    || Object.values(o?.boxStatus || {}).some((s: any) => SCANNED.includes(String(s).toUpperCase()));
  const voiding = String(o?.labelVoiding?.txn || '') === txn;
  const unfinished = o?.labelUnscannedOpen === true && o?.labelUnscanned?.why === 'void_unfinished';
  const relabel = voidedSlots(o).length > 0;
  // A void still under way, or one the morning check handed over, is settled first: a box whose void got no answer may
  // already be refunded, so no box gets a new label until someone has voided it again or kept it.
  if (voiding && !moving) return 'voiding';
  if (unfinished && relabel && !moving) return 'unfinished';
  if (relabel) return 'relabel';
  if (moving) return null;
  if (Array.isArray(o?.labelVoidIds) && o.labelVoidIds.length > 0) return 'partial';
  if (unfinished) return 'unfinished';
  return null;
}

export const labelInDoubt = (o: any): boolean => labelDoubt(o) !== null;

/** The order whose label this one carries: an order shipped in another order's box has a copy, not its own label. */
export function labelHolderId(o: any): string {
  if (o?.shippoTransactionId) return '';
  return String(o?.labelFromOrderId || o?.shippedWithOrderId || '');
}
