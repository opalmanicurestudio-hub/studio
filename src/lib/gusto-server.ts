// src/lib/gusto-server.ts
//
// v87 — Server-side Gusto plumbing shared by the /api/gusto/* routes.
// Tokens live in tenants/{id}/private/gustoTokens (server-only under the
// hardened rules — the browser never sees them).
//
// Works against the sandbox out of the box: set GUSTO_AUTH_BASE and
// GUSTO_API_BASE to https://api.gusto-demo.com while your Gusto app is in
// sandbox; swap to https://api.gusto.com (the defaults) after production
// approval. No code changes either way.
//
// Token lifecycle: Gusto access tokens are short-lived and refresh tokens
// ROTATE on every refresh — the new pair is persisted immediately, because
// losing a rotated refresh token means the owner has to reconnect.

const GUSTO_API_BASE = process.env.GUSTO_API_BASE || 'https://api.gusto.com';
const GUSTO_AUTH_BASE = process.env.GUSTO_AUTH_BASE || 'https://api.gusto.com';

export type GustoAuth = { accessToken: string; companyId: string };

export async function saveGustoTokens(db: any, tenantId: string, tokens: any, companyId?: string | null) {
  await db.doc(`tenants/${tenantId}/private/gustoTokens`).set({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + (Number(tokens.expires_in) || 7200) * 1000,
    ...(companyId ? { companyId } : {}),
    updatedAt: new Date().toISOString(),
  }, { merge: true });
}

/** Load this tenant's Gusto auth, refreshing (and re-persisting) if stale. */
export async function getGustoAuth(db: any, tenantId: string): Promise<GustoAuth> {
  const snap = await db.doc(`tenants/${tenantId}/private/gustoTokens`).get();
  const t = snap.exists ? (snap.data() as any) : null;
  if (!t?.accessToken || !t?.companyId) {
    const err: any = new Error('Gusto isn’t connected for this business — connect it from the Payday tab.');
    err.status = 409;
    throw err;
  }
  // Still comfortably valid (5-min headroom)? Use as-is.
  if (Date.now() < (t.expiresAt || 0) - 5 * 60 * 1000) {
    return { accessToken: t.accessToken, companyId: t.companyId };
  }
  const res = await fetch(`${GUSTO_AUTH_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GUSTO_CLIENT_ID,
      client_secret: process.env.GUSTO_CLIENT_SECRET,
      refresh_token: t.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const err: any = new Error('Gusto session expired — reconnect Gusto from the Payday tab.');
    err.status = 401;
    throw err;
  }
  const fresh = await res.json();
  await saveGustoTokens(db, tenantId, fresh, t.companyId);
  return { accessToken: fresh.access_token, companyId: t.companyId };
}

/** Authenticated JSON call against the Gusto API; throws with a readable message. */
export async function gustoFetch(auth: GustoAuth, path: string, init: any = {}) {
  const res = await fetch(`${GUSTO_API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.accessToken}`,
      ...(init.headers || {}),
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = body?.errors?.[0]?.message || body?.message || body?.error_description
      || `Gusto API error (${res.status})`;
    const err: any = new Error(msg);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

/** Resolve the company uuid + name for a freshly exchanged token. */
export async function resolveGustoCompany(accessToken: string): Promise<{ companyId: string | null; companyName: string | null }> {
  try {
    const infoRes = await fetch(`${GUSTO_API_BASE}/v1/token_info`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const info: any = infoRes.ok ? await infoRes.json() : null;
    const companyId = info?.resource?.uuid || info?.company_uuid || info?.resource_uuid || null;
    if (!companyId) return { companyId: null, companyName: null };
    const coRes = await fetch(`${GUSTO_API_BASE}/v1/companies/${companyId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const co: any = coRes.ok ? await coRes.json() : null;
    return { companyId, companyName: co?.name || co?.trade_name || null };
  } catch {
    return { companyId: null, companyName: null };
  }
}
