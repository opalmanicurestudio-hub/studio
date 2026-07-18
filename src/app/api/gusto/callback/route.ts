// src/app/api/gusto/callback/route.ts
//
// v87 — OAuth step 2, now fully wired. Gusto redirects here with
// ?code=...&state=<tenantId>. Exchange the code for tokens, resolve the
// company, persist everything server-side, mark the tenant connected,
// then bounce back to the Money Hub's Payday tab.
//
// Required env vars: GUSTO_CLIENT_ID, GUSTO_CLIENT_SECRET, GUSTO_REDIRECT_URI
// Sandbox: also set GUSTO_AUTH_BASE + GUSTO_API_BASE to https://api.gusto-demo.com

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { logAuditAdmin } from '@/lib/audit';
import { saveGustoTokens, resolveGustoCompany } from '@/lib/gusto-server';

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

    const db = getAdminDb();

    // ── Which Gusto company did the owner just authorize? ──
    const { companyId, companyName } = await resolveGustoCompany(tokens.access_token);
    if (!companyId) throw new Error('Could not resolve the Gusto company for this connection.');

    // ── Persist: tokens server-only, connection state on the tenant doc ──
    await saveGustoTokens(db, tenantId, tokens, companyId);
    await db.doc(`tenants/${tenantId}`).set({
      gusto: {
        connected: true,
        companyId,
        companyName: companyName || null,
        connectedAt: new Date().toISOString(),
      },
    }, { merge: true });

    await logAuditAdmin(db, tenantId, {
      action: 'gusto.connected',
      targetType: 'tenant', targetId: tenantId,
      summary: `Gusto connected${companyName ? ` — ${companyName}` : ''}`,
      actor: { type: 'user', name: 'Owner', via: 'gusto-oauth' },
    });

    return NextResponse.redirect(new URL('/money?tab=payday&gusto=connected', req.url));
  } catch (e) {
    console.error('Gusto callback failed:', e);
    return NextResponse.redirect(new URL('/money?tab=payday&gusto=error', req.url));
  }
}
