import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

// ─── /api/stripe/webhook/route.ts ─────────────────────────────────────────────
// Handles Stripe webhook events. Key events:
//   charge.succeeded          → write exact processing fee to ledger
//   charge.refunded           → write fee credit back to ledger
//   charge.dispute.created    → write $15 dispute fee
//   charge.dispute.won        → reverse dispute fee
//   payout.paid               → record net payout for reconciliation
//
// The fee is read from balance_transaction.fee_details — this is the EXACT
// amount Stripe took, not an estimate. Option B.

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-webhook';
  let app = getApps().find((a: any) => a.name === APP_NAME);
  if (!app) {
    app = initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    }, APP_NAME);
  }
  return getFirestore(app);
}

// Fee rates for reference — used only in comments/logging, not for estimates
const FEE_RATES = {
  card_not_present: { pct: 0.029, fixed: 30 },   // 2.9% + $0.30
  card_present:     { pct: 0.027, fixed: 5 },     // 2.7% + $0.05 (terminal)
  card_keyed:       { pct: 0.034, fixed: 30 },    // 3.4% + $0.30 (manual entry)
  dispute_fee:      200,                           // $2.00 (not $15 — Stripe changed it)
} as const;

export const config = { api: { bodyParser: false } };

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const sig     = req.headers.get('stripe-signature');
  const secret  = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !secret) {
    console.error('[webhook] Missing signature or secret');
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2025-04-30.basil' as any });
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err: any) {
    console.error('[webhook] Signature verification failed:', err.message);
    return NextResponse.json({ error: 'Webhook Error' }, { status: 400 });
  }

  const db = getAdminDb();

  try {
    switch (event.type) {

      // ── charge.succeeded: write exact fee to ledger ──────────────────────────
      case 'charge.succeeded': {
        const charge    = event.data.object as Stripe.Charge;
        const connAcct  = (event as any).account as string | undefined;

        // Only process charges on connected accounts (your tenants)
        if (!connAcct) break;

        // Find the tenant by stripeAccountId
        const tenantSnap = await db.collection('tenants').where('stripeAccountId', '==', connAcct).limit(1).get();
        if (tenantSnap.empty) break;
        const tenantDoc  = tenantSnap.docs[0];
        const tenantId   = tenantDoc.id;

        // Fetch the balance transaction to get the exact fee
        const balTxnId = typeof charge.balance_transaction === 'string'
          ? charge.balance_transaction
          : charge.balance_transaction?.id;

        if (!balTxnId) break;

        const balTxn = await stripe.balanceTransactions.retrieve(balTxnId, {}, { stripeAccount: connAcct });

        const feeAmountCents  = balTxn.fee;              // exact fee in cents
        const netAmountCents  = balTxn.net;              // what you actually keep
        const grossAmountCents= balTxn.amount;
        const feeAmountDollars= feeAmountCents / 100;

        if (feeAmountCents <= 0) break;

        // Identify payment type from charge object for labeling
        const paymentMethodDetails = charge.payment_method_details;
        const cardPresent   = paymentMethodDetails?.type === 'card_present';
        const cardManual    = (paymentMethodDetails?.card as any)?.read_method === 'contact_emv_fallback'
          || charge.metadata?.manualEntry === 'true';
        const paymentType   = cardPresent ? 'Terminal (card present)' : cardManual ? 'Manual card entry' : 'Card on file';

        // Check if we already wrote this fee (idempotency)
        const existing = await db.collection(`tenants/${tenantId}/transactions`)
          .where('stripeBalanceTxnId', '==', balTxnId)
          .where('category', '==', 'Processing Fee')
          .limit(1).get();

        if (!existing.empty) break; // already recorded

        // Write the processing fee as an expense transaction
        const feeDocRef = db.collection(`tenants/${tenantId}/transactions`).doc();
        await feeDocRef.set({
          id:               feeDocRef.id,
          date:             new Date(charge.created * 1000).toISOString(),
          description:      `Stripe fee: ${paymentType}`,
          clientOrVendor:   'Stripe',
          type:             'expense',
          context:          'Business',
          category:         'Processing Fee',
          taxBucket:        'processing_fee',
          amount:           feeAmountDollars,
          paymentMethod:    paymentType,
          hasReceipt:       false,
          // Links back to the original charge for reconciliation
          stripeChargeId:   charge.id,
          stripeBalanceTxnId: balTxnId,
          stripeConnectedAccountId: connAcct,
          // Metadata for P&L reporting
          grossChargeAmount: grossAmountCents / 100,
          netAfterFee:       netAmountCents / 100,
          feeBreakdown:      balTxn.fee_details.map((d: any) => ({ type: d.type, amount: d.amount / 100, currency: d.currency })),
          tenantId,
          // Try to link to the original checkout session
          checkoutSessionId: charge.metadata?.checkoutSessionId || null,
          clientId:          charge.metadata?.clientId || null,
        });

        // Also update the original revenue transaction with net amount for reporting
        if (charge.metadata?.checkoutSessionId) {
          const revTxns = await db.collection(`tenants/${tenantId}/transactions`)
            .where('checkoutSessionId', '==', charge.metadata.checkoutSessionId)
            .where('taxBucket', '==', 'revenue')
            .limit(1).get();

          if (!revTxns.empty) {
            await revTxns.docs[0].ref.update({
              stripeFeeAmountDollars: feeAmountDollars,
              stripeNetAmountDollars: netAmountCents / 100,
              stripeChargeId:         charge.id,
            });
          }
        }

        console.log(`[webhook] Fee recorded: $${feeAmountDollars.toFixed(2)} for charge ${charge.id} on tenant ${tenantId}`);
        break;
      }

      // ── charge.refunded: Stripe returns a portion of the fee ────────────────
      case 'charge.refunded': {
        const charge   = event.data.object as Stripe.Charge;
        const connAcct = (event as any).account as string | undefined;
        if (!connAcct) break;

        const tenantSnap = await db.collection('tenants').where('stripeAccountId', '==', connAcct).limit(1).get();
        if (tenantSnap.empty) break;
        const tenantId = tenantSnap.docs[0].id;

        // Get the most recent refund
        const latestRefund = charge.refunds?.data?.[0];
        if (!latestRefund) break;

        const refundBalTxnId = typeof latestRefund.balance_transaction === 'string'
          ? latestRefund.balance_transaction
          : (latestRefund.balance_transaction as any)?.id;

        if (!refundBalTxnId) break;

        const refundBalTxn = await stripe.balanceTransactions.retrieve(refundBalTxnId, {}, { stripeAccount: connAcct });

        // Stripe returns PART of the fee on refund — the fee credit is in fee_details
        // fee will be negative (a credit)
        const feeReturn = Math.abs(refundBalTxn.fee) / 100;

        if (feeReturn <= 0) break;

        // Check idempotency
        const existing = await db.collection(`tenants/${tenantId}/transactions`)
          .where('stripeBalanceTxnId', '==', refundBalTxnId)
          .limit(1).get();
        if (!existing.empty) break;

        const feeReturnRef = db.collection(`tenants/${tenantId}/transactions`).doc();
        await feeReturnRef.set({
          id:               feeReturnRef.id,
          date:             new Date(latestRefund.created * 1000).toISOString(),
          description:      `Stripe fee return: partial refund credit`,
          clientOrVendor:   'Stripe',
          type:             'income',
          context:          'Business',
          category:         'Processing Fee',
          taxBucket:        'processing_fee',
          amount:           feeReturn,
          paymentMethod:    'Stripe',
          hasReceipt:       false,
          stripeChargeId:   charge.id,
          stripeBalanceTxnId: refundBalTxnId,
          stripeConnectedAccountId: connAcct,
          tenantId,
        });

        console.log(`[webhook] Fee return recorded: $${feeReturn.toFixed(2)} for refund on charge ${charge.id}`);
        break;
      }

      // ── charge.dispute.created: $15 dispute fee ──────────────────────────────
      case 'charge.dispute.created': {
        const dispute  = event.data.object as Stripe.Dispute;
        const connAcct = (event as any).account as string | undefined;
        if (!connAcct) break;

        const tenantSnap = await db.collection('tenants').where('stripeAccountId', '==', connAcct).limit(1).get();
        if (tenantSnap.empty) break;
        const tenantId = tenantSnap.docs[0].id;

        const disputeRef = db.collection(`tenants/${tenantId}/transactions`).doc();
        await disputeRef.set({
          id:               disputeRef.id,
          date:             new Date(dispute.created * 1000).toISOString(),
          description:      `Stripe dispute fee: ${dispute.reason}`,
          clientOrVendor:   'Stripe',
          type:             'expense',
          context:          'Business',
          category:         'Processing Fee',
          taxBucket:        'processing_fee',
          amount:           1.50,               // Stripe's current dispute fee
          paymentMethod:    'Stripe',
          hasReceipt:       false,
          stripeDisputeId:  dispute.id,
          stripeChargeId:   typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id,
          stripeConnectedAccountId: connAcct,
          notes:            `Dispute reason: ${dispute.reason}. Amount disputed: $${(dispute.amount / 100).toFixed(2)}`,
          tenantId,
        });

        console.log(`[webhook] Dispute fee recorded for dispute ${dispute.id}`);
        break;
      }

      // ── charge.dispute.won: reverse the dispute fee ──────────────────────────
      case 'charge.dispute.won': {
        const dispute  = event.data.object as Stripe.Dispute;
        const connAcct = (event as any).account as string | undefined;
        if (!connAcct) break;

        const tenantSnap = await db.collection('tenants').where('stripeAccountId', '==', connAcct).limit(1).get();
        if (tenantSnap.empty) break;
        const tenantId = tenantSnap.docs[0].id;

        // Find and reverse the original dispute fee
        const original = await db.collection(`tenants/${tenantId}/transactions`)
          .where('stripeDisputeId', '==', dispute.id)
          .where('type', '==', 'expense')
          .limit(1).get();

        if (original.empty) break;

        const reversal = db.collection(`tenants/${tenantId}/transactions`).doc();
        await reversal.set({
          id:               reversal.id,
          date:             new Date().toISOString(),
          description:      `Dispute won: fee reversed`,
          clientOrVendor:   'Stripe',
          type:             'income',
          context:          'Business',
          category:         'Processing Fee',
          taxBucket:        'processing_fee',
          amount:           1.50,
          paymentMethod:    'Stripe',
          hasReceipt:       false,
          stripeDisputeId:  dispute.id,
          stripeConnectedAccountId: connAcct,
          reversalOf:       original.docs[0].id,
          tenantId,
        });

        console.log(`[webhook] Dispute fee reversed for won dispute ${dispute.id}`);
        break;
      }

      // ── checkout.session.completed: save card on file ────────────────────────
      case 'checkout.session.completed': {
        const session  = event.data.object as Stripe.Checkout.Session;
        const connAcct = (event as any).account as string | undefined;
        if (!connAcct || !session.client_reference_id) break;

        const tenantSnap = await db.collection('tenants').where('stripeAccountId', '==', connAcct).limit(1).get();
        if (tenantSnap.empty) break;
        const tenantId = tenantSnap.docs[0].id;

        const clientId = session.client_reference_id;
        if (!session.setup_intent && !session.payment_intent) break;

        // Retrieve the setup intent to get the payment method
        if (session.setup_intent) {
          const setupIntentId = typeof session.setup_intent === 'string' ? session.setup_intent : session.setup_intent.id;
          const setupIntent = await stripe.setupIntents.retrieve(setupIntentId, {}, { stripeAccount: connAcct });
          const pmId = typeof setupIntent.payment_method === 'string' ? setupIntent.payment_method : setupIntent.payment_method?.id;
          if (!pmId) break;

          const pm = await stripe.paymentMethods.retrieve(pmId, {}, { stripeAccount: connAcct });
          const customerId = typeof setupIntent.customer === 'string' ? setupIntent.customer : setupIntent.customer?.id;

          await db.collection(`tenants/${tenantId}/clients`).doc(clientId).set({
            cardOnFile: {
              paymentMethodId: pmId,
              customerId:      customerId || null,
              brand:           pm.card?.brand || 'unknown',
              last4:           pm.card?.last4 || '????',
              expMonth:        pm.card?.exp_month,
              expYear:         pm.card?.exp_year,
              savedAt:         new Date().toISOString(),
            }
          }, { merge: true });

          console.log(`[webhook] Card saved for client ${clientId} on tenant ${tenantId}`);
        }
        break;
      }

      default:
        // Unhandled event — not an error
        break;
    }

    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error('[webhook] Handler error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
