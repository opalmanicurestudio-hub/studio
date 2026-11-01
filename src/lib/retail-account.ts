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

// Two kinds of session, told apart by what's signed. Both sign someone in. A PROVEN one was opened from a link
// emailed to that address (the sign-in link, a wholesale buyer's code link), so it shows they read that inbox; the plain
// kind can also come from an order's pass (account/exchange), which whoever placed the order holds, whatever email they
// typed. Anything that hangs on the email being really theirs (a wholesale buyer's tax-free order) takes only the proven
// kind (verifyProvenAccountToken); everything else takes either.
export function signProvenAccountToken(tenantId: string, email: string, expMs: number): string {
  return createHmac('sha256', secret())
    .update(`acctp.${tenantId}.${normalizeEmail(email)}.${expMs}`)
    .digest('hex');
}
const sameHex = (a: string, b: string) => {
  try { const x = Buffer.from(a, 'hex'); const y = Buffer.from(String(b), 'hex'); return x.length === y.length && x.length > 0 && timingSafeEqual(x, y); } catch { return false; }
};
/** A session opened from a link emailed to this address (see above). */
export function verifyProvenAccountToken(tenantId: string, email: string, expMs: number, sig: string): { ok: boolean; reason?: string } {
  if (!tenantId || !email || !Number.isFinite(expMs) || !sig) return { ok: false, reason: 'Malformed link' };
  if (Date.now() > expMs) return { ok: false, reason: 'This link has expired — request a fresh one.' };
  return sameHex(signProvenAccountToken(tenantId, email, expMs), sig) ? { ok: true } : { ok: false, reason: 'Invalid link' };
}

export function verifyAccountToken(
  tenantId: string, email: string, expMs: number, sig: string
): { ok: boolean; reason?: string } {
  if (!tenantId || !email || !Number.isFinite(expMs) || !sig) return { ok: false, reason: 'Malformed link' };
  if (Date.now() > expMs) return { ok: false, reason: 'This link has expired — request a fresh one.' };
  // Either kind signs them in.
  if (sameHex(signAccountToken(tenantId, email, expMs), sig) || sameHex(signProvenAccountToken(tenantId, email, expMs), sig)) return { ok: true };
  return { ok: false, reason: 'Invalid link' };
}

/** The sign-in link emailed to them: a proven session (it reached their inbox). */
export function accountUrl(origin: string, tenantId: string, email: string): string {
  const exp = Date.now() + ACCOUNT_TOKEN_DAYS * 86_400_000;
  const sig = signProvenAccountToken(tenantId, email, exp);
  const e = encodeURIComponent(normalizeEmail(email));
  return `${origin}/shop/${tenantId}/account?e=${e}&x=${exp}&s=${sig}`;
}
