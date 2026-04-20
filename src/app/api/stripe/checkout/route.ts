// FILE 1: src/app/api/stripe/checkout/route.ts
// Creates a Stripe Checkout session for paid event tickets
// ─────────────────────────────────────────────────────────────────────────────
 
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
 
// Initialize Firebase Admin (server-side only)
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}
 
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
});
 
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      tenantId, eventId, guestName, guestEmail, guestPhone,
      guestId, price, eventName, ticketName, successUrl, cancelUrl,
    } = body;
 
    if (!tenantId || !eventId || !guestEmail || !price) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
 
    // Get tenant's Stripe Connect account ID
    const db = getFirestore();
    const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
    if (!tenantSnap.exists) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }
    const tenant = tenantSnap.data()!;
    const stripeAccountId = tenant.stripeAccountId;
 
    if (!stripeAccountId) {
      return NextResponse.json(
        { error: 'This studio has not connected a payment account yet.' },
        { status: 400 }
      );
    }
 
    // Create Stripe Checkout session
    // Money goes directly to the studio's Stripe account (Connect)
    const session = await stripe.checkout.sessions.create(
      {
        payment_method_types: ['card'],
        mode: 'payment',
        customer_email: guestEmail,
        line_items: [
          {
            price_data: {
              currency: 'usd',
              unit_amount: Math.round(price * 100), // cents
              product_data: {
                name: ticketName || 'Event Ticket',
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
          guestPhone:  guestPhone || '',
          guestId:     guestId    || '',
          ticketName:  ticketName || 'General Admission',
        },
        success_url: successUrl,
        cancel_url:  cancelUrl,
      },
      {
        stripeAccount: stripeAccountId, // Direct to studio's account
      }
    );
 
    return NextResponse.json({ url: session.url, sessionId: session.id });
  } catch (err: any) {
    console.error('[stripe/checkout]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
 