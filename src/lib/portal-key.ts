// src/lib/portal-key.ts — the signed key on a client's private portal link.
// A portal link that can spend money (pay a balance, use gift cards) must carry
// proof it was issued by the business, not just the client's id. The key is an
// HMAC over `${tenantId}:${clientId}` with LINK_SECRET, base64url, 32 chars.
// No secret in production means links can't be signed, so callers refuse.
import { createHmac, timingSafeEqual } from 'crypto';

export const PORTAL_KEY_LENGTH = 32;

function isProduction(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV === 'production' && env.VERCEL_ENV === 'production';
}

/** The secret used to sign links, or null when signing isn't available (production without LINK_SECRET). */
export function linkSecret(env: Record<string, string | undefined> = process.env): string | null {
  const s = env.LINK_SECRET;
  if (s) return s;
  if (isProduction(env)) return null;
  return 'dev-only-link-secret';
}

/** Whether signed links can be made and checked here. */
export function portalKeysReady(env: Record<string, string | undefined> = process.env): boolean {
  return linkSecret(env) !== null;
}

/** The key for this client's portal link, or null when signing isn't set up. */
export function portalKey(tenantId: string, clientId: string, env: Record<string, string | undefined> = process.env): string | null {
  const secret = linkSecret(env);
  if (!secret || !tenantId || !clientId) return null;
  return createHmac('sha256', secret).update(`${tenantId}:${clientId}`).digest('base64url').slice(0, PORTAL_KEY_LENGTH);
}

/** True only when `key` is the valid key for this client. Constant-time compare. */
export function checkPortalKey(tenantId: string, clientId: string, key: unknown, env: Record<string, string | undefined> = process.env): boolean {
  if (typeof key !== 'string' || key.length !== PORTAL_KEY_LENGTH) return false;
  const want = portalKey(tenantId, clientId, env);
  if (!want) return false;
  const a = Buffer.from(want), b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}
