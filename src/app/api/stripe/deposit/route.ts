import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

// ─── Firebase Admin (lazy init — must be inside handler, not module scope) ───
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
    } = await req.json();

    if (!tenantId || !bookingRequestId || !clientEmail || !depositAmount) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const db = getAdminDb();
    const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
    if (!tenantSnap.exists) {
      return NextResponse.json({ error: 'Studio not found' }, { status: 404 });
    }
    const stripeAccountId = tenantSnap.data()?.stripeAccountId;
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
        metadata: {
          tenantId,
          bookingRequestId,
          type:        'deposit',
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