// src/app/api/gusto/authorize/route.ts
//
// OAuth step 1 — redirect the salon owner to Gusto's consent screen.
//
// Required env vars (add to .env.local / hosting config):
//   GUSTO_CLIENT_ID       — from your Gusto Developer Portal app
//   GUSTO_REDIRECT_URI    — e.g. https://yourapp.com/api/gusto/callback
//   Use https://api.gusto-demo.com while your Gusto app is in sandbox.

import { NextRequest, NextResponse } from 'next/server';

const GUSTO_AUTH_BASE = process.env.GUSTO_AUTH_BASE || 'https://api.gusto.com';

export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId');
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
  }

  const clientId = process.env.GUSTO_CLIENT_ID;
  const redirectUri = process.env.GUSTO_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: 'Gusto is not configured. Set GUSTO_CLIENT_ID and GUSTO_REDIRECT_URI.' },
      { status: 501 },
    );
  }

  // `state` carries the tenantId through the OAuth round-trip so the
  // callback knows which tenant to attach the connection to.
  // TODO: sign this value (or stash a nonce in a cookie) to prevent CSRF.
  const authUrl = new URL(`${GUSTO_AUTH_BASE}/oauth/authorize`);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('state', tenantId);

  return NextResponse.redirect(authUrl.toString());
}
