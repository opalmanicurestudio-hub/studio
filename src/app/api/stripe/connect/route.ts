/**
 * API Route: GET /api/stripe/connect   — Express + Account Links (hosted onboarding)
 * ─────────────────────────────────────────────────────────────────────────────
 * Backs the StripeConnectSetup "Connect with Stripe" button.
 *
 * File: src/app/api/stripe/connect/route.ts
 *
 * Flow (no OAuth, no dashboard redirect registration):
 *   START  — /api/stripe/connect?tenantId=XYZ
 *            • If the tenant has no connected account, create an Express account
 *              and save its id to tenants/{tid}.stripeAccountId immediately.
 *            • If it already has one, reuse it and refresh charge/onboarding flags.
 *            • Generate a hosted Account Link and redirect the studio to Stripe.
 *   RETURN — Stripe sends the studio's browser back to return_url (your settings
 *            page) with ?stripe=connected. The component reads that + the saved id.
 *
 * Env:
 *   STRIPE_SECRET_KEY
 *   NEXT_PUBLIC_APP_URL   (optional — falls back to the request origin)
 *   FIREBASE_ADMIN_PROJECT_ID / CLIENT_EMAIL / PRIVATE_KEY
 */

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

function getAdminDb() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const APP_NAME = 'admin';
  let app = getApps().find((a) => a.name === APP_NAME);
  if (!app) {
    app = initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    }, APP_NAME);
  }
  return getFirestore(app);
}

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || url.origin).replace(/\/$/, '');

  const tenantId = url.searchParams.get('tenantId') || '';
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId required' }, { status: 400 });
  }

  // Where to send the studio back to after onboarding — the page they came from.
  const referer = req.headers.get('referer') || `${appUrl}/settings`;
  const ret = referer.split('?')[0];

  try {
    const stripe = getStripe();
    const db = getAdminDb();

    const tenantRef  = db.doc(`tenants/${tenantId}`);
    const tenantSnap = await tenantRef.get();
    if (!tenantSnap.exists) {
      return NextResponse.json({ error: 'Studio not found' }, { status: 404 });
    }

    let accountId: string | undefined = tenantSnap.data()?.stripeAccountId;

    // Create the Express account on first connect.
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        capabilities: {
          card_payments: { requested: true },
          transfers:     { requested: true },
        },
        business_profile: {
          name: tenantSnap.data()?.name || undefined,
        },
        metadata: { tenantId },
      });
      accountId = account.id;
      await tenantRef.set(
        {
          stripeAccountId:   accountId,
          stripeConnectedAt: new Date().toISOString(),
          stripeChargesEnabled: false,
        },
        { merge: true }
      );
    } else {
      // Reuse — refresh the onboarding/charge status so the rest of the app can gate on it.
      try {
        const acct = await stripe.accounts.retrieve(accountId);
        await tenantRef.set(
          {
            stripeChargesEnabled:   !!acct.charges_enabled,
            stripeDetailsSubmitted: !!acct.details_submitted,
          },
          { merge: true }
        );
      } catch { /* non-fatal */ }
    }

    // Hosted onboarding link. return_url = back to settings; refresh_url = remint if expired.
    const link = await stripe.accountLinks.create({
      account:     accountId,
      refresh_url: `${appUrl}/api/stripe/connect?tenantId=${encodeURIComponent(tenantId)}`,
      return_url:  `${ret}?stripe=connected`,
      type:        'account_onboarding',
    });

    return NextResponse.redirect(link.url);
  } catch (e: any) {
    console.error('[stripe/connect] error:', e.message);
    return NextResponse.redirect(`${ret}?stripe=error`);
  }
}