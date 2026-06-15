// ─── /api/stripe/vault-card/route.ts ──────────────────────────────────────────
// Called after a successful embedded card form payment at POS when saveCard=true.
// Retrieves the payment method from the PaymentIntent and saves it to the client.

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

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
    const { tenantId, clientId, paymentIntentId, customerId } = await req.json();
    if (!tenantId || !clientId || !paymentIntentId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const db = getAdminDb();
    const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
    const stripeAccountId = tenantSnap.data()?.stripeAccountId;
    if (!stripeAccountId) return NextResponse.json({ ok: false, error: 'No Stripe account' });

    const stripe    = getStripe();
    const intent    = await stripe.paymentIntents.retrieve(paymentIntentId, { stripeAccount: stripeAccountId } as any);
    const pmId      = typeof intent.payment_method === 'string' ? intent.payment_method : intent.payment_method?.id;

    if (!pmId) return NextResponse.json({ ok: false, error: 'No payment method on intent' });

    const pm     = await stripe.paymentMethods.retrieve(pmId, { stripeAccount: stripeAccountId } as any);
    const nowISO = new Date().toISOString();

    await db.doc(`tenants/${tenantId}/clients/${clientId}`).update({
      cardOnFile: {
        token:           pmId,
        customerId:      customerId || (typeof intent.customer === 'string' ? intent.customer : null),
        paymentMethodId: pmId,
        brand:           pm.card?.brand   || null,
        last4:           pm.card?.last4   || null,
        expMonth:        pm.card?.exp_month || null,
        expYear:         pm.card?.exp_year  || null,
        savedAt:         nowISO,
        source:          'pos_embedded',
      },
      cardOnFileSavedAt: nowISO,
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[vault-card]', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}