import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

// ─── /api/stripe/webhook/route.ts ─────────────────────────────────────────────
// YOUR ACCOUNT webhook — events on your Stripe platform account.
// Stripe Dashboard: Developers → Webhooks → "Your account" endpoint
// Secret env var: STRIPE_WEBHOOK_SECRET
//
// Events handled:
//   account.updated   → sync connected account status to tenant doc

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin-platform-webhook';
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

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const sig     = req.headers.get('stripe-signature');
  const secret  = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !secret) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2025-04-30.basil' as any });
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err: any) {
    console.error('[platform-webhook] Signature verification failed:', err.message);
    return NextResponse.json({ error: 'Webhook Error' }, { status: 400 });
  }

  const db = getAdminDb();

  try {
    switch (event.type) {

      // ── account.updated: sync connected account status ────────────────────
      case 'account.updated': {
        const account = event.data.object as Stripe.Account;
        const tenantSnap = await db.collection('tenants')
          .where('stripeAccountId', '==', account.id)
          .limit(1).get();

        if (tenantSnap.empty) break;

        await tenantSnap.docs[0].ref.set({
          stripeOnboardingComplete: account.details_submitted && account.charges_enabled,
          stripeChargesEnabled:     account.charges_enabled,
          stripePayoutsEnabled:     account.payouts_enabled,
          stripeAccountUpdatedAt:   new Date().toISOString(),
        }, { merge: true });

        console.log('[platform-webhook] Account updated:', account.id);
        break;
      }

      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error('[platform-webhook] Handler error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
