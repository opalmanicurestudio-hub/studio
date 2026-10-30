// src/lib/digital-access-rule.ts — WHO MAY OPEN A PURCHASED DOWNLOAD, AND FOR HOW LONG (pure, safe in the browser).
// The one rule (see lib/digital-access for the whole story): paid and not cancelled; not refunded or returned, in full
// or unit by unit; no chargeback open or lost; inside the access window sold, moved later by the shop's extension; not
// closed by the shop. Read by the file route, the library, the order page, the buyer's account and the Digital products
// area, so they can never disagree.
import { digitalAccessEndsAt } from '@/lib/retail-orders';

/** An extension on or after this is "for good" (lib/entitlement-actions FOREVER). */
export const FOREVER_AT = Date.parse('9999-01-01T00:00:00.000Z');

export type ClosedReason = 'inactive' | 'refunded' | 'disputed' | 'expired' | 'revoked';

const c0 = (v: any) => Math.max(0, Math.round(Number(v) || 0));

/**
 * The order has been given back: everything but a tip that was kept (card refunds plus anything returned to a gift
 * card or store credit), or the card payment refunded in full in the Stripe dashboard.
 */
export function fullyRefunded(o: any): boolean {
  const total = c0(o?.totalCents);
  if (total <= 0) return false;
  if (o?.cardRefundedInFull === true) return true;
  const tipKept = Math.max(0, c0(o?.tipCents) - c0(o?.refundedTipCents));
  return c0(o?.refundedCents) + c0(o?.refundedOtherCents) >= total - tipKept;
}

/** A chargeback open or lost on any payment for this order (a won one, or an inquiry, doesn't count). */
export function disputeHolds(o: any): boolean {
  return Object.values(o?.digitalHolds || {}).some((h: any) => ['open', 'lost'].includes(String(h?.status || '')));
}

/**
 * Whether a digital line can be opened, and if not why. `endsAt` is the end of the window sold (null = for good), moved
 * later when the shop extended it on the buyer's access record (lib/entitlements); a record the shop revoked is closed.
 */
export function digitalLineAccess(o: any, line: any, now = Date.now(), ent?: { status?: string; access?: { endsAt?: string | null; extendedUntil?: string | null } } | null): { open: boolean; reason: ClosedReason | null; endsAt: string | null } {
  const sold = line ? digitalAccessEndsAt(line, o?.paidAt, o?.placedAt) : null;
  const ext = ent?.access?.extendedUntil ? Date.parse(ent.access.extendedUntil) : NaN;
  // Extended for good (the far date the Digital products area saves) means no end at all.
  const endsAt = sold && Number.isFinite(ext) && ext >= FOREVER_AT ? null : sold && Number.isFinite(ext) && ext > Date.parse(sold) ? new Date(ext).toISOString() : sold;
  const shut = (reason: ClosedReason) => ({ open: false, reason, endsAt });
  if (!o || !line || line.digital !== true) return shut('inactive');
  if (['placed', 'cancelled'].includes(String(o.stage))) return shut('inactive');
  if (['refunded', 'backordered'].includes(String(line.status))) return shut('refunded');
  const ordered = c0(line.qtyOrdered);
  if (ordered > 0 && c0(line.qtyRefunded) + c0(line.qtyReturned) >= ordered) return shut('refunded');
  if (fullyRefunded(o)) return shut('refunded');
  if (disputeHolds(o)) return shut('disputed');
  if (ent?.status === 'revoked') return shut('revoked');
  if (endsAt && Date.parse(endsAt) < now) return shut('expired');
  return { open: true, reason: null, endsAt };
}

/** What the customer is told when a line is closed (never a dead end: there's always a person to ask). */
export function closedMessage(reason: ClosedReason | null, endsAt: string | null, gift = false): string {
  // Someone given a download has no order page; a reply to their gift email reaches the shop.
  const ask = gift ? 'Reply to your gift email to reach the shop' : 'Send the shop a message from your order page';
  if (reason === 'expired' && endsAt) return `Your access to this ended on ${new Date(endsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}. ${ask} and they can extend it.`;
  if (reason === 'refunded') return gift ? 'This gift was refunded, so it can’t be opened anymore.' : 'This item was refunded, so it can’t be opened anymore.';
  if (reason === 'revoked') return `The shop has closed access to this item. ${ask} if you think this is a mistake.`;
  if (reason === 'disputed') return `This item is paused while a question about the payment is looked into. ${ask} if you think this is a mistake.`;
  return 'This order isn’t active.';
}

