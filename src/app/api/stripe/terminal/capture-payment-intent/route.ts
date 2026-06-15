import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { nanoid } from 'nanoid';

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin';
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

export async function POST(req: NextRequest) {
  try {
    const {
      tenantId,
      clientId,
      paymentIntentId,
      customerId,
      saveCard = false,
    } = await req.json();

    if (!tenantId || !paymentIntentId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const db = getAdminDb();
    const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
    const stripeAccountId = tenantSnap.data()?.stripeAccountId;
    if (!stripeAccountId) {
      return NextResponse.json({ error: 'No connected Stripe account' }, { status: 400 });
    }

    const stripe = getStripe();

    // Capture the payment intent
    const intent = await stripe.paymentIntents.capture(
      paymentIntentId,
      {},
      { stripeAccount: stripeAccountId }
    );

    if (intent.status !== 'succeeded') {
      return NextResponse.json({ ok: false, error: `Capture failed: ${intent.status}` }, { status: 400 });
    }

    // If saveCard requested, vault the card onto the client profile
    if (saveCard && clientId && customerId) {
      try {
        const pm = intent.payment_method;
        if (pm && typeof pm === 'string') {
          const pmObj = await stripe.paymentMethods.retrieve(pm, { stripeAccount: stripeAccountId } as any);
          const nowISO = new Date().toISOString();
          await db.doc(`tenants/${tenantId}/clients/${clientId}`).update({
            cardOnFile: {
              token:           pm,
              customerId,
              paymentMethodId: pm,
              brand:           pmObj.card_present?.brand || pmObj.card?.brand || null,
              last4:           pmObj.card_present?.last4 || pmObj.card?.last4 || null,
              expMonth:        pmObj.card_present?.exp_month || pmObj.card?.exp_month || null,
              expYear:         pmObj.card_present?.exp_year  || pmObj.card?.exp_year  || null,
              savedAt:         nowISO,
              source:          'terminal',
            },
            cardOnFileSavedAt: new Date().toISOString(),
          });
        }
      } catch (e) {
        console.warn('[terminal/capture] card save failed (non-fatal)', e);
      }
    }

    return NextResponse.json({ ok: true, paymentIntentId: intent.id });
  } catch (err: any) {
    console.error('[terminal/capture-payment-intent]', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}