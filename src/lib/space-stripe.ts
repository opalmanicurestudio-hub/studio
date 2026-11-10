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

/** Space payments that write their own processing fee line (the booking route, lib/booth-money, lib/no-show,
 *  lib/kiosk-charges), so the payments notice (lib/connect-webhook, charge.succeeded) doesn't write a second one for
 *  them. A guest's space booking is 'space_booking'. 'booth_booking' is a renter's station booking
 *  (api/stripe/book-station), whose fee the notice DOES write, so it isn't here (a guest booking opened in the few minutes
 *  it was named that carries its reservation's id, and is told apart by it). */
export const SPACE_OWN_FEE_KINDS = new Set(['space_booking', 'day_pass', 'booth_overage', 'booth_incidental', 'booth_balance', 'booth_no_show_fee', 'concierge_charge', 'concierge_renter_charge']);
// (Rent paid online and a renter's incidental aren't here: their own fee line is named after Stripe's balance record, as
// the notice names it, so the two can't both write one, and the notice writes the real fee when theirs couldn't.)
export const writesOwnFee = (md: any): boolean => {
  const kind = String(md?.kind || '');
  return SPACE_OWN_FEE_KINDS.has(kind) || (kind === 'booth_booking' && !!md?.reservationId && !md?.bookingId);
};

/** What a business without card payments set up is told when a guest tries to pay for a space. */
export const SPACE_NO_PAYMENTS = 'This business isn’t set up to take card payments online yet, so this can’t be paid here. Please let the business know.';

// ── RENTERS ──────────────────────────────────────────────────────────────────────────────────────────────────────────
// A renter's saved card (renter.stripeCustomerId + stripePaymentMethodId) is saved on the business's own account, which is
// recorded with it (renter.stripeCustomerAccount); rent paid online goes there too. A card saved before that was
// recorded is on the platform's account, where the business's autopay and station bookings can't charge it, so it's
// treated as not on file for those until the renter saves it again (their next card setup or online rent payment does).

/** The account a renter's saved card is on: the one recorded when it was saved, else the platform's (null). */
export const renterCardAccount = (renter: any): string | null =>
  (typeof renter?.stripeCustomerAccount === 'string' && renter.stripeCustomerAccount) ? renter.stripeCustomerAccount : null;

/** The renter's card that this business can charge: saved, on its own account. null when there's none (or only one
 *  saved on the platform's account before the move). */
export function renterBusinessCard(renter: any, businessAccount: string | null): { customer: string; pm: string; account: string } | null {
  const customer = renter?.stripeCustomerId ? String(renter.stripeCustomerId) : '';
  const pm = String(renter?.stripePaymentMethodId || renter?.defaultPaymentMethodId || '');
  const account = renterCardAccount(renter);
  if (!customer || !pm || !account || !businessAccount || account !== businessAccount) return null;
  return { customer, pm, account };
}

/** What the renter or the team is told when the card on file was saved before the move and has to be saved again. */
export const RENTER_CARD_AGAIN = 'The card on file needs to be saved again before it can be charged. The renter can add it in their portal, or send them a card link.';
