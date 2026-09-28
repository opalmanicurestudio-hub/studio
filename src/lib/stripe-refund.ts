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
