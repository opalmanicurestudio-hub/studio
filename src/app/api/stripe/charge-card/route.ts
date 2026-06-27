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
//                      cancel; or a front-desk deposit charge with no client
//                      standing at the terminal). Uses off_session +
//                      confirm:true. On failure, the ARREARS_FEE kind parks
//                      the amount and raises a charge flag; the DEPOSIT kind
//                      does not (see `kind` below).
//
// If `mode` is omitted it defaults to 'pos' so existing POS callers work
// without any changes to CheckoutHub.
//
// ── FIX: `kind` discriminator for auto-mode failures ────────────────────────
// `mode: 'auto'` was originally written for ONE thing: charging a no-show /
// late-cancel fee for a service that already happened. On failure it calls
// flagAndPark(), which bumps the client's `outstandingBalance` and pushes a
// record into `unpaidFees` — both fields whose documented semantics (see the
// Client type) are specifically post-service arrears.
//
// QuickBookForm now also calls this route in `auto` mode to charge a
// DEPOSIT for a brand-new booking, before the appointment even exists. A
// declined deposit attempt is not arrears — nothing was owed yet, no
// service was rendered, there is no debt. Writing it into `unpaidFees`
// would silently mix "this client skipped out on a finished appointment"
// with "we tried to pre-charge a deposit and the card said no" under one
// field, with no way to tell them apart later (collections workflows,
// `autoChargeArrears`, `repeatNoShowThreshold` etc. all read this same
// field and have no business looking at failed deposit attempts).
//
// Fix: accept an optional `kind` ('deposit' | 'arrears_fee'), defaulting to
// 'arrears_fee' so every existing caller (no-show policy engine, etc.) is
// completely unaffected. Only 'arrears_fee' triggers flagAndPark on
// failure. 'deposit' just returns { ok: false, reason, code } and lets the
// caller decide what to do (QuickBookForm falls back to a completion link).
//
// ── Card processing fee passthrough ─────────────────────────────────────────
// `amountCents` is the FULL amount actually charged (already inclusive of any
// card-surcharge CheckoutHub calculated client-side). `surchargeAmountCents`
// is optional — when present, the ledger write is split into two separate
// transactions instead of one lump sum: the base amount under whatever
// `category` was passed (typically Service Revenue), and the surcharge
// portion under its own 'Card Processing Fee' income line. This keeps the
// fee passed to the client visible as its own number for tax reporting,
// distinct from the actual Stripe processing fee expense (which the
// connect-webhook's charge.succeeded handler records separately).
//
// ── FIX: ledger ↔ webhook linkage ────────────────────────────────────────────
// The connect-webhook's `charge.succeeded` handler attaches the Stripe
// processing fee onto the matching revenue transaction by looking it up two
// ways, in order:
//   1. transactions.checkoutSessionId === charge.metadata.checkoutSessionId
//   2. transactions.stripeChargeId    === charge.id
// This route previously satisfied NEITHER: the PaymentIntent metadata never
// carried `checkoutSessionId`, and writeLedger only stored
// `stripePaymentIntentId` (a `pi_...` id) — never `stripeChargeId` (the
// `ch_...` id the webhook event actually matches on). Every fee silently
// failed to attach. Fixed by (a) accepting an optional `checkoutSessionId`
// from the caller and forwarding it into the PaymentIntent metadata, and
// (b) resolving the actual charge id off `intent.latest_charge` and writing
// it as `stripeChargeId` on the ledger row, so the webhook's fallback match
// also works even when no checkoutSessionId is supplied.
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
    surchargeAmountCents = 0,
    description  = 'Fee',
    category     = 'Service Revenue',
    appointmentId = null,
    reason       = 'Studio Services',
    mode         = 'pos',           // 'pos' | 'auto'
    // FIX: 'deposit' | 'arrears_fee'. Default preserves every existing
    // caller's behavior exactly (they're all arrears use cases today).
    kind         = 'arrears_fee',
    checkoutSessionId = null,       // FIX: optional, forwarded into Stripe metadata + ledger
  } = parsed;

  if (!tenantId || !clientId || !amountCents || amountCents <= 0) {
    return NextResponse.json(
      { error: 'Missing tenantId, clientId, or amountCents' },
      { status: 400 }
    );
  }

  const { db, FieldValue } = getAdmin();
  const amountDollars    = amountCents / 100;
  const surchargeDollars = Math.max(0, Number(surchargeAmountCents) || 0) / 100;
  const baseDollars      = Number((amountDollars - surchargeDollars).toFixed(2));
  const nowISO           = new Date().toISOString();
  // FIX: only post arrears bookkeeping (outstandingBalance / unpaidFees /
  // chargeFlags) for genuine arrears attempts. A declined deposit attempt
  // for a booking that hasn't happened yet has nothing to park.
  const isArrearsKind    = kind === 'arrears_fee';

  // ── Helper: write the ledger record(s) for a successful charge ────────────
  // Splits into a base line + a separate Card Processing Fee line when a
  // surcharge was included in the charge.
  // FIX: now takes stripeChargeId explicitly (the `ch_...` id, resolved from
  // intent.latest_charge by the caller) in addition to the PaymentIntent id,
  // and writes both onto the transaction. stripeChargeId is what the
  // connect-webhook's charge.succeeded handler matches on.
  const writeLedger = async (
    txnIdPrefix: string,
    paymentIntentId: string,
    stripeChargeId: string | null,
    clientData: any
  ) => {
    const batch = db.batch();
    const baseTxnRef = db.doc(`tenants/${tenantId}/transactions/${txnIdPrefix}`);
    batch.set(baseTxnRef, {
      id:                    txnIdPrefix,
      date:                  nowISO,
      description,
      clientOrVendor:        clientData?.name || 'Client',
      clientId,
      type:                  'income',
      context:               'Business',
      category,
      taxBucket:             'revenue',
      amount:                baseDollars,
      paymentMethod:         'Card on file (Stripe)',
      appointmentId:         appointmentId || null,
      stripePaymentIntentId: paymentIntentId,
      stripeChargeId:        stripeChargeId,
      checkoutSessionId:     checkoutSessionId || null,
      hasReceipt:            true,
      tenantId,
    }, { merge: true });

    if (surchargeDollars > 0) {
      const surchargeTxnRef = db.doc(`tenants/${tenantId}/transactions/${txnIdPrefix}__surcharge`);
      batch.set(surchargeTxnRef, {
        id:                    `${txnIdPrefix}__surcharge`,
        date:                  nowISO,
        description:           'Card Processing Fee (passed to client)',
        clientOrVendor:        clientData?.name || 'Client',
        clientId,
        type:                  'income',
        context:               'Business',
        category:              'Card Processing Fee',
        taxBucket:              'revenue',
        amount:                surchargeDollars,
        paymentMethod:         'Card on file (Stripe)',
        appointmentId:         appointmentId || null,
        stripePaymentIntentId: paymentIntentId,
        stripeChargeId:        stripeChargeId,
        checkoutSessionId:     checkoutSessionId || null,
        hasReceipt:            false,
        tenantId,
      }, { merge: true });
    }

    await batch.commit();
  };

  // ── Helper: park as arrears + write flag record (auto-mode failure path) ──
  // FIX: only called for kind === 'arrears_fee' now (see call sites below).
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

  // FIX: resolve the actual charge id (`ch_...`) off a confirmed/succeeded
  // PaymentIntent. `latest_charge` is a string id unless expanded; this works
  // either way without needing to add `expand` to the create() calls below.
  const resolveChargeId = (intent: Stripe.PaymentIntent): string | null => {
    const lc: any = intent.latest_charge;
    if (!lc) return null;
    return typeof lc === 'string' ? lc : lc.id || null;
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
      if (mode === 'auto' && isArrearsKind) await flagAndPark('no_card_on_file');
      return NextResponse.json({
        ok: false,
        flagged:        mode === 'auto' && isArrearsKind,
        reason:         'No card on file',
        parkedAsBalance: mode === 'auto' && isArrearsKind,
      });
    }

    // ── Load connected Stripe account ────────────────────────────────────────
    const tenantSnap      = await db.doc(`tenants/${tenantId}`).get();
    const stripeAccountId = tenantSnap.data()?.stripeAccountId;
    if (!stripeAccountId) {
      if (mode === 'auto' && isArrearsKind) await flagAndPark('no_connected_account');
      return NextResponse.json({
        ok: false,
        flagged:         mode === 'auto' && isArrearsKind,
        reason:          'No connected payment account. Configure Stripe in Settings.',
        parkedAsBalance: mode === 'auto' && isArrearsKind,
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
              surchargeCents: String(Math.round(surchargeDollars * 100)),
              // FIX: this is the field the connect-webhook's charge.succeeded
              // handler checks FIRST to find the matching revenue transaction.
              // Without it, the webhook fell through to a stripeChargeId
              // match that the ledger write below never satisfied either —
              // so the processing fee silently never attached.
              checkoutSessionId: checkoutSessionId || '',
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

      await writeLedger(`pos_cof__${intent.id}`, intent.id, resolveChargeId(intent), clientData);

      return NextResponse.json({ ok: true, paymentIntentId: intent.id, amount: amountDollars });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // AUTO MODE — client NOT present (policy engine: no-show, late-cancel;
    // OR a front-desk deposit charge per `kind: 'deposit'` — see header note)
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
            surchargeCents: String(Math.round(surchargeDollars * 100)),
            checkoutSessionId: checkoutSessionId || '', // FIX: same linkage as pos mode
          },
        },
        { stripeAccount: stripeAccountId, idempotencyKey }
      );
    } catch (stripeErr: any) {
      const code = stripeErr?.code || stripeErr?.raw?.code || 'charge_failed';
      if (isArrearsKind) await flagAndPark('stripe_error', code);
      return NextResponse.json({
        ok:              false,
        flagged:         isArrearsKind,
        reason:          stripeErr?.message || 'Charge failed',
        code,
        parkedAsBalance: isArrearsKind,
      });
    }

    if (intent.status !== 'succeeded') {
      if (isArrearsKind) await flagAndPark('not_succeeded', intent.status);
      return NextResponse.json({
        ok:              false,
        flagged:         isArrearsKind,
        reason:          `Charge ${intent.status}`,
        code:            intent.status,
        parkedAsBalance: isArrearsKind,
      });
    }

    await writeLedger(`card_charge__${intent.id}`, intent.id, resolveChargeId(intent), clientData);

    return NextResponse.json({ ok: true, paymentIntentId: intent.id, amount: amountDollars });

  } catch (err: any) {
    console.error('[stripe/charge-card]', err);
    if (mode === 'auto' && isArrearsKind) await flagAndPark('unexpected_error', err?.code);
    return NextResponse.json({
      ok:              false,
      flagged:         mode === 'auto' && isArrearsKind,
      reason:          err.message,
      parkedAsBalance: mode === 'auto' && isArrearsKind,
    }, { status: 200 });
  }
}
