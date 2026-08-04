/**
 * stripe-fees.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE place that turns a Stripe charge into its Processing Fee ledger line and
 * links that fee back to the sale it came from.
 *
 * WHY THIS EXISTS
 *   The fee used to be written only from the connect webhook's `charge.succeeded`
 *   branch. Two things went wrong with that:
 *
 *     1. If `charge.succeeded` was never delivered (not enabled on the endpoint,
 *        a failed delivery, a signature error) the fee simply never landed —
 *        the sale showed in the Ledger with no cost against it.
 *
 *     2. Stripe emits `charge.succeeded` BEFORE `checkout.session.completed`.
 *        The old code tried to stamp the fee onto the revenue row at fee time,
 *        but that row does not exist yet, so the backfill silently found
 *        nothing and the sale never learned its fee or net.
 *
 *   So fee recording is now callable from BOTH ends: the webhook when the event
 *   arrives, and the order-paid path right after the revenue row is written.
 *   Whichever runs second completes the link.
 *
 * IDEMPOTENCY
 *   The fee document id is derived from the Stripe balance transaction id, so
 *   every path writes the SAME document. Running it twice — or from both ends
 *   at once — cannot double-count. Fee rows written before this module existed
 *   used random ids, so a legacy lookup by `stripeBalanceTxnId` runs first and
 *   defers to whatever is already there.
 */

/** Deterministic ledger doc id for the fee on one balance transaction. */
export function stripeFeeDocId(balanceTxnId: string): string {
  return `stripe_fee__${String(balanceTxnId).replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

export interface RecordStripeFeeArgs {
  db: any;                       // admin Firestore
  stripe: any;                   // Stripe client (platform key)
  tenantId: string;
  connAcct: string;              // connected account the charge lives on
  charge: any | string;          // Stripe.Charge or a charge id
  /** Checkout session that produced this charge, when the caller knows it —
   *  it is how the fee finds its revenue row for retail/deposit checkouts. */
  checkoutSessionId?: string | null;
}

export interface RecordStripeFeeResult {
  recorded: boolean;             // did a fee row exist or get written
  feeCents: number;
  netCents: number;
  balanceTxnId: string | null;
  linkedRevenueTxnId: string | null;
  reason?: string;               // why nothing was recorded
}

const NOTHING: RecordStripeFeeResult = {
  recorded: false, feeCents: 0, netCents: 0, balanceTxnId: null, linkedRevenueTxnId: null,
};

/** Human label for the ledger, derived from how the card was presented. */
function paymentLabelFor(charge: any, checkoutSessionId?: string | null): string {
  const pmDetails = charge?.payment_method_details;
  if (pmDetails?.type === 'card_present') return 'Terminal (card present)';
  if (pmDetails?.card?.read_method === 'contact_emv_fallback' || charge?.metadata?.manualEntry === 'true') {
    return 'Manual card entry';
  }
  if (checkoutSessionId || charge?.metadata?.checkoutSessionId || charge?.metadata?.type === 'retail_order') {
    return 'Online Checkout';
  }
  return 'Card on file';
}

/**
 * Record the Stripe processing fee for a charge and stamp it onto the matching
 * revenue transaction. Safe to call repeatedly and from multiple code paths.
 */
export async function recordStripeFeeForCharge(
  args: RecordStripeFeeArgs
): Promise<RecordStripeFeeResult> {
  const { db, stripe, tenantId, connAcct } = args;
  const txnsPath = `tenants/${tenantId}/transactions`;

  // ── Resolve the charge and its balance transaction ───────────────────────
  let charge: any = args.charge;
  try {
    if (typeof charge === 'string') {
      charge = await stripe.charges.retrieve(charge, {}, { stripeAccount: connAcct });
    }
  } catch (e) {
    console.error('[stripe-fees] Could not retrieve charge', e);
    return { ...NOTHING, reason: 'charge_unavailable' };
  }
  if (!charge?.id) return { ...NOTHING, reason: 'no_charge' };

  let balTxnId: string | null = typeof charge.balance_transaction === 'string'
    ? charge.balance_transaction
    : charge.balance_transaction?.id || null;

  // Stripe occasionally reports the charge a moment before the balance
  // transaction is attached. Re-fetch once rather than drop the fee.
  if (!balTxnId) {
    try {
      const fresh = await stripe.charges.retrieve(charge.id, {}, { stripeAccount: connAcct });
      charge = fresh;
      balTxnId = typeof fresh.balance_transaction === 'string'
        ? fresh.balance_transaction
        : fresh.balance_transaction?.id || null;
    } catch (e) {
      console.error('[stripe-fees] Could not re-fetch charge for balance_transaction', e);
    }
  }
  if (!balTxnId) {
    console.warn(`[stripe-fees] No balance_transaction for charge ${charge.id} — fee not recorded yet`);
    return { ...NOTHING, reason: 'no_balance_transaction' };
  }

  const checkoutSessionId = args.checkoutSessionId || charge.metadata?.checkoutSessionId || null;
  const feeRef = db.collection(txnsPath).doc(stripeFeeDocId(balTxnId));
  const feeSnap = await feeRef.get();

  // Already fully processed — nothing left to write or link.
  if (feeSnap.exists && feeSnap.data()?.linkedRevenueTxnId) {
    const d = feeSnap.data();
    return {
      recorded: true,
      feeCents: Math.round((Number(d.amount) || 0) * 100),
      netCents: Math.round((Number(d.netAfterFee) || 0) * 100),
      balanceTxnId: balTxnId,
      linkedRevenueTxnId: d.linkedRevenueTxnId,
    };
  }

  const balTxn = await stripe.balanceTransactions.retrieve(balTxnId, {}, { stripeAccount: connAcct });
  const feeCents = balTxn.fee;
  const netCents = balTxn.net;
  const grossCents = balTxn.amount;
  if (feeCents <= 0) return { ...NOTHING, balanceTxnId: balTxnId, reason: 'no_fee' };

  const feeDollars = feeCents / 100;
  const netDollars = netCents / 100;

  // Legacy rows (written with a random id before this module) — never post a
  // second fee for the same balance transaction.
  let legacyFeeId: string | null = null;
  if (!feeSnap.exists) {
    const legacy = await db.collection(txnsPath)
      .where('stripeBalanceTxnId', '==', balTxnId)
      .where('category', '==', 'Processing Fee')
      .limit(1).get();
    if (!legacy.empty) legacyFeeId = legacy.docs[0].id;
  }

  const paymentLabel = paymentLabelFor(charge, checkoutSessionId);

  if (!feeSnap.exists && !legacyFeeId) {
    await feeRef.set({
      id:                       feeRef.id,
      date:                     new Date(charge.created * 1000).toISOString(),
      description:              `Stripe fee — ${paymentLabel}`,
      clientOrVendor:           'Stripe',
      clientId:                 charge.metadata?.clientId || null,
      type:                     'expense',
      context:                  'Business',
      category:                 'Processing Fee',
      taxBucket:                'processing_fee',
      amount:                   feeDollars,
      paymentMethod:            paymentLabel,
      hasReceipt:               false,
      stripeChargeId:           charge.id,
      stripeBalanceTxnId:       balTxnId,
      stripeConnectedAccountId: connAcct,
      grossChargeAmount:        grossCents / 100,
      netAfterFee:              netDollars,
      feeBreakdown:             (balTxn.fee_details || []).map((d: any) => ({
        type:     d.type,
        amount:   d.amount / 100,
        currency: d.currency,
      })),
      checkoutSessionId,
      retailOrderId:            charge.metadata?.retailOrderId || null,
      tenantId,
    });
    console.log(`[stripe-fees] Fee $${feeDollars.toFixed(2)} recorded for charge ${charge.id} on ${tenantId}`);
  }

  // ── Stamp the fee onto the sale it came from ─────────────────────────────
  // Look up by checkout session first (set on both sides of a Checkout flow),
  // then by charge id (Terminal / card-on-file charges).
  let revenueDoc: any = null;
  if (checkoutSessionId) {
    const bySession = await db.collection(txnsPath)
      .where('checkoutSessionId', '==', checkoutSessionId)
      .where('taxBucket', '==', 'revenue')
      .limit(1).get();
    if (!bySession.empty) revenueDoc = bySession.docs[0];
  }
  if (!revenueDoc) {
    const byCharge = await db.collection(txnsPath)
      .where('stripeChargeId', '==', charge.id)
      .where('taxBucket', '==', 'revenue')
      .limit(1).get();
    if (!byCharge.empty) revenueDoc = byCharge.docs[0];
  }

  if (revenueDoc) {
    await revenueDoc.ref.set({
      stripeFeeAmountDollars: feeDollars,
      stripeNetAmountDollars: netDollars,
      stripeChargeId:         charge.id,
      stripeBalanceTxnId:     balTxnId,
      stripeFeeTxnId:         legacyFeeId || feeRef.id,
    }, { merge: true });
    // Remember the link so a later call short-circuits instead of re-querying.
    await (legacyFeeId ? db.collection(txnsPath).doc(legacyFeeId) : feeRef)
      .set({ linkedRevenueTxnId: revenueDoc.id }, { merge: true });
  } else {
    // The sale row is not written yet (Stripe sends charge.succeeded before
    // checkout.session.completed). The order-paid path calls this again once
    // the revenue row exists, and the link is made then.
    console.log(`[stripe-fees] No revenue row yet for charge ${charge.id} — fee stands alone until the sale posts`);
  }

  return {
    recorded: true,
    feeCents,
    netCents,
    balanceTxnId: balTxnId,
    linkedRevenueTxnId: revenueDoc?.id || null,
  };
}
