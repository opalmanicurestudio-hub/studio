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

export async function POST(req: NextRequest) {
  try {
    const {
      tenantId,
      eventId,
      guestName,
      guestEmail,
      guestPhone,
      guestId,
      price,
      eventName,
      ticketName,
      successUrl,
      cancelUrl,
    } = await req.json();

    if (!tenantId || !eventId || !guestEmail || !price) {
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
        customer_email: guestEmail,
        line_items: [
          {
            price_data: {
              currency:     'usd',
              unit_amount:  Math.round(price * 100),
              product_data: {
                name:        ticketName || 'Event Ticket',
                description: eventName,
              },
            },
            quantity: 1,
          },
        ],
        metadata: {
          tenantId,
          eventId,
          guestName,
          guestEmail,
          guestPhone:  guestPhone  || '',
          guestId:     guestId     || '',
          ticketName:  ticketName  || 'General Admission',
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
    console.error('[stripe/checkout]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}