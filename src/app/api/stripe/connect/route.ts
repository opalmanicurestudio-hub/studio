/**
 * API Route: GET /api/stripe/connect
 * ─────────────────────────────────────────────────────────────────────────────
 * Backs the StripeConnectSetup component. Standard Connect via OAuth.
 *
 * File: src/app/api/stripe/connect/route.ts
 *
 * Two legs, same handler:
 *   1) START   — /api/stripe/connect?tenantId=XYZ  (no `code`)
 *                → redirects the studio to Stripe's OAuth authorize page.
 *   2) CALLBACK — Stripe redirects back here with ?code=...&state=...
 *                → exchanges the code, saves stripe_user_id (acct_...) onto the
 *                  tenant doc as `stripeAccountId`, returns to settings with
 *                  ?stripe=connected (or ?stripe=error).
 *
 * Requires in Vercel:
 *   STRIPE_SECRET_KEY
 *   STRIPE_CONNECT_CLIENT_ID   (the ca_... OAuth client id from Connect settings)
 *   NEXT_PUBLIC_APP_URL        (stable https URL of the app)
 *   FIREBASE_ADMIN_*           (same as every other admin route)
 *
 * In the Stripe dashboard you must register this exact redirect URI:
 *   {NEXT_PUBLIC_APP_URL}/api/stripe/connect
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

function withParam(base: string, kv: string) {
  return `${base}${base.includes('?') ? '&' : '?'}${kv}`;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || url.origin).replace(/\/$/, '');

  const code        = url.searchParams.get('code');
  const stateRaw    = url.searchParams.get('state');
  const oauthError  = url.searchParams.get('error');

  // ── CALLBACK LEG ──────────────────────────────────────────────────────────
  if (code || oauthError) {
    let tenantId = '';
    let ret = appUrl;
    try {
      const decoded = JSON.parse(Buffer.from(stateRaw || '', 'base64').toString('utf8'));
      tenantId = decoded.tenantId || '';
      ret      = decoded.ret || appUrl;
    } catch { /* fall back to appUrl */ }

    if (oauthError || !code) {
      return NextResponse.redirect(withParam(ret, 'stripe=error'));
    }

    try {
      const stripe = getStripe();
      const resp = await stripe.oauth.token({ grant_type: 'authorization_code', code });
      const connectedAccountId = (resp as any).stripe_user_id;
      if (!connectedAccountId || !tenantId) throw new Error('Missing connected account or tenant');

      const db = getAdminDb();
      await db.doc(`tenants/${tenantId}`).set(
        {
          stripeAccountId:   connectedAccountId,
          stripeConnectedAt: new Date().toISOString(),
        },
        { merge: true }
      );

      return NextResponse.redirect(withParam(ret, 'stripe=connected'));
    } catch (e: any) {
      console.error('[stripe/connect] token exchange failed:', e.message);
      return NextResponse.redirect(withParam(ret, 'stripe=error'));
    }
  }

  // ── START LEG ─────────────────────────────────────────────────────────────
  const tenantId = url.searchParams.get('tenantId') || '';
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId required' }, { status: 400 });
  }

  const clientId = process.env.STRIPE_CONNECT_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: 'STRIPE_CONNECT_CLIENT_ID is not configured in the environment.' },
      { status: 500 }
    );
  }

  // Remember where to send the studio back to (the settings page they came from)
  const referer = req.headers.get('referer') || appUrl;
  const ret = referer.split('?')[0];
  const state = Buffer.from(JSON.stringify({ tenantId, ret })).toString('base64');
  const redirectUri = `${appUrl}/api/stripe/connect`;

  const authorize = new URL('https://connect.stripe.com/oauth/authorize');
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', clientId);
  authorize.searchParams.set('scope', 'read_write');
  authorize.searchParams.set('redirect_uri', redirectUri);
  authorize.searchParams.set('state', state);

  return NextResponse.redirect(authorize.toString());
}