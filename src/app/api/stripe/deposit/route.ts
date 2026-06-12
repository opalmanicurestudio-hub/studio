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
// Creates a Stripe Checkout Session to collect an appointment DEPOSIT on the
// studio's connected account. Mirrors the event-ticket checkout route exactly.
//
// The only meaningful differences from tickets:
//   • metadata.type = 'deposit'      ← the webhook branches on this
//   • metadata.bookingRequestId      ← so the webhook can mark THAT request paid
//   • the line item is the deposit amount, labelled as a deposit
//
// This route only COLLECTS. It posts nothing to the ledger. Income recognition
// and netting happen later (webhook deposit branch + checkout subtraction),
// shipped together to avoid any double-count window.
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const {
      tenantId,
      bookingRequestId,
      depositAmount,        // dollars (matches how the ticket route takes `price`)
      clientName,
      clientEmail,
      serviceName,
      successUrl,
      cancelUrl,
    } = await req.json();

    if (!tenantId || !bookingRequestId || !clientEmail || !depositAmount) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Get the studio's connected Stripe account
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

    // Create checkout session on the studio's Stripe account
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create(
      {
        payment_method_types: ['card'],
        mode:           'payment',
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
        success_url: successUrl,
        cancel_url:  cancelUrl,
      },
      {
        stripeAccount: stripeAccountId,
      }
    );

    return NextResponse.json({ url: session.url, sessionId: session.id });
  } catch (err: any) {
    console.error('[stripe/deposit]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}