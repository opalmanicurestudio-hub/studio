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


/** Stripe version that knows `excluded_payment_method_types` on Checkout Sessions (added 2025-09-30). */
export const EXCLUDE_API_VERSION = '2025-09-30.clover';

/**
 * Create a Checkout Session that may carry the pay-later exclusion.
 * The app's Stripe clients are pinned to OLDER versions (2024-06-20 / 2025-04-30), which reject
 * `excluded_payment_method_types` as an unknown parameter — so every checkout that excluded pay-later
 * (the default!) failed: online shop orders, renter packages, Academy courses. Now: that one request is
 * sent on the newer version (callers only read the session's id and url); if it's still refused, it's
 * retried WITHOUT the exclusion so the sale always goes through (pay-later may show) — and it's logged.
 */
export async function createCheckoutSession(stripe: any, params: Record<string, any>, reqOpts: Record<string, any> = {}): Promise<any> {
  if (!params?.excluded_payment_method_types) return stripe.checkout.sessions.create(params, reqOpts);
  try { return await stripe.checkout.sessions.create(params, { ...reqOpts, apiVersion: EXCLUDE_API_VERSION }); }
  catch (e: any) {
    console.warn('[pay-later] exclusion refused — creating the checkout without it:', String(e?.raw?.message || e?.message || e).slice(0, 200));
    const { excluded_payment_method_types: _drop, ...rest } = params;
    return stripe.checkout.sessions.create(rest, reqOpts);
  }
}
