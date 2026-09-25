// src/lib/pay-later.ts
//
// BUY NOW, PAY LATER (Klarna · Afterpay · Affirm) — only when the business
// chooses it, and only where it makes sense.
//
// A business's choice lives on its record as payLater = { enabled, minAmount }.
// It's offered ONLY at a live checkout for a one-off purchase at or above the
// minimum (default $150): the online shop today; the Academy next. Never on
// deposits, saved-card or no-show charges, tap-to-pay, rent or memberships.
//
// Cost: ClarityFlow's Stripe pricing scheme charges the business 6.5% + 30¢
// on these payments (Stripe charges ClarityFlow ~6% + 30¢).

export const PAY_LATER_TYPES = ['klarna', 'afterpay_clearpay', 'affirm'] as const;
export const PAY_LATER_CAPABILITIES = ['klarna_payments', 'afterpay_clearpay_payments', 'affirm_payments'] as const;
export const PAY_LATER_DEFAULT_MIN = 150;
export const PAY_LATER_FEE_TEXT = '6.5% + 30¢';

export interface PayLaterSetting { enabled?: boolean; minAmount?: number }

/**
 * Extra Checkout Session params: hides pay-later unless this business turned
 * it on AND the order is big enough. (Stripe otherwise shows whatever payment
 * methods it has switched on for the account.)
 */
export function payLaterCheckoutParams(setting: PayLaterSetting | null | undefined, amountCents: number): Record<string, any> {
  const min = Math.max(0, Number(setting?.minAmount ?? PAY_LATER_DEFAULT_MIN)) * 100;
  const offer = !!setting?.enabled && amountCents >= min;
  return offer ? {} : { excluded_payment_method_types: [...PAY_LATER_TYPES] };
}
