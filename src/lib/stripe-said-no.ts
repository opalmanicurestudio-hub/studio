// src/lib/stripe-said-no.ts — DID STRIPE SAY NO? (server and browser-safe; no imports).
// Stripe said no: a card declined, a request it refused (a charge already refunded, too much asked back), or the
// account not allowed to do it. Nothing moved, so the claim can go and a new try is a new request. Anything else may
// have gone through: no connection, no answer, Stripe's own error, or the same request still going on under its key
// (Stripe answers that one with a refusal type, but it isn't one). Those keep the claim, and asking again under the
// same key finds what Stripe did.
const SAID_NO = ['StripeCardError', 'StripeInvalidRequestError', 'StripePermissionError', 'StripeAuthenticationError'];

export function stripeRefused(e: any): boolean {
  const code = String(e?.code || e?.raw?.code || '');
  if (code === 'idempotency_key_in_use' || String(e?.type || '') === 'StripeIdempotencyError') return false;
  return SAID_NO.includes(String(e?.type || ''));
}
