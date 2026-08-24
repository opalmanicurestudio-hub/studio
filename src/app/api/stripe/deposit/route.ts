import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

// ─── Firebase Admin (lazy init — must be inside handler, not module scope) ───
function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  /* NAMED app, and the firestore instance is taken FROM it.
   *
   * This was `if (!getApps().length) initializeApp(...)` followed by a bare
   * `getFirestore()`. Both halves are wrong together: the guard asks "does
   * ANY app exist", but other routes in this codebase create their own NAMED
   * apps — so as soon as one of those had run in the same warm serverless
   * instance, this route decided initialisation was already done and then
   * asked for the DEFAULT app, which nobody had created. The result was a
   * checkout that failed with "The default Firebase app does not exist",
   * intermittently, depending purely on which route ran first.
   *
   * Naming the app and passing it to getFirestore removes the shared global
   * entirely — this route's initialisation no longer depends on what any
   * other route did. */
  const APP_NAME = 'admin-stripe-deposit';
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

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Creates an EMBEDDED Stripe Checkout Session to collect an appointment
// DEPOSIT on the studio's connected account, mounted directly inside the
// BookingSheet — no redirect away from the booking page.
//
//   • metadata.type = 'deposit'      ← the connect-webhook branches on this
//   • metadata.bookingRequestId      ← so the webhook can convert THAT request
//   • redirect_on_completion: 'never' + onComplete callback client-side means
//     the guest never leaves the page, even on completion.
//
// This route only COLLECTS. It posts nothing to the ledger — that happens in
// the connect-webhook once checkout.session.completed fires.
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const {
      tenantId,
      bookingRequestId,
      depositAmount,        // dollars
      clientName,
      clientEmail,
      serviceName,
      renterProviderId,     // present when this is an independent provider's booking
    } = await req.json();

    if (!tenantId || !bookingRequestId || !clientEmail || !depositAmount) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const db = getAdminDb();
    const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
    if (!tenantSnap.exists) {
      return NextResponse.json({ error: 'Studio not found' }, { status: 404 });
    }
    // ── Whose account collects this? ────────────────────────────────────────
    // For an independent provider's booking the money must land on THEIR
    // connected account, never the studio's. The account id is resolved here
    // from their provider record — never accepted from the caller — and only
    // when Stripe has actually enabled charges for them.
    let stripeAccountId = tenantSnap.data()?.stripeAccountId;
    let isRenterCharge = false;
    if (renterProviderId) {
      const stSnap = await db.doc(`tenants/${tenantId}/staff/${String(renterProviderId)}`).get();
      const st = stSnap.exists ? (stSnap.data() as any) : null;
      if (!st?.isRenter || !st?.renterId) {
        return NextResponse.json({ error: 'Provider not found.' }, { status: 404 });
      }
      const rSnap = await db.doc(`tenants/${tenantId}/renters/${st.renterId}`).get();
      const r = rSnap.exists ? (rSnap.data() as any) : null;
      if (!r?.stripeAccountId || r?.stripeChargesEnabled !== true) {
        return NextResponse.json(
          { error: 'This provider is not set up to take cards yet — book without a deposit and pay them directly.' },
          { status: 400 }
        );
      }
      stripeAccountId = r.stripeAccountId;
      isRenterCharge = true;
    }
    if (!stripeAccountId) {
      return NextResponse.json(
        { error: 'This studio has not connected a payment account yet.' },
        { status: 400 }
      );
    }

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create(
      {
        ui_mode:        'embedded',
        mode:           'payment',
        payment_method_types: ['card'],
        customer_email: clientEmail,
        customer_creation: 'always',
        line_items: [
          {
            price_data: {
              currency:     'usd',
              unit_amount:  Math.round(depositAmount * 100),
              product_data: {
                name:        serviceName ? `Deposit — ${serviceName}` : 'Appointment Deposit',
                description: 'Deposit to secure your appointment. Applied to your final total.',
              },
            },
            quantity: 1,
          },
        ],
        // Save the card for future off-session charges (final balance, fees, etc.)
        payment_intent_data: { setup_future_usage: 'off_session' },
        metadata: {
          tenantId,
          bookingRequestId,
          type:        'deposit',
          // Tagged so the webhook and any later reconciliation can tell a
          // renter's deposit from the studio's at a glance.
          ...(isRenterCharge ? { renterProviderId: String(renterProviderId) } : {}),
          serviceName: serviceName || '',
          clientName:  clientName  || '',
          clientEmail: clientEmail || '',
        },
        redirect_on_completion: 'never',
      },
      {
        stripeAccount: stripeAccountId,
      }
    );

    return NextResponse.json({
      clientSecret:   session.client_secret,
      sessionId:      session.id,
      stripeAccountId,
    });
  } catch (err: any) {
    console.error('[stripe/deposit]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
