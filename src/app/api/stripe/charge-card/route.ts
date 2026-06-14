import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { nanoid } from 'nanoid';

// ─── Lazy inits — must NOT be at module scope (build-time env vars unavailable) ─
function getAdmin() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  const APP_NAME = 'admin';
  let app = getApps().find((a) => a.name === APP_NAME);
  if (!app) {
    app = initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    }, APP_NAME);
  }
  return { db: getFirestore(app), FieldValue };
}

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Charges a client's saved card OFF-SESSION (client not present) — e.g. an
// automated no-show or late-cancel fee resolved by the policy engine.
//
// IMPORTANT: only charges a card that was saved WITH the client's authorization
// (captured by the booking-completion flow). The saved card lives on the client
// as `cardOnFile = { customerId, paymentMethodId, ... }`.
//
// On success → posts the fee to the ledger (idempotent).
// On ANY failure (declined, card expired, authentication required, no card) →
// does NOT lose the money: it parks the fee on the client's balance/arrears AND
// writes a flag record, then returns { ok:false, flagged:true }. Nothing silent.
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  let parsed: any = {};
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const {
    tenantId,
    clientId,
    amountCents,
    description = 'Fee',
    category = 'Cancellation Fee',
    appointmentId = null,
    reason = 'Policy fee',
  } = parsed;

  if (!tenantId || !clientId || !amountCents || amountCents <= 0) {
    return NextResponse.json({ error: 'Missing tenantId, clientId, or amountCents' }, { status: 400 });
  }

  const { db, FieldValue } = getAdmin();
  const amountDollars = amountCents / 100;
  const nowISO = new Date().toISOString();

  // Helper: park the fee as arrears + write a flag record (the "flag it" path)
  const flagAndPark = async (failReason: string, code?: string) => {
    try {
      const batch = db.batch();
      batch.update(db.doc(`tenants/${tenantId}/clients/${clientId}`), {
        outstandingBalance: FieldValue.increment(amountDollars),
        unpaidFees: FieldValue.arrayUnion({
          feeId: nanoid(),
          appointmentId,
          appointmentDate: nowISO,
          feeAmount: amountDollars,
          reason: `${reason} — auto-charge failed (${code || failReason})`,
        }),
      });
      batch.set(db.collection(`tenants/${tenantId}/chargeFlags`).doc(), {
        tenantId, clientId, appointmentId, amountDollars,
        description, category, reason, failReason, code: code || null,
        status: 'needs_attention', createdAt: nowISO,
      });
      await batch.commit();
    } catch (e) {
      console.error('[charge-card] flagAndPark failed', e);
    }
  };

  try {
    // Load client + saved card
    const clientSnap = await db.doc(`tenants/${tenantId}/clients/${clientId}`).get();
    if (!clientSnap.exists) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }
    const card = clientSnap.data()?.cardOnFile;
    if (!card?.customerId || !card?.paymentMethodId) {
      await flagAndPark('no_card_on_file');
      return NextResponse.json({ ok: false, flagged: true, reason: 'No card on file', parkedAsBalance: true });
    }

    // Connected account
    const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
    const stripeAccountId = tenantSnap.data()?.stripeAccountId;
    if (!stripeAccountId) {
      await flagAndPark('no_connected_account');
      return NextResponse.json({ ok: false, flagged: true, reason: 'No connected payment account', parkedAsBalance: true });
    }

    // Off-session charge against the saved card
    const stripe = getStripe();
    let intent: Stripe.PaymentIntent;
    try {
      intent = await stripe.paymentIntents.create(
        {
          amount: amountCents,
          currency: 'usd',
          customer: card.customerId,
          payment_method: card.paymentMethodId,
          off_session: true,
          confirm: true,
          description: `${description} — ${reason}`,
          metadata: { tenantId, clientId, appointmentId: appointmentId || '', category, kind: 'auto_fee' },
        },
        { stripeAccount: stripeAccountId, idempotencyKey: `fee_${appointmentId || clientId}_${amountCents}` }
      );
    } catch (stripeErr: any) {
      // Declined, expired, or authentication_required — can't complete off-session
      const code = stripeErr?.code || stripeErr?.raw?.code || 'charge_failed';
      await flagAndPark('stripe_error', code);
      return NextResponse.json({ ok: false, flagged: true, reason: stripeErr?.message || 'Charge failed', code, parkedAsBalance: true });
    }

    if (intent.status !== 'succeeded') {
      await flagAndPark('not_succeeded', intent.status);
      return NextResponse.json({ ok: false, flagged: true, reason: `Charge ${intent.status}`, code: intent.status, parkedAsBalance: true });
    }

    // Success → post the fee income to the ledger (idempotent doc id)
    const txnId  = `card_charge__${intent.id}`;
    const txnRef = db.doc(`tenants/${tenantId}/transactions/${txnId}`);
    await txnRef.set({
      id:                    txnId,
      date:                  nowISO,
      description:           `${description}`,
      clientOrVendor:        clientSnap.data()?.name || 'Client',
      clientId,
      type:                  'income',
      context:               'Business',
      category,
      amount:                amountDollars,
      paymentMethod:         'Card on file (Stripe)',
      appointmentId:         appointmentId || null,
      stripePaymentIntentId: intent.id,
      hasReceipt:            true,
      tenantId,
    }, { merge: true });

    return NextResponse.json({ ok: true, paymentIntentId: intent.id, amount: amountDollars });
  } catch (err: any) {
    console.error('[stripe/charge-card]', err);
    await flagAndPark('unexpected_error', err?.code);
    return NextResponse.json({ ok: false, flagged: true, reason: err.message, parkedAsBalance: true }, { status: 200 });
  }
}