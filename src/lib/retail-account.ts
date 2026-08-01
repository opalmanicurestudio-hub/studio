import { createHmac, timingSafeEqual } from 'crypto';

// ─── src/lib/retail-account.ts ────────────────────────────────────────────────
// Passwordless customer accounts, HMAC-signed like the pickup QR tokens: a
// token is proof that THIS email on THIS shop was verified, valid until exp.
// Nothing is stored server-side for sessions — verification is pure crypto,
// so the account API costs zero reads before the token checks out.

export const ACCOUNT_TOKEN_DAYS = 30;

function secret(): string {
  return process.env.RETAIL_QR_SECRET || process.env.STRIPE_SECRET_KEY || 'dev-secret';
}

export function normalizeEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

export function signAccountToken(tenantId: string, email: string, expMs: number): string {
  return createHmac('sha256', secret())
    .update(`acct.${tenantId}.${normalizeEmail(email)}.${expMs}`)
    .digest('hex');
}

export function verifyAccountToken(
  tenantId: string, email: string, expMs: number, sig: string
): { ok: boolean; reason?: string } {
  if (!tenantId || !email || !Number.isFinite(expMs) || !sig) return { ok: false, reason: 'Malformed link' };
  if (Date.now() > expMs) return { ok: false, reason: 'This link has expired — request a fresh one.' };
  const expected = signAccountToken(tenantId, email, expMs);
  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(String(sig), 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'Invalid link' };
  } catch {
    return { ok: false, reason: 'Invalid link' };
  }
  return { ok: true };
}

export function accountUrl(origin: string, tenantId: string, email: string): string {
  const exp = Date.now() + ACCOUNT_TOKEN_DAYS * 86_400_000;
  const sig = signAccountToken(tenantId, email, exp);
  const e = encodeURIComponent(normalizeEmail(email));
  return `${origin}/shop/${tenantId}/account?e=${e}&x=${exp}&s=${sig}`;
}
