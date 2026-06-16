import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

// ─── /api/stripe/connect-webhook/route.ts ─────────────────────────────────────
// CONNECTED ACCOUNTS webhook — events on your tenants' Stripe accounts.
// Stripe Dashboard: Developers → Webhooks → "Connected accounts" endpoint
// Secret env var: STRIPE_CONNECT_WEBHOOK_SECRET
//
// Events handled:
//   checkout.session.completed  → save card on file to client profile
//   charge.succeeded            → write exact Stripe processing fee to ledger
//   charge.refunded             → write fee credit back to ledger
//   charge.dispute.created      → write dispute fee
//   charge.dispute.closed        → reverse fee if won, note if lost
//   payout.paid                 → record net payout for reconciliation

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-connect-webhook';
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

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const sig     = req.headers.get('stripe-signature');
  const secret  = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;

  if (!sig || !secret) {
    console.error('[connect-webhook] Missing signature or STRIPE_CONNECT_WEBHOOK_SECRET');
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2025-04-30.basil' as any });
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err: any) {
    console.error('[connect-webhook] Signature verification failed:', err.message);
    return NextResponse.json({ error: 'Webhook Error' }, { status: 400 });
  }

  // All connected account events have an account field
  const connAcct = (event as any).account as string | undefined;
  if (!connAcct) {
    console.warn('[connect-webhook] No connected account on event — ignoring');
    return NextResponse.json({ received: true });
  }

  const db    = getAdminDb();
  const stripe2 = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2025-04-30.basil' as any });

  // Helper: find tenant by connected Stripe account ID
  const getTenant = async (accountId: string) => {
    const snap = await db.collection('tenants')
      .where('stripeAccountId', '==', accountId)
      .limit(1).get();
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ref: snap.docs[0].ref };
  };

  try {
    switch (event.type) {

      // ── checkout.session.completed: save card on file ─────────────────────
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (!session.client_reference_id) break;

        const tenant = await getTenant(connAcct);
        if (!tenant) break;

        const clientId = session.client_reference_id;

        if (session.setup_intent) {
          const siId = typeof session.setup_intent === 'string'
            ? session.setup_intent : session.setup_intent.id;
          const setupIntent = await stripe2.setupIntents.retrieve(
            siId, {}, { stripeAccount: connAcct }
          );
          const pmId = typeof setupIntent.payment_method === 'string'
            ? setupIntent.payment_method : setupIntent.payment_method?.id;
          if (!pmId) break;

          const pm = await stripe2.paymentMethods.retrieve(pmId, {}, { stripeAccount: connAcct });
          const customerId = typeof setupIntent.customer === 'string'
            ? setupIntent.customer : (setupIntent.customer as any)?.id;

          await db.collection(`tenants/${tenant.id}/clients`).doc(clientId).set({
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

          console.log(`[connect-webhook] Card saved for client ${clientId} on tenant ${tenant.id}`);
        }
        break;
      }

      // ── charge.succeeded: record exact Stripe processing fee ─────────────
      case 'charge.succeeded': {
        const charge = event.data.object as Stripe.Charge;
        const tenant = await getTenant(connAcct);
        if (!tenant) break;

        const balTxnId = typeof charge.balance_transaction === 'string'
          ? charge.balance_transaction
          : (charge.balance_transaction as any)?.id;
        if (!balTxnId) break;

        // Fetch the balance transaction — contains the EXACT fee Stripe took
        const balTxn = await stripe2.balanceTransactions.retrieve(
          balTxnId, {}, { stripeAccount: connAcct }
        );

        const feeAmountCents   = balTxn.fee;
        const netAmountCents   = balTxn.net;
        const grossAmountCents = balTxn.amount;
        const feeAmountDollars = feeAmountCents / 100;

        if (feeAmountCents <= 0) break;

        // Idempotency check — don't write the same fee twice
        const existing = await db.collection(`tenants/${tenant.id}/transactions`)
          .where('stripeBalanceTxnId', '==', balTxnId)
          .where('category', '==', 'Processing Fee')
          .limit(1).get();
        if (!existing.empty) break;

        // Identify payment method type for the description
        const pmDetails    = charge.payment_method_details;
        const isTerminal   = pmDetails?.type === 'card_present';
        const isManual     = (pmDetails?.card as any)?.read_method === 'contact_emv_fallback'
          || charge.metadata?.manualEntry === 'true';
        const paymentLabel = isTerminal ? 'Terminal (card present)'
          : isManual ? 'Manual card entry'
          : 'Card on file';

        // Write the fee as an expense
        const feeRef = db.collection(`tenants/${tenant.id}/transactions`).doc();
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
          amount:                   feeAmountDollars,
          paymentMethod:            paymentLabel,
          hasReceipt:               false,
          // Reconciliation fields
          stripeChargeId:           charge.id,
          stripeBalanceTxnId:       balTxnId,
          stripeConnectedAccountId: connAcct,
          grossChargeAmount:        grossAmountCents / 100,
          netAfterFee:              netAmountCents / 100,
          feeBreakdown:             balTxn.fee_details.map((d: any) => ({
            type:     d.type,
            amount:   d.amount / 100,
            currency: d.currency,
          })),
          checkoutSessionId:        charge.metadata?.checkoutSessionId || null,
          tenantId:                 tenant.id,
        });

        // Back-fill net amount on the original revenue transaction for accurate reporting
        if (charge.metadata?.checkoutSessionId) {
          const revTxns = await db.collection(`tenants/${tenant.id}/transactions`)
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

        console.log(`[connect-webhook] Fee $${feeAmountDollars.toFixed(2)} recorded for charge ${charge.id} on ${tenant.id}`);
        break;
      }

      // ── charge.refunded: Stripe returns part of the fee ──────────────────
      case 'charge.refunded': {
        const charge  = event.data.object as Stripe.Charge;
        const tenant  = await getTenant(connAcct);
        if (!tenant) break;

        const latestRefund = charge.refunds?.data?.[0];
        if (!latestRefund) break;

        const refundBalTxnId = typeof latestRefund.balance_transaction === 'string'
          ? latestRefund.balance_transaction
          : (latestRefund.balance_transaction as any)?.id;
        if (!refundBalTxnId) break;

        // Idempotency
        const existing = await db.collection(`tenants/${tenant.id}/transactions`)
          .where('stripeBalanceTxnId', '==', refundBalTxnId)
          .limit(1).get();
        if (!existing.empty) break;

        const refundBalTxn = await stripe2.balanceTransactions.retrieve(
          refundBalTxnId, {}, { stripeAccount: connAcct }
        );

        // Stripe returns part of the fee — fee will be negative (a credit)
        const feeReturn = Math.abs(refundBalTxn.fee) / 100;
        if (feeReturn <= 0) break;

        const retRef = db.collection(`tenants/${tenant.id}/transactions`).doc();
        await retRef.set({
          id:                       retRef.id,
          date:                     new Date(latestRefund.created * 1000).toISOString(),
          description:              'Stripe fee return — refund credit',
          clientOrVendor:           'Stripe',
          type:                     'income',
          context:                  'Business',
          category:                 'Processing Fee',
          taxBucket:                'processing_fee',
          amount:                   feeReturn,
          paymentMethod:            'Stripe',
          hasReceipt:               false,
          stripeChargeId:           charge.id,
          stripeBalanceTxnId:       refundBalTxnId,
          stripeConnectedAccountId: connAcct,
          tenantId:                 tenant.id,
        });

        console.log(`[connect-webhook] Fee return $${feeReturn.toFixed(2)} for refund on charge ${charge.id}`);
        break;
      }

      // ── charge.dispute.created: dispute fee ──────────────────────────────
      case 'charge.dispute.created': {
        const dispute = event.data.object as Stripe.Dispute;
        const tenant  = await getTenant(connAcct);
        if (!tenant) break;

        // Idempotency
        const existing = await db.collection(`tenants/${tenant.id}/transactions`)
          .where('stripeDisputeId', '==', dispute.id)
          .where('type', '==', 'expense')
          .limit(1).get();
        if (!existing.empty) break;

        const dispRef = db.collection(`tenants/${tenant.id}/transactions`).doc();
        await dispRef.set({
          id:                       dispRef.id,
          date:                     new Date(dispute.created * 1000).toISOString(),
          description:              `Dispute fee — ${dispute.reason}`,
          clientOrVendor:           'Stripe',
          type:                     'expense',
          context:                  'Business',
          category:                 'Processing Fee',
          taxBucket:                'processing_fee',
          amount:                   1.50,   // Stripe current dispute fee
          paymentMethod:            'Stripe',
          hasReceipt:               false,
          stripeDisputeId:          dispute.id,
          stripeChargeId:           typeof dispute.charge === 'string'
            ? dispute.charge : (dispute.charge as any)?.id,
          stripeConnectedAccountId: connAcct,
          notes: `Reason: ${dispute.reason}. Disputed: $${(dispute.amount / 100).toFixed(2)}`,
          tenantId:                 tenant.id,
        });

        console.log(`[connect-webhook] Dispute fee recorded for ${dispute.id}`);
        break;
      }

      // ── charge.dispute.closed: fires for won, lost, or warning_closed ──────
      case 'charge.dispute.closed': {
        const dispute = event.data.object as Stripe.Dispute;
        const tenant  = await getTenant(connAcct);
        if (!tenant) break;

        if (dispute.status === 'won') {
          // Reverse the original dispute fee — we get it back
          const original = await db.collection(`tenants/${tenant.id}/transactions`)
            .where('stripeDisputeId', '==', dispute.id)
            .where('type', '==', 'expense')
            .limit(1).get();
          if (original.empty) break;

          const revRef = db.collection(`tenants/${tenant.id}/transactions`).doc();
          await revRef.set({
            id:                       revRef.id,
            date:                     new Date().toISOString(),
            description:              'Dispute won — fee reversed',
            clientOrVendor:           'Stripe',
            type:                     'income',
            context:                  'Business',
            category:                 'Processing Fee',
            taxBucket:                'processing_fee',
            amount:                   1.50,
            paymentMethod:            'Stripe',
            hasReceipt:               false,
            stripeDisputeId:          dispute.id,
            stripeConnectedAccountId: connAcct,
            reversalOf:               original.docs[0].id,
            tenantId:                 tenant.id,
          });
          console.log(`[connect-webhook] Dispute won — fee reversed for ${dispute.id}`);

        } else if (dispute.status === 'lost') {
          // Lost — also write the disputed charge amount as an additional expense
          const lossRef = db.collection(`tenants/${tenant.id}/transactions`).doc();
          await lossRef.set({
            id:                       lossRef.id,
            date:                     new Date().toISOString(),
            description:              `Dispute lost — chargeback $${(dispute.amount / 100).toFixed(2)}`,
            clientOrVendor:           'Stripe',
            type:                     'expense',
            context:                  'Business',
            category:                 'Processing Fee',
            taxBucket:                'processing_fee',
            amount:                   dispute.amount / 100,
            paymentMethod:            'Stripe',
            hasReceipt:               false,
            stripeDisputeId:          dispute.id,
            stripeChargeId:           typeof dispute.charge === 'string'
              ? dispute.charge : (dispute.charge as any)?.id,
            stripeConnectedAccountId: connAcct,
            notes:                    `Dispute lost: ${dispute.reason}. Full charge amount returned to cardholder.`,
            tenantId:                 tenant.id,
          });
          console.log(`[connect-webhook] Dispute lost — chargeback $${(dispute.amount / 100).toFixed(2)} for ${dispute.id}`);

        } else {
          // warning_closed — no financial impact, just log it
          console.log(`[connect-webhook] Dispute closed with status: ${dispute.status} for ${dispute.id}`);
        }
        break;
      }

      // ── payout.paid: record net payout for month-end reconciliation ───────
      case 'payout.paid': {
        const payout = event.data.object as Stripe.Payout;
        const tenant = await getTenant(connAcct);
        if (!tenant) break;

        // Idempotency
        const existing = await db.collection(`tenants/${tenant.id}/stripePayouts`)
          .where('stripePayoutId', '==', payout.id)
          .limit(1).get();
        if (!existing.empty) break;

        // Write to a separate payouts collection for reconciliation
        // (not the transactions ledger — this is a bank transfer, not revenue)
        const payoutRef = db.collection(`tenants/${tenant.id}/stripePayouts`).doc(payout.id);
        await payoutRef.set({
          id:                       payout.id,
          stripePayoutId:           payout.id,
          stripeConnectedAccountId: connAcct,
          amount:                   payout.amount / 100,
          currency:                 payout.currency,
          arrivalDate:              new Date(payout.arrival_date * 1000).toISOString(),
          createdAt:                new Date(payout.created * 1000).toISOString(),
          status:                   payout.status,
          method:                   payout.method,
          description:              payout.description || 'Stripe payout',
          tenantId:                 tenant.id,
        });

        console.log(`[connect-webhook] Payout $${(payout.amount / 100).toFixed(2)} recorded for ${tenant.id}`);
        break;
      }

      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error('[connect-webhook] Handler error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
