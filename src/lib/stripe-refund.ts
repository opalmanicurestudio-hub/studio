// src/lib/stripe-refund.ts — refund a payment on the business's connected account (server).
// Used when a charge must be undone automatically (e.g. a rescheduled time was
// taken in the split second after the fee was charged). Idempotent per payment.
import Stripe from 'stripe';
export async function refundPaymentIntent(stripeAccountId: string | null | undefined, paymentIntentId: string): Promise<boolean> {
  if (!process.env.STRIPE_SECRET_KEY || !stripeAccountId || !paymentIntentId) return false;
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' as any });
    await stripe.refunds.create({ payment_intent: paymentIntentId, reason: 'requested_by_customer' }, { stripeAccount: stripeAccountId, idempotencyKey: `auto-refund-${paymentIntentId}` });
    return true;
  } catch (e) { console.error('[stripe-refund] failed', e); return false; }
}

// Refund part or all of a card payment. `key` names this one refund, so a retry
// (double tap, network drop) returns the same refund instead of making a second.
export async function refundAmount(stripeAccountId: string | null | undefined, paymentIntentId: string, cents: number, key: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!process.env.STRIPE_SECRET_KEY) return { ok: false, error: 'Card payments aren’t set up on the server.' };
  if (!stripeAccountId || !paymentIntentId || !(cents > 0)) return { ok: false, error: 'That payment can’t be refunded to the card.' };
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' as any });
    const r = await stripe.refunds.create({ payment_intent: paymentIntentId, amount: Math.round(cents), reason: 'requested_by_customer' }, { stripeAccount: stripeAccountId, idempotencyKey: key });
    return { ok: true, id: r.id };
  } catch (e: any) { console.error('[stripe-refund] amount failed', e?.message); return { ok: false, error: e?.message ? String(e.message).slice(0, 200) : 'The card refund didn’t go through.' }; }
}
