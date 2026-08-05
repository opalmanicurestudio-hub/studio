import crypto from 'crypto';

// ─── src/lib/shipping-quote.ts ────────────────────────────────────────────────
// Signing for customer-chosen shipping rates.
//
// This lives in lib rather than inside the quote route because a route file is
// an endpoint, not a module to import from: Next compiles it for its own
// entrypoint, and importing one route from another produces exactly the build
// failure this replaces ("Can't resolve @/app/api/retail/shipping-quote/route").
//
// The contract: a quote is only trustworthy if it carries our signature over
// the exact tenant, amount, service and expiry. The browser chooses which
// service to buy; it can never choose the price.

const QUOTE_TTL_MIN = 30;

function quoteSecret(): string {
  return String(
    process.env.RETAIL_QUOTE_SECRET
    || process.env.FIREBASE_ADMIN_PRIVATE_KEY
    || 'clarityflow-quote'
  );
}

export function quoteExpiry(): number {
  return Date.now() + QUOTE_TTL_MIN * 60_000;
}

export function signQuote(tenantId: string, amountCents: number, service: string, expMs: number): string {
  return crypto
    .createHmac('sha256', quoteSecret())
    .update(`${tenantId}|${amountCents}|${service}|${expMs}`)
    .digest('base64url');
}

export function verifyQuote(
  tenantId: string, amountCents: number, service: string, expMs: number, sig: string
): boolean {
  if (!sig || !Number.isFinite(expMs) || Date.now() > expMs) return false;
  const expected = signQuote(tenantId, amountCents, service, expMs);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(sig));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
