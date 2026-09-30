// src/lib/retail-payment-check.ts — CONFIRM A SHOP ORDER'S PAYMENT WITH STRIPE (server).
// Normally Stripe's webhook marks a paid order paid. If that notification is late or never arrives, the order would sit
// at 'placed' — invisible on the orders board, and "Confirming payment" forever for the customer. This asks Stripe
// directly and runs the SAME completion the webhook runs (it only acts on a 'placed' order, so it can't happen twice).
// Used by the customer's order page (while it's open) and by /api/cron/retail-payments (every 5 min, page or no page).
export async function confirmRetailPayment(db: any, tenantId: string, tenant: any, orderRef: any, order: any): Promise<'paid' | 'expired' | 'waiting' | 'skipped'> {
  const acct = tenant?.stripeAccountId || tenant?.stripeConnectAccountId;
  if (order?.stage !== 'placed' || !order?.stripeCheckoutSessionId || !acct || !process.env.STRIPE_SECRET_KEY) return 'skipped';
  await orderRef.set({ paymentCheckAt: new Date().toISOString() }, { merge: true });
  const Stripe = (await import('stripe')).default; const stripe: any = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-04-30.basil' as any });
  const session: any = await stripe.checkout.sessions.retrieve(order.stripeCheckoutSessionId, {}, { stripeAccount: acct });
  const { handleRetailOrderPaid, handleRetailCheckoutExpired } = await import('@/lib/retail-webhook');
  if (session?.payment_status === 'paid') {
    let chargeId: string | null = null;
    const piId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    if (piId) { try { const pi: any = await stripe.paymentIntents.retrieve(piId, {}, { stripeAccount: acct }); chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id || null; } catch { /* optional */ } }
    await handleRetailOrderPaid(db, stripe, tenantId, acct, session, chargeId); return 'paid';
  }
  if (session?.status === 'expired') { await handleRetailCheckoutExpired(db, tenantId, session); return 'expired'; }
  return 'waiting';
}
