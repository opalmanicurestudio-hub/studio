// src/lib/space-stripe.ts — WHERE A SPACE RENTAL'S MONEY GOES: the business's own Stripe account.
// Day and hourly space bookings, day-pass packs, and every charge and refund on them (an overage, an incidental, a
// no-show fee) are made on the business's connected account, so the money is paid out to the business, as every other
// payment it takes is. The account is saved on the booking (and on the pass purchase) when its payment page is opened,
// and every later charge, check or refund on it uses that same account. A booking paid before this was paid on the
// platform's own account and has no account saved, so it carries on there (its card and payment live there).

/** The business's account for new space payments, or null when it can't take cards yet (no account, or Stripe hasn't
 *  switched card payments on). */
export function spacePayAccount(tenant: any): string | null {
  const a = tenant?.stripeAccountId;
  return typeof a === 'string' && a && tenant?.stripeChargesEnabled !== false ? a : null;
}

/** Stripe's request options for a record's account (none for one paid on the platform account), merged with others
 *  (an idempotency key). */
export function onAccount(rec: any, opts: Record<string, any> = {}): Record<string, any> | undefined {
  const acct = typeof rec?.stripeAccountId === 'string' && rec.stripeAccountId ? rec.stripeAccountId : null;
  const out = { ...opts, ...(acct ? { stripeAccount: acct } : {}) };
  return Object.keys(out).length ? out : undefined;
}

/** Space payments that write their own processing fee line (the booking route, lib/booth-money, lib/no-show), so the
 *  payments notice (lib/connect-webhook, charge.succeeded) doesn't write a second one for them. */
export const SPACE_OWN_FEE_KINDS = new Set(['booth_booking', 'day_pass', 'booth_overage', 'booth_incidental', 'booth_no_show_fee', 'concierge_charge', 'concierge_renter_charge']);

/** What a business without card payments set up is told when a guest tries to pay for a space. */
export const SPACE_NO_PAYMENTS = 'This business isn’t set up to take card payments online yet, so this can’t be paid here. Please let the business know.';
