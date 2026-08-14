// ─── src/lib/return-eligibility.ts ────────────────────────────────────────
// WHETHER A THING CAN COME BACK, AND — the part that matters — WHY NOT.
//
// Until now the answer was always yes. Returns were gated on exactly two
// things: the order's stage, and the arithmetic of how many units were
// ordered, shorted and already returned. Nothing anywhere said that a
// downloaded file, an opened bottle or a gift card is not coming back. So the
// storefront cheerfully accepted those returns, they landed on the returns
// board, and a person had to say no AFTER the app had already said yes. That
// refusal costs more goodwill than never offering it would have.
//
// TWO DESIGN RULES, both load-bearing:
//
// 1. FINAL SALE MEANS "NO RETURNS FOR CHANGE OF MIND". It does not mean "you
//    have no recourse". If the parcel arrived smashed, or the wrong thing is
//    in the box, that is the shop's problem regardless of the flag — and a
//    customer told "final sale, nothing we can do" about a wrong item does
//    not shrug and move on, they call their card issuer. Conflating the two
//    is how a return becomes a chargeback. So FAULT_REASONS always pass.
//
// 2. THE RULE TRAVELS ON THE ORDER LINE, NOT THE ITEM. `finalSaleFor()` reads
//    the item at checkout and the result is stamped onto the line. Everything
//    afterwards reads the stamp. If a shop marks something final sale in
//    March, that must not retroactively change what a January customer was
//    told — the same reason order.policySnapshot and order.preorderAck carry
//    their text rather than a pointer to it.

import type { ReturnReason } from '@/lib/retail-orders';

/** Reasons that describe something the SHOP got wrong. These are never
 *  blocked, whatever the flag says. */
export const FAULT_REASONS: ReturnReason[] = ['damaged_in_transit', 'defective', 'wrong_item'];

/** Reasons that describe the customer changing their mind. These are what
 *  final sale actually restricts. */
export const CHOICE_REASONS: ReturnReason[] = ['changed_mind', 'other'];

export type FinalSaleCode = 'digital' | 'hygiene' | 'custom' | 'gift_card' | 'clearance' | 'other';

export type FinalSaleStamp = {
  finalSale: true;
  /** Why, in the customer's own reading. Stored, not derived later. */
  finalSaleReason: string;
  finalSaleCode: FinalSaleCode;
};

/** Wording per code. Kept here so the product page, the cart, the checkout
 *  notice and the return picker all say the same sentence — a policy that is
 *  phrased three ways reads as three different policies. */
export const FINAL_SALE_REASONS: Record<FinalSaleCode, string> = {
  digital: 'Digital download — delivered instantly, so it cannot be returned.',
  hygiene: 'Hygiene item — once opened it cannot be resold, so it is final sale.',
  custom: 'Made to order for you — final sale.',
  gift_card: 'Gift cards cannot be returned or refunded.',
  clearance: 'Clearance item — final sale.',
  other: 'This item is final sale and cannot be returned.',
};

type ItemLike = {
  digital?: boolean;
  finalSale?: boolean;
  finalSaleCode?: string;
  finalSaleReason?: string;
  isGiftCard?: boolean;
  type?: string;
};

/**
 * The rule, evaluated against an inventory item. Returns the stamp to put on
 * the order line, or null when the item returns normally.
 *
 * A DIGITAL ITEM IS ALWAYS FINAL SALE and does not need the flag set. That is
 * not a shortcut — it is the one case where the shop cannot possibly get the
 * goods back, and it is live in the codebase today (`item.digital` skips
 * reservation and picking and emails a download link on payment). Making it
 * depend on someone remembering to tick a box would leave the most obviously
 * unreturnable thing you sell returnable by default.
 */
export function finalSaleFor(item?: ItemLike | null): FinalSaleStamp | null {
  if (!item) return null;

  if (item.digital === true) {
    return {
      finalSale: true,
      finalSaleCode: 'digital',
      finalSaleReason: FINAL_SALE_REASONS.digital,
    };
  }

  const flagged = item.finalSale === true
    || item.isGiftCard === true
    || String(item.type || '') === 'gift_card';
  if (!flagged) return null;

  const rawCode = String(item.finalSaleCode || '').trim() as FinalSaleCode;
  const code: FinalSaleCode = (item.isGiftCard === true || String(item.type || '') === 'gift_card')
    ? 'gift_card'
    : (rawCode in FINAL_SALE_REASONS ? rawCode : 'other');

  // A shop's own wording wins over ours — it knows its customers. Ours is the
  // floor, so the reason is never blank.
  const custom = String(item.finalSaleReason || '').trim();
  return {
    finalSale: true,
    finalSaleCode: code,
    finalSaleReason: custom || FINAL_SALE_REASONS[code],
  };
}

type LineLike = {
  name?: string;
  finalSale?: boolean;
  finalSaleReason?: string;
  finalSaleCode?: string;
};

/** Is this ORDER LINE final sale? Reads the stamp, never the item — an order
 *  written before the stamp existed simply returns false and behaves exactly
 *  as it always has. */
export function isFinalSaleLine(line?: LineLike | null): boolean {
  return line?.finalSale === true;
}

/** The sentence to show next to that line. Empty when it returns normally. */
export function finalSaleReasonOf(line?: LineLike | null): string {
  if (!isFinalSaleLine(line)) return '';
  const stored = String(line?.finalSaleReason || '').trim();
  if (stored) return stored;
  const code = String(line?.finalSaleCode || 'other') as FinalSaleCode;
  return FINAL_SALE_REASONS[code in FINAL_SALE_REASONS ? code : 'other'];
}

export type EligibilityVerdict = {
  allowed: boolean;
  /** Present only when blocked. Written to be shown to the customer as-is. */
  message?: string;
};

/**
 * THE GATE. Can this line come back, for this reason?
 *
 * Note the shape of the refusal: it names the item and gives the reason, and
 * it ends by telling them what they CAN still do. A bare "this item cannot be
 * returned" is the message that produces a phone call, or a chargeback.
 */
export function canReturnLine(line: LineLike | null | undefined, reason: ReturnReason): EligibilityVerdict {
  if (!isFinalSaleLine(line)) return { allowed: true };
  if (FAULT_REASONS.includes(reason)) return { allowed: true };

  const name = String(line?.name || 'This item').trim() || 'This item';
  return {
    allowed: false,
    message: `${name}: ${finalSaleReasonOf(line)} If it arrived damaged, is faulty, or is not what you ordered, choose that reason instead and we will put it right.`,
  };
}

/** Convenience for a whole basket of selections — returns the FIRST refusal,
 *  because a customer fixes one problem at a time and a wall of errors reads
 *  as a broken screen. */
export function firstBlocked(
  selections: Array<{ lineId: string; qty: number; reason: ReturnReason }>,
  lines: Array<LineLike & { lineId?: string }>,
): EligibilityVerdict {
  for (const sel of selections) {
    if (!sel || (Number(sel.qty) || 0) <= 0) continue;
    const line = lines.find((l) => l?.lineId === sel.lineId);
    const verdict = canReturnLine(line, sel.reason);
    if (!verdict.allowed) return verdict;
  }
  return { allowed: true };
}
