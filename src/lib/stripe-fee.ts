// src/lib/stripe-fee.ts — THE EXACT FEE STRIPE TOOK ON A CARD PAYMENT, AS AN EXPENSE LINE (server).
// Written once per payment, from Stripe's own balance record, whichever arrives first: the charge.succeeded or
// charge.captured notice (connect-webhook), or the card reader's capture itself (terminal/capture-payment-intent).
// A card reader payment is approved first and captured after, and the fee only exists once it's captured, so the
// approval notice alone never recorded one: every card reader sale was missing its processing fee.
// The revenue line it belongs to is given the fee and the net amount, for reports.

/** Record the fee for a charge that has been captured. Returns the fee in cents, or 0 when there's none (yet). */
export async function recordChargeFee(db: any, stripe: any, tenantId: string, connAcct: string, charge: any): Promise<number> {
  const balTxnId = typeof charge?.balance_transaction === 'string' ? charge.balance_transaction : charge?.balance_transaction?.id;
  if (!balTxnId) return 0;   // not captured yet: the capture brings it
  const balTxn: any = typeof charge.balance_transaction === 'object' && charge.balance_transaction?.fee !== undefined
    ? charge.balance_transaction
    : await stripe.balanceTransactions.retrieve(balTxnId, {}, { stripeAccount: connAcct });
  const feeAmountCents = Number(balTxn?.fee) || 0;
  const netAmountCents = Number(balTxn?.net) || 0;
  const grossAmountCents = Number(balTxn?.amount) || 0;
  const feeAmountDollars = feeAmountCents / 100;
  if (feeAmountCents <= 0) return 0;

  const T = `tenants/${tenantId}`;
  // Once: by its own id, and by the lines written before it had one.
  const existing = await db.collection(`${T}/transactions`).where('stripeBalanceTxnId', '==', balTxnId).where('category', '==', 'Processing Fee').limit(1).get();
  if (!existing.empty) return feeAmountCents;

  const pm = charge.payment_method_details;
  const isTerminal = pm?.type === 'card_present';
  const isManual = pm?.card?.read_method === 'contact_emv_fallback' || charge.metadata?.manualEntry === 'true';
  const paymentLabel = isTerminal ? 'Terminal (card present)' : isManual ? 'Manual card entry' : 'Card on file';
  const feeRef = db.doc(`${T}/transactions/stripefee_${String(balTxnId).replace(/[^A-Za-z0-9_]/g, '')}`);
  try {
    await feeRef.create({
      id: feeRef.id,
      date: new Date((Number(charge.created) || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
      description: `Stripe fee — ${paymentLabel}`,
      clientOrVendor: 'Stripe',
      clientId: charge.metadata?.clientId || null,
      type: 'expense',
      context: 'Business',
      category: 'Processing Fee',
      taxBucket: 'processing_fee',
      amount: feeAmountDollars,
      paymentMethod: paymentLabel,
      hasReceipt: false,
      stripeChargeId: charge.id,
      stripeBalanceTxnId: balTxnId,
      stripeConnectedAccountId: connAcct,
      ...(charge.payment_intent ? { stripePaymentIntentId: typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent.id } : {}),
      grossChargeAmount: grossAmountCents / 100,
      netAfterFee: netAmountCents / 100,
      feeBreakdown: (balTxn.fee_details || []).map((d: any) => ({ type: d.type, amount: d.amount / 100, currency: d.currency })),
      checkoutSessionId: charge.metadata?.checkoutSessionId || null,
      tenantId,
    });
  } catch { return feeAmountCents; }   // the other notice wrote it a moment ago

  // The revenue line it belongs to gets the fee and the net amount.
  const patch = { stripeFeeAmountDollars: feeAmountDollars, stripeNetAmountDollars: netAmountCents / 100 };
  if (charge.metadata?.checkoutSessionId) {
    const rev = await db.collection(`${T}/transactions`).where('checkoutSessionId', '==', charge.metadata.checkoutSessionId).where('taxBucket', '==', 'revenue').limit(1).get();
    if (!rev.empty) await rev.docs[0].ref.update({ ...patch, stripeChargeId: charge.id });
  } else {
    const rev = await db.collection(`${T}/transactions`).where('stripeChargeId', '==', charge.id).where('taxBucket', '==', 'revenue').limit(1).get();
    if (!rev.empty) await rev.docs[0].ref.update(patch);
  }
  return feeAmountCents;
}
