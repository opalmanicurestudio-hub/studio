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

export async function GET(req: NextRequest) {
  const code     = req.nextUrl.searchParams.get('code');
  const tenantId = req.nextUrl.searchParams.get('state');
  const error    = req.nextUrl.searchParams.get('error');

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';

  // User denied access or something went wrong on Stripe's side
  if (error || !code || !tenantId) {
    console.error('[stripe/connect/callback] Error or missing params:', { error, code, tenantId });
    return NextResponse.redirect(`${appUrl}/settings?stripe=error`);
  }

  try {
    // Exchange authorization code for the connected account ID
    const stripe = getStripe();
    const response = await stripe.oauth.token({
      grant_type: 'authorization_code',
      code,
    });

    const stripeAccountId = response.stripe_user_id;

    if (!stripeAccountId) {
      throw new Error('No stripe_user_id in OAuth response');
    }

    // Save the connected account ID to the tenant doc
    const db = getAdminDb();
    await db.doc(`tenants/${tenantId}`).update({
      stripeAccountId,
      stripeConnectedAt: new Date().toISOString(),
    });

    return NextResponse.redirect(`${appUrl}/settings?stripe=connected`);
  } catch (err: any) {
    console.error('[stripe/connect/callback] Failed to exchange code:', err.message);
    return NextResponse.redirect(`${appUrl}/settings?stripe=error`);
  }
}