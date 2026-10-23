// src/lib/stripe-refund.ts — refund a payment on the business's connected account (server).
// Used when a charge must be undone automatically (e.g. a rescheduled time was
// taken in the split second after the fee was charged). Idempotent per payment.
import Stripe from 'stripe';
// Every refund the app sends carries its mark (metadata.origin 'app'), so the payments handler can tell it from one made
// in the Stripe Dashboard (lib/outside-refund), which it records itself. A retry of a refund first sent before the mark
// (same key, so Stripe wants the same details) is sent as it was then, and gets the same refund back.
const APP_MARK = { origin: 'app' };
const isKeyClash = (e: any) => String(e?.type || '') === 'StripeIdempotencyError';

export async function refundPaymentIntent(stripeAccountId: string | null | undefined, paymentIntentId: string): Promise<boolean> {
  if (!process.env.STRIPE_SECRET_KEY || !stripeAccountId || !paymentIntentId) return false;
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' as any });
    const opts = { stripeAccount: stripeAccountId, idempotencyKey: `auto-refund-${paymentIntentId}` };
    const asBefore = { payment_intent: paymentIntentId, reason: 'requested_by_customer' as const };
    try { await stripe.refunds.create({ ...asBefore, metadata: APP_MARK }, opts); }
    catch (e: any) {
      if (isKeyClash(e)) await stripe.refunds.create(asBefore, opts);
      // Refunded in full already (by an earlier try, or by hand): what was asked for is done.
      else if (String(e?.code || e?.raw?.code || '') === 'charge_already_refunded') return true;
      else throw e;
    }
    return true;
  } catch (e) { console.error('[stripe-refund] failed', e); return false; }
}

// Refund part or all of a card payment. `key` names this one refund, so a retry
// (double tap, network drop) returns the same refund instead of making a second.
export async function refundAmount(stripeAccountId: string | null | undefined, paymentIntentId: string, cents: number, key: string, metadata?: Record<string, string>): Promise<{ ok: boolean; id?: string; error?: string; code?: string }> {
  if (!process.env.STRIPE_SECRET_KEY) return { ok: false, error: 'Card payments aren’t set up on the server.' };
  if (!stripeAccountId || !paymentIntentId || !(cents > 0)) return { ok: false, error: 'That payment can’t be refunded to the card.' };
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' as any });
    const asBefore = { payment_intent: paymentIntentId, amount: Math.round(cents), reason: 'requested_by_customer' as const, ...(metadata ? { metadata } : {}) };
    const opts = { stripeAccount: stripeAccountId, idempotencyKey: key };
    let r: any;
    try { r = await stripe.refunds.create({ ...asBefore, metadata: { ...(metadata || {}), ...APP_MARK } }, opts); }
    catch (e: any) { if (!isKeyClash(e)) throw e; r = await stripe.refunds.create(asBefore, opts); }
    return { ok: true, id: r.id };
  } catch (e: any) { console.error('[stripe-refund] amount failed', e?.message); return { ok: false, error: e?.message ? String(e.message).slice(0, 200) : 'The card refund didn’t go through.', ...(e?.code || e?.raw?.code ? { code: String(e.code || e.raw.code) } : {}) }; }
}
