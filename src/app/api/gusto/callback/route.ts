// src/app/api/gusto/callback/route.ts
//
// OAuth step 2 — Gusto redirects here with ?code=...&state=<tenantId>.
// Exchange the code for tokens, store them server-side, mark the tenant
// as connected, then bounce back to the Money Hub's Payday tab.
//
// Required env vars: GUSTO_CLIENT_ID, GUSTO_CLIENT_SECRET, GUSTO_REDIRECT_URI

import { NextRequest, NextResponse } from 'next/server';

const GUSTO_AUTH_BASE = process.env.GUSTO_AUTH_BASE || 'https://api.gusto.com';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const tenantId = req.nextUrl.searchParams.get('state');

  if (!code || !tenantId) {
    return NextResponse.redirect(new URL('/money?tab=payday&gusto=error', req.url));
  }

  try {
    // ── Exchange authorization code for access + refresh tokens ──
    const tokenRes = await fetch(`${GUSTO_AUTH_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.GUSTO_CLIENT_ID,
        client_secret: process.env.GUSTO_CLIENT_SECRET,
        redirect_uri: process.env.GUSTO_REDIRECT_URI,
        code,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) throw new Error(`Token exchange failed (${tokenRes.status})`);
    const tokens = await tokenRes.json(); // { access_token, refresh_token, expires_in, ... }

    // ── TODO (server-side persistence) ─────────────────────────────────
    // Using firebase-admin (NOT the client SDK):
    //   1. Store tokens in a private collection the client can't read:
    //        tenants/{tenantId}/private/gustoTokens
    //        { accessToken, refreshToken, expiresAt }
    //   2. Fetch the company via GET /v1/token_info + /v1/companies/{id}
    //   3. Mark the tenant doc so the UI flips to "connected":
    //        tenants/{tenantId} → { gusto: { connected: true, companyId,
    //          companyName, connectedAt: new Date().toISOString() } }
    // ────────────────────────────────────────────────────────────────────
    void tokens; // remove once persistence above is implemented

    return NextResponse.redirect(new URL('/money?tab=payday&gusto=connected', req.url));
  } catch (e) {
    console.error('Gusto callback failed:', e);
    return NextResponse.redirect(new URL('/money?tab=payday&gusto=error', req.url));
  }
}
