import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { nanoid } from 'nanoid';

// ─── Lazy inits ───────────────────────────────────────────────────────────────
function getAdmin() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  const APP_NAME = 'admin';
  let app = getApps().find((a: any) => a.name === APP_NAME);
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
// TWO MODES controlled by the `mode` field in the request body:
//
//   mode: 'pos'      — Client IS present at checkout. Uses a PaymentIntent
//                      with a clientSecret returned to the frontend, which
//                      then confirms it using the saved payment method.
//                      This satisfies Stripe's on-session requirement and
//                      avoids authentication_required declines.
//
//   mode: 'auto'     — Client is NOT present (policy engine: no-show, late
//                      cancel). Uses off_session + confirm:true. On failure,
//                      parks the amount as arrears and raises a charge flag.
//
// If `mode` is omitted it defaults to 'pos' so existing POS callers work
// without any changes to CheckoutHub.
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
    description  = 'Fee',
    category     = 'Service Revenue',
    appointmentId = null,
    reason       = 'Studio Services',
    mode         = 'pos',           // 'pos' | 'auto'
  } = parsed;

  if (!tenantId || !clientId || !amountCents || amountCents <= 0) {
    return NextResponse.json(
      { error: 'Missing tenantId, clientId, or amountCents' },
      { status: 400 }
    );
  }

  const { db, FieldValue } = getAdmin();
  const amountDollars = amountCents / 100;
  const nowISO        = new Date().toISOString();

  // ── Helper: park as arrears + write flag record (auto-mode failure path) ──
  const flagAndPark = async (failReason: string, code?: string) => {
    try {
      const batch = db.batch();
      batch.update(db.doc(`tenants/${tenantId}/clients/${clientId}`), {
        outstandingBalance: FieldValue.increment(amountDollars),
        unpaidFees: FieldValue.arrayUnion({
          feeId:           nanoid(),
          appointmentId,
          appointmentDate: nowISO,
          feeAmount:       amountDollars,
          reason:          `${reason} — auto-charge failed (${code || failReason})`,
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
    // ── Load client ──────────────────────────────────────────────────────────
    const clientSnap = await db.doc(`tenants/${tenantId}/clients/${clientId}`).get();
    if (!clientSnap.exists) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }
    const clientData = clientSnap.data();
    const card       = clientData?.cardOnFile;

    if (!card?.customerId || !card?.paymentMethodId) {
      if (mode === 'auto') await flagAndPark('no_card_on_file');
      return NextResponse.json({
        ok: false,
        flagged:        mode === 'auto',
        reason:         'No card on file',
        parkedAsBalance: mode === 'auto',
      });
    }

    // ── Load connected Stripe account ────────────────────────────────────────
    const tenantSnap      = await db.doc(`tenants/${tenantId}`).get();
    const stripeAccountId = tenantSnap.data()?.stripeAccountId;
    if (!stripeAccountId) {
      if (mode === 'auto') await flagAndPark('no_connected_account');
      return NextResponse.json({
        ok: false,
        flagged:         mode === 'auto',
        reason:          'No connected payment account. Configure Stripe in Settings.',
        parkedAsBalance: mode === 'auto',
      });
    }

    const stripe = getStripe();

    // ══════════════════════════════════════════════════════════════════════════
    // POS MODE — client is present, confirm on the frontend
    // Returns a clientSecret; CheckoutHub never reaches this path directly
    // (it uses /api/stripe/pos-payment-intent for new cards), but when
    // CheckoutHub calls THIS route for a card-on-file POS charge we create
    // an on-session intent and confirm server-side with the saved PM.
    // ══════════════════════════════════════════════════════════════════════════
    if (mode === 'pos') {
      // Use a time-based idempotency key so retries within the same second
      // are safe but a second tap generates a new intent.
      const idempotencyKey = `pos_${clientId}_${amountCents}_${Math.floor(Date.now() / 10000)}`;

      let intent: Stripe.PaymentIntent;
      try {
        intent = await stripe.paymentIntents.create(
          {
            amount:         amountCents,
            currency:       'usd',
            customer:       card.customerId,
            payment_method: card.paymentMethodId,
            // on_session = client is present; dramatically reduces declines
            off_session:    false,
            confirm:        true,
            // If authentication is needed this returns a requires_action status
            // with a next_action URL rather than throwing — frontend handles it.
            return_url:     `${process.env.NEXT_PUBLIC_APP_URL || 'https://app.clarityflow.com'}/pos`,
            description:    `${description} — ${reason}`,
            metadata: {
              tenantId,
              clientId,
              appointmentId: appointmentId || '',
              category,
              kind: 'pos_cof',
            },
          },
          {
            stripeAccount:  stripeAccountId,
            idempotencyKey,
          }
        );
      } catch (stripeErr: any) {
        const code = stripeErr?.code || stripeErr?.raw?.code || 'charge_failed';
        console.error('[charge-card] POS stripe error:', stripeErr?.message, code);
        return NextResponse.json({
          ok:     false,
          reason: stripeErr?.message || 'Card charge failed',
          code,
        });
      }

      // Requires further authentication (3DS etc.) — unlikely for saved cards
      // but handle gracefully
      if (intent.status === 'requires_action') {
        return NextResponse.json({
          ok:              false,
          requiresAction:  true,
          clientSecret:    intent.client_secret,
          reason:          'Card requires additional authentication. Please ask the client to complete verification.',
        });
      }

      if (intent.status !== 'succeeded') {
        return NextResponse.json({
          ok:     false,
          reason: `Charge did not complete (status: ${intent.status})`,
          code:   intent.status,
        });
      }

      // ── Write ledger record ────────────────────────────────────────────────
      const txnId  = `pos_cof__${intent.id}`;
      await db.doc(`tenants/${tenantId}/transactions/${txnId}`).set({
        id:                    txnId,
        date:                  nowISO,
        description,
        clientOrVendor:        clientData?.name || 'Client',
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
    }

    // ══════════════════════════════════════════════════════════════════════════
    // AUTO MODE — client NOT present (policy engine: no-show, late-cancel)
    // ══════════════════════════════════════════════════════════════════════════
    const idempotencyKey = `fee_${appointmentId || clientId}_${amountCents}`;

    let intent: Stripe.PaymentIntent;
    try {
      intent = await stripe.paymentIntents.create(
        {
          amount:         amountCents,
          currency:       'usd',
          customer:       card.customerId,
          payment_method: card.paymentMethodId,
          off_session:    true,
          confirm:        true,
          description:    `${description} — ${reason}`,
          metadata: {
            tenantId,
            clientId,
            appointmentId: appointmentId || '',
            category,
            kind: 'auto_fee',
          },
        },
        { stripeAccount: stripeAccountId, idempotencyKey }
      );
    } catch (stripeErr: any) {
      const code = stripeErr?.code || stripeErr?.raw?.code || 'charge_failed';
      await flagAndPark('stripe_error', code);
      return NextResponse.json({
        ok:              false,
        flagged:         true,
        reason:          stripeErr?.message || 'Charge failed',
        code,
        parkedAsBalance: true,
      });
    }

    if (intent.status !== 'succeeded') {
      await flagAndPark('not_succeeded', intent.status);
      return NextResponse.json({
        ok:              false,
        flagged:         true,
        reason:          `Charge ${intent.status}`,
        code:            intent.status,
        parkedAsBalance: true,
      });
    }

    // ── Write ledger record ──────────────────────────────────────────────────
    const txnId  = `card_charge__${intent.id}`;
    await db.doc(`tenants/${tenantId}/transactions/${txnId}`).set({
      id:                    txnId,
      date:                  nowISO,
      description,
      clientOrVendor:        clientData?.name || 'Client',
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
    if (mode === 'auto') await flagAndPark('unexpected_error', err?.code);
    return NextResponse.json({
      ok:              false,
      flagged:         mode === 'auto',
      reason:          err.message,
      parkedAsBalance: mode === 'auto',
    }, { status: 200 });
  }
}