import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

// ─── Lazy inits — must NOT be at module scope (build-time env vars unavailable) ─
function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  }
  return getFirestore();
}

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Refunds an appointment deposit and reverses its ledger income.
//
// Called only for the 'refund' outcome — rollover and forfeit never hit Stripe.
// Guards:
//   • Only a deposit still 'available' can be refunded. A consumed (already
//     applied at checkout), refunded, or forfeited deposit is rejected — so this
//     can never double-refund or refund money the studio already earned.
//   • The Stripe refund uses an idempotency key, and the ledger reversal has a
//     deterministic doc id, so a retried request is harmless.
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { tenantId, creditId } = await req.json();
    if (!tenantId || !creditId) {
      return NextResponse.json({ error: 'Missing tenantId or creditId' }, { status: 400 });
    }

    const db        = getAdminDb();
    const creditRef = db.doc(`tenants/${tenantId}/depositCredits/${creditId}`);
    const snap      = await creditRef.get();
    if (!snap.exists) {
      return NextResponse.json({ error: 'Deposit credit not found' }, { status: 404 });
    }
    const credit = snap.data() || {};

    // Only an unused deposit can be refunded.
    if (credit.status !== 'available') {
      return NextResponse.json(
        { error: `Deposit is '${credit.status}', not refundable`, status: credit.status },
        { status: 409 }
      );
    }

    const paymentIntentId = credit.stripePaymentIntentId;
    if (!paymentIntentId) {
      return NextResponse.json({ error: 'No payment on file to refund' }, { status: 400 });
    }

    // Connected account for this studio
    const tenantSnap      = await db.doc(`tenants/${tenantId}`).get();
    const stripeAccountId = tenantSnap.data()?.stripeAccountId;
    if (!stripeAccountId) {
      return NextResponse.json({ error: 'Studio has no connected payment account' }, { status: 400 });
    }

    // Issue the refund on the connected account (idempotent)
    const stripe = getStripe();
    const refund = await stripe.refunds.create(
      { payment_intent: paymentIntentId },
      { stripeAccount: stripeAccountId, idempotencyKey: `deposit_refund_${creditId}` }
    );

    const nowISO        = new Date().toISOString();
    const amountDollars = typeof credit.amountDollars === 'number'
      ? credit.amountDollars
      : (credit.amountCents || 0) / 100;

    const batch = db.batch();

    // 1) Close the credit so it can never be applied at checkout
    batch.set(
      creditRef,
      { status: 'refunded', refundedAt: nowISO, stripeRefundId: refund.id },
      { merge: true }
    );

    // 2) Reverse the deposit income in the ledger (deterministic id → idempotent).
    //    Posted as an expense so it cleanly nets the original income to zero,
    //    matching how the void flow records reversals.
    const reversalId  = `deposit_refund__${String(creditId).replace(/[^A-Za-z0-9_-]/g, '')}`;
    const reversalRef = db.doc(`tenants/${tenantId}/transactions/${reversalId}`);
    batch.set(
      reversalRef,
      {
        id:                    reversalId,
        date:                  nowISO,
        description:           `Deposit refund — ${credit.serviceName || 'Service'} — ${credit.clientName || 'Client'}`,
        clientOrVendor:        credit.clientName || 'Client',
        clientId:              credit.clientId || null,
        type:                  'expense',
        context:               'Business',
        category:              'Deposit Refund',
        amount:                amountDollars,
        paymentMethod:         'Card (Stripe)',
        reversalOf:            credit.ledgerSourceId || null,
        stripeRefundId:        refund.id,
        stripePaymentIntentId: paymentIntentId,
        hasReceipt:            false,
        tenantId,
      },
      { merge: true }
    );

    await batch.commit();

    return NextResponse.json({ ok: true, refundId: refund.id, amount: amountDollars });
  } catch (err: any) {
    console.error('[stripe/deposit-refund]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}