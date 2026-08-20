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
  const APP_NAME = 'admin-connect-callback';
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
